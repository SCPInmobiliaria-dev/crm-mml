-- =====================================================================
-- CRM Mercado Media Luna — PRUEBAS DE 19 · PRECIO POR UNIDAD
--
-- Qué comprueba: lo que sql/19-precio-por-unidad.sql promete. Que una unidad
-- solo apunta a un nivel de precio de su tipo y con moneda (la base lo
-- impide, no el formulario); que fn_asignar_precio la usan Dirección y
-- Administración y nadie más, salta las de otro tipo y no reescribe lo que
-- ya está; que la web ve `precio` SOLO de una unidad disponible con su nivel
-- en 🟢 verde; que anon ve la función pública y no la de asignar; y que el
-- aviso de Realtime salta con un nivel de precio y no con otro parámetro.
--
-- 🟢 ESTADO: escrito el 06/10/2026. Arnés PGlite local (01..14 + 16 + 18 +
--    19): 20 pasan, 0 fallan, 0 omitidas. Producción (06/10/2026, dentro de
--    una transacción que se deshizo entera): 20/20 pasan.
--
-- CÓMO SE LEE: igual que pruebas\reglas-16.sql. ✅ PASA · 🔴 FALLA ·
-- 🟡 OMITIDA. Al final, un solo cuadro con la fila RESUMEN (n=9999).
--
-- ESTE ARCHIVO NO DEJA RASTRO: todo va dentro de `begin … rollback` (las
-- unidades PRUEBA19-*, los niveles precio_puesto_prueba19*, el aviso de
-- Realtime encolado). ⚠️ NO borres el `rollback` del final.
--
-- AQUÍ NO HAY NI UNA CIFRA DEL NEGOCIO: los montos 1, 2, 3 y 4 y el área 1
-- son FICHAS DE JUGUETE (07-crm\CLAUDE.md §2).
--
-- REQUISITOS: 01..14, 16 y 19 aplicados (18 da igual). Para las filas RPC
-- hace falta un perfil activo `comercial` y otro de `direccion`; sin ellos
-- salen 🟡 OMITIDA.
-- Lo esperado: `20 pasan · 0 fallan · 0 omitidas` (así salió en PGlite el 06/10/2026).
-- =====================================================================
--
-- ---------------------------------------------------------------------
-- CÓMO SE CORRE (versión de una sola sentencia, 07/10/2026)
-- ---------------------------------------------------------------------
-- El SQL Editor de Supabase no siempre mantiene un `begin … rollback` entre
-- sentencias: la primera corrida de esta batería falló con «relation
-- "resultado" does not exist» porque la tabla temporal ya se había borrado.
-- Por eso ahora TODO va dentro de una función: corre en una sola sentencia,
-- lo deshace todo al final (un error atrapado a propósito: nada de lo que
-- crea queda en la base) y devuelve el cuadro como filas. La función se
-- borra sola al terminar. Se pega entero y se pulsa Run; da igual el editor.
-- =====================================================================

create or replace function public.probar_reglas_19()
returns table (n integer, regla text, veredicto text, prueba text, esperado text, obtenido text)
language plpgsql set search_path = public as $bateria$
#variable_conflict use_column
declare
  v_cuadro jsonb;
  v_caida  text;
  v_ctx    text;
begin
  -- Sin la migración que se prueba, no se corre nada: se dice qué falta.
  if not (to_regprocedure('public.fn_asignar_precio(uuid[],text)') is not null) then
    return query
      select 1, 'PRE'::text, '🔴 FALLA'::text, 'La migración está aplicada'::text, 'sí'::text,
             'NO: falta aplicar sql/19-precio-por-unidad.sql en el SQL Editor. Aplícala primero y vuelve a correr esta batería.'::text
      union all
      select 9999, 'RESUMEN'::text, '0 pasan · 1 fallan · 0 omitidas'::text, '1 pruebas'::text,
             'Mira las filas 🔴 de arriba: son las únicas que exigen algo'::text, ''::text;
    execute 'drop function if exists public.probar_reglas_19()';
    return;
  end if;
  begin
-- @@INICIO_CUERPO

create temporary table resultado (
  n         serial primary key,
  regla     text not null,
  prueba    text not null,
  esperado  text not null,
  obtenido  text not null,
  veredicto text not null
) on commit drop;

create temporary table fixture (clave text primary key, id uuid) on commit drop;

create function pg_temp.anotar(p_regla text, p_prueba text, p_esperado text, p_obtenido text, p_ok boolean)
returns void language sql as $$
  insert into resultado (regla, prueba, esperado, obtenido, veredicto)
  values (p_regla, p_prueba, p_esperado, coalesce(p_obtenido, '(nulo)'),
          case when coalesce(p_ok, false) then '✅ PASA' else '🔴 FALLA' end)
$$;

create function pg_temp.omitir(p_regla text, p_prueba text, p_falta text)
returns void language sql as $$
  insert into resultado (regla, prueba, esperado, obtenido, veredicto)
  values (p_regla, p_prueba, 'ver prueba', 'falta: ' || p_falta, '🟡 OMITIDA')
$$;

create function pg_temp.f(p_clave text) returns uuid language sql stable as $$
  select id from fixture where clave = p_clave
$$;

create function pg_temp.como(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then ''
         else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
end $$;

-- La unidad PRUEBA19-… tal como la ve la web.
create function pg_temp.publica(p_codigo text) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(fn_inventario_publico() -> 'unidades') as e
   where e ->> 'codigo' = p_codigo
$$;


-- ---------------------------------------------------------------------
-- 0 · PREPARACIÓN
-- ---------------------------------------------------------------------
insert into parametros (id, descripcion, valor_numerico, valor_moneda, unidad, fuente, estado_semaforo) values
  ('precio_puesto_prueba19a', 'PRUEBA19 nivel verde',      1, 'USD', 'monto', 'PRUEBA', 'verde'),
  ('precio_puesto_prueba19b', 'PRUEBA19 nivel propuesta',  2, 'USD', 'monto', 'PRUEBA', 'azul'),
  ('precio_tienda_prueba19',  'PRUEBA19 nivel de tienda', 3, 'USD', 'monto', 'PRUEBA', 'verde'),
  ('precio_puesto_prueba19x', 'PRUEBA19 nivel sin moneda', 4, null, 'monto', 'PRUEBA', 'verde');

with nuevas as (
  insert into unidades (codigo_unidad, tipo, area_m2, estado_comercial, estado_dato, fuente_plano)
  values ('PRUEBA19-P1', 'puesto', 1, 'disponible',    'verde', 'PRUEBA plano'),
         ('PRUEBA19-P2', 'puesto', 1, 'disponible',    'verde', 'PRUEBA plano'),
         ('PRUEBA19-P3', 'puesto', 1, 'no_disponible', 'verde', 'PRUEBA plano'),
         ('PRUEBA19-T1', 'Tienda', 1, 'disponible',    'verde', 'PRUEBA plano')
  returning id, codigo_unidad
)
insert into fixture select replace(codigo_unidad, 'PRUEBA19-', ''), id from nuevas;

insert into fixture select 'comercial', id from perfiles where rol = 'comercial' and activo order by creado_el limit 1;
insert into fixture select 'direccion', id from perfiles where rol = 'direccion' and activo order by creado_el limit 1;


-- ---------------------------------------------------------------------
-- 1 · LA BASE IMPIDE UN PRECIO QUE NO CORRESPONDE (t_unidades_precio_valido)
-- ---------------------------------------------------------------------
<<bloque_1>>
begin
  begin
    update unidades set precio_parametro = 'inventario_disponibilidad_corte' where id = pg_temp.f('P1');
    perform pg_temp.anotar('BASE', 'apuntar a un parámetro que no es precio', 'rechazo «no es un precio de lista»', 'aceptado', false);
  exception when others then
    perform pg_temp.anotar('BASE', 'apuntar a un parámetro que no es precio', 'rechazo «no es un precio de lista»', sqlerrm,
                           strpos(sqlerrm, 'no es un precio de lista') > 0);
  end;

  begin
    update unidades set precio_parametro = 'precio_tienda_prueba19' where id = pg_temp.f('P1');
    perform pg_temp.anotar('BASE', 'puesto con un precio de tienda', 'rechazo «Elige un precio de su tipo»', 'aceptado', false);
  exception when others then
    perform pg_temp.anotar('BASE', 'puesto con un precio de tienda', 'rechazo «Elige un precio de su tipo»', sqlerrm,
                           strpos(sqlerrm, 'Elige un precio de su tipo') > 0);
  end;

  begin
    update unidades set precio_parametro = 'precio_puesto_prueba19x' where id = pg_temp.f('P1');
    perform pg_temp.anotar('BASE', 'precio sin moneda (R7)', 'rechazo «no tiene moneda»', 'aceptado', false);
  exception when others then
    perform pg_temp.anotar('BASE', 'precio sin moneda (R7)', 'rechazo «no tiene moneda»', sqlerrm,
                           strpos(sqlerrm, 'no tiene moneda') > 0);
  end;

  begin
    update unidades set precio_parametro = 'precio_tienda_prueba19' where id = pg_temp.f('T1');
    perform pg_temp.anotar('BASE', 'tienda escrita «Tienda» con precio de tienda', 'aceptado', 'aceptado', true);
  exception when others then
    perform pg_temp.anotar('BASE', 'tienda escrita «Tienda» con precio de tienda', 'aceptado', sqlerrm, false);
  end;
end;


-- ---------------------------------------------------------------------
-- 2 · fn_asignar_precio
-- ---------------------------------------------------------------------
<<bloque_2>>
declare r jsonb;
begin
  if pg_temp.f('comercial') is null or pg_temp.f('direccion') is null then
    perform pg_temp.omitir('RPC', 'asignar en bloque (rol, tipo, idempotencia, quitar)', 'un perfil comercial y uno de direccion activos');
    exit bloque_2;
  end if;

  perform pg_temp.como(pg_temp.f('comercial'));
  r := fn_asignar_precio(array[pg_temp.f('P1')], 'precio_puesto_prueba19a');
  perform pg_temp.anotar('RPC', 'un comercial no asigna precios', 'ok=false', r::text, (r ->> 'ok')::boolean is false);

  perform pg_temp.como(pg_temp.f('direccion'));
  r := fn_asignar_precio(array[pg_temp.f('P1'), pg_temp.f('P2'), pg_temp.f('T1')], 'precio_puesto_prueba19a');
  perform pg_temp.anotar('RPC', 'Dirección asigna a 2 puestos; salta la tienda',
    'ok · actualizadas 2 · omitida PRUEBA19-T1', r::text,
    (r ->> 'ok')::boolean and (r ->> 'actualizadas')::int = 2
      and jsonb_array_length(r -> 'omitidas') = 1 and r -> 'omitidas' -> 0 ->> 'codigo' = 'PRUEBA19-T1');

  r := fn_asignar_precio(array[pg_temp.f('P1'), pg_temp.f('P2')], 'precio_puesto_prueba19a');
  perform pg_temp.anotar('RPC', 'repetir no reescribe', 'actualizadas 0 · sin_cambio 2', r::text,
    (r ->> 'actualizadas')::int = 0 and (r ->> 'sin_cambio')::int = 2);

  r := fn_asignar_precio(array[pg_temp.f('P1')], 'inventario_disponibilidad_corte');
  perform pg_temp.anotar('RPC', 'un parámetro que no es precio', 'ok=false', r::text, (r ->> 'ok')::boolean is false);

  r := fn_asignar_precio(array[pg_temp.f('P1')], 'precio_puesto_prueba19x');
  perform pg_temp.anotar('RPC', 'un precio sin moneda (R7)', 'ok=false', r::text, (r ->> 'ok')::boolean is false);

  -- P2 pasa al nivel en propuesta (azul) y P3 (no disponible) al verde: §3.
  r := fn_asignar_precio(array[pg_temp.f('P2')], 'precio_puesto_prueba19b');
  r := fn_asignar_precio(array[pg_temp.f('P3')], 'precio_puesto_prueba19a');
  r := fn_asignar_precio(array[pg_temp.f('T1')], null);
  perform pg_temp.anotar('RPC', 'quitar el precio (NULL)', 'T1 sin precio',
    coalesce((select precio_parametro from unidades where id = pg_temp.f('T1')), 'sin precio'),
    (select precio_parametro from unidades where id = pg_temp.f('T1')) is null);

  perform pg_temp.como(null);
end;


-- ---------------------------------------------------------------------
-- 3 · LA WEB SOLO VE EL PRECIO VERDE DE UNA UNIDAD DISPONIBLE
-- ---------------------------------------------------------------------
<<bloque_3>>
declare e jsonb;
begin
  if pg_temp.f('direccion') is null then
    perform pg_temp.omitir('WEB', 'precio publicado', 'los precios se asignan en §2');
    exit bloque_3;
  end if;

  e := pg_temp.publica('PRUEBA19-P1');
  perform pg_temp.anotar('WEB', 'disponible + nivel verde ⇒ precio', '{"monto": 1, "moneda": "USD"}', coalesce((e -> 'precio')::text, 'null'),
    e -> 'precio' = '{"monto": 1, "moneda": "USD"}'::jsonb);

  e := pg_temp.publica('PRUEBA19-P2');
  perform pg_temp.anotar('WEB', 'nivel en propuesta (azul) ⇒ sin precio', 'null', coalesce(e ->> 'precio', 'null'),
    jsonb_typeof(e -> 'precio') = 'null');

  e := pg_temp.publica('PRUEBA19-P3');
  perform pg_temp.anotar('WEB', 'no disponible con nivel verde ⇒ sin precio', 'null', coalesce(e ->> 'precio', 'null'),
    jsonb_typeof(e -> 'precio') = 'null');

  e := pg_temp.publica('PRUEBA19-T1');
  perform pg_temp.anotar('WEB', 'sin nivel ⇒ sin precio; siete claves', 'null · 7 claves',
    coalesce(e ->> 'precio', 'null') || ' · ' || (select count(*) from jsonb_object_keys(e)) || ' claves',
    jsonb_typeof(e -> 'precio') = 'null' and (select count(*) from jsonb_object_keys(e)) = 7);
end;

-- Lo que anon puede ejecutar.
<<bloque_4>>
begin
  perform pg_temp.anotar('ANON', 'anon ejecuta fn_inventario_publico() y NO fn_asignar_precio()',
    'sí · no',
    case when has_function_privilege('anon', 'fn_inventario_publico()', 'execute') then 'sí' else 'no' end || ' · ' ||
    case when has_function_privilege('anon', 'fn_asignar_precio(uuid[], text)', 'execute') then 'sí' else 'no' end,
    has_function_privilege('anon', 'fn_inventario_publico()', 'execute')
      and not has_function_privilege('anon', 'fn_asignar_precio(uuid[], text)', 'execute'));
end;


-- ---------------------------------------------------------------------
-- 4 · EL AVISO DE REALTIME SALTA CON UN NIVEL DE PRECIO
-- ---------------------------------------------------------------------
<<bloque_5>>
declare v_tabla text;
begin
  perform set_config('mml.inventario_publico_tabla', '', true);
  update parametros set nota = 'PRUEBA19' where id = 'precio_puesto_prueba19a';
  v_tabla := current_setting('mml.inventario_publico_tabla', true);
  perform pg_temp.anotar('AVISO', 'cambiar un nivel de precio avisa a la web', 'parametros', coalesce(nullif(v_tabla, ''), '(no avisó)'),
    v_tabla = 'parametros');

  perform set_config('mml.inventario_publico_tabla', '', true);
  update parametros set nota = nota where id = 'separacion_monto';
  v_tabla := current_setting('mml.inventario_publico_tabla', true);
  perform pg_temp.anotar('AVISO', 'otro parámetro (separacion_monto) NO avisa', '(no avisó)', coalesce(nullif(v_tabla, ''), '(no avisó)'),
    coalesce(v_tabla, '') = '');
end;


-- ---------------------------------------------------------------------
-- 5 · CATÁLOGO
-- ---------------------------------------------------------------------
<<bloque_6>>
begin
  perform pg_temp.anotar('CAT', 'fn_asignar_precio es SECURITY DEFINER con search_path fijo', 'sí',
    (select case when p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=public%' then 'sí' else 'no' end
       from pg_proc p where p.oid = 'fn_asignar_precio(uuid[], text)'::regprocedure),
    (select p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=public%'
       from pg_proc p where p.oid = 'fn_asignar_precio(uuid[], text)'::regprocedure));
  perform pg_temp.anotar('CAT', 'disparadores t_unidades_precio_valido y t_inventario_publico_parametros', '2 de 2',
    (select count(*)::text || ' de 2' from pg_trigger where tgname in ('t_unidades_precio_valido', 't_inventario_publico_parametros') and not tgisinternal),
    (select count(*) = 2 from pg_trigger where tgname in ('t_unidades_precio_valido', 't_inventario_publico_parametros') and not tgisinternal));
  perform pg_temp.anotar('CAT', 'nadie ejecuta la función del disparador', 'no · no · no',
    concat_ws(' · ',
      case when has_function_privilege('anon', 'fn_unidades_precio_valido()', 'execute') then 'sí' else 'no' end,
      case when has_function_privilege('authenticated', 'fn_unidades_precio_valido()', 'execute') then 'sí' else 'no' end,
      case when has_function_privilege('public', 'fn_unidades_precio_valido()', 'execute') then 'sí' else 'no' end),
    not has_function_privilege('anon', 'fn_unidades_precio_valido()', 'execute')
      and not has_function_privilege('authenticated', 'fn_unidades_precio_valido()', 'execute'));
end;


    -- El cuadro, ANTES de deshacer: lo que se guarda en una variable sobrevive.
    select jsonb_agg(to_jsonb(c) order by c.n) into v_cuadro
      from (
with resumen as (
  select 9999 as n,
         'RESUMEN' as regla,
         count(*) filter (where veredicto = '✅ PASA')    || ' pasan · ' ||
         count(*) filter (where veredicto = '🔴 FALLA')   || ' fallan · ' ||
         count(*) filter (where veredicto = '🟡 OMITIDA') || ' omitidas'
           as veredicto,
         count(*) || ' pruebas' as prueba,
         'Mira las filas 🔴 de arriba: son las únicas que exigen algo' as esperado,
         '' as obtenido
    from resultado
)
select n, regla, veredicto, prueba, esperado, obtenido
from (
  select n, regla, veredicto, prueba, esperado, obtenido from resultado
  union all
  select n, regla, veredicto, prueba, esperado, obtenido from resumen
) todo
order by n
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
  execute 'drop function if exists public.probar_reglas_19()';

  if v_caida is not null then
    return query
      select 1, 'CAÍDA'::text, '🔴 FALLA'::text, 'La batería llegó hasta el final sin caerse'::text, 'sin error'::text,
             left(v_caida || ' · ' || coalesce(replace(v_ctx, E'\n', ' | '), ''), 1200)::text
      union all
      select 9999, 'RESUMEN'::text, '0 pasan · 1 fallan · 0 omitidas'::text, '1 pruebas'::text,
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
revoke all on function public.probar_reglas_19() from public, anon, authenticated;

select * from public.probar_reglas_19();
