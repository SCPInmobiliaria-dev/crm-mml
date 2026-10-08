// Convierte una batería «begin … rollback» (bloques DO + tablas temporales on commit drop)
// en una sola función que corre todo en UNA sentencia, lo deshace con un error atrapado
// y devuelve el cuadro como filas. Así funciona igual en psql, en PGlite y en el SQL
// Editor de Supabase, mantenga o no la transacción entre sentencias.
// Uso: node convertir-bateria.mjs <entrada.sql> <salida.sql> <nombre_funcion>
import fs from 'node:fs'

const [entrada, salida, nombre, guardia, faltante] = process.argv.slice(2)
// guardia: expresión SQL booleana que es true si la migración que se prueba está aplicada.
// faltante: el archivo que falta aplicar, para decirlo en el cuadro.
const t = fs.readFileSync(entrada, 'utf8').replace(/\r\n/g, '\n')

const ini = t.indexOf('-- @@INICIO_CUERPO')
const fin = t.indexOf('-- @@FIN_CUERPO')
if (ini < 0 || fin < 0) throw new Error('faltan las marcas @@INICIO_CUERPO / @@FIN_CUERPO')

// La cabecera: los comentarios de arriba, sin el `begin;`.
let cabecera = t.slice(0, ini)
cabecera = cabecera.replace(/^begin;\s*$/m, '').trimEnd()

// El cuerpo: cada `do $$ … end $$;` pasa a ser un bloque anidado `… end;`.
const lineas = t.slice(ini, fin).split('\n')
let enDo = false
let bloques = 0
const cuerpo = lineas.map((l) => {
  if (/^do \$\$\s*$/.test(l)) {
    if (enDo) throw new Error('DO anidado sin cerrar')
    enDo = true
    bloques++
    return '  -- (bloque)'
  }
  if (enDo && /^end \$\$;\s*$/.test(l)) {
    enDo = false
    return 'end;'
  }
  return l
})
if (enDo) throw new Error('un bloque DO quedó sin cerrar')

// El cuadro final: la consulta entre @@FIN_CUERPO y el rollback.
const resto = t.slice(fin)
const desde = resto.indexOf('with resumen as (')
const hasta = resto.indexOf('order by n;', desde)
if (desde < 0 || hasta < 0) throw new Error('no encontré el cuadro final')
const cuadro = resto.slice(desde, hasta + 'order by n'.length)

const sql = `${cabecera}
--
-- ---------------------------------------------------------------------
-- CÓMO SE CORRE (versión de una sola sentencia, 07/10/2026)
-- ---------------------------------------------------------------------
-- El SQL Editor de Supabase no siempre mantiene un \`begin … rollback\` entre
-- sentencias: la primera corrida de esta batería falló con «relation
-- "resultado" does not exist» porque la tabla temporal ya se había borrado.
-- Por eso ahora TODO va dentro de una función: corre en una sola sentencia,
-- lo deshace todo al final (un error atrapado a propósito: nada de lo que
-- crea queda en la base) y devuelve el cuadro como filas. La función se
-- borra sola al terminar. Se pega entero y se pulsa Run; da igual el editor.
-- =====================================================================

create or replace function public.${nombre}()
returns table (n integer, regla text, veredicto text, prueba text, esperado text, obtenido text)
language plpgsql set search_path = public as $bateria$
#variable_conflict use_column
declare
  v_cuadro jsonb;
begin
${guardia ? `  -- Sin la migración que se prueba, no se corre nada: se dice qué falta.
  if not (${guardia}) then
    return query
      select 1, 'PRE'::text, '🔴 FALLA'::text, 'La migración está aplicada'::text, 'sí'::text,
             'NO: falta aplicar ${faltante} en el SQL Editor. Aplícala primero y vuelve a correr esta batería.'::text
      union all
      select 9999, 'RESUMEN'::text, '0 pasan · 1 fallan · 0 omitidas'::text, '1 pruebas'::text,
             'Mira las filas 🔴 de arriba: son las únicas que exigen algo'::text, ''::text;
    execute 'drop function if exists public.${nombre}()';
    return;
  end if;
` : ''}  begin
${cuerpo.join('\n')}
    -- El cuadro, ANTES de deshacer: lo que se guarda en una variable sobrevive.
    select jsonb_agg(to_jsonb(c) order by c.n) into v_cuadro
      from (
${cuadro}
      ) c;
    -- Deshacer TODO lo que hizo la batería (unidades, personas, separaciones,
    -- papeles, tablas y funciones temporales): un error atrapado justo abajo.
    raise exception using errcode = 'P0999', message = 'deshacer la batería';
  exception when sqlstate 'P0999' then
    null;
  end;

  -- La función no se queda en la base: se borra a sí misma.
  execute 'drop function if exists public.${nombre}()';

  return query
    select x.n, x.regla, x.veredicto, x.prueba, x.esperado, x.obtenido
      from jsonb_to_recordset(v_cuadro)
        as x(n integer, regla text, veredicto text, prueba text, esperado text, obtenido text)
     order by x.n;
end $bateria$;

-- Nadie la puede llamar por la API mientras exista (solo quien la creó, en el editor).
revoke all on function public.${nombre}() from public, anon, authenticated;

select * from public.${nombre}();
`
fs.writeFileSync(salida, sql)
console.log(`ok: ${bloques} bloques DO convertidos → ${salida}`)
