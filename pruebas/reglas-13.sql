-- =====================================================================
-- CRM Mercado Media Luna — PRUEBAS DE 13 · SEGUIMIENTO COMERCIAL
--
-- Qué comprueba: lo que sql/13-seguimiento-comercial.sql promete y la
-- interfaz da por hecho (SPEC §4.8): registro uno a uno y por lotes sin
-- duplicar, paso a fríos al llegar al umbral, 01→02 con motivo (R9),
-- «no contactar» (Ley 29733), R5 y R7 a través del perfil, visitas (dos
-- tareas, una sola abierta, reprogramar conserva el UID del .ics), RLS del
-- perfil y de la bandeja, «tomar» un lead (gana el primero), R8 en las tablas
-- nuevas, que `anon` no ejecute nada nuevo, que v_cartera cumpla su contrato
-- y (§9, humo) que cada RPC que la ficha llama corra al menos una vez sin error.
--
-- 🟡 ESTADO: ver pruebas\COMO-PROBAR.md §«Pruebas de 13». El resultado del
--    ensayo queda anotado allí con su fecha; este archivo no declara VALIDADO
--    nada que nadie haya visto pasar.
--
-- ---------------------------------------------------------------------
-- CÓMO SE LEE
-- ---------------------------------------------------------------------
-- Igual que pruebas\reglas.sql: cada prueba dice qué DEBE pasar, lo compara
-- con lo obtenido y lo anota en la tabla temporal `resultado`. Las que tienen
-- que fallar comprueban además que el mensaje sea EL SUYO (un error distinto
-- no prueba nada). Al final sale un solo cuadro con la fila RESUMEN (n=9999).
--   ✅ PASA · 🔴 FALLA · 🟡 OMITIDA (faltan datos para probarla; dice cuáles)
--
-- ---------------------------------------------------------------------
-- ESTE ARCHIVO NO DEJA RASTRO
-- ---------------------------------------------------------------------
-- Todo va dentro de UNA función que se deshace sola (ver «CÓMO SE CORRE», más
-- abajo): personas, oportunidades, tareas, visitas, perfiles, documentos y el
-- rol cambiado un momento para la prueba de `lectura` se deshacen al final.
-- ⚠️ No quites el `raise exception … P0999` del final de la función: es lo que
-- lo deshace todo.
--
-- ---------------------------------------------------------------------
-- AQUÍ NO HAY NI UNA CIFRA DEL NEGOCIO
-- ---------------------------------------------------------------------
-- Los teléfonos (+5190013000N), el capital de juguete (10) y los
-- desplazamientos de fecha (+48 h, +1 día) son FICHAS DE JUGUETE, elegidas
-- para que se vean a simple vista (07-crm\CLAUDE.md §2). Los umbrales
-- operativos (intentos hasta fríos, horas de confirmación) se LEEN de
-- `parametros` con parametro_entero(): si alguien los vacía, la prueba que
-- los necesita sale 🟡 OMITIDA en vez de inventar el número.
--
-- ---------------------------------------------------------------------
-- REQUISITOS
-- ---------------------------------------------------------------------
-- 01..12 aplicados y DESPUÉS 13-seguimiento-comercial.sql (14, 16, 17, 18 y 19 dan
-- igual; sin 13 sale una sola fila 🔴 que lo dice). Un perfil activo
-- de cada rol operativo (comercial, direccion, administracion): `perfiles.id`
-- referencia `auth.users` y no se puede inventar uno. Sin ellos, casi todo
-- sale 🔴 con el motivo en «obtenido» y la fila PRE dice por qué.
--
-- SUPLANTACIÓN: las funciones se llaman como `postgres` con los claims del
-- JWT puestos (auth.uid() los lee); las pruebas de RLS cambian además a
-- `set local role authenticated`, que es el rol con el que llega la app.
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

create or replace function public.probar_reglas_13()
returns table (n integer, regla text, veredicto text, prueba text, esperado text, obtenido text)
language plpgsql set search_path = public as $bateria$
#variable_conflict use_column
declare
  v_cuadro jsonb;
  v_caida  text;
  v_ctx    text;
begin
  -- Sin la migración que se prueba, no se corre nada: se dice qué falta.
  if not (to_regprocedure('public.fn_registrar_prospecto(jsonb,boolean)') is not null and to_regprocedure('public.fn_archivar_documento(uuid,text)') is not null and to_regclass('public.visitas') is not null and to_regclass('public.v_cartera') is not null) then
    return query
      select 1, 'PRE'::text, '🔴 FALLA'::text, 'La migración está aplicada'::text, 'sí'::text,
             'NO: falta aplicar sql/13-seguimiento-comercial.sql en el SQL Editor. Aplícala primero y vuelve a correr esta batería.'::text
      union all
      select 9999, 'RESUMEN'::text, '0 pasan · 1 fallan · 0 omitidas'::text, '1 pruebas'::text,
             'Mira las filas 🔴 de arriba: son las únicas que exigen algo'::text, ''::text;
    execute 'drop function if exists public.probar_reglas_13()';
    return;
  end if;
  begin
-- @@INICIO_CUERPO (el ensayo de SPEC §4.9 envía desde aquí hasta @@FIN_CUERPO)

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

-- Mismo criterio que pruebas\reglas.sql: `strpos` y no LIKE, porque los
-- fragmentos llevan guiones bajos y en LIKE un `_` vale por cualquier letra.
create function pg_temp.veredicto_error(p_fallo boolean, p_mensaje text, p_fragmento text)
returns text language sql immutable as $$
  select case when p_fallo and strpos(coalesce(p_mensaje, ''), p_fragmento) > 0
              then '✅ PASA' else '🔴 FALLA' end
$$;

create function pg_temp.anotar(p_regla text, p_prueba text, p_esperado text, p_obtenido text, p_ok boolean)
returns void language sql as $$
  insert into resultado (regla, prueba, esperado, obtenido, veredicto)
  values (p_regla, p_prueba, p_esperado, coalesce(p_obtenido, '(nulo)'),
          case when coalesce(p_ok, false) then '✅ PASA' else '🔴 FALLA' end)
$$;

create function pg_temp.f(p_clave text) returns uuid language sql stable as $$
  select id from fixture where clave = p_clave
$$;

-- Suplantar (o dejar de suplantar, con NULL) a un usuario del proyecto.
create function pg_temp.como(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then ''
         else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
end $$;

-- Lo común de todo registro de prueba: origen admitido y consentimiento
-- declarado (sin él la función se niega, Ley 29733).
create function pg_temp.comun() returns jsonb language sql immutable as $$
  select jsonb_build_object('origen', 'live', 'consentimiento', true,
                            'consentimiento_canal', 'prueba_reglas',
                            'consentimiento_evidencia', 'PRUEBA reglas-13 (se deshace con rollback)')
$$;

create function pg_temp.datos(p_nombre text, p_tel text) returns jsonb language sql immutable as $$
  select pg_temp.comun() || jsonb_build_object('nombre', p_nombre, 'telefono', p_tel)
$$;

  <<bloque_1>>
declare v_n integer;
begin
  insert into fixture select 'comercial', id from perfiles
   where rol = 'comercial' and activo order by creado_el limit 1;
  insert into fixture select 'direccion', id from perfiles
   where rol = 'direccion' and activo order by creado_el limit 1;
  insert into fixture select 'administracion', id from perfiles
   where rol = 'administracion' and activo order by creado_el limit 1;
  select count(*) into v_n from fixture;
  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('PRE', 'Hay un perfil activo de cada rol operativo (comercial, direccion, administracion)',
   'los tres', v_n || ' de 3', case when v_n = 3 then '✅ PASA' else '🟡 OMITIDA' end);
end;


-- ---------------------------------------------------------------------
-- 1 · REGISTRO: uno a uno, sin duplicar, y por lotes
-- ---------------------------------------------------------------------

-- 1a · R6 desde el alta: persona + oportunidad 01 + tarea abierta con fecha.
  <<bloque_2>>
declare v jsonb; v_op uuid; v_ok boolean;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  v := fn_registrar_prospecto(pg_temp.datos('PRUEBA13 Ana', '+51900130001'));
  perform pg_temp.como(null);
  v_op := (v ->> 'oportunidad_id')::uuid;
  insert into fixture values ('op_ana', v_op), ('per_ana', (v ->> 'persona_id')::uuid);
  v_ok := v ->> 'accion' = 'creada'
      and exists (select 1 from oportunidades o where o.id = v_op and o.estado = '01_prospecto_captado'
                     and o.situacion = 'activa' and o.responsable_id = pg_temp.f('comercial'))
      and exists (select 1 from tareas t where t.oportunidad_id = v_op and t.completada_el is null
                     and t.tipo = 'primer_contacto' and t.vence_el is not null);
  perform pg_temp.anotar('R6', 'fn_registrar_prospecto crea persona + oportunidad 01 + tarea «Primer contacto» abierta',
    'accion creada, tarea primer_contacto abierta con fecha',
    concat_ws(' · ', v ->> 'accion', 'tarea ' || coalesce(v ->> 'tarea_id', 'ninguna')), v_ok);
exception when others then
  perform pg_temp.anotar('R6', 'fn_registrar_prospecto crea persona + oportunidad 01 + tarea «Primer contacto» abierta',
    'accion creada, tarea primer_contacto abierta con fecha', sqlerrm, false);
end;

-- 1b · El mismo teléfono, registrado por OTRO usuario: se reutiliza, no se
-- duplica y no cambia de dueño (lo que fn_registro_rapido no sabía hacer).
  <<bloque_3>>
declare v jsonb; v_n integer; v_ok boolean;
begin
  perform pg_temp.como(pg_temp.f('direccion'));
  v := fn_registrar_prospecto(pg_temp.datos('PRUEBA13 Ana otra vez', '+51900130001'));
  perform pg_temp.como(null);
  select count(*) into v_n from oportunidades o
   where o.persona_id = pg_temp.f('per_ana') and o.situacion in ('activa','pausada') and o.archivado_el is null;
  v_ok := v ->> 'accion' = 'oportunidad_reutilizada'
      and (v ->> 'responsable_otro')::boolean
      and (v ->> 'responsable_id')::uuid = pg_temp.f('comercial')
      and (v ->> 'oportunidad_id')::uuid = pg_temp.f('op_ana')
      and v_n = 1;
  perform pg_temp.anotar('DEDUP', 'El mismo teléfono registrado por otro usuario reutiliza la oportunidad viva',
    'oportunidad_reutilizada, responsable_otro, 1 sola oportunidad viva',
    concat_ws(' · ', v ->> 'accion', 'responsable_otro ' || (v ->> 'responsable_otro'), v_n || ' viva(s)'), v_ok);
exception when others then
  perform pg_temp.anotar('DEDUP', 'El mismo teléfono registrado por otro usuario reutiliza la oportunidad viva',
    'oportunidad_reutilizada, responsable_otro, 1 sola oportunidad viva', sqlerrm, false);
end;

-- 1c · Lote SIMULADO: marca el repetido dentro de la lista y el teléfono
-- inválido, con índice 0-based, y no escribe NADA.
  <<bloque_4>>
declare v jsonb; v_escritas integer; v_ok boolean;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  v := fn_registrar_lote(jsonb_build_array(
         jsonb_build_object('nombre', 'PRUEBA13 Beto',     'telefono', '+51900130002'),
         jsonb_build_object('nombre', 'PRUEBA13 Beto bis', 'telefono', '+51900130002'),
         jsonb_build_object('nombre', 'PRUEBA13 Malo',     'telefono', '999')),
       pg_temp.comun(), true);
  perform pg_temp.como(null);
  select count(*) into v_escritas from personas where telefono_e164 in ('+51900130002', '999');
  v_ok := (v ->> 'simulado')::boolean
      and (v -> 'filas' -> 0 ->> 'ok')::boolean
      and (v -> 'filas' -> 0 ->> 'indice')::integer = 0
      and not (v -> 'filas' -> 1 ->> 'ok')::boolean
      and strpos(v -> 'filas' -> 1 ->> 'motivo', 'Repetido en esta lista (fila 1)') > 0
      and not (v -> 'filas' -> 2 ->> 'ok')::boolean
      and strpos(v -> 'filas' -> 2 ->> 'motivo', 'E.164') > 0
      and (v ->> 'validas')::integer = 1 and (v ->> 'con_error')::integer = 2
      and v_escritas = 0;
  perform pg_temp.anotar('LOTE', 'fn_registrar_lote simulado: repetido en la lista + teléfono inválido, sin escribir',
    '1 válida, 2 con error (repetido fila 1, E.164), 0 personas escritas',
    concat_ws(' · ', 'validas ' || (v ->> 'validas'), 'con_error ' || (v ->> 'con_error'),
              v -> 'filas' -> 1 ->> 'motivo', left(v -> 'filas' -> 2 ->> 'motivo', 60),
              v_escritas || ' escritas'), v_ok);
exception when others then
  perform pg_temp.anotar('LOTE', 'fn_registrar_lote simulado: repetido en la lista + teléfono inválido, sin escribir',
    '1 válida, 2 con error (repetido fila 1, E.164), 0 personas escritas', sqlerrm, false);
end;

-- 1d · Lote REAL con «repartir entre»: las oportunidades nuevas se reparten
-- por turnos, en el orden de la lista.
  <<bloque_5>>
declare v jsonb; v_ok boolean;
begin
  perform pg_temp.como(pg_temp.f('direccion'));
  v := fn_registrar_lote(jsonb_build_array(
         jsonb_build_object('nombre', 'PRUEBA13 Caro', 'telefono', '+51900130003'),
         jsonb_build_object('nombre', 'PRUEBA13 Dani', 'telefono', '+51900130004')),
       pg_temp.comun() || jsonb_build_object('repartir_entre',
         jsonb_build_array(pg_temp.f('comercial'), pg_temp.f('administracion'))),
       false);
  perform pg_temp.como(null);
  insert into fixture values
    ('op_caro',  (v -> 'filas' -> 0 ->> 'oportunidad_id')::uuid),
    ('op_dani',  (v -> 'filas' -> 1 ->> 'oportunidad_id')::uuid),
    ('per_dani', (v -> 'filas' -> 1 ->> 'persona_id')::uuid);
  v_ok := (v ->> 'creadas')::integer = 2
      and (v -> 'filas' -> 0 ->> 'responsable_id')::uuid = pg_temp.f('comercial')
      and (v -> 'filas' -> 1 ->> 'responsable_id')::uuid = pg_temp.f('administracion')
      and exists (select 1 from oportunidades o where o.id = pg_temp.f('op_dani')
                     and o.responsable_id = pg_temp.f('administracion'));
  perform pg_temp.anotar('LOTE', 'fn_registrar_lote real con repartir_entre alterna los dueños',
    '2 creadas: fila 0 → comercial, fila 1 → administracion',
    concat_ws(' · ', 'creadas ' || (v ->> 'creadas'),
              'fila 0 ' || coalesce((select p.rol::text from perfiles p where p.id = (v -> 'filas' -> 0 ->> 'responsable_id')::uuid), '?'),
              'fila 1 ' || coalesce((select p.rol::text from perfiles p where p.id = (v -> 'filas' -> 1 ->> 'responsable_id')::uuid), '?')),
    v_ok);
exception when others then
  perform pg_temp.anotar('LOTE', 'fn_registrar_lote real con repartir_entre alterna los dueños',
    '2 creadas: fila 0 → comercial, fila 1 → administracion', sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 2 · CONTACTOS: fríos, 01→02, «no contactar»
-- ---------------------------------------------------------------------

-- 2a · N× «no contesta» (N = parametros.frio_intentos_sin_respuesta): pasa a
-- fríos justo en el intento N, ni uno antes, y deja la tarea de reactivación.
  <<bloque_6>>
declare v jsonb; v_umbral integer; k integer; v_antes boolean := false; v_marcas text[] := '{}'; v_ok boolean;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  v_umbral := parametro_entero('frio_intentos_sin_respuesta');
  if v_umbral is null or v_umbral < 1 then
    perform pg_temp.como(null);
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('FRIOS', 'N intentos sin respuesta mandan el lead a fríos', 'pausada en el intento N',
     'parametros.frio_intentos_sin_respuesta vacío o no operativo', '🟡 OMITIDA');
    exit bloque_6;
  end if;
  for k in 1 .. v_umbral loop
    v := fn_registrar_contacto(pg_temp.f('op_ana'), 'no_contesta', 'llamada');
    v_marcas := v_marcas || coalesce(v ->> 'paso_a_frios', 'nulo');
    if k < v_umbral and coalesce((v ->> 'paso_a_frios')::boolean, false) then v_antes := true; end if;
  end loop;
  perform pg_temp.como(null);
  v_ok := not v_antes
      and (v ->> 'paso_a_frios')::boolean
      and v ->> 'situacion' = 'pausada'
      and (v ->> 'intentos_sin_respuesta')::integer = v_umbral
      and v -> 'tarea' ?& array['id','titulo','vence_el']
      and exists (select 1 from oportunidades o where o.id = pg_temp.f('op_ana')
                     and o.motivo_frio = 'no_responde' and o.enfriado_el is not null)
      and exists (select 1 from tareas t where t.oportunidad_id = pg_temp.f('op_ana')
                     and t.completada_el is null and t.tipo = 'reactivacion')
      and not exists (select 1 from tareas t where t.oportunidad_id = pg_temp.f('op_ana')
                         and t.completada_el is null and t.tipo in ('primer_contacto','seguimiento'));
  perform pg_temp.anotar('FRIOS', 'N intentos sin respuesta mandan el lead a fríos (N = ' || v_umbral || ', de parametros)',
    'paso_a_frios solo en el intento N, pausada/no_responde, tarea de reactivación abierta',
    concat_ws(' · ', 'paso_a_frios por intento: ' || array_to_string(v_marcas, ','),
              v ->> 'situacion', 'tarea ' || coalesce(v -> 'tarea' ->> 'titulo', 'ninguna')), v_ok);
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('FRIOS', 'N intentos sin respuesta mandan el lead a fríos',
    'paso_a_frios solo en el intento N', sqlerrm, false);
end;

-- 2b · R9 fuera del embudo: el paso a fríos deja su evento con actor y motivo.
  <<bloque_7>>
declare v_ok boolean; v_obt text;
begin
  select true, e.de || '→' || e.a || ' · ' || coalesce(e.motivo, '(sin motivo)')
    into v_ok, v_obt
    from oportunidad_eventos e
   where e.oportunidad_id = pg_temp.f('op_ana') and e.tipo = 'situacion'
     and e.de = 'activa' and e.a = 'pausada'
     and e.actor_id = pg_temp.f('comercial') and e.motivo like 'Pasó a fríos%'
   order by e.id desc limit 1;
  perform pg_temp.anotar('R9', 'El cambio de situación queda en oportunidad_eventos con actor y motivo',
    'situacion activa→pausada, actor comercial, motivo «Pasó a fríos…»', coalesce(v_obt, 'sin evento'), v_ok);
end;

-- 2c · Una respuesta mueve 01→02 y estado_historial.motivo por fin se llena.
  <<bloque_8>>
declare v jsonb; v_mot text; v_ok boolean;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  v := fn_registrar_contacto(pg_temp.f('op_caro'), 'contesto', 'whatsapp', 'PRUEBA respondió');
  perform pg_temp.como(null);
  select h.motivo into v_mot from estado_historial h
   where h.oportunidad_id = pg_temp.f('op_caro') and h.a_estado = '02_contactado'
     and h.actor_id = pg_temp.f('comercial')
   order by h.id desc limit 1;
  v_ok := v ->> 'estado' = '02_contactado'
      and v_mot like 'Respondió:%'
      and v -> 'tarea' ?& array['id','titulo','vence_el'];
  perform pg_temp.anotar('R9', 'Contacto positivo mueve 01→02 con estado_historial.motivo',
    'estado 02_contactado, motivo «Respondió: …», tarea {id,titulo,vence_el}',
    concat_ws(' · ', v ->> 'estado', coalesce(v_mot, 'motivo NULL'), 'tarea ' || coalesce(v ->> 'tarea', 'null')), v_ok);
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('R9', 'Contacto positivo mueve 01→02 con estado_historial.motivo',
    'estado 02_contactado, motivo «Respondió: …»', sqlerrm, false);
end;

-- 2d · «No contactar» (Ley 29733): la persona queda marcada, sin
-- consentimiento, su oportunidad perdida y sin una sola tarea abierta.
  <<bloque_9>>
declare v jsonb; v_abiertas integer; v_ok boolean;
begin
  perform pg_temp.como(pg_temp.f('administracion'));
  v := fn_registrar_contacto(pg_temp.f('op_dani'), 'pidio_no_contacto', 'whatsapp', 'PRUEBA pidió que no le escriban');
  perform pg_temp.como(null);
  select count(*) into v_abiertas from tareas t
   where t.oportunidad_id = pg_temp.f('op_dani') and t.completada_el is null;
  v_ok := (v ->> 'descartada')::boolean
      and v -> 'tarea' = 'null'::jsonb
      and exists (select 1 from personas p where p.id = pg_temp.f('per_dani')
                     and p.no_contactar_el is not null and not p.consentimiento)
      and exists (select 1 from oportunidades o where o.id = pg_temp.f('op_dani')
                     and o.situacion = 'perdida' and o.motivo_perdida_codigo = 'pidio_no_contacto')
      and v_abiertas = 0;
  perform pg_temp.anotar('LEY29733', 'pidio_no_contacto: no_contactar + consentimiento false + perdida + 0 tareas abiertas',
    'todo eso, y tarea null en la respuesta',
    concat_ws(' · ', v ->> 'situacion', 'tarea ' || coalesce(v ->> 'tarea', 'null'), v_abiertas || ' abiertas'), v_ok);
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('LEY29733', 'pidio_no_contacto: no_contactar + consentimiento false + perdida + 0 tareas abiertas',
    'todo eso', sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 3 · PERFIL: R7 y R5
-- ---------------------------------------------------------------------

-- 3a · R7: un capital sin moneda no se guarda.
  <<bloque_10>>
declare v_fallo boolean := false; v_msg text := 'se guardó sin error';
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  begin
    perform fn_guardar_perfil(pg_temp.f('op_caro'), jsonb_build_object('capital_monto', '10'));
  exception when others then v_fallo := true; v_msg := sqlerrm;
  end;
  perform pg_temp.como(null);
  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R7', 'fn_guardar_perfil con capital_monto y sin capital_moneda', '❌ ERROR citando capital_con_moneda',
   v_msg, pg_temp.veredicto_error(v_fallo, v_msg, 'capital_con_moneda'));
end;

-- 3b · R5 vía perfil: con 3 de las 4 respuestas, faltan dice cuál y la base
-- no deja pasar a 06.
  <<bloque_11>>
declare v jsonb; v_fallo boolean := false; v_msg text := 'pasó a 06 sin error'; v_ok boolean;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  v := fn_guardar_perfil(pg_temp.f('op_caro'),
         jsonb_build_object('proposito', 'operar', 'forma_pago', 'contado', 'decide_solo', true));
  perform pg_temp.como(null);
  begin
    update oportunidades set estado = '06_calificado' where id = pg_temp.f('op_caro');
  exception when others then v_fallo := true; v_msg := sqlerrm;
  end;
  v_ok := not (v ->> 'cualificacion_completa')::boolean
      and v -> 'faltan' = '["compro_antes"]'::jsonb
      and pg_temp.veredicto_error(v_fallo, v_msg, 'calificado_requiere_las_4_respuestas') = '✅ PASA';
  perform pg_temp.anotar('R5', 'Perfil con 3 de 4 respuestas: faltan = compro_antes y no se llega a 06',
    'cualificacion_completa false, faltan ["compro_antes"], ERROR calificado_requiere_las_4_respuestas',
    concat_ws(' · ', 'faltan ' || (v ->> 'faltan'), v_msg), v_ok);
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('R5', 'Perfil con 3 de 4 respuestas: faltan = compro_antes y no se llega a 06',
    'faltan ["compro_antes"] y ERROR de R5', sqlerrm, false);
end;

-- 3c · R5 vía perfil: con la cuarta respuesta, la cualificación está completa
-- y 06 ya es posible.
  <<bloque_12>>
declare v jsonb; v_msg text := 'ok'; v_ok boolean;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  v := fn_guardar_perfil(pg_temp.f('op_caro'), jsonb_build_object('compro_antes', false));
  perform pg_temp.como(null);
  begin
    update oportunidades set estado = '06_calificado' where id = pg_temp.f('op_caro');
  exception when others then v_msg := sqlerrm;
  end;
  v_ok := (v ->> 'cualificacion_completa')::boolean and v -> 'faltan' = '[]'::jsonb and v_msg = 'ok';
  perform pg_temp.anotar('R5', 'Perfil con las 4 respuestas: cualificación completa y 06 permitido',
    'cualificacion_completa true, faltan [], update a 06 sin error',
    concat_ws(' · ', 'completa ' || (v ->> 'cualificacion_completa'), 'faltan ' || (v ->> 'faltan'), v_msg), v_ok);
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('R5', 'Perfil con las 4 respuestas: cualificación completa y 06 permitido',
    'cualificacion_completa true', sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 4 · VISITAS
-- ---------------------------------------------------------------------

-- 4a · Agendar deja DOS tareas ligadas a la visita (la visita y su
-- confirmación) y el UID del .ics es el id de la visita, secuencia 0.
  <<bloque_13>>
declare v jsonb; v_horas integer; v_inicio timestamptz; v_vis uuid; v_n integer; v_ok boolean;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  v_horas := parametro_entero('visita_confirmar_horas_antes');
  if v_horas is null then
    perform pg_temp.como(null);
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('VISITA', 'Agendar una visita deja 2 tareas (visita + confirmar)', '2 tareas',
     'parametros.visita_confirmar_horas_antes vacío: no se crea la de confirmar', '🟡 OMITIDA');
    exit bloque_13;
  end if;
  v_inicio := now() + make_interval(hours => v_horas + 48);
  v := fn_agendar_visita(pg_temp.f('op_caro'), 'obra', v_inicio);
  perform pg_temp.como(null);
  v_vis := (v ->> 'visita_id')::uuid;
  insert into fixture values ('visita1', v_vis);
  select count(*) into v_n from tareas t where t.visita_id = v_vis and t.completada_el is null;
  v_ok := v ->> 'tarea_visita_id' is not null and v ->> 'tarea_confirmar_id' is not null
      and v_n = 2 and v ->> 'ics_uid' = v_vis::text and (v ->> 'ics_secuencia')::integer = 0;
  perform pg_temp.anotar('VISITA', 'Agendar una visita deja 2 tareas (visita + confirmar) y ics_uid = id',
    '2 tareas abiertas ligadas, ics_uid = visita_id, secuencia 0',
    concat_ws(' · ', v_n || ' tareas', 'uid ' || coalesce(v ->> 'ics_uid', '?'), 'seq ' || coalesce(v ->> 'ics_secuencia', '?')), v_ok);
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('VISITA', 'Agendar una visita deja 2 tareas (visita + confirmar) y ics_uid = id',
    '2 tareas abiertas ligadas', sqlerrm, false);
end;

-- 4b · Una segunda visita abierta se rechaza con su mensaje.
  <<bloque_14>>
declare v_fallo boolean := false; v_msg text := 'se agendó otra sin error';
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  begin
    perform fn_agendar_visita(pg_temp.f('op_caro'), 'videollamada', now() + interval '3 days');
  exception when others then v_fallo := true; v_msg := sqlerrm;
  end;
  perform pg_temp.como(null);
  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('VISITA', 'Segunda visita abierta para la misma oportunidad', '❌ ERROR «Ya tiene una visita agendada…»',
   v_msg, pg_temp.veredicto_error(v_fallo, v_msg, 'Ya tiene una visita agendada'));
end;

-- 4c · Reprogramar CONSERVA el UID y sube la secuencia (RFC 5545): el
-- calendario del cliente mueve el evento en vez de duplicarlo.
  <<bloque_15>>
declare v jsonb; v_prev uuid := pg_temp.f('visita1'); v_ok boolean; v_est text; v_viejas integer; v_nuevas integer;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  v := fn_agendar_visita(p_oportunidad_id => pg_temp.f('op_caro'), p_tipo => 'obra',
                         p_inicio_el => (select inicio_el from visitas where id = v_prev) + interval '1 day',
                         p_reprograma_id => v_prev);
  perform pg_temp.como(null);
  select estado into v_est from visitas where id = v_prev;
  select count(*) into v_viejas from tareas where visita_id = v_prev and completada_el is null;
  select count(*) into v_nuevas from tareas where visita_id = (v ->> 'visita_id')::uuid and completada_el is null;
  v_ok := v ->> 'ics_uid' = v_prev::text and (v ->> 'ics_secuencia')::integer = 1
      and v_est = 'reprogramada' and v_viejas = 0 and v_nuevas = 2;
  perform pg_temp.anotar('VISITA', 'Reprogramar conserva ics_uid y sube ics_secuencia',
    'mismo uid, secuencia 1, la anterior reprogramada y sin tareas abiertas, la nueva con 2',
    concat_ws(' · ', 'seq ' || coalesce(v ->> 'ics_secuencia', '?'), 'anterior ' || coalesce(v_est, '?'),
              v_viejas || ' viejas abiertas', v_nuevas || ' nuevas'), v_ok);
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('VISITA', 'Reprogramar conserva ics_uid y sube ics_secuencia', 'mismo uid, secuencia 1', sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 5 · RLS DEL PERFIL Y BANDEJA
-- ---------------------------------------------------------------------

-- Preparación: Eva, de dirección, con perfil; Fito, con perfil y SIN dueño
-- (como un lead que entró solo por la web).
  <<bloque_16>>
declare v jsonb;
begin
  perform pg_temp.como(pg_temp.f('direccion'));
  v := fn_registrar_prospecto(pg_temp.datos('PRUEBA13 Eva', '+51900130005'));
  insert into fixture values ('op_eva', (v ->> 'oportunidad_id')::uuid), ('per_eva', (v ->> 'persona_id')::uuid);
  perform fn_guardar_perfil(pg_temp.f('op_eva'), jsonb_build_object('tipo_interes', 'puesto'));
  v := fn_registrar_prospecto(pg_temp.datos('PRUEBA13 Fito', '+51900130006'));
  insert into fixture values ('op_fito', (v ->> 'oportunidad_id')::uuid);
  perform fn_guardar_perfil(pg_temp.f('op_fito'), jsonb_build_object('tipo_interes', 'tienda'));
  perform pg_temp.como(null);
  update oportunidades set responsable_id = null where id = pg_temp.f('op_fito');
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('PREP', 'Preparación de las pruebas de RLS (Eva con dueño, Fito sin dueño)', 'sin error', sqlerrm, false);
end;

-- 5a y 5b · Con el rol `authenticated` de verdad, como el comercial.
  <<bloque_17>>
declare v_eva uuid := pg_temp.f('op_eva'); v_fito uuid := pg_temp.f('op_fito');
        v_perf_eva integer; v_perf_fito integer; v_op_eva integer; v_op_fito integer;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  execute 'set local role authenticated';
  select count(*) into v_op_eva    from oportunidades      where id = v_eva;
  select count(*) into v_perf_eva  from oportunidad_perfil where oportunidad_id = v_eva;
  select count(*) into v_op_fito   from oportunidades      where id = v_fito;
  select count(*) into v_perf_fito from oportunidad_perfil where oportunidad_id = v_fito;
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('RLS', 'Un comercial NO lee el perfil de una oportunidad de otro',
    '0 oportunidades y 0 perfiles visibles', v_op_eva || ' oportunidad(es) · ' || v_perf_eva || ' perfil(es)',
    v_op_eva = 0 and v_perf_eva = 0);
  perform pg_temp.anotar('RLS', 'Un comercial SÍ lee un lead sin dueño y su perfil (oport_leer_sin_dueno)',
    '1 oportunidad y 1 perfil visibles', v_op_fito || ' oportunidad(es) · ' || v_perf_fito || ' perfil(es)',
    v_op_fito = 1 and v_perf_fito = 1);
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('RLS', 'Lectura del perfil como comercial', '0 ajeno / 1 sin dueño', sqlerrm, false);
end;

-- 5c · La bandeja lo muestra y «Tomar» lo gana el primero: el segundo recibe
-- «Ya la tomó …» y el lead no cambia de manos.
  <<bloque_18>>
declare v1 jsonb; v2 jsonb; v_en_bandeja boolean; v_ok boolean;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  select exists (select 1 from fn_bandeja() b where b.oportunidad_id = pg_temp.f('op_fito')) into v_en_bandeja;
  v1 := fn_reclamar_oportunidad(pg_temp.f('op_fito'));
  perform pg_temp.como(pg_temp.f('administracion'));
  v2 := fn_reclamar_oportunidad(pg_temp.f('op_fito'));
  perform pg_temp.como(null);
  v_ok := v_en_bandeja
      and (v1 ->> 'ok')::boolean and (v1 ->> 'responsable_id')::uuid = pg_temp.f('comercial')
      and not (v2 ->> 'ok')::boolean and strpos(v2 ->> 'motivo', 'Ya la tomó') > 0
      and exists (select 1 from oportunidades o where o.id = pg_temp.f('op_fito')
                     and o.responsable_id = pg_temp.f('comercial'))
      and not exists (select 1 from tareas t where t.oportunidad_id = pg_temp.f('op_fito')
                         and t.completada_el is null and t.responsable_id <> pg_temp.f('comercial'));
  perform pg_temp.anotar('BANDEJA', 'fn_bandeja muestra el lead sin dueño y fn_reclamar_oportunidad lo gana el primero',
    'en bandeja; 1.º ok; 2.º ok:false «Ya la tomó …»; tareas pasan al comercial',
    concat_ws(' · ', 'en bandeja ' || v_en_bandeja, '1.º ' || (v1 ->> 'ok'), '2.º ' || coalesce(v2 ->> 'motivo', v2 ->> 'ok')), v_ok);
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('BANDEJA', 'fn_bandeja + fn_reclamar_oportunidad (gana el primero)', 'el primero gana', sqlerrm, false);
end;

-- 5d · R9: el cambio de responsable y la toma quedan en la línea de tiempo,
-- con el NOMBRE (un vendedor no puede leer `perfiles` de otros).
  <<bloque_19>>
declare v_ok boolean;
begin
  v_ok := exists (select 1 from oportunidad_eventos e
                   where e.oportunidad_id = pg_temp.f('op_fito') and e.tipo = 'responsable'
                     and e.a = (select p.nombre from perfiles p where p.id = pg_temp.f('comercial'))
                     and e.actor_id = pg_temp.f('comercial') and e.motivo = 'Tomada de la bandeja')
      and exists (select 1 from oportunidad_eventos e
                   where e.oportunidad_id = pg_temp.f('op_fito') and e.tipo = 'bandeja' and e.a = 'tomada');
  perform pg_temp.anotar('R9', 'El cambio de responsable queda en oportunidad_eventos con nombre, actor y motivo',
    'evento responsable → nombre del comercial + evento bandeja «tomada»',
    (select string_agg(e.tipo || ':' || coalesce(e.de, '∅') || '→' || coalesce(e.a, '∅'), ' | ' order by e.id)
       from oportunidad_eventos e where e.oportunidad_id = pg_temp.f('op_fito')), v_ok);
end;


-- ---------------------------------------------------------------------
-- 6 · R8 EN LAS TABLAS NUEVAS Y EN TAREAS
-- ---------------------------------------------------------------------
  <<bloque_20>>
declare v_doc uuid; v_fallo boolean; v_msg text; v_rep text := '';
        v_malas integer := 0;
begin
  insert into documentos (persona_id, oportunidad_id, tipo, nombre_archivo, ruta, creado_por)
  values (pg_temp.f('per_eva'), pg_temp.f('op_eva'), 'otro', 'PRUEBA13.pdf',
          'prueba-13/' || gen_random_uuid()::text || '.pdf', pg_temp.f('direccion'))
  returning id into v_doc;

  v_fallo := false; v_msg := 'se borró';
  begin delete from visitas where id = pg_temp.f('visita1');
  exception when others then v_fallo := true; v_msg := sqlerrm; end;
  if pg_temp.veredicto_error(v_fallo, v_msg, 'Nada se borra') <> '✅ PASA' then v_malas := v_malas + 1; end if;
  v_rep := v_rep || 'visitas: ' || left(v_msg, 40);

  v_fallo := false; v_msg := 'se borró';
  begin delete from tareas where id = (select t.id from tareas t where t.oportunidad_id = pg_temp.f('op_caro') limit 1);
  exception when others then v_fallo := true; v_msg := sqlerrm; end;
  if pg_temp.veredicto_error(v_fallo, v_msg, 'Nada se borra') <> '✅ PASA' then v_malas := v_malas + 1; end if;
  v_rep := v_rep || ' | tareas: ' || left(v_msg, 40);

  v_fallo := false; v_msg := 'se borró';
  begin delete from documentos where id = v_doc;
  exception when others then v_fallo := true; v_msg := sqlerrm; end;
  if pg_temp.veredicto_error(v_fallo, v_msg, 'Nada se borra') <> '✅ PASA' then v_malas := v_malas + 1; end if;
  v_rep := v_rep || ' | documentos: ' || left(v_msg, 40);

  v_fallo := false; v_msg := 'se borró';
  begin delete from oportunidad_eventos
         where id = (select min(e.id) from oportunidad_eventos e where e.oportunidad_id = pg_temp.f('op_ana'));
  exception when others then v_fallo := true; v_msg := sqlerrm; end;
  if pg_temp.veredicto_error(v_fallo, v_msg, 'de solo agregar') <> '✅ PASA' then v_malas := v_malas + 1; end if;
  v_rep := v_rep || ' | oportunidad_eventos: ' || left(v_msg, 50);

  perform pg_temp.anotar('R8', 'DELETE en visitas, tareas, documentos y oportunidad_eventos',
    '❌ los cuatro rechazados con su mensaje (R8 / de solo agregar, R9)', v_rep, v_malas = 0);
exception when others then
  perform pg_temp.anotar('R8', 'DELETE en visitas, tareas, documentos y oportunidad_eventos', 'los cuatro rechazados', sqlerrm, false);
end;


-- ---------------------------------------------------------------------
-- 7 · PERMISOS
-- ---------------------------------------------------------------------

-- 7a · anon no ejecuta nada de lo nuevo ni las cuatro de ayuda de 1b;
-- fn_captar_prospecto conserva su grant (la web la necesita).
  <<bloque_21>>
declare v_total integer; v_con_anon text; v_captar boolean; v_auth boolean;
begin
  select count(*),
         string_agg(p.proname, ', ') filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))
    into v_total, v_con_anon
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = any(array[
       'parametro_entero','parametro_texto','parametro_publico','puede_operar_oportunidad','fn_equipo',
       'fn_campana_asegurar','fn_registrar_prospecto','fn_registrar_lote','fn_guardar_perfil',
       'fn_registrar_contacto','fn_cambiar_situacion','fn_fijar_temperatura','fn_reclamar_oportunidad',
       'fn_asignar_oportunidades','fn_bandeja','fn_agendar_visita','fn_actualizar_visita',
       'fn_datos_aviso_visita','fn_registrar_aviso_visita','fn_archivar_documento',
       'fn_registrar_evento_oportunidad','fn_evento_documento','fn_registrar_cambio_estado',
       'mi_rol','es','puede_emitir_constancia','origenes_admitidos']);
  v_captar := has_function_privilege('anon', 'fn_captar_prospecto(text,text,text,boolean,jsonb,text)', 'EXECUTE');
  v_auth   := has_function_privilege('authenticated', 'fn_registrar_prospecto(jsonb,boolean)', 'EXECUTE');
  perform pg_temp.anotar('SEG', 'anon sin EXECUTE en las funciones DEFINER de 13 y en las 4 de ayuda (1b)',
    '27 funciones, ninguna con anon; fn_captar_prospecto sí; authenticated sí',
    concat_ws(' · ', v_total || ' funciones', 'con anon: ' || coalesce(v_con_anon, 'ninguna'),
              'captar anon ' || v_captar, 'authenticated ' || v_auth),
    v_total = 27 and v_con_anon is null and v_captar and v_auth);
end;

-- 7b · Las auxiliares internas solo las ejecuta su dueño.
  <<bloque_22>>
declare v_con text;
begin
  select string_agg(p.proname, ', ') into v_con
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = any(array['fijar_motivo','texto_a_uuid','dias_de_cadencia','cerrar_tareas_abiertas',
       'crear_tarea_crm','asegurar_tarea_abierta','cancelar_visitas_abiertas','aplicar_enfriar',
       'aplicar_descartar','aplicar_no_contactar','normalizar_perfil','guardar_perfil_interno'])
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('anon', p.oid, 'EXECUTE'));
  perform pg_temp.anotar('SEG', 'Las 12 auxiliares internas no las ejecutan ni authenticated ni anon',
    'ninguna', coalesce(v_con, 'ninguna'), v_con is null);
end;


-- ---------------------------------------------------------------------
-- 8 · v_cartera, R6 Y LECTURA
-- ---------------------------------------------------------------------

-- 8a · El contrato con src/lib/cartera.ts: columnas en el orden EXACTO de
-- SPEC §4.6 (create or replace view solo deja añadir al final).
  <<bloque_23>>
declare v_real text; v_contrato text :=
  'id,persona_id,nombre_completo,telefono_e164,usuario_red,red_social,email,origen,campana_id,campana_nombre,'
  'lanzamiento,estado,situacion,responsable_id,responsable_nombre,sin_dueno,entro_solo,fecha_ingreso,'
  'fecha_primer_contacto,fecha_ultimo_contacto,dias_sin_contacto,motivo_frio,enfriado_el,motivo_perdida_codigo,'
  'motivo_perdida,no_contactar,cualificacion_completa,faltan_cualificacion,tiene_tarea_abierta,tipo_interes,'
  'interes_detalle,proposito,forma_pago,capital_categoria,horizonte_compra,mes_objetivo,intentos_sin_respuesta,'
  'ultimo_inbound_el,total_contactos,proxima_tarea_id,proxima_tarea_titulo,proxima_tarea_tipo,'
  'proxima_tarea_vence_el,visita_id,visita_tipo,visita_estado,visita_inicio_el,no_asistio_total,temperatura,'
  'temperatura_motivo,temperatura_manual,puntaje,creado_el';
begin
  select string_agg(c.column_name, ',' order by c.ordinal_position) into v_real
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'v_cartera';
  perform pg_temp.anotar('CONTRATO', 'v_cartera tiene las columnas de SPEC §4.6 en su orden',
    'idénticas', case when v_real = v_contrato then 'idénticas' else coalesce(v_real, 'sin vista') end,
    v_real = v_contrato);
end;

-- 8b · Ningún booleano ni conteo de v_cartera llega NULL (los filtros de la
-- pantalla usan .eq('no_contactar', false): un NULL escondería la fila), y
-- cada caso de prueba sale con su temperatura.
  <<bloque_24>>
declare v_nulos integer; v_filas integer; v_vivas integer; v_ana text; v_dani text; v_caro text; v_eva text;
begin
  perform pg_temp.como(pg_temp.f('direccion'));   -- para que parametro_entero lea los umbrales
  select count(*) filter (where sin_dueno is null or entro_solo is null or no_contactar is null
                             or cualificacion_completa is null or faltan_cualificacion is null
                             or tiene_tarea_abierta is null or temperatura_manual is null
                             or intentos_sin_respuesta is null or total_contactos is null
                             or no_asistio_total is null or temperatura is null or temperatura_motivo is null),
         count(*),
         max(temperatura) filter (where id = pg_temp.f('op_ana')),
         max(temperatura) filter (where id = pg_temp.f('op_dani')),
         max(temperatura) filter (where id = pg_temp.f('op_caro')),
         max(temperatura) filter (where id = pg_temp.f('op_eva'))
    into v_nulos, v_filas, v_ana, v_dani, v_caro, v_eva
    from v_cartera;
  perform pg_temp.como(null);
  select count(*) into v_vivas from oportunidades where archivado_el is null;
  perform pg_temp.anotar('CONTRATO', 'v_cartera: una fila por oportunidad viva, sin NULL en booleanos/conteos, temperatura de cada caso',
    '0 nulos; filas = oportunidades vivas; Ana frio, Dani no_contactar, Caro caliente, Eva nuevo',
    concat_ws(' · ', v_nulos || ' nulos', v_filas || '/' || v_vivas || ' filas',
              'Ana ' || coalesce(v_ana, '?'), 'Dani ' || coalesce(v_dani, '?'),
              'Caro ' || coalesce(v_caro, '?'), 'Eva ' || coalesce(v_eva, '?')),
    v_nulos = 0 and v_filas = v_vivas and v_ana = 'frio' and v_dani = 'no_contactar'
      and v_caro = 'caliente' and v_eva = 'nuevo');
end;

-- 8c · R6 sobre todo lo creado aquí: ninguna oportunidad ACTIVA sin tarea abierta.
  <<bloque_25>>
declare v_sin text;
begin
  select string_agg(p.nombre_completo, ', ') into v_sin
    from oportunidades o join personas p on p.id = o.persona_id
   where p.nombre_completo like 'PRUEBA13%' and o.situacion = 'activa' and o.archivado_el is null
     and not exists (select 1 from tareas t where t.oportunidad_id = o.id and t.completada_el is null);
  perform pg_temp.anotar('R6', 'Ninguna oportunidad activa de estas pruebas se queda sin tarea abierta',
    'ninguna', coalesce(v_sin, 'ninguna'), v_sin is null);
end;

-- 8d · `lectura` ve la oportunidad (oport_leer) pero NO su perfil: el capital
-- declarado puede ser dato sensible. No hay un perfil `lectura` real, así que
-- a administración se le cambia el rol un momento (el rollback lo deshace, y
-- aquí mismo se devuelve por si alguien añade pruebas debajo).
  <<bloque_26>>
declare v_adm uuid := pg_temp.f('administracion'); v_eva uuid := pg_temp.f('op_eva');
        v_op integer; v_perf integer;
begin
  update perfiles set rol = 'lectura' where id = v_adm;
  perform pg_temp.como(v_adm);
  execute 'set local role authenticated';
  select count(*) into v_op   from oportunidades      where id = v_eva;
  select count(*) into v_perf from oportunidad_perfil where oportunidad_id = v_eva;
  execute 'reset role';
  perform pg_temp.como(null);
  update perfiles set rol = 'administracion' where id = v_adm;
  perform pg_temp.anotar('RLS', 'lectura ve la oportunidad pero NO su perfil comercial',
    '1 oportunidad, 0 perfiles', v_op || ' oportunidad(es) · ' || v_perf || ' perfil(es)', v_op = 1 and v_perf = 0);
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('RLS', 'lectura ve la oportunidad pero NO su perfil comercial', '1 / 0', sqlerrm, false);
end;

-- ---------------------------------------------------------------------
-- 9 · HUMO: cada RPC nueva que la interfaz llama, al menos una vez
-- ---------------------------------------------------------------------
-- Un cuerpo plpgsql solo se valida de verdad al EJECUTARSE: una columna mal
-- escrita compila y revienta en la primera llamada, delante del agente. Esta
-- sección no repite reglas de 1..8: recorre el camino feliz de las funciones
-- que esas secciones no llamaron (aviso de visita, confirmar/realizada,
-- enfriar/reactivar/descartar, temperatura a mano, asignar, equipo, campaña,
-- documento + storage) y comprueba lo mínimo que la pantalla da por hecho.
-- Leads propios (+5190013009N) para no mover los de las secciones de arriba.

-- 9a · Ciclo de una visita: datos del aviso → aviso registrado → confirmar →
-- realizada con resultado. El lugar sale NULO porque sus parámetros están en
-- 🔴 (SPEC §2: al cliente solo llega lo 'verde'), y R6 deja una tarea abierta.
  <<bloque_27>>
declare v jsonb; v_d jsonb; v_op uuid; v_vis uuid; v_paso text := 'fn_registrar_prospecto';
        v_estado text; v_aviso timestamptz; v_notif integer; v_abiertas integer; v_conf integer;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  v := fn_registrar_prospecto(pg_temp.datos('PRUEBA13 Humo Visita', '+51900130091'));
  v_op := (v ->> 'oportunidad_id')::uuid;
  insert into fixture values ('op_humo', v_op), ('per_humo', (v ->> 'persona_id')::uuid);
  v_paso := 'fn_agendar_visita';
  v := fn_agendar_visita(v_op, 'oficina', now() + interval '3 days');
  v_vis := (v ->> 'visita_id')::uuid;
  v_paso := 'fn_datos_aviso_visita';
  v_d := fn_datos_aviso_visita(v_vis);
  v_paso := 'fn_registrar_aviso_visita';
  perform fn_registrar_aviso_visita(v_vis, 'whatsapp', 'manual', 'confirmacion');
  v_paso := 'fn_actualizar_visita confirmar';
  perform fn_actualizar_visita(v_vis, 'confirmar');
  select count(*) into v_conf from tareas t
   where t.visita_id = v_vis and t.tipo = 'confirmar_visita' and t.completada_el is null;
  v_paso := 'fn_actualizar_visita realizada';
  perform fn_actualizar_visita(v_vis, 'realizada', 'interesado', 'PRUEBA humo');
  perform pg_temp.como(null);
  select estado, aviso_enviado_el into v_estado, v_aviso from visitas where id = v_vis;
  select count(*) into v_notif from notificaciones where visita_id = v_vis;
  select count(*) into v_abiertas from tareas where oportunidad_id = v_op and completada_el is null;
  perform pg_temp.anotar('HUMO', 'Visita: datos del aviso → aviso → confirmar → realizada',
    'ok, uid = id, lugar nulo (🔴), 1 aviso, realizada, 0 «confirmar» abiertas, ≥1 tarea abierta (R6)',
    concat_ws(' · ', 'datos ' || coalesce(v_d ->> 'ok', '?'), 'uid ' || coalesce(v_d #>> '{visita,ics_uid}', '?'),
              'mapa ' || coalesce(v_d #>> '{lugar,mapa_url}', 'nulo'), v_notif || ' aviso(s)',
              'estado ' || coalesce(v_estado, '?'), v_conf || ' confirmar abierta(s)', v_abiertas || ' abierta(s)'),
    coalesce((v_d ->> 'ok')::boolean, false) and v_d #>> '{visita,ics_uid}' = v_vis::text
      and v_d #>> '{lugar,mapa_url}' is null and v_notif = 1 and v_aviso is not null
      and v_estado = 'realizada' and v_conf = 0 and v_abiertas >= 1);
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('HUMO', 'Visita: datos del aviso → aviso → confirmar → realizada', 'sin error',
    v_paso || ': ' || sqlerrm, false);
end;

-- 9b · Situación y temperatura: enfriar (deja tarea de reactivación) →
-- reactivar → fijar temperatura a mano y quitarla → descartar (0 tareas).
-- Cada cambio deja su evento (R9).
  <<bloque_28>>
declare v jsonb; v_op uuid; v_paso text := 'fn_registrar_prospecto';
        v_s1 text; v_s2 text; v_s3 text; v_react boolean; v_t1 text; v_m1 boolean; v_m2 boolean;
        v_cod text; v_abiertas integer; v_ev integer;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  v := fn_registrar_prospecto(pg_temp.datos('PRUEBA13 Humo Situacion', '+51900130092'));
  v_op := (v ->> 'oportunidad_id')::uuid;
  v_paso := 'fn_cambiar_situacion enfriar';
  v_s1 := fn_cambiar_situacion(v_op, 'enfriar', 'mas_adelante') ->> 'situacion';
  select exists (select 1 from tareas where oportunidad_id = v_op and tipo = 'reactivacion' and completada_el is null)
    into v_react;
  v_paso := 'fn_cambiar_situacion reactivar';
  v_s2 := fn_cambiar_situacion(v_op, 'reactivar') ->> 'situacion';
  v_paso := 'fn_fijar_temperatura';
  perform fn_fijar_temperatura(v_op, 'caliente', 'PRUEBA: pidió visita');
  select temperatura, temperatura_manual into v_t1, v_m1 from v_cartera where id = v_op;
  perform fn_fijar_temperatura(v_op, null);
  select temperatura_manual into v_m2 from v_cartera where id = v_op;
  v_paso := 'fn_cambiar_situacion descartar';
  v_s3 := fn_cambiar_situacion(v_op, 'descartar', 'no_encaja', 'PRUEBA humo') ->> 'situacion';
  perform pg_temp.como(null);
  select motivo_perdida_codigo into v_cod from oportunidades where id = v_op;
  select count(*) into v_abiertas from tareas where oportunidad_id = v_op and completada_el is null;
  select count(*) into v_ev from oportunidad_eventos where oportunidad_id = v_op and tipo in ('situacion','temperatura');
  perform pg_temp.anotar('HUMO', 'Situación: enfriar → reactivar → temperatura a mano → descartar',
    'pausada + reactivación, activa, caliente (manual) y luego sin manual, perdida no_encaja, 0 abiertas, ≥5 eventos',
    concat_ws(' · ', v_s1, 'reactivación ' || v_react, v_s2, v_t1 || ' manual ' || v_m1, 'después manual ' || v_m2,
              v_s3 || ' ' || coalesce(v_cod, '?'), v_abiertas || ' abierta(s)', v_ev || ' evento(s)'),
    v_s1 = 'pausada' and v_react and v_s2 = 'activa' and v_t1 = 'caliente' and v_m1 and not v_m2
      and v_s3 = 'perdida' and v_cod = 'no_encaja' and v_abiertas = 0 and v_ev >= 5);
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('HUMO', 'Situación: enfriar → reactivar → temperatura a mano → descartar', 'sin error',
    v_paso || ': ' || sqlerrm, false);
end;

-- 9c · Equipo, campaña y asignación: fn_equipo trae a los tres roles
-- operativos (nunca a lectura); fn_campana_asegurar no duplica por
-- mayúsculas/espacios y no inventa inversión; Dirección asigna (y las tareas
-- abiertas se van con el lead); un comercial no puede quitarle el lead a otro.
  <<bloque_29>>
declare v jsonb; v_op uuid; v_paso text := 'fn_equipo'; v_eq integer; v_otros integer;
        v_c1 uuid; v_c2 uuid; v_inv numeric; v_asig integer; v_omit integer; v_resp uuid; v_mal integer;
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  select count(*) filter (where e.id in (pg_temp.f('comercial'), pg_temp.f('direccion'), pg_temp.f('administracion'))),
         count(*) filter (where e.rol::text not in ('direccion','comercial','administracion'))
    into v_eq, v_otros from fn_equipo() e;
  v_paso := 'fn_campana_asegurar';
  v_c1 := fn_campana_asegurar('PRUEBA13 Campaña Humo', 'tiktok');
  v_c2 := fn_campana_asegurar('  prueba13 campaña humo ', 'tiktok');
  select inversion into v_inv from campanas where id = v_c1;
  v_paso := 'fn_registrar_prospecto';
  v := fn_registrar_prospecto(pg_temp.datos('PRUEBA13 Humo Asignar', '+51900130093'));
  v_op := (v ->> 'oportunidad_id')::uuid;
  v_paso := 'fn_asignar_oportunidades (direccion)';
  perform pg_temp.como(pg_temp.f('direccion'));
  v_asig := (fn_asignar_oportunidades(array[v_op], pg_temp.f('administracion')) ->> 'asignadas')::integer;
  v_paso := 'fn_asignar_oportunidades (comercial, lead ajeno)';
  perform pg_temp.como(pg_temp.f('comercial'));
  v := fn_asignar_oportunidades(array[v_op], pg_temp.f('comercial'));
  v_omit := jsonb_array_length(coalesce(v -> 'omitidas', '[]'::jsonb));
  perform pg_temp.como(null);
  select responsable_id into v_resp from oportunidades where id = v_op;
  select count(*) into v_mal from tareas
   where oportunidad_id = v_op and completada_el is null and responsable_id <> pg_temp.f('administracion');
  perform pg_temp.anotar('HUMO', 'fn_equipo, fn_campana_asegurar y fn_asignar_oportunidades',
    '3 del equipo y 0 de otros roles, misma campaña sin inversión, 1 asignada, 1 omitida, dueño y tareas = administración',
    concat_ws(' · ', v_eq || ' del equipo', v_otros || ' de otros roles', 'misma campaña ' || (v_c1 = v_c2),
              'inversión ' || coalesce(v_inv::text, 'nula'), v_asig || ' asignada(s)', v_omit || ' omitida(s)',
              'dueño ok ' || (v_resp = pg_temp.f('administracion')), v_mal || ' tarea(s) con otro dueño'),
    v_eq = 3 and v_otros = 0 and v_c1 = v_c2 and v_inv is null and v_asig = 1 and v_omit = 1
      and v_resp = pg_temp.f('administracion') and v_mal = 0);
exception when others then
  perform pg_temp.como(null);
  perform pg_temp.anotar('HUMO', 'fn_equipo, fn_campana_asegurar y fn_asignar_oportunidades', 'sin error',
    v_paso || ': ' || sqlerrm, false);
end;

-- 9d · Documento con RLS de verdad (rol authenticated, como el comercial):
-- sube la fila y el objeto del bucket, lo lee; archivar sin motivo falla con
-- SU mensaje; con motivo archiva y el objeto deja de poder leerse.
  <<bloque_30>>
declare v_doc uuid; v_ruta text := 'prueba-13/' || gen_random_uuid()::text || '.pdf';
        v_paso text := 'insert documentos (RLS)'; v_lee1 integer; v_lee2 integer;
        v_fallo boolean := false; v_msg text := 'se archivó sin motivo'; v_arch timestamptz;
        -- Se leen ANTES de cambiar de rol: `authenticated` no puede leer la tabla temporal fixture.
        v_per uuid := pg_temp.f('per_humo'); v_op uuid := pg_temp.f('op_humo');
begin
  perform pg_temp.como(pg_temp.f('comercial'));
  execute 'set local role authenticated';
  insert into documentos (persona_id, oportunidad_id, tipo, nombre_archivo, ruta)
  values (v_per, v_op, 'material_enviado', 'PRUEBA13.pdf', v_ruta)
  returning id into v_doc;
  v_paso := 'insert storage.objects (documentos_subir)';
  insert into storage.objects (bucket_id, name) values ('documentos', v_ruta);
  select count(*) into v_lee1 from storage.objects where bucket_id = 'documentos' and name = v_ruta;
  execute 'reset role';
  v_paso := 'fn_archivar_documento';
  begin perform fn_archivar_documento(v_doc, '  ');
  exception when others then v_fallo := true; v_msg := sqlerrm; end;
  perform fn_archivar_documento(v_doc, 'PRUEBA humo');
  execute 'set local role authenticated';
  select count(*) into v_lee2 from storage.objects where bucket_id = 'documentos' and name = v_ruta;
  execute 'reset role';
  perform pg_temp.como(null);
  select archivado_el into v_arch from documentos where id = v_doc;
  perform pg_temp.anotar('HUMO', 'Documento: subir (RLS + storage), archivar exige motivo, archivado no se lee',
    'lee 1 objeto, «hay que decir por qué», archivado, lee 0',
    concat_ws(' · ', 'lee ' || v_lee1, left(v_msg, 45), 'archivado ' || (v_arch is not null), 'después lee ' || v_lee2),
    v_lee1 = 1 and pg_temp.veredicto_error(v_fallo, v_msg, 'hay que decir por qué') = '✅ PASA'
      and v_arch is not null and v_lee2 = 0);
exception when others then
  execute 'reset role';
  perform pg_temp.como(null);
  perform pg_temp.anotar('HUMO', 'Documento: subir (RLS + storage), archivar exige motivo, archivado no se lee', 'sin error',
    v_paso || ': ' || sqlerrm, false);
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
    -- Deshacer TODO lo que hizo la batería (personas, oportunidades, tareas,
    -- visitas, perfiles, documentos, tablas y funciones temporales): un error
    -- atrapado justo abajo.
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
  execute 'drop function if exists public.probar_reglas_13()';

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
revoke all on function public.probar_reglas_13() from public, anon, authenticated;

select * from public.probar_reglas_13();
