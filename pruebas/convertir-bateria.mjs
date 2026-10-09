// Convierte una batería «begin … rollback» (bloques DO + tablas temporales on commit drop)
// en UNA función que corre todo en una sola sentencia, lo deshace con un error atrapado a
// propósito y devuelve el cuadro como filas. Así funciona igual en psql, en PGlite y en el
// SQL Editor de Supabase, mantenga o no la transacción entre sentencias.
//
// Uso: node convertir-bateria.mjs <entrada> <salida> <nombre_fn> <guardia_sql_booleana> <faltante> [verbo] [detalle_sql]
//   guardia   expresión SQL booleana: true si lo que la batería NECESITA PARA CORRER existe. Nunca
//             debe exigir lo que la batería DEFIENDE (un trigger, una política): si eso falta, la
//             batería tiene que correr y poner 🔴 las filas que lo prueban, no decir «falta aplicar».
//             Vacía = sin guardia.
//   faltante  el archivo que falta aplicar, para el mensaje de la fila PRE.
//   verbo     «Aplícala» (por omisión) o «Aplícalas».
//   detalle   expresión SQL que devuelve texto con LO QUE FALTA (o NULL si no falta nada); sustituye a
//             la guardia y hace que la fila PRE nombre los objetos ausentes.
//
// La entrada necesita las marcas «-- @@INICIO_CUERPO» y «-- @@FIN_CUERPO» (el cuerpo va entre
// ellas) y, tras la segunda, el cuadro final que empieza en «with resumen as (» y termina en
// «order by n;». Cada `do $$ … end $$;` pasa a ser un bloque anidado etiquetado `<<bloque_N>>`.
//
// Lo que NO se puede convertir a ciegas, y por eso falla en voz alta:
//   · un `return;` dentro de un DO se convierte en `exit bloque_N;` (en un DO sale del bloque; en
//     la función saldría de TODA la función y se tragaría las pruebas siguientes). Cualquier otro
//     `return` DENTRO de un DO se rechaza; fuera de un DO (funciones auxiliares) se deja tal cual.
//   · un `do $$` anidado o un DO sin cerrar.
//
// Qué pasa si el cuerpo se cae (07/10/2026, hallazgo del verificador independiente de la 19): el
// error se atrapa, lo que la batería ya hizo se deshace con el sub-bloque, la función se borra igual
// y el editor muestra UNA fila 🔴 CAÍDA con el error y su contexto. Antes, en el editor sentencia
// por sentencia, la función se quedaba en la base.
import fs from 'node:fs'

const [entrada, salida, nombre, guardia = '', faltante = '', verbo = 'Aplícala', detalle = ''] = process.argv.slice(2)
if (!entrada || !salida || !nombre) {
  console.error('uso: node convertir-bateria.mjs <entrada> <salida> <nombre_fn> <guardia_sql> <faltante> [verbo] [detalle_sql]')
  process.exit(2)
}
const t = fs.readFileSync(entrada, 'utf8').replace(/\r\n/g, '\n')

const ini = t.indexOf('-- @@INICIO_CUERPO')
const fin = t.indexOf('-- @@FIN_CUERPO')
if (ini < 0 || fin < 0) throw new Error('faltan las marcas @@INICIO_CUERPO / @@FIN_CUERPO')

// La cabecera: los comentarios de arriba, sin el `begin;`.
let cabecera = t.slice(0, ini)
cabecera = cabecera.replace(/^begin;\s*$/m, '').trimEnd()

// El cuerpo: cada `do $$ … end $$;` pasa a ser un bloque anidado etiquetado `<<bloque_N>> … end;`.
const lineas = t.slice(ini, fin).split('\n')
let enDo = false
let bloques = 0
let returns = 0
const cuerpo = lineas.map((l) => {
  if (/^do \$\$\s*$/.test(l)) {
    if (enDo) throw new Error('DO anidado sin cerrar')
    enDo = true
    bloques++
    return `<<bloque_${bloques}>>`
  }
  if (enDo && /^end \$\$;\s*$/.test(l)) {
    enDo = false
    return 'end;'
  }
  if (enDo && /^\s*return;\s*$/.test(l)) {
    returns++
    return l.replace(/return;/, `exit bloque_${bloques};`)
  }
  // Fuera de un DO, un `return valor;` es de una función auxiliar (pg_temp.*): se deja tal cual.
  if (enDo && /\breturn\b/i.test(l.replace(/--.*$/, '').replace(/'[^']*'/g, "''"))) {
    throw new Error('un `return` dentro de un DO que no sé convertir: ' + l.trim())
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

// El RESUMEN de las filas PRE y CAÍDA imita el formato del cuadro de esta batería (con o sin «conocidas»).
const resumenPre = /conocidas/.test(cuadro)
  ? '0 pasan · 1 fallan · 0 conocidas · 0 omitidas · 0 a revisar'
  : '0 pasan · 1 fallan · 0 omitidas'

const NL = String.fromCharCode(10)
const hayGuardia = Boolean(detalle || guardia)
const bloqueGuardia = hayGuardia
  ? `  -- Sin lo que se necesita para correr, no se corre nada: se dice qué falta.
${detalle ? `  v_falta := (
    ${detalle.split(NL).join(NL + '    ')});
  if v_falta is not null then` : `  if not (${guardia}) then`}
    return query
      select 1, 'PRE'::text, '🔴 FALLA'::text, 'Lo que se prueba está aplicado'::text, 'sí'::text,
             ('NO: falta aplicar ${faltante} en el SQL Editor.'${detalle ? " || ' Faltan: ' || v_falta || '.'" : ''} || ' ${verbo} primero y vuelve a correr esta batería.')::text
      union all
      select 9999, 'RESUMEN'::text, '${resumenPre}'::text, '1 pruebas'::text,
             'Mira las filas 🔴 de arriba: son las únicas que exigen algo'::text, ''::text;
    execute 'drop function if exists public.${nombre}()';
    return;
  end if;
`
  : ''

const sql = `${cabecera}
--
-- ---------------------------------------------------------------------
-- CÓMO SE CORRE (versión de una sola sentencia, 07/10/2026)
-- ---------------------------------------------------------------------
-- El SQL Editor de Supabase no siempre mantiene un \`begin … rollback\` entre
-- sentencias: la primera corrida de la batería 17 falló con «relation
-- "resultado" does not exist» porque la tabla temporal ya se había borrado.
-- Por eso ahora TODO va dentro de una función: corre en una sola sentencia,
-- lo deshace todo al final (un error atrapado a propósito: nada de lo que
-- crea queda en la base) y devuelve el cuadro como filas. La función se
-- borra sola al terminar. Se pega entero y se pulsa Run; da igual el editor.
-- Si falta lo que se necesita para correr, no corre nada: devuelve UNA sola
-- fila 🔴 PRE que dice qué falta. Si el cuerpo se cae a mitad de camino,
-- devuelve UNA fila 🔴 CAÍDA con el error y dónde ocurrió, y tampoco deja
-- nada en la base.
-- =====================================================================

create or replace function public.${nombre}()
returns table (n integer, regla text, veredicto text, prueba text, esperado text, obtenido text)
language plpgsql set search_path = public as $bateria$
#variable_conflict use_column
declare
  v_cuadro jsonb;
  v_caida  text;
  v_ctx    text;${detalle ? `
  v_falta  text;` : ''}
begin
${bloqueGuardia}  begin
${cuerpo.join('\n')}
    -- El cuadro, ANTES de deshacer: lo que se guarda en una variable sobrevive.
    select jsonb_agg(to_jsonb(c) order by c.n) into v_cuadro
      from (
${cuadro}
      ) c;
    -- Deshacer TODO lo que hizo la batería (unidades, personas, separaciones,
    -- papeles, tablas y funciones temporales): un error atrapado justo abajo.
    raise exception using errcode = 'P0999', message = 'deshacer la batería';
  exception
    when sqlstate 'P0999' then
      null;
    when others then
      -- La batería se cayó a mitad de camino (p. ej. una regresión en la migración que prueba).
      -- Lo que hizo ya se deshizo con el sub-bloque; el error no se esconde: sale como fila.
      get stacked diagnostics v_ctx = pg_exception_context;
      v_caida := sqlerrm;
  end;

  -- La función no se queda en la base: se borra a sí misma.
  execute 'drop function if exists public.${nombre}()';

  if v_caida is not null then
    return query
      select 1, 'CAÍDA'::text, '🔴 FALLA'::text, 'La batería llegó hasta el final sin caerse'::text, 'sin error'::text,
             left(v_caida || ' · ' || coalesce(replace(v_ctx, E'\\n', ' | '), ''), 1200)::text
      union all
      select 9999, 'RESUMEN'::text, '${resumenPre}'::text, '1 pruebas'::text,
             'La batería se cayó: la fila 🔴 de arriba dice dónde. Nada de lo que hizo quedó en la base'::text, ''::text;
    return;
  end if;

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
console.log(`ok: ${bloques} bloques DO convertidos, ${returns} return → exit etiquetado → ${salida}`)
