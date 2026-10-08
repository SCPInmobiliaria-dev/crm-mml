-- =====================================================================
-- CRM Mercado Media Luna — PRUEBAS DE 17 · INVENTARIO MAESTRO
--
-- Qué comprueba lo que sql/17-inventario-maestro.sql promete:
--   EST   el estado de la unidad SIGUE a su separación, su contrato y sus
--         cuotas, y vuelve a donde estaba cuando se caen; no toca lo que
--         pone una persona (no_disponible, entregada, un estado más adelantado);
--         R1 sigue en pie; la web (fn_inventario_publico) lo ve igual.
--   TIT   el titular: Dirección y Administración sí; Comercial, Lectura, un
--         usuario desactivado y anon no; no duplica personas; valida lo que
--         recibe; quitarlo no borra a la persona (R8); queda en la bitácora.
--   DOC   los papeles de una unidad: solo Dirección y Administración los
--         suben y los leen (tabla y bucket); los de una persona siguen igual.
--
-- 🟡 ESTADO: escrito el 05/10/2026 y ensayado SOLO en el arnés PGlite local
--    (COMO-PROBAR.md §9.1). Contra el proyecto real de Supabase todavía no se
--    ha corrido: este archivo no declara VALIDADO nada que nadie haya visto
--    pasar contra la base viva.
--
-- ---------------------------------------------------------------------
-- CÓMO SE LEE
-- ---------------------------------------------------------------------
-- Igual que pruebas\reglas-13.sql y reglas-16.sql: cada prueba dice qué DEBE
-- pasar, lo compara con lo obtenido y lo anota en la tabla temporal
-- `resultado`. Al final sale un solo cuadro con la fila RESUMEN (n=9999).
--   ✅ PASA · 🔴 FALLA · 🟡 OMITIDA (faltan datos para probarla; dice cuáles)
--
-- ---------------------------------------------------------------------
-- ESTE ARCHIVO NO DEJA RASTRO
-- ---------------------------------------------------------------------
-- Todo va dentro de `begin … rollback`: las unidades PRUEBA17-*, las
-- personas, las separaciones, los contratos, los papeles y el objeto del
-- bucket se deshacen al final. ⚠️ NO borres el `rollback` del final.
--
-- ---------------------------------------------------------------------
-- AQUÍ NO HAY NI UNA CIFRA DEL NEGOCIO
-- ---------------------------------------------------------------------
-- Montos (0), documentos (PRUEBA17…) y teléfonos (+519001…) son FICHAS DE
-- JUGUETE que se ven a simple vista (07-crm\CLAUDE.md §2). Ninguna persiste.
--
-- ---------------------------------------------------------------------
-- REQUISITOS
-- ---------------------------------------------------------------------
-- 01..14, 16, 18 y 19 aplicados y DESPUÉS 17-inventario-maestro.sql (15 y 20
-- dan igual; sin 16 las comprobaciones contra la web no se hacen). Hace falta un perfil activo de
-- direccion, administracion y comercial; sin ellos, la fila PRE sale 🟡 OMITIDA y las pruebas
-- que lo necesitan fallan con su mensaje. El de lectura/contabilidad, si el proyecto no tiene
-- ninguno, se crea DE MENTIRA (auth.users → t_nuevo_usuario) y se deshace con todo lo demás; si
-- no se puede crear, las dos comprobaciones que lo suplantan salen 🟡 OMITIDA (no ✅ en vacío).
-- SUPLANTACIÓN: como reglas-13 — claims del JWT con set_config; para RLS,
-- `set local role authenticated` (o `anon`).
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

create or replace function public.probar_reglas_17()
returns table (n integer, regla text, veredicto text, prueba text, esperado text, obtenido text)
language plpgsql set search_path = public as $bateria$
#variable_conflict use_column
declare
  v_cuadro jsonb;
  v_caida  text;
  v_ctx    text;
begin
  -- Sin la migración que se prueba, no se corre nada: se dice qué falta.
  if not (to_regprocedure('public.fn_cerrar_separacion(uuid,text,text,date)') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'unidades' and column_name = 'estado_comercial_previo')) then
    return query
      select 1, 'PRE'::text, '🔴 FALLA'::text, 'La migración está aplicada'::text, 'sí'::text,
             'NO: falta aplicar sql/17-inventario-maestro.sql en el SQL Editor. Aplícala primero y vuelve a correr esta batería.'::text
      union all
      select 9999, 'RESUMEN'::text, '0 pasan · 1 fallan · 0 omitidas'::text, '1 pruebas'::text,
             'Mira las filas 🔴 de arriba: son las únicas que exigen algo'::text, ''::text;
    execute 'drop function if exists public.probar_reglas_17()';
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

create function pg_temp.anotar(p_regla text, p_prueba text, p_esperado text, p_obtenido text, p_ok boolean)
returns void language sql as $$
  insert into resultado (regla, prueba, esperado, obtenido, veredicto)
  values (p_regla, p_prueba, p_esperado, coalesce(p_obtenido, '(nulo)'),
          case when coalesce(p_ok, false) then '✅ PASA' else '🔴 FALLA' end)
$$;

-- Como anotar(), para una comprobación que incluye a un actor de LECTURA. Si ese perfil no
-- existe (ni se pudo crear uno de mentira, ver PRE), esa parte NO se probó: la fila sale
-- 🟡 OMITIDA y lo dice, en vez de dar ✅ por haber suplantado a «nadie» (un actor sin perfil
-- siempre es rechazado, y eso no prueba nada sobre el rol de lectura).
create function pg_temp.anotar_lec(p_regla text, p_prueba text, p_esperado text, p_obtenido text,
                                   p_ok_resto boolean, p_ok_lec boolean, p_sin_perfil boolean)
returns void language sql as $$
  insert into resultado (regla, prueba, esperado, obtenido, veredicto)
  values (p_regla, p_prueba, p_esperado,
          coalesce(p_obtenido, '(nulo)') || case when p_sin_perfil then ' · lectura: SIN PERFIL, esa parte no se probó' else '' end,
          case when not coalesce(p_ok_resto, false) then '🔴 FALLA'
               when p_sin_perfil then '🟡 OMITIDA'
               when coalesce(p_ok_lec, false) then '✅ PASA'
               else '🔴 FALLA' end)
$$;

create function pg_temp.f(p_clave text) returns uuid language sql stable as $$
  select id from fixture where clave = p_clave
$$;

create function pg_temp.veredicto_error(p_fallo boolean, p_mensaje text, p_fragmento text)
returns boolean language sql immutable as $$
  select p_fallo and strpos(coalesce(p_mensaje, ''), p_fragmento) > 0
$$;

-- Suplantar (o dejar de suplantar, con NULL) a un usuario del proyecto.
create function pg_temp.como(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then ''
         else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
end $$;

-- «estado_comercial/estado_comercial_previo» de una unidad de prueba.
create function pg_temp.estado(p_codigo text) returns text language sql stable as $$
  select estado_comercial::text || '/' || coalesce(estado_comercial_previo::text, '—')
    from unidades where codigo_unidad = p_codigo
$$;

-- Una separación viva, pendiente de verificar, sobre una unidad (con su
-- oportunidad). Devuelve el id de la separación.
create function pg_temp.separar(p_codigo text) returns uuid language plpgsql as $$
declare v_op uuid; v_sep uuid;
begin
  insert into oportunidades (persona_id) values (pg_temp.f('per')) returning id into v_op;
  insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda)
  values (v_op, pg_temp.f('per'), (select id from unidades where codigo_unidad = p_codigo), 0, 'PEN')
  returning id into v_sep;
  return v_sep;
end $$;

-- Lo que la web ve de una unidad (NULL si no hay fn_inventario_publico o no sale).
create function pg_temp.estado_web(p_codigo text) returns text language plpgsql stable as $$
declare v text;
begin
  if to_regprocedure('public.fn_inventario_publico()') is null then return null; end if;
  select e ->> 'estado' into v
    from jsonb_array_elements(public.fn_inventario_publico() -> 'unidades') e
   where e ->> 'codigo' = p_codigo;
  return v;
end $$;

  -- (bloque)
declare v_n integer; v_fn boolean; v_lec_nuevo uuid; v_falta text; v_nota text := null;
begin
  insert into fixture select 'direccion', id from perfiles
   where rol = 'direccion' and activo order by creado_el limit 1;
  insert into fixture select 'administracion', id from perfiles
   where rol = 'administracion' and activo order by creado_el limit 1;
  insert into fixture select 'comercial', id from perfiles
   where rol = 'comercial' and activo order by creado_el limit 1;
  insert into fixture select 'lector', id from perfiles
   where rol in ('lectura', 'contabilidad') and activo order by (rol = 'lectura') desc, creado_el limit 1;
  -- El proyecto puede no tener todavía ningún usuario de lectura/contabilidad. Todo usuario nace
  -- 'lectura' (t_nuevo_usuario), así que se crea uno DE MENTIRA, que se deshace con el resto de
  -- la batería (nunca llega a existir de verdad). Si el proyecto no deja crearlo, no se inventa
  -- nada: el actor queda sin perfil y las pruebas de lectura salen 🟡 OMITIDA (anotar_lec).
  if not exists (select 1 from fixture where clave = 'lector') then
    begin
      v_lec_nuevo := gen_random_uuid();
      insert into auth.users (id, email) values (v_lec_nuevo, 'prueba17-lector@example.invalid');
      insert into fixture select 'lector', id from perfiles where id = v_lec_nuevo and rol = 'lectura' and activo;
      if exists (select 1 from fixture where clave = 'lector') then
        v_nota := 'lectura: usuario de mentira, creado y deshecho por la batería';
      end if;
    exception when others then
      delete from fixture where clave = 'lector';
      v_nota := 'lectura: no se pudo crear un usuario de mentira (' || left(sqlerrm, 60) || ')';
    end;
  end if;
  select count(*) into v_n from fixture where clave in ('direccion', 'administracion', 'comercial', 'lector');
  select nullif(concat_ws(', ',
           case when not exists (select 1 from fixture where clave = 'direccion') then 'dirección' end,
           case when not exists (select 1 from fixture where clave = 'administracion') then 'administración' end,
           case when not exists (select 1 from fixture where clave = 'comercial') then 'comercial' end,
           case when not exists (select 1 from fixture where clave = 'lector') then 'lectura/contabilidad' end), '')
    into v_falta;
  v_fn := to_regprocedure('public.fn_guardar_titular_unidad(uuid,uuid,text,text,text,text,text,text,text)') is not null;
  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('PRE', 'sql/17 aplicado y hay un perfil activo de dirección, administración, comercial y lectura/contabilidad',
   'función sí · 4 de 4 perfiles',
   concat_ws(' · ', 'función ' || case when v_fn then 'sí' else 'NO' end, v_n || ' de 4 perfiles',
             case when v_falta is not null then 'FALTA: ' || v_falta end, v_nota),
   case when not v_fn then '🔴 FALLA' when v_n = 4 then '✅ PASA' else '🟡 OMITIDA' end);
end;


-- ---------------------------------------------------------------------
-- 1 · PERMISOS (catálogo)
-- ---------------------------------------------------------------------
-- 1a · Las dos funciones de titular: DEFINER con search_path fijo; authenticated
-- las ejecuta; ni anon ni PUBLIC.
  -- (bloque)
declare v_a text; v_ok boolean := true; r record;
begin
  for r in select p.oid::regprocedure::text as nombre, p.prosecdef, coalesce(array_to_string(p.proconfig, ' '), '') as conf
             from pg_proc p
            where p.oid in (to_regprocedure('public.fn_guardar_titular_unidad(uuid,uuid,text,text,text,text,text,text,text)'),
                            to_regprocedure('public.fn_quitar_titular_unidad(uuid)'))
  loop
    v_a := concat_ws(' | ', v_a, r.nombre || ': ' || case when r.prosecdef then 'definer' else 'INVOKER' end
      || ' · ' || r.conf
      || ' · auth ' || has_function_privilege('authenticated', r.nombre::regprocedure, 'EXECUTE')
      || ' · anon ' || has_function_privilege('anon', r.nombre::regprocedure, 'EXECUTE')
      || ' · public ' || has_function_privilege('public', r.nombre::regprocedure, 'EXECUTE'));
    v_ok := v_ok and r.prosecdef and strpos(r.conf, 'search_path=public') > 0
            and has_function_privilege('authenticated', r.nombre::regprocedure, 'EXECUTE')
            and not has_function_privilege('anon', r.nombre::regprocedure, 'EXECUTE')
            and not has_function_privilege('public', r.nombre::regprocedure, 'EXECUTE');
  end loop;
  perform pg_temp.anotar('SEG', 'fn_guardar_titular_unidad y fn_quitar_titular_unidad: DEFINER, search_path fijo, authenticated sí, anon y PUBLIC no',
    '2 funciones · definer · search_path=public · auth true · anon false · public false',
    coalesce(v_a, 'no existen: falta aplicar sql/17'), v_a is not null and v_ok);
end;

-- 1b · Las cinco funciones internas del estado: nadie las ejecuta.
  -- (bloque)
declare v_con text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_con
    from pg_proc p
   where p.oid in (to_regprocedure('public.fn_estado_comercial_derivado(uuid)'),
                   to_regprocedure('public.fn_sincronizar_estado_unidad(uuid)'),
                   to_regprocedure('public.fn_t_sync_unidad_separacion()'),
                   to_regprocedure('public.fn_t_sync_unidad_contrato()'),
                   to_regprocedure('public.fn_t_sync_unidad_cuota()'))
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('public', p.oid, 'EXECUTE'));
  perform pg_temp.anotar('SEG', 'Las cinco funciones internas del estado de la unidad no las ejecuta nadie (ni authenticated, ni anon, ni PUBLIC)',
    'ninguna con EXECUTE', coalesce(v_con, 'ninguna con EXECUTE'), v_con is null
      and to_regprocedure('public.fn_sincronizar_estado_unidad(uuid)') is not null);
end;


-- ---------------------------------------------------------------------
-- 2 · DATOS DE PRUEBA
-- ---------------------------------------------------------------------
  -- (bloque)
declare v_per uuid;
begin
  insert into personas (nombre_completo, telefono_e164) values ('PRUEBA17 Persona', '+51900170001')
  returning id into v_per;
  insert into fixture values ('per', v_per);

  insert into unidades (codigo_unidad, tipo, estado_comercial, estado_dato, fuente_plano) values
  ('PRUEBA17-A',  'puesto', 'disponible',    'verde', 'PRUEBA17 plano'),
  ('PRUEBA17-H',  'puesto', 'disponible',    'verde', 'PRUEBA17 plano'),
  ('PRUEBA17-M',  'puesto', 'disponible',    'verde', 'PRUEBA17 plano'),
  ('PRUEBA17-R1', 'puesto', 'disponible',    'verde', 'PRUEBA17 plano'),
  ('PRUEBA17-R2', 'puesto', 'disponible',    'verde', 'PRUEBA17 plano'),
  ('PRUEBA17-N',  'puesto', 'no_disponible', 'verde', 'PRUEBA17 plano'),
  ('PRUEBA17-C',  'puesto', 'contratada',    'verde', 'PRUEBA17 plano'),
  ('PRUEBA17-E',  'puesto', 'entregada',     'verde', 'PRUEBA17 plano'),
  ('PRUEBA17-T',  'puesto', 'no_disponible', 'rojo',  null),
  ('PRUEBA17-D',  'puesto', 'no_disponible', 'rojo',  null);
  insert into fixture select 'u_' || lower(substr(codigo_unidad, 10)), id from unidades
   where codigo_unidad like 'PRUEBA17-%';

  perform pg_temp.anotar('PREP', 'Preparación: 1 persona y 10 unidades PRUEBA17-*', 'sin error', 'sin error', true);
exception when others then
  perform pg_temp.anotar('PREP', 'Preparación: 1 persona y 10 unidades PRUEBA17-*', 'sin error', sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 3 · EST · EL ESTADO SIGUE A LA SEPARACIÓN, AL CONTRATO Y A LAS CUOTAS
-- ---------------------------------------------------------------------

-- 3a · pendiente → reservada_temporal · verificada → separada · devuelta →
-- vuelve a disponible.
  -- (bloque)
declare v_sep uuid; v_ini text; v_pend text; v_ver text; v_dev text; v_dir uuid := pg_temp.f('direccion');
begin
  v_ini := pg_temp.estado('PRUEBA17-A');
  v_sep := pg_temp.separar('PRUEBA17-A');
  v_pend := pg_temp.estado('PRUEBA17-A');
  perform pg_temp.como(v_dir);
  update separaciones set estado = 'verificada', verificada_por = v_dir, verificada_el = now() where id = v_sep;
  perform pg_temp.como(null);
  v_ver := pg_temp.estado('PRUEBA17-A');
  update separaciones set estado = 'devuelta', devuelta_el = current_date, motivo_devolucion = 'PRUEBA17' where id = v_sep;
  v_dev := pg_temp.estado('PRUEBA17-A');
  perform pg_temp.anotar('EST', 'Separación: pendiente → reservada_temporal · verificada → separada · devuelta → vuelve a disponible',
    'disponible/— → reservada_temporal/disponible → separada/disponible → disponible/—',
    concat_ws(' → ', v_ini, v_pend, v_ver, v_dev),
    v_ini = 'disponible/—' and v_pend = 'reservada_temporal/disponible'
      and v_ver = 'separada/disponible' and v_dev = 'disponible/—');
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('EST', 'Separación: pendiente → reservada_temporal · verificada → separada · devuelta → vuelve a disponible',
    'sin error', sqlerrm, false);
end;

-- 3b · archivar una separación pendiente también devuelve la unidad; y la
-- web la ve «separada» mientras está viva.
  -- (bloque)
declare v_sep uuid; v_pend text; v_web_pend text; v_arch text; v_web_arch text;
begin
  v_sep := pg_temp.separar('PRUEBA17-A');
  v_pend := pg_temp.estado('PRUEBA17-A');
  v_web_pend := pg_temp.estado_web('PRUEBA17-A');
  update separaciones set archivado_el = now() where id = v_sep;
  v_arch := pg_temp.estado('PRUEBA17-A');
  v_web_arch := pg_temp.estado_web('PRUEBA17-A');
  perform pg_temp.anotar('EST', 'Archivar la separación devuelve la unidad a disponible; la web la ve separada mientras está viva y disponible después',
    'reservada_temporal/disponible · web separada → disponible/— · web disponible',
    concat_ws(' · ', v_pend, 'web ' || coalesce(v_web_pend, 'sin función'), '→', v_arch, 'web ' || coalesce(v_web_arch, 'sin función')),
    v_pend = 'reservada_temporal/disponible' and v_arch = 'disponible/—'
      and (v_web_pend is null or (v_web_pend = 'separada' and v_web_arch = 'disponible')));
end;

-- 3c · el ciclo entero: separación verificada → contrato (la separación pasa
-- a aplicada_a_contrato) → contratada → cuotas pendientes siguen contratada →
-- todas pagadas → pagada → otra cuota pendiente → contratada → condonada →
-- pagada → contrato archivado → vuelve a disponible.
  -- (bloque)
declare v_sep uuid; v_con uuid; v_c1 uuid; v_c2 uuid; v_dir uuid := pg_temp.f('direccion');
        v_per uuid := pg_temp.f('per'); v_h uuid := pg_temp.f('u_h');
        a text; b text; c text; d text; e text; f text; g text; h text; v_web text;
begin
  v_sep := pg_temp.separar('PRUEBA17-H');
  perform pg_temp.como(v_dir);
  update separaciones set estado = 'verificada', verificada_por = v_dir, verificada_el = now() where id = v_sep;
  perform pg_temp.como(null);
  a := pg_temp.estado('PRUEBA17-H');

  insert into contratos (persona_id, unidad_id, separacion_id, precio_total, precio_moneda)
  values (v_per, v_h, v_sep, 0, 'PEN') returning id into v_con;
  update separaciones set estado = 'aplicada_a_contrato' where id = v_sep;
  b := pg_temp.estado('PRUEBA17-H');
  v_web := pg_temp.estado_web('PRUEBA17-H');

  insert into cuotas (contrato_id, numero, fecha_vencimiento, monto, monto_moneda)
  values (v_con, 1, current_date, 0, 'PEN') returning id into v_c1;
  c := pg_temp.estado('PRUEBA17-H');
  update cuotas set estado = 'pagada' where id = v_c1;
  d := pg_temp.estado('PRUEBA17-H');
  insert into cuotas (contrato_id, numero, fecha_vencimiento, monto, monto_moneda)
  values (v_con, 2, current_date, 0, 'PEN') returning id into v_c2;
  e := pg_temp.estado('PRUEBA17-H');
  update cuotas set estado = 'condonada' where id = v_c2;
  f := pg_temp.estado('PRUEBA17-H');
  update contratos set archivado_el = now() where id = v_con;
  g := pg_temp.estado('PRUEBA17-H');
  perform pg_temp.anotar('EST', 'Contrato: verificada → separada · contrato vivo → contratada · cuotas pendientes → sigue contratada · todas pagadas o condonadas → pagada · contrato archivado → vuelve a disponible',
    'separada → contratada → contratada → pagada → contratada → pagada → disponible/— (la web ve no_disponible con el contrato vivo)',
    concat_ws(' → ', a, b, c, d, e, f, g) || ' · web ' || coalesce(v_web, 'sin función'),
    a = 'separada/disponible' and b = 'contratada/disponible' and c = 'contratada/disponible'
      and d = 'pagada/disponible' and e = 'contratada/disponible' and f = 'pagada/disponible'
      and g = 'disponible/—' and (v_web is null or v_web = 'no_disponible'));
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('EST', 'Contrato: verificada → separada · contrato vivo → contratada · cuotas → pagada · archivado → vuelve', 'sin error', sqlerrm, false);
end;

-- 3d · lo que pone una persona no se toca: una unidad retirada de venta, una
-- entregada, y una que ya iba MÁS ADELANTE (contratada a mano) que la
-- separación que se abre encima.
  -- (bloque)
declare v_n text; v_c text; v_e text;
begin
  perform pg_temp.separar('PRUEBA17-N');
  perform pg_temp.separar('PRUEBA17-C');
  perform pg_temp.separar('PRUEBA17-E');
  v_n := pg_temp.estado('PRUEBA17-N');
  v_c := pg_temp.estado('PRUEBA17-C');
  v_e := pg_temp.estado('PRUEBA17-E');
  perform pg_temp.anotar('EST', 'No se pisa lo que puso una persona: no_disponible, contratada a mano (más adelante que la separación) y entregada quedan como estaban',
    'no_disponible/— · contratada/— · entregada/—', concat_ws(' · ', v_n, v_c, v_e),
    v_n = 'no_disponible/—' and v_c = 'contratada/—' and v_e = 'entregada/—');
end;

-- 3e · si una persona cambia el estado entre medias, se respeta: al caerse la
-- separación la unidad NO vuelve al estado viejo.
  -- (bloque)
declare v_sep uuid; v_pend text; v_fin text;
begin
  v_sep := pg_temp.separar('PRUEBA17-M');
  v_pend := pg_temp.estado('PRUEBA17-M');
  update unidades set estado_comercial = 'no_disponible' where codigo_unidad = 'PRUEBA17-M';
  update separaciones set estado = 'vencida' where id = v_sep;
  v_fin := pg_temp.estado('PRUEBA17-M');
  perform pg_temp.anotar('EST', 'Un cambio manual entre medias se respeta: al vencer la separación la unidad queda como la dejó la persona y se olvida el estado anterior',
    'reservada_temporal/disponible → no_disponible/—', v_pend || ' → ' || v_fin,
    v_pend = 'reservada_temporal/disponible' and v_fin = 'no_disponible/—');
end;

-- 3f · cambiar la separación de unidad: la vieja se suelta y la nueva se mueve.
  -- (bloque)
declare v_sep uuid; a text; b text; c text; d text;
begin
  v_sep := pg_temp.separar('PRUEBA17-R1');
  a := pg_temp.estado('PRUEBA17-R1');
  b := pg_temp.estado('PRUEBA17-R2');
  update separaciones set unidad_id = pg_temp.f('u_r2') where id = v_sep;
  c := pg_temp.estado('PRUEBA17-R1');
  d := pg_temp.estado('PRUEBA17-R2');
  perform pg_temp.anotar('EST', 'Mover la separación a otra unidad: la anterior vuelve a disponible y la nueva pasa a reservada_temporal',
    'R1 reservada/disponible, R2 disponible/— → R1 disponible/—, R2 reservada/disponible',
    concat_ws(' ', 'R1', a, 'R2', b, '→ R1', c, 'R2', d),
    a = 'reservada_temporal/disponible' and b = 'disponible/—' and c = 'disponible/—' and d = 'reservada_temporal/disponible');
end;

-- 3g · R1 sigue en pie: dos separaciones vivas sobre la misma unidad, no.
  -- (bloque)
declare v_fallo boolean := false; v_msg text := 'se aceptó la segunda separación';
begin
  perform pg_temp.separar('PRUEBA17-A');
  begin
    perform pg_temp.separar('PRUEBA17-A');
  exception when others then v_fallo := true; v_msg := sqlerrm;
  end;
  perform pg_temp.anotar('EST', 'R1 sigue en pie: una segunda separación viva sobre la misma unidad se rechaza',
    'unidad_una_separacion_viva', left(v_msg, 80),
    pg_temp.veredicto_error(v_fallo, v_msg, 'unidad_una_separacion_viva'));
end;

-- 3h · todo cambio queda en la bitácora con quién lo hizo: el paso a
-- «separada» del 3a lo hizo Dirección.
  -- (bloque)
declare v_n integer; v_dir uuid := pg_temp.f('direccion');
begin
  select count(*) into v_n from bitacora
   where tabla = 'unidades' and registro_id = pg_temp.f('u_a')::text
     and despues ->> 'estado_comercial' = 'separada' and actor_id = v_dir;
  perform pg_temp.anotar('EST', 'El paso a «separada» queda en la bitácora de unidades con el actor que verificó la separación',
    '1 o más filas con actor = dirección', v_n || ' filas', v_n >= 1);
end;

-- 3i · idempotencia: sincronizar dos veces no cambia nada.
  -- (bloque)
declare a text; b text;
begin
  a := pg_temp.estado('PRUEBA17-R2') || pg_temp.estado('PRUEBA17-C') || pg_temp.estado('PRUEBA17-N');
  perform fn_sincronizar_estado_unidad(pg_temp.f('u_r2'));
  perform fn_sincronizar_estado_unidad(pg_temp.f('u_c'));
  perform fn_sincronizar_estado_unidad(pg_temp.f('u_n'));
  perform fn_sincronizar_estado_unidad(pg_temp.f('u_r2'));
  b := pg_temp.estado('PRUEBA17-R2') || pg_temp.estado('PRUEBA17-C') || pg_temp.estado('PRUEBA17-N');
  perform pg_temp.anotar('EST', 'Sincronizar dos veces no cambia nada', a, b, a = b);
end;


-- ---------------------------------------------------------------------
-- 4 · TIT · EL TITULAR DE LA UNIDAD
-- ---------------------------------------------------------------------
-- Cada llamada va con la sesión y el rol de la app (authenticated + claims).
-- Los ids se leen ANTES de cambiar de rol: authenticated no lee las tablas temporales.

-- 4a · Dirección crea un titular nuevo: persona de verdad, socia, sin
-- consentimiento todavía, con la fuente y el vínculo en la unidad.
  -- (bloque)
declare v_r jsonb; v_per uuid; v_p personas%rowtype; v_tit uuid; v_u uuid := pg_temp.f('u_t'); v_dir uuid := pg_temp.f('direccion');
begin
  perform pg_temp.como(v_dir);
  execute 'set local role authenticated';
  v_r := fn_guardar_titular_unidad(v_u, null, '  PRUEBA17 Titular Uno ', 'DNI', 'PRUEBA17-DOC-1', '+51900170101', null, 'prueba17@example.test', 'nota de prueba');
  execute 'reset role';
  perform pg_temp.como(null);
  v_per := (v_r ->> 'persona_id')::uuid;
  select * into v_p from personas where id = v_per;
  select titular_persona_id into v_tit from unidades where id = v_u;
  insert into fixture values ('tit1', v_per);
  perform pg_temp.anotar('TIT', 'Dirección crea un titular: persona nueva (nombre sin espacios, socia, sin consentimiento, con fuente) y queda vinculada a la unidad',
    'ok · creada · nombre limpio · es_socio · consentimiento false · fuente del inventario maestro · titular = esa persona',
    concat_ws(' · ', v_r ->> 'ok', 'creada ' || (v_r ->> 'creada'), v_p.nombre_completo, 'socio ' || v_p.es_socio,
              'consent ' || v_p.consentimiento, left(coalesce(v_p.fuente_del_dato, '(nulo)'), 40), 'titular ok ' || (v_tit = v_per)),
    (v_r ->> 'ok') = 'true' and (v_r ->> 'creada') = 'true' and v_p.nombre_completo = 'PRUEBA17 Titular Uno'
      and v_p.es_socio and not v_p.consentimiento and v_p.fuente_del_dato like 'Inventario maestro del CRM%'
      and v_tit = v_per);
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('TIT', 'Dirección crea un titular', 'sin error', sqlerrm, false);
end;

-- 4b · el mismo documento otra vez (sin elegir persona) NO crea una segunda
-- persona: reutiliza la que ya estaba y no la pisa.
  -- (bloque)
declare v_r jsonb; v_n integer; v_nombre text; v_u uuid := pg_temp.f('u_d'); v_adm uuid := pg_temp.f('administracion');
begin
  perform pg_temp.como(v_adm);
  execute 'set local role authenticated';
  v_r := fn_guardar_titular_unidad(v_u, null, 'PRUEBA17 Otro Nombre', 'DNI', 'PRUEBA17-DOC-1', null, null, null, null);
  execute 'reset role';
  perform pg_temp.como(null);
  select count(*), min(nombre_completo) into v_n, v_nombre from personas where doc_tipo = 'DNI' and doc_numero = 'PRUEBA17-DOC-1';
  perform pg_temp.anotar('TIT', 'Administración elige al mismo titular por su documento: se reutiliza la persona, no se duplica ni se pisa su nombre',
    'reutilizada · 1 persona con ese documento · nombre intacto',
    concat_ws(' · ', 'reutilizada ' || (v_r ->> 'reutilizada'), v_n || ' persona(s)', v_nombre),
    (v_r ->> 'reutilizada') = 'true' and v_n = 1 and v_nombre = 'PRUEBA17 Titular Uno');
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('TIT', 'Administración reutiliza al titular por documento', 'sin error', sqlerrm, false);
end;

-- 4c · editar a una persona elegida actualiza SUS datos; pero no puede quedarse
-- con el documento de otra.
  -- (bloque)
declare v_r jsonb; v_tel text; v_fallo boolean := false; v_msg text := 'se aceptó el documento de otra persona';
        v_tit uuid := pg_temp.f('tit1'); v_u uuid := pg_temp.f('u_t'); v_dir uuid := pg_temp.f('direccion'); v_otra uuid;
begin
  insert into personas (nombre_completo, doc_tipo, doc_numero) values ('PRUEBA17 Otra Persona', 'DNI', 'PRUEBA17-DOC-2') returning id into v_otra;
  perform pg_temp.como(v_dir);
  execute 'set local role authenticated';
  v_r := fn_guardar_titular_unidad(v_u, v_tit, 'PRUEBA17 Titular Uno', 'DNI', 'PRUEBA17-DOC-1', '+51900170102', null, null, null);
  begin
    perform fn_guardar_titular_unidad(v_u, v_tit, 'PRUEBA17 Titular Uno', 'DNI', 'PRUEBA17-DOC-2', null, null, null, null);
  exception when others then v_fallo := true; v_msg := sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp.como(null);
  select telefono_e164 into v_tel from personas where id = v_tit;
  perform pg_temp.anotar('TIT', 'Editar al titular elegido cambia sus datos; quedarse con el documento de otra persona se rechaza',
    'teléfono nuevo · «Ya hay otra persona registrada con ese documento»',
    concat_ws(' · ', v_tel, left(v_msg, 60)),
    v_tel = '+51900170102' and pg_temp.veredicto_error(v_fallo, v_msg, 'Ya hay otra persona registrada con ese documento'));
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('TIT', 'Editar al titular elegido', 'sin error', sqlerrm, false);
end;

-- 4d · quién NO puede: comercial, lectura/contabilidad, un usuario de dirección
-- desactivado (es() devuelve NULL, y `if not es()` no dispara con NULL) y anon.
  -- (bloque)
declare v_u uuid := pg_temp.f('u_d'); v_dir uuid := pg_temp.f('direccion');
        v_com uuid := pg_temp.f('comercial'); v_lec uuid := pg_temp.f('lector');
        m_com text := 'se aceptó'; m_lec text := 'se aceptó'; m_ina text := 'se aceptó'; m_anon text := 'se aceptó';
        f_com boolean := false; f_lec boolean := false; f_ina boolean := false; f_anon boolean := false;
        v_tit uuid;
begin
  perform pg_temp.como(v_com);
  execute 'set local role authenticated';
  begin perform fn_guardar_titular_unidad(v_u, null, 'PRUEBA17 Intruso', null, null, null, null, null, null);
  exception when others then f_com := true; m_com := sqlerrm; end;
  execute 'reset role';

  if v_lec is null then
    m_lec := '(sin perfil de lectura)';
  else
    perform pg_temp.como(v_lec);
    execute 'set local role authenticated';
    begin perform fn_guardar_titular_unidad(v_u, null, 'PRUEBA17 Intruso', null, null, null, null, null, null);
    exception when others then f_lec := true; m_lec := sqlerrm; end;
    execute 'reset role';
  end if;

  update perfiles set activo = false where id = v_dir;
  perform pg_temp.como(v_dir);
  execute 'set local role authenticated';
  begin perform fn_guardar_titular_unidad(v_u, null, 'PRUEBA17 Intruso', null, null, null, null, null, null);
  exception when others then f_ina := true; m_ina := sqlerrm; end;
  execute 'reset role';
  update perfiles set activo = true where id = v_dir;

  perform pg_temp.como(null);
  execute 'set local role anon';
  begin perform fn_guardar_titular_unidad(v_u, null, 'PRUEBA17 Intruso', null, null, null, null, null, null);
  exception when others then f_anon := true; m_anon := sqlerrm; end;
  execute 'reset role';

  select titular_persona_id into v_tit from unidades where id = v_u;
  perform pg_temp.anotar_lec('TIT', 'Comercial, lectura, un usuario de dirección desactivado y anon no pueden cambiar el titular',
    '«Solo Dirección o Administración» ×3 · anon sin EXECUTE · la unidad no cambió',
    concat_ws(' · ', left(m_com, 30), left(m_lec, 30), left(m_ina, 30), left(m_anon, 40), 'titular de u_d: ' || coalesce(v_tit::text, 'ninguno')),
    pg_temp.veredicto_error(f_com, m_com, 'Solo Dirección o Administración')
      and pg_temp.veredicto_error(f_ina, m_ina, 'Solo Dirección o Administración')
      and f_anon and strpos(m_anon, 'permission denied') > 0
      and v_tit is distinct from null,
    pg_temp.veredicto_error(f_lec, m_lec, 'Solo Dirección o Administración'),
    v_lec is null);
exception when others then
  execute 'reset role';
  update perfiles set activo = true where id = v_dir;
  perform pg_temp.como(null);
  perform pg_temp.anotar('TIT', 'Quién no puede cambiar el titular', 'sin error', sqlerrm, false);
end;
-- (Nota para quien lea el cuadro: `v_tit is distinct from null` comprueba que
--  u_d conserva el titular que le puso 4b; los intrusos no lo cambiaron.)

-- 4e · lo que se recibe se valida, con mensajes en español.
  -- (bloque)
declare v_u uuid := pg_temp.f('u_t'); v_dir uuid := pg_temp.f('direccion'); v_msgs text := ''; v_ok boolean := true; v_m text; v_i integer;
  casos text[][] := array[
    array['sin nombre',      '',   null, null, null, null, 'El nombre del titular es obligatorio'],
    array['documento a medias', 'X', 'DNI', null, null, null, 'tipo y su número'],
    array['tipo inventado',  'X',  'LIBRETA', 'PRUEBA17-DOC-9', null, null, 'DNI, CE, RUC o Pasaporte'],
    array['teléfono sin +',  'X',  null, null, '900170999', null, 'código de país'],
    array['correo roto',     'X',  null, null, null, 'no-es-un-correo', 'forma de un correo']];
begin
  perform pg_temp.como(v_dir);
  execute 'set local role authenticated';
  for v_i in 1 .. array_length(casos, 1) loop
    v_m := null;
    begin
      perform fn_guardar_titular_unidad(v_u, null, casos[v_i][2], casos[v_i][3], casos[v_i][4], casos[v_i][5], null, casos[v_i][6], null);
    exception when others then v_m := sqlerrm; end;
    v_ok := v_ok and v_m is not null and strpos(v_m, casos[v_i][7]) > 0;
    v_msgs := v_msgs || casos[v_i][1] || ': ' || coalesce(left(v_m, 28), 'SE ACEPTÓ') || ' | ';
  end loop;
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('TIT', 'Se rechaza, con su mensaje: sin nombre, documento a medias, tipo de documento inventado, teléfono sin código de país y correo roto',
    'los cinco rechazados', v_msgs, v_ok);
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('TIT', 'Validación del titular', 'sin error', sqlerrm, false);
end;

-- 4f · quitar al titular suelta el vínculo y NO borra a la persona (R8);
-- queda en la bitácora de unidades.
  -- (bloque)
declare v_u uuid := pg_temp.f('u_t'); v_tit uuid := pg_temp.f('tit1'); v_dir uuid := pg_temp.f('direccion');
        v_vinculo uuid; v_existe boolean; v_bit integer;
begin
  perform pg_temp.como(v_dir);
  execute 'set local role authenticated';
  perform fn_quitar_titular_unidad(v_u);
  execute 'reset role';
  perform pg_temp.como(null);
  select titular_persona_id into v_vinculo from unidades where id = v_u;
  select exists (select 1 from personas where id = v_tit) into v_existe;
  select count(*) into v_bit from bitacora
   where tabla = 'unidades' and registro_id = v_u::text and actor_id = v_dir
     and antes ->> 'titular_persona_id' is not null and despues ->> 'titular_persona_id' is null;
  perform pg_temp.anotar('TIT', 'Quitar al titular suelta el vínculo, la persona sigue existiendo (R8) y queda en la bitácora con su actor',
    'vínculo nulo · persona existe · 1 fila de bitácora', concat_ws(' · ', coalesce(v_vinculo::text, 'nulo'), 'persona ' || v_existe, v_bit || ' fila(s)'),
    v_vinculo is null and v_existe and v_bit = 1);
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('TIT', 'Quitar al titular', 'sin error', sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 5 · DOC · LOS PAPELES DE UNA UNIDAD
-- ---------------------------------------------------------------------
-- 5a · Dirección y Administración suben papeles a una unidad (sin persona ni
-- oportunidad); Comercial no; y lo mismo con el objeto del bucket.
  -- (bloque)
declare v_u uuid := pg_temp.f('u_d'); v_dir uuid := pg_temp.f('direccion'); v_adm uuid := pg_temp.f('administracion');
        v_com uuid := pg_temp.f('comercial');
        v_doc1 uuid; v_doc2 uuid; v_fallo boolean := false; v_msg text := 'se aceptó';
begin
  perform pg_temp.como(v_dir);
  execute 'set local role authenticated';
  insert into documentos (unidad_id, tipo, nombre_archivo, ruta)
  values (v_u, 'minuta', 'PRUEBA17 minuta.pdf', 'prueba-17/' || gen_random_uuid()::text || '.pdf') returning id into v_doc1;
  execute 'reset role';
  perform pg_temp.como(v_adm);
  execute 'set local role authenticated';
  insert into documentos (unidad_id, tipo, nombre_archivo, ruta)
  values (v_u, 'tramite_notarial', 'PRUEBA17 notaria.pdf', 'prueba-17/' || gen_random_uuid()::text || '.pdf') returning id into v_doc2;
  execute 'reset role';
  perform pg_temp.como(v_com);
  execute 'set local role authenticated';
  begin
    insert into documentos (unidad_id, tipo, nombre_archivo, ruta)
    values (v_u, 'minuta', 'PRUEBA17 intruso.pdf', 'prueba-17/' || gen_random_uuid()::text || '.pdf');
  exception when others then v_fallo := true; v_msg := sqlerrm; end;
  execute 'reset role';
  perform pg_temp.como(null);
  insert into fixture values ('doc1', v_doc1);
  perform pg_temp.anotar('DOC', 'Dirección y Administración registran papeles de una unidad (sin persona); Comercial no (RLS de documentos)',
    'dirección ok · administración ok · comercial «row-level security»',
    concat_ws(' · ', 'dirección ' || (v_doc1 is not null), 'administración ' || (v_doc2 is not null), left(v_msg, 60)),
    v_doc1 is not null and v_doc2 is not null and pg_temp.veredicto_error(v_fallo, v_msg, 'row-level security'));
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('DOC', 'Registrar papeles de una unidad', 'sin error', sqlerrm, false);
end;

-- 5b · quién LEE los papeles de una unidad: dirección y administración sí;
-- comercial, lectura y un usuario de dirección desactivado no.
  -- (bloque)
declare v_u uuid := pg_temp.f('u_d'); v_dir uuid := pg_temp.f('direccion'); v_adm uuid := pg_temp.f('administracion');
        v_com uuid := pg_temp.f('comercial'); v_lec uuid := pg_temp.f('lector');
        n_dir integer; n_adm integer; n_com integer; n_lec integer; n_ina integer;
begin
  perform pg_temp.como(v_dir);  execute 'set local role authenticated';
  select count(*) into n_dir from documentos where unidad_id = v_u;  execute 'reset role';
  perform pg_temp.como(v_adm);  execute 'set local role authenticated';
  select count(*) into n_adm from documentos where unidad_id = v_u;  execute 'reset role';
  perform pg_temp.como(v_com);  execute 'set local role authenticated';
  select count(*) into n_com from documentos where unidad_id = v_u;  execute 'reset role';
  if v_lec is not null then
    perform pg_temp.como(v_lec);  execute 'set local role authenticated';
    select count(*) into n_lec from documentos where unidad_id = v_u;  execute 'reset role';
  end if;
  update perfiles set activo = false where id = v_dir;
  perform pg_temp.como(v_dir);  execute 'set local role authenticated';
  select count(*) into n_ina from documentos where unidad_id = v_u;  execute 'reset role';
  update perfiles set activo = true where id = v_dir;
  perform pg_temp.como(null);
  perform pg_temp.anotar_lec('DOC', 'Leen los papeles de una unidad: dirección y administración sí (2); comercial, lectura y un usuario desactivado no (0)',
    'dirección 2 · administración 2 · comercial 0 · lectura 0 · desactivado 0',
    format('dirección %s · administración %s · comercial %s · lectura %s · desactivado %s', n_dir, n_adm, n_com, coalesce(n_lec::text, '—'), n_ina),
    n_dir = 2 and n_adm = 2 and n_com = 0 and n_ina = 0,
    n_lec = 0,
    v_lec is null);
exception when others then
  execute 'reset role';
  update perfiles set activo = true where id = v_dir;
  perform pg_temp.como(null);
  perform pg_temp.anotar('DOC', 'Quién lee los papeles de una unidad', 'sin error', sqlerrm, false);
end;

-- 5c · las reglas de forma: un papel necesita persona o unidad; los tipos
-- nuevos entran, uno inventado no.
  -- (bloque)
declare f_vacio boolean := false; m_vacio text := 'se aceptó'; f_tipo boolean := false; m_tipo text := 'se aceptó';
        v_n integer; v_u uuid := pg_temp.f('u_d');
begin
  begin insert into documentos (tipo, nombre_archivo, ruta) values ('otro', 'PRUEBA17', 'prueba-17/' || gen_random_uuid()::text);
  exception when others then f_vacio := true; m_vacio := sqlerrm; end;
  begin insert into documentos (unidad_id, tipo, nombre_archivo, ruta) values (v_u, 'tipo_inventado', 'PRUEBA17', 'prueba-17/' || gen_random_uuid()::text);
  exception when others then f_tipo := true; m_tipo := sqlerrm; end;
  insert into documentos (unidad_id, tipo, nombre_archivo, ruta)
  select v_u, t, 'PRUEBA17 ' || t, 'prueba-17/' || gen_random_uuid()::text
    from unnest(array['escritura','tramite_registral','carta_poder','plano_unidad','dni','recibo','otro']) as t;
  get diagnostics v_n = row_count;
  perform pg_temp.anotar('DOC', 'Un papel necesita persona o unidad; los tipos nuevos (minuta, escritura, trámites, carta poder, plano de la unidad) entran y uno inventado no',
    'sin persona ni unidad → documentos_persona_o_unidad · tipo inventado → documentos_tipo_valido · 7 tipos aceptados',
    concat_ws(' · ', left(m_vacio, 50), left(m_tipo, 50), v_n || ' aceptados'),
    pg_temp.veredicto_error(f_vacio, m_vacio, 'documentos_persona_o_unidad')
      and pg_temp.veredicto_error(f_tipo, m_tipo, 'documentos_tipo_valido') and v_n = 7);
end;

-- 5d · el archivo en el bucket: lo lee dirección mientras su fila está vigente;
-- comercial no; archivado con motivo, deja de leerse (R8: no se borra).
  -- (bloque)
declare v_u uuid := pg_temp.f('u_d'); v_dir uuid := pg_temp.f('direccion'); v_com uuid := pg_temp.f('comercial');
        v_ruta text := 'prueba-17/' || gen_random_uuid()::text || '.pdf'; v_doc uuid;
        l_dir integer; l_com integer; l_arch integer; v_arch timestamptz; v_paso text := 'insert documentos';
begin
  perform pg_temp.como(v_dir);
  execute 'set local role authenticated';
  insert into documentos (unidad_id, tipo, nombre_archivo, ruta)
  values (v_u, 'minuta', 'PRUEBA17 bucket.pdf', v_ruta) returning id into v_doc;
  v_paso := 'insert storage.objects';
  insert into storage.objects (bucket_id, name) values ('documentos', v_ruta);
  select count(*) into l_dir from storage.objects where bucket_id = 'documentos' and name = v_ruta;
  execute 'reset role';
  perform pg_temp.como(v_com);
  execute 'set local role authenticated';
  select count(*) into l_com from storage.objects where bucket_id = 'documentos' and name = v_ruta;
  execute 'reset role';
  perform pg_temp.como(v_dir);
  v_paso := 'fn_archivar_documento';
  perform fn_archivar_documento(v_doc, 'PRUEBA17 archivado');
  execute 'set local role authenticated';
  select count(*) into l_arch from storage.objects where bucket_id = 'documentos' and name = v_ruta;
  execute 'reset role';
  perform pg_temp.como(null);
  select archivado_el into v_arch from documentos where id = v_doc;
  perform pg_temp.anotar('DOC', 'El archivo de un papel de unidad en el bucket: dirección lo lee, comercial no; archivado con motivo deja de leerse',
    'dirección 1 · comercial 0 · archivado y después 0',
    format('dirección %s · comercial %s · archivado %s · después %s', l_dir, l_com, v_arch is not null, l_arch),
    l_dir = 1 and l_com = 0 and v_arch is not null and l_arch = 0);
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('DOC', 'Archivo de un papel de unidad en el bucket', 'sin error', v_paso || ': ' || sqlerrm, false);
end;

-- 5e · lo que ya andaba no se rompe: un comercial sigue adjuntando documentos de
-- SU oportunidad a la persona, y los ve.
  -- (bloque)
declare v_per uuid := pg_temp.f('per'); v_com uuid := pg_temp.f('comercial'); v_op uuid; v_doc uuid; v_n integer;
begin
  insert into oportunidades (persona_id, responsable_id) values (v_per, v_com) returning id into v_op;
  perform pg_temp.como(v_com);
  execute 'set local role authenticated';
  insert into documentos (persona_id, oportunidad_id, tipo, nombre_archivo, ruta)
  values (v_per, v_op, 'material_enviado', 'PRUEBA17 material.pdf', 'prueba-17/' || gen_random_uuid()::text) returning id into v_doc;
  select count(*) into v_n from documentos where id = v_doc;
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('DOC', 'No se rompe lo anterior: un comercial adjunta un documento a la persona de su oportunidad y lo ve',
    'insertado y 1 fila visible', 'insertado ' || (v_doc is not null) || ' · ' || v_n || ' fila visible', v_doc is not null and v_n = 1);
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('DOC', 'Documento de persona sigue funcionando', 'sin error', sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 6 · CIERRE · el contrato se queda con la separación; cerrar una separación
-- ---------------------------------------------------------------------

-- 6a · Al crear el contrato con su separación, la separación pasa SOLA a
-- aplicada_a_contrato (deja de estar viva) y la unidad queda contratada.
  -- (bloque)
declare v_sep uuid; v_dir uuid := pg_temp.f('direccion'); v_u uuid; v_est text; v_viva boolean; v_uni text;
begin
  insert into unidades (codigo_unidad, tipo, estado_comercial, estado_dato, fuente_plano)
  values ('PRUEBA17-CON', 'puesto', 'disponible', 'verde', 'PRUEBA17 plano') returning id into v_u;
  v_sep := pg_temp.separar('PRUEBA17-CON');
  perform pg_temp.como(v_dir);
  update separaciones set estado = 'verificada', verificada_por = v_dir, verificada_el = now() where id = v_sep;
  perform pg_temp.como(null);
  insert into contratos (persona_id, unidad_id, separacion_id, precio_total, precio_moneda)
  values (pg_temp.f('per'), v_u, v_sep, 0, 'PEN');
  select estado::text into v_est from separaciones where id = v_sep;
  select tiene_separacion_viva into v_viva from v_unidades_tablero where id = v_u;
  v_uni := pg_temp.estado('PRUEBA17-CON');
  perform pg_temp.anotar('CIERRE', 'Crear el contrato con su separación la pasa sola a aplicada_a_contrato (ya no viva) y deja la unidad contratada',
    'aplicada_a_contrato · sin separación viva · contratada/disponible',
    concat_ws(' · ', v_est, 'viva ' || v_viva, v_uni),
    v_est = 'aplicada_a_contrato' and v_viva = false and v_uni = 'contratada/disponible');
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('CIERRE', 'Crear el contrato con su separación', 'sin error', sqlerrm, false);
end;

-- 6b · Una unidad con contrato vivo nunca es ofrecible, aunque alguien deje su
-- estado guardado en 'disponible'; el tablero lo dice y la web no la ofrece.
  -- (bloque)
declare v_u uuid; v_ofr boolean; v_tc boolean; v_web text;
begin
  insert into unidades (codigo_unidad, tipo, estado_comercial, estado_dato, fuente_plano, area_m2)
  values ('PRUEBA17-OFR', 'puesto', 'disponible', 'verde', 'PRUEBA17 plano', 1) returning id into v_u;
  insert into contratos (persona_id, unidad_id, precio_total, precio_moneda)
  values (pg_temp.f('per'), v_u, 0, 'PEN');
  update unidades set estado_comercial = 'disponible' where id = v_u;   -- a mano, contra los hechos
  select ofrecible, tiene_contrato_vivo into v_ofr, v_tc from v_unidades_tablero where id = v_u;
  v_web := pg_temp.estado_web('PRUEBA17-OFR');
  perform pg_temp.anotar('CIERRE', 'Con contrato vivo una unidad nunca es ofrecible (aunque su estado diga disponible); el tablero lo marca y la web no la ofrece',
    'ofrecible false · tiene_contrato_vivo true · web ≠ disponible',
    concat_ws(' · ', 'ofrecible ' || v_ofr, 'contrato ' || v_tc, 'web ' || coalesce(v_web, 'sin función')),
    v_ofr = false and v_tc = true and coalesce(v_web, 'x') <> 'disponible');
exception when others then
  perform pg_temp.anotar('CIERRE', 'Con contrato vivo nunca es ofrecible', 'sin error', sqlerrm, false);
end;

-- 6c · R3: no hay constancia de una separación archivada.
  -- (bloque)
declare v_sep uuid; v_dir uuid := pg_temp.f('direccion'); v_antes boolean; v_despues boolean;
begin
  insert into unidades (codigo_unidad, tipo, estado_comercial, estado_dato, fuente_plano)
  values ('PRUEBA17-R3', 'puesto', 'disponible', 'verde', 'PRUEBA17 plano');
  v_sep := pg_temp.separar('PRUEBA17-R3');
  perform pg_temp.como(v_dir);
  update separaciones set estado = 'verificada', verificada_por = v_dir, verificada_el = now(),
         doc_cliente_registrado = true where id = v_sep;
  perform pg_temp.como(null);
  v_antes := puede_emitir_constancia(v_sep);
  update separaciones set archivado_el = now() where id = v_sep;
  v_despues := puede_emitir_constancia(v_sep);
  perform pg_temp.anotar('CIERRE', 'R3: una separación verificada con documento puede emitir constancia; archivada, ya no',
    'antes true · archivada false', 'antes ' || v_antes || ' · archivada ' || v_despues, v_antes and not v_despues);
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('CIERRE', 'R3 con separación archivada', 'sin error', sqlerrm, false);
end;

-- 6d · fn_cerrar_separacion, con la sesión de la app: quién puede qué.
  -- (bloque)
declare v_dir uuid := pg_temp.f('direccion'); v_adm uuid := pg_temp.f('administracion'); v_com uuid := pg_temp.f('comercial');
        v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_op uuid;
        m_dev text := 'se aceptó'; m_ajena text := 'se aceptó'; m_sin text := 'se aceptó'; m_fut text := 'se aceptó'; m_doble text := 'se aceptó';
        e1 text; e2 text; e3 text; e4 text; u1 text; u3 text; v_fecha date;
begin
  insert into unidades (codigo_unidad, tipo, estado_comercial, estado_dato, fuente_plano) values
    ('PRUEBA17-C1', 'puesto', 'disponible', 'verde', 'PRUEBA17 plano'),
    ('PRUEBA17-C2', 'puesto', 'disponible', 'verde', 'PRUEBA17 plano'),
    ('PRUEBA17-C3', 'puesto', 'disponible', 'verde', 'PRUEBA17 plano'),
    ('PRUEBA17-C4', 'puesto', 'disponible', 'verde', 'PRUEBA17 plano');
  -- C1: la registró el comercial y está verificada · C2: la registró el comercial, sin verificar
  -- C3: la registró Dirección, sin verificar (ajena para el comercial) · C4: para «vencer»
  insert into oportunidades (persona_id, responsable_id) values (pg_temp.f('per'), v_com) returning id into v_op;
  insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda, creado_por)
  select v_op, pg_temp.f('per'), id, 0, 'PEN', v_com from unidades where codigo_unidad = 'PRUEBA17-C1' returning id into v_s1;
  insert into oportunidades (persona_id, responsable_id) values (pg_temp.f('per'), v_com) returning id into v_op;
  insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda, creado_por)
  select v_op, pg_temp.f('per'), id, 0, 'PEN', v_com from unidades where codigo_unidad = 'PRUEBA17-C2' returning id into v_s2;
  insert into oportunidades (persona_id, responsable_id) values (pg_temp.f('per'), v_dir) returning id into v_op;
  insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda, creado_por)
  select v_op, pg_temp.f('per'), id, 0, 'PEN', v_dir from unidades where codigo_unidad = 'PRUEBA17-C3' returning id into v_s3;
  v_s4 := pg_temp.separar('PRUEBA17-C4');
  perform pg_temp.como(v_dir);
  update separaciones set estado = 'verificada', verificada_por = v_dir, verificada_el = now() where id = v_s1;

  -- El comercial: no puede devolver la suya verificada, ni anular la ajena; sí anular la suya sin verificar.
  perform pg_temp.como(v_com);
  execute 'set local role authenticated';
  begin perform fn_cerrar_separacion(v_s1, 'devolver', 'PRUEBA17', null); exception when others then m_dev := sqlerrm; end;
  begin perform fn_cerrar_separacion(v_s3, 'anular', 'PRUEBA17', null); exception when others then m_ajena := sqlerrm; end;
  perform fn_cerrar_separacion(v_s2, 'anular', 'PRUEBA17 cargada por error', null);
  begin perform fn_cerrar_separacion(v_s3, 'anular', '   ', null); exception when others then m_sin := sqlerrm; end;
  execute 'reset role';

  -- Administración devuelve la verificada (fecha de hoy por defecto); Dirección vence la C4.
  perform pg_temp.como(v_adm);
  execute 'set local role authenticated';
  begin perform fn_cerrar_separacion(v_s1, 'devolver', 'PRUEBA17', current_date + 5); exception when others then m_fut := sqlerrm; end;
  perform fn_cerrar_separacion(v_s1, 'devolver', 'PRUEBA17 devuelto al cliente', null);
  begin perform fn_cerrar_separacion(v_s1, 'devolver', 'PRUEBA17', null); exception when others then m_doble := sqlerrm; end;
  execute 'reset role';
  perform pg_temp.como(v_dir);
  execute 'set local role authenticated';
  perform fn_cerrar_separacion(v_s4, 'vencer', 'PRUEBA17 no firmó', null);
  execute 'reset role';
  perform pg_temp.como(null);

  select estado::text || case when archivado_el is null then '' else '+archivada' end, devuelta_el into e1, v_fecha from separaciones where id = v_s1;
  select estado::text || case when archivado_el is null then '' else '+archivada' end into e2 from separaciones where id = v_s2;
  select estado::text || case when archivado_el is null then '' else '+archivada' end into e3 from separaciones where id = v_s3;
  select estado::text || case when archivado_el is null then '' else '+archivada' end into e4 from separaciones where id = v_s4;
  u1 := pg_temp.estado('PRUEBA17-C1');
  u3 := pg_temp.estado('PRUEBA17-C3');
  perform pg_temp.anotar('CIERRE', 'fn_cerrar_separacion: el comercial solo anula una SUYA sin verificar; Administración devuelve (no fecha futura, no dos veces); Dirección vence; la unidad vuelve a disponible',
    'comercial rechazado al devolver y en la ajena · C2 anulada · sin motivo rechazado · C1 devuelta hoy y unidad disponible/— · C4 vencida · C3 sigue viva',
    concat_ws(' | ', left(m_dev, 40), left(m_ajena, 40), 'C2 ' || e2, left(m_sin, 30), left(m_fut, 30), 'C1 ' || e1 || ' ' || v_fecha, u1, left(m_doble, 30), 'C4 ' || e4, 'C3 ' || e3 || ' ' || u3),
    strpos(m_dev, 'Solo Dirección o Administración') > 0 and strpos(m_ajena, 'Solo Dirección o Administración') > 0
      and e2 = 'pendiente_verificacion+archivada' and strpos(m_sin, 'hay que decir por qué') > 0
      and strpos(m_fut, 'no puede ser futura') > 0 and e1 = 'devuelta' and v_fecha = (now() at time zone 'America/Lima')::date
      and u1 = 'disponible/—' and strpos(m_doble, 'ya no está viva') > 0 and e4 = 'vencida'
      and e3 = 'pendiente_verificacion' and u3 = 'reservada_temporal/disponible');
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('CIERRE', 'fn_cerrar_separacion por rol', 'sin error', sqlerrm, false);
end;

-- 6e · Registrar el documento del cliente después de crear la separación
-- (antes solo se podía al crearla): sin DNI en la ficha se rechaza; con DNI, sí.
  -- (bloque)
declare v_sep uuid; v_per uuid; v_op uuid; v_com uuid := pg_temp.f('comercial'); m text := 'se aceptó'; v_ok boolean;
begin
  insert into unidades (codigo_unidad, tipo, estado_comercial, estado_dato, fuente_plano)
  values ('PRUEBA17-DOCC', 'puesto', 'disponible', 'verde', 'PRUEBA17 plano');
  insert into personas (nombre_completo, telefono_e164) values ('PRUEBA17 Sin DNI', '+51900170201') returning id into v_per;
  insert into oportunidades (persona_id) values (v_per) returning id into v_op;
  insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda)
  select v_op, v_per, id, 0, 'PEN' from unidades where codigo_unidad = 'PRUEBA17-DOCC' returning id into v_sep;
  perform pg_temp.como(v_com);
  execute 'set local role authenticated';
  begin perform fn_registrar_doc_cliente(v_sep); exception when others then m := sqlerrm; end;
  execute 'reset role';
  update personas set doc_tipo = 'DNI', doc_numero = 'PRUEBA17-DOC-9' where id = v_per;
  execute 'set local role authenticated';
  perform fn_registrar_doc_cliente(v_sep);
  execute 'reset role';
  perform pg_temp.como(null);
  select doc_cliente_registrado into v_ok from separaciones where id = v_sep;
  perform pg_temp.anotar('CIERRE', 'El documento del cliente se puede registrar después de crear la separación, solo si la ficha ya tiene su DNI',
    'sin DNI rechazado · con DNI registrado', left(m, 60) || ' · registrado ' || v_ok,
    strpos(m, 'todavía no tiene su documento') > 0 and v_ok);
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('CIERRE', 'Registrar el documento del cliente', 'sin error', sqlerrm, false);
end;

-- 6f · R2 con RLS de verdad: un comercial no deshace la verificación de Walter
-- ni edita la separación de otro vendedor; la suya sin verificar, sí.
  -- (bloque)
declare v_dir uuid := pg_temp.f('direccion'); v_com uuid := pg_temp.f('comercial');
        v_ver uuid; v_ajena uuid; v_suya uuid; v_op uuid; n_ver integer; n_ajena integer; n_suya integer; v_sigue timestamptz;
begin
  insert into unidades (codigo_unidad, tipo, estado_comercial, estado_dato, fuente_plano) values
    ('PRUEBA17-RLS1', 'puesto', 'disponible', 'verde', 'PRUEBA17 plano'),
    ('PRUEBA17-RLS2', 'puesto', 'disponible', 'verde', 'PRUEBA17 plano'),
    ('PRUEBA17-RLS3', 'puesto', 'disponible', 'verde', 'PRUEBA17 plano');
  insert into oportunidades (persona_id, responsable_id) values (pg_temp.f('per'), v_com) returning id into v_op;
  insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda, creado_por)
  select v_op, pg_temp.f('per'), id, 0, 'PEN', v_com from unidades where codigo_unidad = 'PRUEBA17-RLS1' returning id into v_ver;
  insert into oportunidades (persona_id, responsable_id) values (pg_temp.f('per'), v_dir) returning id into v_op;
  insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda, creado_por)
  select v_op, pg_temp.f('per'), id, 0, 'PEN', v_dir from unidades where codigo_unidad = 'PRUEBA17-RLS2' returning id into v_ajena;
  insert into oportunidades (persona_id, responsable_id) values (pg_temp.f('per'), v_com) returning id into v_op;
  insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda, creado_por)
  select v_op, pg_temp.f('per'), id, 0, 'PEN', v_com from unidades where codigo_unidad = 'PRUEBA17-RLS3' returning id into v_suya;
  perform pg_temp.como(v_dir);
  update separaciones set estado = 'verificada', verificada_por = v_dir, verificada_el = now() where id = v_ver;

  perform pg_temp.como(v_com);
  execute 'set local role authenticated';
  update separaciones set verificada_el = null, verificada_por = null, estado = 'pendiente_verificacion' where id = v_ver;
  get diagnostics n_ver = row_count;
  update separaciones set notas = 'PRUEBA17 ajena' where id = v_ajena;
  get diagnostics n_ajena = row_count;
  update separaciones set notas = 'PRUEBA17 suya' where id = v_suya;
  get diagnostics n_suya = row_count;
  execute 'reset role';
  perform pg_temp.como(null);
  select verificada_el into v_sigue from separaciones where id = v_ver;
  perform pg_temp.anotar('CIERRE', 'R2 con RLS: un comercial no deshace la verificación de Walter ni edita la separación de otro vendedor; la suya sin verificar sí',
    'deshacer 0 filas (sigue verificada) · ajena 0 filas · suya 1 fila',
    format('deshacer %s filas (verificada %s) · ajena %s · suya %s', n_ver, v_sigue is not null, n_ajena, n_suya),
    n_ver = 0 and v_sigue is not null and n_ajena = 0 and n_suya = 1);
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('CIERRE', 'R2 con RLS en separaciones', 'sin error', sqlerrm, false);
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
  execute 'drop function if exists public.probar_reglas_17()';

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
revoke all on function public.probar_reglas_17() from public, anon, authenticated;

select * from public.probar_reglas_17();
