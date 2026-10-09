-- =====================================================================
-- CRM Mercado Media Luna — PRUEBAS DE 16 · INVENTARIO PÚBLICO
--
-- Qué comprueba: lo que sql/16-inventario-publico.sql promete y la web
-- (planos de mercadomedialuna.com) da por hecho: que `anon` ejecuta
-- fn_inventario_publico() y nada más del inventario; que la respuesta tiene
-- EXACTAMENTE las claves del contrato y ni un dato privado; que «disponible»
-- es lo mismo que v_unidades_ofrecibles; que una separación viva sale
-- «separada» y una asignación a una oportunidad activa sale «no_disponible»;
-- que `revision` cambia cuando cambia el inventario; que los seis
-- disparadores existen y saltan solo con lo que deben (y que un lead sin
-- unidad NO avisa por el canal público); que una escritura del
-- CRM con RLS de verdad no se bloquea por el aviso; y, si el proyecto tiene
-- Realtime de base de datos, que el aviso se encola una vez por transacción.
--
-- 🟡 ESTADO: escrito el 02/10/2026 y NO ejecutado todavía en ningún sitio
--    (ni PGlite ni Supabase). El resultado se anota en
--    pruebas\COMO-PROBAR.md con su fecha; este archivo no declara VALIDADO
--    nada que nadie haya visto pasar.
--
-- ---------------------------------------------------------------------
-- CÓMO SE LEE
-- ---------------------------------------------------------------------
-- Igual que pruebas\reglas-13.sql: cada prueba dice qué DEBE pasar, lo
-- compara con lo obtenido y lo anota en la tabla temporal `resultado`. Al
-- final sale un solo cuadro con la fila RESUMEN (n=9999).
--   ✅ PASA · 🔴 FALLA · 🟡 OMITIDA (faltan datos para probarla; dice cuáles)
--   · 🟡 REVISAR (no es un agujero, pero hay que mirarlo)
--
-- ---------------------------------------------------------------------
-- ESTE ARCHIVO NO DEJA RASTRO, Y NO AVISA A NADIE
-- ---------------------------------------------------------------------
-- Todo va dentro de UNA función que se deshace sola: las unidades PRUEBA16-*, la
-- persona, las oportunidades, la separación, el corte de disponibilidad
-- cambiado un momento (§3c) y el mensaje de Realtime que encolan los
-- disparadores se deshacen al final (un error atrapado a propósito, ver
-- «CÓMO SE CORRE» más abajo). Un mensaje de Realtime solo sale al CONFIRMARSE
-- la transacción: al deshacerse no llega a ningún navegador.
-- ⚠️ NO quites el `raise exception … 'P0999'` ni el `exception when sqlstate
-- 'P0999'` que lo atrapa: es lo único que deshace los datos de prueba.
--
-- ---------------------------------------------------------------------
-- AQUÍ NO HAY NI UNA CIFRA DEL NEGOCIO
-- ---------------------------------------------------------------------
-- El teléfono (+51900160001), el área (1), el monto de la separación (0) y
-- las coordenadas (10, 20) son FICHAS DE JUGUETE, elegidas para que se vean a
-- simple vista (07-crm\CLAUDE.md §2). Ninguna sale de 00-fuente-de-verdad y
-- ninguna persiste.
--
-- ---------------------------------------------------------------------
-- REQUISITOS
-- ---------------------------------------------------------------------
-- 01..14 aplicados (15 da igual) y DESPUÉS 16-inventario-publico.sql. Sin
-- 04 falla la preparación (`separaciones.plazo_parametro`). Corre igual con
-- el inventario vacío o cargado: compara contra lo que haya.
-- Para la fila ESCRITURA hace falta un perfil activo `comercial` y otro de
-- `direccion` o `administracion` (`perfiles.id` referencia `auth.users` y no
-- se puede inventar); sin ellos sale 🟡 OMITIDA. Sin `realtime.send` en el
-- proyecto, la fila REALTIME sale 🟡 OMITIDA (la web queda en consulta
-- periódica, que es lo previsto).
--
-- Lo esperado con todo en su sitio (🟡 a confirmar en la primera corrida):
-- `17 pasan · 0 fallan · 0 omitidas · 0 revisar`. En el arnés PGlite, que no
-- tiene esquema `realtime`, la fila REALTIME sale 🟡 OMITIDA:
-- `16 pasan · 0 fallan · 1 omitidas · 0 revisar`.
--
-- SUPLANTACIÓN: como reglas-13 — claims del JWT con set_config; para RLS,
-- `set local role authenticated`; para la web, `set local role anon`.
-- =====================================================================
--
-- ---------------------------------------------------------------------
-- CÓMO SE CORRE (versión de una sola sentencia, 07/10/2026)
-- ---------------------------------------------------------------------
-- El SQL Editor de Supabase no siempre mantiene un `begin … rollback` entre
-- sentencias: la primera corrida de la batería 17 falló con «relation
-- "resultado" does not exist» porque la tabla temporal ya se había borrado.
-- Por eso ahora TODO va dentro de una función: corre en una sola sentencia,
-- lo deshace todo al final (un error atrapado a propósito: nada de lo que
-- crea queda en la base) y devuelve el cuadro como filas. La función se
-- borra sola al terminar. Se pega entero y se pulsa Run; da igual el editor.
-- =====================================================================

create or replace function public.probar_reglas_16()
returns table (n integer, regla text, veredicto text, prueba text, esperado text, obtenido text)
language plpgsql set search_path = public as $bateria$
#variable_conflict use_column
declare
  v_cuadro jsonb;
  v_caida  text;
  v_ctx    text;
begin
  -- Sin la migración que se prueba, no se corre nada: se dice qué falta.
  if not (to_regprocedure('public.fn_inventario_publico()') is not null) then
    return query
      select 1, 'PRE'::text, '🔴 FALLA'::text, 'La migración está aplicada'::text, 'sí'::text,
             'NO: falta aplicar sql/16-inventario-publico.sql en el SQL Editor. Aplícala primero y vuelve a correr esta batería.'::text
      union all
      select 9999, 'RESUMEN'::text, '0 pasan · 1 fallan · 0 omitidas · 0 revisar'::text, '1 pruebas'::text,
             'Mira las filas 🔴 de arriba: son las únicas que exigen algo'::text, ''::text;
    execute 'drop function if exists public.probar_reglas_16()';
    return;
  end if;
  begin
-- @@INICIO_CUERPO

-- ---------------------------------------------------------------------
-- 0 · CUADERNO, AYUDANTES Y PERFILES REALES
-- ---------------------------------------------------------------------
create temporary table resultado (
  n         serial primary key,
  regla     text not null,
  prueba    text not null,
  esperado  text not null,
  obtenido  text not null,
  veredicto text not null
) on commit drop;

create temporary table fixture (clave text primary key, id uuid) on commit drop;

-- Lo que devolvió la función, para leerlo en varias pruebas.
create temporary table salida (clave text primary key, valor jsonb) on commit drop;

create function pg_temp.anotar(p_regla text, p_prueba text, p_esperado text, p_obtenido text, p_ok boolean)
returns void language sql as $$
  insert into resultado (regla, prueba, esperado, obtenido, veredicto)
  values (p_regla, p_prueba, p_esperado, coalesce(p_obtenido, '(nulo)'),
          case when coalesce(p_ok, false) then '✅ PASA' else '🔴 FALLA' end)
$$;

create function pg_temp.f(p_clave text) returns uuid language sql stable as $$
  select id from fixture where clave = p_clave
$$;

create function pg_temp.s(p_clave text) returns jsonb language sql stable as $$
  select valor from salida where clave = p_clave
$$;

-- Suplantar (o dejar de suplantar, con NULL) a un usuario del proyecto.
create function pg_temp.como(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then ''
         else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
end $$;

-- Las claves de un objeto jsonb, ordenadas byte a byte y separadas por comas.
create function pg_temp.claves(p jsonb) returns text language sql immutable as $$
  select case when jsonb_typeof(p) = 'object' then
           (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(p) as k)
         end
$$;

-- ¿Esta unidad tiene la forma del contrato? Devuelve NULL si sí, o qué falla.
create function pg_temp.forma_unidad(e jsonb) returns text language plpgsql immutable as $$
declare p jsonb;
begin
  if jsonb_typeof(e) is distinct from 'object' then return 'no es un objeto'; end if;
  -- Desde 19 (precio por unidad) hay una séptima clave, `precio`: null, o
  -- {monto, moneda} solo en una unidad disponible (lo prueba reglas-19.sql).
  if pg_temp.claves(e) not in ('area_m2,codigo,estado,geometria,tipo,zona_rubro',
                               'area_m2,codigo,estado,geometria,precio,tipo,zona_rubro') then
    return 'claves ' || pg_temp.claves(e);
  end if;
  if jsonb_typeof(e -> 'precio') = 'object' then
    if pg_temp.claves(e -> 'precio') <> 'moneda,monto'
       or jsonb_typeof(e -> 'precio' -> 'monto') <> 'number'
       or (e -> 'precio' ->> 'moneda') not in ('USD', 'PEN')
       or (e ->> 'estado') <> 'disponible' then
      return 'precio';
    end if;
  elsif e ? 'precio' and jsonb_typeof(e -> 'precio') <> 'null' then
    return 'precio: tipo';
  end if;
  if jsonb_typeof(e -> 'codigo') <> 'string' or btrim(e ->> 'codigo') = '' then return 'codigo'; end if;
  if jsonb_typeof(e -> 'tipo') <> 'string' then return 'tipo'; end if;
  if jsonb_typeof(e -> 'area_m2') not in ('number', 'null') then return 'area_m2'; end if;
  if jsonb_typeof(e -> 'zona_rubro') not in ('string', 'null') then return 'zona_rubro'; end if;
  if (e ->> 'estado') is null or (e ->> 'estado') not in ('disponible', 'separada', 'no_disponible') then
    return 'estado ' || coalesce(e ->> 'estado', 'nulo');
  end if;
  if jsonb_typeof(e -> 'geometria') = 'array' then
    if jsonb_array_length(e -> 'geometria') not between 3 and 64 then return 'geometria: puntos'; end if;
    for p in select value from jsonb_array_elements(e -> 'geometria') loop
      if jsonb_typeof(p) <> 'array' then return 'geometria: punto'; end if;
      if jsonb_array_length(p) <> 2 or jsonb_typeof(p -> 0) <> 'number' or jsonb_typeof(p -> 1) <> 'number' then
        return 'geometria: punto';
      end if;
    end loop;
  elsif jsonb_typeof(e -> 'geometria') <> 'null' then
    return 'geometria: tipo';
  end if;
  return null;
end $$;

<<bloque_1>>
declare v_n integer; v_fn boolean; v_16 boolean;
begin
  insert into fixture select 'comercial', id from perfiles
   where rol = 'comercial' and activo order by creado_el limit 1;
  -- Quien mantiene el inventario: Rosa (administración) si existe; si no, Dirección.
  insert into fixture select 'gestor', id from perfiles
   where rol in ('administracion', 'direccion') and activo
   order by (rol = 'administracion') desc, creado_el limit 1;
  select count(*) into v_n from fixture;
  v_fn := to_regprocedure('public.fn_inventario_publico()') is not null;
  select exists (select 1 from migraciones_aplicadas where archivo = '16-inventario-publico.sql') into v_16;
  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('PRE', 'fn_inventario_publico() existe; hay perfil comercial y de direccion/administracion (para ESCRITURA)',
   'función sí · 2 de 2 perfiles',
   concat_ws(' · ', 'función ' || case when v_fn then 'sí' else 'NO' end, v_n || ' de 2 perfiles',
             '16 en migraciones_aplicadas: ' || case when v_16 then 'sí' else 'no' end),
   case when not v_fn then '🔴 FALLA' when v_n = 2 then '✅ PASA' else '🟡 OMITIDA' end);
end;

-- Cuántos mensajes del canal había ANTES de esta prueba (para REALTIME, §7).
-- Si `realtime.messages` no existe o no se puede leer, queda vacío.
<<bloque_2>>
declare v_n bigint;
begin
  execute 'select count(*) from realtime.messages where topic = $1' into v_n using 'inventario-publico';
  perform set_config('prueba16.cola_inicial', v_n::text, true);
exception when others then
  perform set_config('prueba16.cola_inicial', '', true);
  perform set_config('prueba16.cola_error', left(sqlerrm, 120), true);
end;


-- ---------------------------------------------------------------------
-- 1 · PERMISOS (catálogo)
-- ---------------------------------------------------------------------

-- 1a · La forma de la función: DEFINER (anon no lee las tablas), STABLE
-- (PostgREST solo deja usar GET con STABLE/IMMUTABLE), search_path fijo,
-- sin argumentos y devolviendo jsonb.
<<bloque_3>>
declare v_def boolean; v_vol "char"; v_conf text; v_res text; v_args text;
begin
  select p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ' '), ''),
         pg_get_function_result(p.oid), pg_get_function_identity_arguments(p.oid)
    into v_def, v_vol, v_conf, v_res, v_args
    from pg_proc p
   where p.oid = to_regprocedure('public.fn_inventario_publico()');
  perform pg_temp.anotar('SEG', 'fn_inventario_publico(): SECURITY DEFINER, STABLE, search_path fijo, sin argumentos, devuelve jsonb',
    'definer · stable · search_path=public · () · jsonb',
    coalesce(nullif(concat_ws(' · ', case when v_def then 'definer' when not v_def then 'INVOKER' end,
                              case v_vol when 's' then 'stable' when 'i' then 'IMMUTABLE' when 'v' then 'VOLATILE' end,
                              nullif(v_conf, ''), '(' || v_args || ')', v_res), ''),
             'la función no existe: falta aplicar sql/16'),
    v_def and v_vol = 's' and strpos(v_conf, 'search_path=public') > 0 and v_args = '' and v_res = 'jsonb');
end;

-- 1b · Quién ejecuta qué: la función pública, anon y authenticated sí y
-- PUBLIC no; la del aviso, nadie (un disparador no lo necesita).
<<bloque_4>>
declare v_pub_anon boolean; v_pub_auth boolean; v_pub_public boolean;
        v_av_anon boolean; v_av_auth boolean; v_av_public boolean;
begin
  v_pub_anon   := has_function_privilege('anon',          'public.fn_inventario_publico()', 'EXECUTE');
  v_pub_auth   := has_function_privilege('authenticated', 'public.fn_inventario_publico()', 'EXECUTE');
  v_pub_public := has_function_privilege('public',        'public.fn_inventario_publico()', 'EXECUTE');
  v_av_anon    := has_function_privilege('anon',          'public.fn_inventario_publico_aviso()', 'EXECUTE');
  v_av_auth    := has_function_privilege('authenticated', 'public.fn_inventario_publico_aviso()', 'EXECUTE');
  v_av_public  := has_function_privilege('public',        'public.fn_inventario_publico_aviso()', 'EXECUTE');
  perform pg_temp.anotar('SEG', 'EXECUTE: fn_inventario_publico para anon y authenticated (no PUBLIC); fn_inventario_publico_aviso para nadie',
    'pública: anon true · authenticated true · public false | aviso: false · false · false',
    'pública: anon ' || v_pub_anon || ' · authenticated ' || v_pub_auth || ' · public ' || v_pub_public
      || ' | aviso: anon ' || v_av_anon || ' · authenticated ' || v_av_auth || ' · public ' || v_av_public,
    v_pub_anon and v_pub_auth and not v_pub_public and not v_av_anon and not v_av_auth and not v_av_public);
exception when others then
  perform pg_temp.anotar('SEG', 'EXECUTE: fn_inventario_publico para anon y authenticated (no PUBLIC); fn_inventario_publico_aviso para nadie',
    'pública: anon true · authenticated true · public false | aviso: false · false · false', sqlerrm, false);
end;

-- 1c · anon sigue sin leer NI ESCRIBIR ninguna tabla ni vista de public
-- (02-rls §0, 11 §4): ni unidades, ni personas, ni separaciones, ni
-- oportunidades, ni v_unidades_tablero, ni v_unidades_ofrecibles, ni
-- parametros. Lo único que tiene es la función.
-- (authenticated SÍ tiene SELECT sobre esas tablas a propósito —11 §2— y RLS
-- decide las filas: comprobar aquí que no lo tuviera sería falso.)
<<bloque_5>>
declare v_con text; v_nombradas text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_con
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'v', 'm', 'p', 'f')
     and has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE');
  select string_agg(t.nombre || case when to_regclass('public.' || t.nombre) is null then ' (no existe)' else '' end, ', ')
    into v_nombradas
    from unnest(array['unidades','personas','separaciones','oportunidades','parametros',
                      'v_unidades_tablero','v_unidades_ofrecibles']) as t(nombre)
   where to_regclass('public.' || t.nombre) is null
      or has_table_privilege('anon', to_regclass('public.' || t.nombre), 'SELECT');
  perform pg_temp.anotar('SEG', 'anon no lee ni escribe ninguna tabla ni vista de public (unidades, personas, separaciones, oportunidades, parametros, v_unidades_tablero, v_unidades_ofrecibles…)',
    'ninguna',
    concat_ws(' · ', 'con privilegio: ' || coalesce(v_con, 'ninguna'), 'de las nombradas: ' || coalesce(v_nombradas, 'ninguna')),
    v_con is null and v_nombradas is null);
end;


-- ---------------------------------------------------------------------
-- 2 · DATOS DE PRUEBA
-- ---------------------------------------------------------------------
-- Siete unidades, una por caso. `fuente_plano` lo exige verde_exige_plano
-- (08 §3) en las verdes. Las columnas PRIVADAS van rellenas con textos que
-- se buscan después en la respuesta (§3g): si alguno aparece, se filtró.
--   LIBRE          disponible + verde, polígono bueno       → disponible
--   SEPARADA       disponible + verde + separación viva     → separada
--   ASIGNADA       disponible + verde + oportunidad activa  → no_disponible
--   RESERVADA      reservada_temporal                       → separada
--   SIN-VERIFICAR  disponible + amarillo, polígono de 2 pts → no_disponible, sin polígono
--   CONTRATADA     contratada, polígono con un punto malo   → no_disponible, sin polígono
--   ARCHIVADA      disponible + verde, archivada            → no aparece
<<bloque_6>>
declare v_per uuid; v_op uuid; v_sep uuid;
begin
  insert into personas (nombre_completo, telefono_e164)
  values ('PRUEBA16 Titular Privado', '+51900160001')
  returning id into v_per;
  insert into fixture values ('per', v_per);

  insert into unidades (codigo_unidad, tipo, area_m2, estado_comercial, estado_dato, fuente_plano,
                        geometria, zona_rubro, titular_persona_id, tipo_socio, estado_legal,
                        documento_sustento, observaciones, revisar, fuente_disponibilidad, archivado_el)
  values
  ('PRUEBA16-LIBRE', 'puesto', 1, 'disponible', 'verde', 'PRUEBA16 plano privado',
   '[[10,10],[20,10],[20,20],[10,20]]'::jsonb, 'PRUEBA16 rubro', v_per, 'PRUEBA16 socio privado',
   'PRUEBA16 legal privado', 'PRUEBA16 documento privado', 'PRUEBA16 observacion privada',
   'PRUEBA16 revisar privado', 'PRUEBA16 fuente privada', null),
  ('PRUEBA16-SEPARADA', 'puesto', null, 'disponible', 'verde', 'PRUEBA16 plano privado',
   null, null, null, null, null, null, null, null, null, null),
  ('PRUEBA16-ASIGNADA', 'tienda', null, 'disponible', 'verde', 'PRUEBA16 plano privado',
   null, null, null, null, null, null, null, null, null, null),
  ('PRUEBA16-RESERVADA', 'puesto', null, 'reservada_temporal', 'verde', 'PRUEBA16 plano privado',
   null, null, null, null, null, null, null, null, null, null),
  ('PRUEBA16-SIN-VERIFICAR', 'puesto', null, 'disponible', 'amarillo', null,
   '[[10,10],[20,20]]'::jsonb, null, null, null, null, null, null, null, null, null),
  ('PRUEBA16-CONTRATADA', 'puesto', null, 'contratada', 'verde', 'PRUEBA16 plano privado',
   '[[10,10],[20,"x"],[20,20]]'::jsonb, null, null, null, null, null, null, null, null, null),
  ('PRUEBA16-ARCHIVADA', 'puesto', null, 'disponible', 'verde', 'PRUEBA16 plano privado',
   null, null, null, null, null, null, null, null, null, now());

  insert into fixture select 'u_libre',    id from unidades where codigo_unidad = 'PRUEBA16-LIBRE';
  insert into fixture select 'u_separada', id from unidades where codigo_unidad = 'PRUEBA16-SEPARADA';
  insert into fixture select 'u_asignada', id from unidades where codigo_unidad = 'PRUEBA16-ASIGNADA';

  -- La asignación (R1): una oportunidad ACTIVA con la unidad asignada, sin separación.
  insert into oportunidades (persona_id, unidad_asignada_id)
  values (v_per, pg_temp.f('u_asignada'))
  returning id into v_op;
  insert into fixture values ('op_asignada', v_op);

  -- La separación viva: pendiente de verificar, sin fecha de depósito (para
  -- no tropezar con el parámetro de plazo, que es cosa de reglas.sql R4a).
  insert into oportunidades (persona_id) values (v_per) returning id into v_op;
  insert into fixture values ('op_separacion', v_op);
  insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda)
  values (v_op, v_per, pg_temp.f('u_separada'), 0, 'PEN')
  returning id into v_sep;
  insert into fixture values ('separacion', v_sep);

  perform pg_temp.anotar('PREP', 'Preparación: 7 unidades PRUEBA16-*, 1 persona, 2 oportunidades, 1 separación viva',
    'sin error', 'sin error', true);
exception when others then
  perform pg_temp.anotar('PREP', 'Preparación: 7 unidades PRUEBA16-*, 1 persona, 2 oportunidades, 1 separación viva',
    'sin error', sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 3 · CONTRATO CON LA WEB
-- ---------------------------------------------------------------------

-- 3a · Como la web: rol anon (la clave publicable, sin sesión). Y como un
-- usuario con sesión cualquiera. Los dos reciben exactamente lo mismo que el
-- dueño de la función.
<<bloque_7>>
declare v_dueno jsonb; v_anon jsonb; v_auth jsonb;
begin
  v_dueno := fn_inventario_publico();
  execute 'set local role anon';
  v_anon := fn_inventario_publico();
  execute 'reset role';
  execute 'set local role authenticated';
  v_auth := fn_inventario_publico();
  execute 'reset role';
  insert into salida values ('anon', v_anon);
  perform pg_temp.anotar('SEG', 'anon (la web) y authenticated ejecutan fn_inventario_publico() y reciben lo mismo que su dueño',
    'idéntico para los tres',
    concat_ws(' · ', 'anon ' || case when v_anon = v_dueno then 'idéntico' else 'DISTINTO' end,
              'authenticated ' || case when v_auth = v_dueno then 'idéntico' else 'DISTINTO' end,
              jsonb_array_length(v_anon -> 'unidades') || ' unidades'),
    v_anon = v_dueno and v_auth = v_dueno);
exception when others then
  execute 'reset role';
  perform pg_temp.anotar('SEG', 'anon (la web) y authenticated ejecutan fn_inventario_publico() y reciben lo mismo que su dueño',
    'idéntico para los tres', sqlerrm, false);
end;

-- 3b · Arriba, exactamente cinco claves; version 1; revision = md5 del
-- texto de `unidades`; generado_el es una fecha de ahora.
<<bloque_8>>
declare v jsonb := pg_temp.s('anon'); v_claves text; v_gen timestamptz; v_rev_ok boolean;
begin
  v_claves := pg_temp.claves(v);
  begin
    v_gen := (v ->> 'generado_el')::timestamptz;
  exception when others then
    v_gen := null;
  end;
  v_rev_ok := (v ->> 'revision') ~ '^[0-9a-f]{32}$'
              and (v ->> 'revision') = md5((v -> 'unidades')::text);
  perform pg_temp.anotar('CONTRATO', 'Arriba: exactamente version, generado_el, revision, disponibilidad y unidades',
    'esas 5 claves · version 1 · unidades es arreglo · revision = md5(unidades) · generado_el = ahora',
    concat_ws(' · ', coalesce(v_claves, '(sin claves)'), 'version ' || coalesce(v ->> 'version', '?'),
              'unidades ' || coalesce(jsonb_typeof(v -> 'unidades'), '?'),
              'revision ' || case when v_rev_ok then 'cuadra' else 'NO cuadra' end,
              'generado_el ' || coalesce(v ->> 'generado_el', '?')),
    v_claves = 'disponibilidad,generado_el,revision,unidades,version'
      and v -> 'version' = '1'::jsonb
      and jsonb_typeof(v -> 'unidades') = 'array'
      and v_rev_ok
      and v_gen between now() - interval '1 minute' and now() + interval '1 minute');
end;

-- 3c · disponibilidad: {semaforo, corte}. El texto del corte SOLO sale en
-- verde. Se comprueba con el valor real y, además, forzando el parámetro a
-- amarillo y a verde con un texto de juguete (se devuelve a su valor aquí
-- mismo, y el rollback lo deshace igual: dos redes).
<<bloque_9>>
declare v jsonb := pg_temp.s('anon') -> 'disponibilidad';
        v_sem text; v_val text; v_existe boolean; v_ok_real boolean;
        v_amarillo jsonb; v_verde jsonb; v_rep text;
begin
  select true, p.estado_semaforo::text, p.valor_texto into v_existe, v_sem, v_val
    from parametros p where p.id = 'inventario_disponibilidad_corte';
  v_ok_real := pg_temp.claves(v) = 'corte,semaforo'
               and (v ->> 'semaforo') is not distinct from v_sem
               and (v ->> 'corte') is not distinct from (case when v_sem = 'verde' then v_val end);
  v_rep := concat_ws(' · ', 'claves ' || coalesce(pg_temp.claves(v), '?'),
                     'real: ' || coalesce(v ->> 'semaforo', 'null') || '/' || case when v ->> 'corte' is null then 'sin texto' else 'con texto' end);

  if coalesce(v_existe, false) then
    update parametros set estado_semaforo = 'amarillo', valor_texto = 'PRUEBA16 corte'
     where id = 'inventario_disponibilidad_corte';
    v_amarillo := fn_inventario_publico() -> 'disponibilidad';
    update parametros set estado_semaforo = 'verde'
     where id = 'inventario_disponibilidad_corte';
    v_verde := fn_inventario_publico() -> 'disponibilidad';
    update parametros set estado_semaforo = v_sem::semaforo, valor_texto = v_val
     where id = 'inventario_disponibilidad_corte';
    v_rep := concat_ws(' · ', v_rep,
                       'amarillo: ' || coalesce(v_amarillo ->> 'corte', 'null'),
                       'verde: '    || coalesce(v_verde ->> 'corte', 'null'));
    perform pg_temp.anotar('CONTRATO', 'disponibilidad = {semaforo, corte}; el texto del corte solo sale en verde (sql/14 §3)',
      'claves corte,semaforo · real coherente · amarillo: null · verde: PRUEBA16 corte',
      v_rep,
      v_ok_real and (v_amarillo ->> 'semaforo') = 'amarillo' and (v_amarillo ->> 'corte') is null
        and (v_verde ->> 'semaforo') = 'verde' and (v_verde ->> 'corte') = 'PRUEBA16 corte');
  else
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('CONTRATO', 'disponibilidad = {semaforo, corte}; el texto del corte solo sale en verde (sql/14 §3)',
     'claves corte,semaforo · semaforo null sin la fila',
     v_rep || ' · falta la fila inventario_disponibilidad_corte (sql/14 §3): no se pudo forzar amarillo/verde',
     case when v_ok_real then '🟡 OMITIDA' else '🔴 FALLA' end);
  end if;
exception when others then
  perform pg_temp.anotar('CONTRATO', 'disponibilidad = {semaforo, corte}; el texto del corte solo sale en verde (sql/14 §3)',
    'claves corte,semaforo · real coherente · amarillo: null · verde: PRUEBA16 corte', sqlerrm, false);
end;

-- 3d · Cada unidad: exactamente las 6 claves, con su tipo, un estado de los
-- tres y, si hay polígono, 3..64 puntos [x, y] numéricos.
<<bloque_10>>
declare v jsonb := pg_temp.s('anon') -> 'unidades'; v_malas integer; v_total integer; v_ej text;
begin
  select count(*) filter (where pg_temp.forma_unidad(e) is not null),
         count(*),
         min(case when pg_temp.forma_unidad(e) is not null
                  then coalesce(e ->> 'codigo', '?') || ': ' || pg_temp.forma_unidad(e) end)
    into v_malas, v_total, v_ej
    from jsonb_array_elements(v) as e;
  perform pg_temp.anotar('CONTRATO', 'Cada unidad: exactamente codigo, tipo, area_m2, zona_rubro, geometria y estado (disponible/separada/no_disponible)',
    '0 mal formadas',
    v_malas || ' mal formada(s) de ' || v_total || coalesce(' · p. ej. ' || v_ej, ''),
    v_malas = 0 and v_total > 0);
exception when others then
  perform pg_temp.anotar('CONTRATO', 'Cada unidad: exactamente codigo, tipo, area_m2, zona_rubro, geometria y estado (disponible/separada/no_disponible)',
    '0 mal formadas', sqlerrm, false);
end;

-- 3e · Los totales cuadran con la base: todas las unidades vivas (si saliera
-- de menos, el dueño de la función no atraviesa el FORCE RLS de `unidades`),
-- ninguna archivada, en orden de codigo_unidad, y «disponible» = las filas de
-- v_unidades_ofrecibles, ni una más ni una menos.
<<bloque_11>>
declare v jsonb := pg_temp.s('anon') -> 'unidades';
        n_json integer; n_vivas integer; d_json integer; d_vista integer;
        ord_json text; ord_bd text; n_arch integer;
begin
  n_json := jsonb_array_length(v);
  select count(*) into n_vivas from unidades where archivado_el is null;
  select count(*) into d_json from jsonb_array_elements(v) e where e ->> 'estado' = 'disponible';
  select count(*) into d_vista from v_unidades_ofrecibles;
  select string_agg(x.e ->> 'codigo', '|' order by x.o) into ord_json
    from jsonb_array_elements(v) with ordinality as x(e, o);
  select string_agg(codigo_unidad, '|' order by codigo_unidad) into ord_bd
    from unidades where archivado_el is null;
  select count(*) into n_arch
    from jsonb_array_elements(v) e
    join unidades u on u.codigo_unidad = e ->> 'codigo'
   where u.archivado_el is not null;
  perform pg_temp.anotar('CONTRATO', 'Totales: todas las unidades vivas, ninguna archivada, en orden de codigo; disponibles = v_unidades_ofrecibles',
    'unidades = vivas · 0 archivadas · mismo orden · disponibles = ofrecibles',
    concat_ws(' · ', n_json || '/' || n_vivas || ' unidades', n_arch || ' archivada(s)',
              'orden ' || case when ord_json is not distinct from ord_bd then 'igual' else 'DISTINTO' end,
              d_json || '/' || d_vista || ' disponibles/ofrecibles'),
    n_json = n_vivas and n_arch = 0 and ord_json is not distinct from ord_bd and d_json = d_vista);
exception when others then
  perform pg_temp.anotar('CONTRATO', 'Totales: todas las unidades vivas, ninguna archivada, en orden de codigo; disponibles = v_unidades_ofrecibles',
    'unidades = vivas · 0 archivadas · mismo orden · disponibles = ofrecibles', sqlerrm, false);
end;

-- 3f · El estado de cada caso de prueba, y el polígono solo donde es válido.
<<bloque_12>>
declare v jsonb := pg_temp.s('anon') -> 'unidades'; v_rep text; v_libre jsonb;
        v_esperado text :=
          'PRUEBA16-ARCHIVADA=ausente · PRUEBA16-ASIGNADA=no_disponible · '
          'PRUEBA16-CONTRATADA=no_disponible · PRUEBA16-LIBRE=disponible+poligono · '
          'PRUEBA16-RESERVADA=separada · PRUEBA16-SEPARADA=separada · '
          'PRUEBA16-SIN-VERIFICAR=no_disponible';
begin
  select string_agg(x.codigo || '=' || coalesce(j.e ->> 'estado', 'ausente')
                    || case when jsonb_typeof(j.e -> 'geometria') = 'array' then '+poligono' else '' end,
                    ' · ' order by x.codigo collate "C")
    into v_rep
    from unnest(array['PRUEBA16-ARCHIVADA','PRUEBA16-ASIGNADA','PRUEBA16-CONTRATADA','PRUEBA16-LIBRE',
                      'PRUEBA16-RESERVADA','PRUEBA16-SEPARADA','PRUEBA16-SIN-VERIFICAR']) as x(codigo)
    left join lateral (select el as e from jsonb_array_elements(v) as el
                        where el ->> 'codigo' = x.codigo) j on true;
  select el into v_libre from jsonb_array_elements(v) as el where el ->> 'codigo' = 'PRUEBA16-LIBRE';
  perform pg_temp.anotar('ESTADO', 'Separación viva → separada; solo asignada a una oportunidad activa → no_disponible; sin verificar → no_disponible; archivada → no sale',
    v_esperado || ' · LIBRE con su polígono, área 1, rubro y tipo tal cual',
    v_rep || ' · LIBRE ' || coalesce(v_libre::text, 'ausente'),
    v_rep = v_esperado
      and v_libre -> 'geometria' = '[[10,10],[20,10],[20,20],[10,20]]'::jsonb
      and v_libre -> 'area_m2' = '1'::jsonb
      and v_libre ->> 'zona_rubro' = 'PRUEBA16 rubro'
      and v_libre ->> 'tipo' = 'puesto');
exception when others then
  perform pg_temp.anotar('ESTADO', 'Separación viva → separada; solo asignada a una oportunidad activa → no_disponible; sin verificar → no_disponible; archivada → no sale',
    'los 7 casos', sqlerrm, false);
end;

-- 3g · Ni un dato privado: ningún id (de unidad, de titular, de la
-- oportunidad o la separación de prueba) y ninguno de los textos privados
-- de los datos de prueba aparece en la respuesta.
<<bloque_13>>
declare v_txt text := pg_temp.s('anon')::text; v_hall text;
begin
  select string_agg(distinct q.que, ', ') into v_hall
    from (
      select 'id de unidad' as que from unidades u where strpos(v_txt, u.id::text) > 0
      union all
      select 'id de titular' from personas p
       where p.id in (select titular_persona_id from unidades where titular_persona_id is not null)
         and strpos(v_txt, p.id::text) > 0
      union all
      select 'id de oportunidad/separacion de prueba'
        from fixture f where f.clave in ('op_asignada', 'op_separacion', 'separacion')
         and strpos(v_txt, f.id::text) > 0
      union all
      select t.que
        from (values ('nombre del titular',    'PRUEBA16 Titular Privado'),
                     ('telefono del titular',  '+51900160001'),
                     ('tipo_socio',            'PRUEBA16 socio privado'),
                     ('estado_legal',          'PRUEBA16 legal privado'),
                     ('documento_sustento',    'PRUEBA16 documento privado'),
                     ('observaciones',         'PRUEBA16 observacion privada'),
                     ('revisar',               'PRUEBA16 revisar privado'),
                     ('fuente_disponibilidad', 'PRUEBA16 fuente privada'),
                     ('fuente_plano',          'PRUEBA16 plano privado')) as t(que, texto)
       where strpos(v_txt, t.texto) > 0
    ) q;
  perform pg_temp.anotar('PRIVACIDAD', 'La respuesta no lleva ids, titulares (nombre, teléfono) ni columnas internas (observaciones, revisar, fuentes, socio, legal, documento)',
    'ninguno', coalesce(v_hall, 'ninguno'), v_txt is not null and v_hall is null);
exception when others then
  perform pg_temp.anotar('PRIVACIDAD', 'La respuesta no lleva ids, titulares (nombre, teléfono) ni columnas internas (observaciones, revisar, fuentes, socio, legal, documento)',
    'ninguno', sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 4 · REVISIÓN: cambia cuando cambia el inventario
-- ---------------------------------------------------------------------
-- La oportunidad que tenía asignada PRUEBA16-ASIGNADA pasa a pausada: la
-- unidad vuelve a v_unidades_ofrecibles, sale «disponible» y la revisión
-- cambia (la web redibuja).
<<bloque_14>>
declare v_antes jsonb := pg_temp.s('anon'); v_despues jsonb; v_op uuid := pg_temp.f('op_asignada'); v_est text;
begin
  update oportunidades set situacion = 'pausada' where id = v_op;
  v_despues := fn_inventario_publico();
  select el ->> 'estado' into v_est
    from jsonb_array_elements(v_despues -> 'unidades') as el
   where el ->> 'codigo' = 'PRUEBA16-ASIGNADA';
  perform pg_temp.anotar('REVISION', 'Soltar la asignación (oportunidad pausada) devuelve la unidad a disponible y cambia revision',
    'disponible · revision distinta',
    concat_ws(' · ', coalesce(v_est, '?'),
              case when (v_despues ->> 'revision') <> (v_antes ->> 'revision') then 'revision distinta' else 'revision IGUAL' end),
    v_est = 'disponible' and (v_despues ->> 'revision') <> (v_antes ->> 'revision'));
exception when others then
  perform pg_temp.anotar('REVISION', 'Soltar la asignación (oportunidad pausada) devuelve la unidad a disponible y cambia revision',
    'disponible · revision distinta', sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 5 · DISPARADORES
-- ---------------------------------------------------------------------

-- 5a · Los seis existen, activos, AFTER, con su nivel, sus eventos y sus
-- columnas, y llaman a fn_inventario_publico_aviso(). Los de oportunidades
-- van por fila y con WHEN (solo con unidad: sql/16 §3c); el de sentencia de
-- la versión anterior ya no tiene que estar.
<<bloque_15>>
declare v_real text; v_esperado text :=
  'oportunidades: fila after delete cuando | '
  'oportunidades: fila after insert cuando | '
  'oportunidades: fila after update de archivado_el,situacion,unidad_asignada_id cuando | '
  'parametros: fila after insert update cuando | '
  'separaciones: sentencia after insert update delete de archivado_el,estado,unidad_id | '
  'unidades: sentencia after insert update delete';
begin
  select string_agg(d.relname || ': ' || d.forma, ' | ' order by d.relname collate "C", d.forma collate "C") into v_real
    from (
      select c.relname,
             case when t.tgtype & 1 = 1 then 'fila' else 'sentencia' end
             || case when t.tgtype & 2 = 2 then ' before' when t.tgtype & 64 = 64 then ' instead' else ' after' end
             || case when t.tgtype & 4 = 4 then ' insert' else '' end
             || case when t.tgtype & 16 = 16 then ' update' else '' end
             || case when t.tgtype & 8 = 8 then ' delete' else '' end
             || coalesce(' de ' || (select string_agg(a.attname, ',' order by a.attname collate "C")
                                      from unnest(t.tgattr::int2[]) as x(attnum)
                                      join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = x.attnum), '')
             || case when t.tgqual is not null then ' cuando' else '' end
             || case when t.tgenabled = 'D' then ' DESACTIVADO' else '' end as forma
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal
         and t.tgfoid = to_regprocedure('public.fn_inventario_publico_aviso()')
    ) d;
  perform pg_temp.anotar('DISPARADOR', 'Los seis disparadores del aviso: unidades y separaciones por sentencia; oportunidades por fila y solo con unidad; parametros por fila (solo el corte)',
    v_esperado, coalesce(v_real, 'ninguno'), v_real = v_esperado);
end;

-- 5b · Cada uno salta con lo que debe y no con lo que no: el rastro
-- `mml.inventario_publico_tabla` (sql/16 §2) dice qué tabla disparó. Notas
-- de una separación o de una oportunidad NO avisan (no mueven el estado).
-- En oportunidades solo avisa la que lleva unidad (op_asignada): la
-- situación de una oportunidad SIN unidad no avisa, y un lead nuevo sin
-- unidad (lo que inserta fn_captar_prospecto, 12, que anon ejecuta) tampoco.
-- Si avisara, el canal público diría si un teléfono ya era prospecto
-- (sql/16 §3c).
<<bloque_16>>
declare v_u uuid := pg_temp.f('u_libre'); v_sep uuid := pg_temp.f('separacion');
        v_op uuid := pg_temp.f('op_separacion'); v_op_u uuid := pg_temp.f('op_asignada');
        r_u text; r_s text; r_o text; r_p text; r_no text; r_lead text;
begin
  perform set_config('mml.inventario_publico_tabla', '', true);
  update unidades set observaciones = observaciones where id = v_u;
  r_u := coalesce(nullif(current_setting('mml.inventario_publico_tabla', true), ''), 'nada');

  perform set_config('mml.inventario_publico_tabla', '', true);
  update separaciones set estado = estado where id = v_sep;
  r_s := coalesce(nullif(current_setting('mml.inventario_publico_tabla', true), ''), 'nada');

  perform set_config('mml.inventario_publico_tabla', '', true);
  update oportunidades set situacion = situacion where id = v_op_u;
  r_o := coalesce(nullif(current_setting('mml.inventario_publico_tabla', true), ''), 'nada');

  perform set_config('mml.inventario_publico_tabla', '', true);
  update parametros set nota = nota where id = 'inventario_disponibilidad_corte';
  r_p := coalesce(nullif(current_setting('mml.inventario_publico_tabla', true), ''), 'nada');

  perform set_config('mml.inventario_publico_tabla', '', true);
  update separaciones  set notas = notas where id = v_sep;
  update oportunidades set notas = notas where id = v_op;
  update oportunidades set situacion = situacion where id = v_op;   -- sin unidad
  update parametros    set nota  = nota
   where id = (select min(id) from parametros where id <> 'inventario_disponibilidad_corte');
  r_no := coalesce(nullif(current_setting('mml.inventario_publico_tabla', true), ''), 'nada');

  perform set_config('mml.inventario_publico_tabla', '', true);
  insert into oportunidades (persona_id) values (pg_temp.f('per'));
  r_lead := coalesce(nullif(current_setting('mml.inventario_publico_tabla', true), ''), 'nada');

  perform pg_temp.anotar('DISPARADOR', 'Saltan con unidades, separaciones.estado, oportunidades.situacion (con unidad) y el corte; NO con notas, otro parámetro, una oportunidad sin unidad ni un lead nuevo sin unidad',
    'unidades · separaciones · oportunidades · parametros · sin aviso: nada · lead sin unidad: nada',
    concat_ws(' · ', r_u, r_s, r_o, r_p, 'sin aviso: ' || r_no, 'lead sin unidad: ' || r_lead),
    r_u = 'unidades' and r_s = 'separaciones' and r_o = 'oportunidades' and r_p = 'parametros'
      and r_no = 'nada' and r_lead = 'nada');
exception when others then
  perform pg_temp.anotar('DISPARADOR', 'Saltan con unidades, separaciones.estado, oportunidades.situacion (con unidad) y el corte; NO con notas, otro parámetro, una oportunidad sin unidad ni un lead nuevo sin unidad',
    'unidades · separaciones · oportunidades · parametros · sin aviso: nada · lead sin unidad: nada', sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 6 · ESCRITURA: el aviso nunca bloquea al CRM
-- ---------------------------------------------------------------------
-- Con RLS de verdad (rol authenticated), como lo hace la app: quien mantiene
-- el inventario cambia una unidad y un comercial toca el estado de una
-- separación. fn_inventario_publico_aviso() NO tiene EXECUTE para
-- authenticated (sql/16 §2): si PostgreSQL lo exigiera al disparar, esto
-- reventaría con «permission denied for function». Tiene que pasar, una fila
-- cada una, y el rastro tiene que decir que el disparador saltó.
<<bloque_17>>
declare v_u uuid := pg_temp.f('u_libre'); v_sep uuid := pg_temp.f('separacion');
        v_gestor uuid := pg_temp.f('gestor'); v_com uuid := pg_temp.f('comercial');
        n_u integer; n_s integer; r_u text; r_s text; v_paso text := 'inicio';
begin
  if v_gestor is null or v_com is null then
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('ESCRITURA', 'Con RLS (authenticated): actualizar una unidad y una separación no lo impide el aviso',
     '1 fila cada una, sin error, el disparador saltó',
     concat_ws(' · ', case when v_gestor is null then 'falta un perfil activo de direccion o administracion' end,
                      case when v_com is null then 'falta un perfil activo comercial' end),
     '🟡 OMITIDA');
    exit bloque_17;
  end if;

  v_paso := 'unidades como direccion/administracion';
  perform set_config('mml.inventario_publico_tabla', '', true);
  perform pg_temp.como(v_gestor);
  execute 'set local role authenticated';
  update unidades set estado_comercial = estado_comercial where id = v_u;
  get diagnostics n_u = row_count;
  execute 'reset role';
  r_u := coalesce(nullif(current_setting('mml.inventario_publico_tabla', true), ''), 'nada');

  v_paso := 'separaciones como comercial';
  -- Desde sql/17 un comercial solo edita SUS separaciones sin verificar
  -- (sep_editar_operativo): la de la prueba pasa a ser suya. Si 17 no está
  -- aplicado, esto no cambia nada.
  update separaciones set creado_por = v_com where id = v_sep;
  perform set_config('mml.inventario_publico_tabla', '', true);
  perform pg_temp.como(v_com);
  execute 'set local role authenticated';
  update separaciones set estado = estado where id = v_sep;
  get diagnostics n_s = row_count;
  execute 'reset role';
  r_s := coalesce(nullif(current_setting('mml.inventario_publico_tabla', true), ''), 'nada');
  perform pg_temp.como(null);

  perform pg_temp.anotar('ESCRITURA', 'Con RLS (authenticated): actualizar una unidad y una separación no lo impide el aviso',
    'unidades 1 fila (saltó) · separaciones 1 fila (saltó)',
    'unidades ' || n_u || ' fila(s) (' || r_u || ') · separaciones ' || n_s || ' fila(s) (' || r_s || ')',
    n_u = 1 and n_s = 1 and r_u = 'unidades' and r_s = 'separaciones');
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('ESCRITURA', 'Con RLS (authenticated): actualizar una unidad y una separación no lo impide el aviso',
    'unidades 1 fila (saltó) · separaciones 1 fila (saltó)', v_paso || ': ' || sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 7 · REALTIME: el aviso se encola, una vez por transacción
-- ---------------------------------------------------------------------
-- Todo lo de arriba escribió en unidades, separaciones, oportunidades y
-- parametros dentro de ESTA transacción: tiene que haber quedado UN mensaje
-- en realtime.messages para el canal «inventario-publico» (y la marca de la
-- transacción puesta). El rollback lo borra antes de que salga.
-- Más de uno puede ser actividad del CRM durante la prueba (otra
-- transacción que confirmó entretanto) o que el agrupado no funciona: 🟡.
<<bloque_18>>
declare v_send boolean := to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null;
        v_marca text := current_setting('mml.inventario_publico_aviso', true);
        v_tx text := txid_current()::text;
        v_ini text := coalesce(current_setting('prueba16.cola_inicial', true), '');
        v_err text := current_setting('prueba16.cola_error', true);
        v_fin bigint; v_nuevos bigint; v_rep text;
begin
  if not v_send then
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('REALTIME', 'Cada transacción que mueve el inventario encola un aviso en el canal público inventario-publico',
     '1 mensaje nuevo en realtime.messages',
     'realtime.send no existe en este proyecto: la web se queda con su consulta periódica', '🟡 OMITIDA');
    exit bloque_18;
  end if;

  begin
    execute 'select count(*) from realtime.messages where topic = $1' into v_fin using 'inventario-publico';
  exception when others then
    v_err := left(sqlerrm, 120);
  end;
  if v_fin is not null and v_ini <> '' then
    v_nuevos := v_fin - v_ini::bigint;
  end if;
  v_rep := concat_ws(' · ', 'marca ' || case when v_marca = v_tx then 'puesta' else 'NO puesta' end,
                     coalesce(v_nuevos::text || ' mensaje(s) nuevo(s)', 'realtime.messages no se pudo leer: ' || coalesce(v_err, '?')));

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('REALTIME', 'Cada transacción que mueve el inventario encola un aviso en el canal público inventario-publico',
   'marca puesta · 1 mensaje nuevo en realtime.messages',
   v_rep,
   case
     when v_marca is distinct from v_tx then '🔴 FALLA'          -- el disparador no llegó a llamar a realtime.send: mira los WARNING
     when v_nuevos is null             then '🟡 REVISAR'         -- se llamó, pero no se pudo contar
     when v_nuevos = 1                 then '✅ PASA'
     when v_nuevos = 0                 then '🟡 REVISAR'         -- realtime.send se tragó un error (mira los WARNING)
     else '🟡 REVISAR'                                           -- más de uno: ver el comentario de arriba
   end);
end;


    -- El cuadro, ANTES de deshacer: lo que se guarda en una variable sobrevive.
    select jsonb_agg(to_jsonb(c) order by c.n) into v_cuadro
      from (
with resumen as (
  select 9999 as n,
         'RESUMEN' as regla,
         count(*) filter (where veredicto = '✅ PASA')    || ' pasan · ' ||
         count(*) filter (where veredicto = '🔴 FALLA')   || ' fallan · ' ||
         count(*) filter (where veredicto = '🟡 OMITIDA') || ' omitidas · ' ||
         count(*) filter (where veredicto = '🟡 REVISAR') || ' revisar'
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
  execute 'drop function if exists public.probar_reglas_16()';

  if v_caida is not null then
    return query
      select 1, 'CAÍDA'::text, '🔴 FALLA'::text, 'La batería llegó hasta el final sin caerse'::text, 'sin error'::text,
             left(v_caida || ' · ' || coalesce(replace(v_ctx, E'\n', ' | '), ''), 1200)::text
      union all
      select 9999, 'RESUMEN'::text, '0 pasan · 1 fallan · 0 omitidas · 0 revisar'::text, '1 pruebas'::text,
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
revoke all on function public.probar_reglas_16() from public, anon, authenticated;

select * from public.probar_reglas_16();
