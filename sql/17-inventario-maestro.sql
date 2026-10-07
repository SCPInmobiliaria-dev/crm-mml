-- =====================================================================
-- CRM Mercado Media Luna — 17 · INVENTARIO MAESTRO
--   el estado de la unidad sigue a la separación · titular y papeles de cada unidad
-- Estado: 🟡 POR APLICAR · 05/10/2026 (07/10/2026: rehecho sobre 18 y 19, ya
--         aplicados; sin el paso de P-264, que dibujó 18)
--         Escrito y ensayado en el arnés PGlite local (pruebas/reglas-17.sql).
--         NO está aplicado en ningún proyecto. Quien lo aplique corre después
--         pruebas/reglas-17.sql y anota el resultado en pruebas/COMO-PROBAR.md;
--         la fila de migraciones_aplicadas la escribe la última sentencia de
--         este archivo.
--
-- Orden de ejecución: … → 14-inventario-grafico → 16-inventario-publico
--                     → 18-geometria-plano → 19-precio-por-unidad → 17
-- (El número es anterior a 18 y 19 porque se reservó antes; se aplica DESPUÉS.
--  No toca fn_inventario_publico, así que da igual antes o después de 20.)
-- Depende de 01 (unidades, separaciones, contratos, cuotas), 02 (es()), 10
-- (migraciones_aplicadas), 13 (documentos, bucket `documentos`, fn_bitacora) y
-- 14 (geometria, revisar). Si 16 ya está aplicado, los disparadores de aviso de
-- 16 saltan solos con cada cambio de estado que haga este archivo: la web se
-- entera sin tocar nada. NO depende de 15 (usa coalesce(es(...), false)).
--
-- QUÉ AÑADE
--   1 · unidades.estado_comercial_previo: en qué estado estaba la unidad ANTES
--       de que una separación o un contrato la moviera, para devolverla ahí si
--       esa separación o ese contrato se cae.
--   2 · El estado de la unidad SIGUE a lo que le pasa:
--         separación pendiente de verificar → reservada_temporal
--         separación verificada             → separada
--         contrato vivo                      → contratada
--         contrato vivo y todas sus cuotas pagadas o condonadas → pagada
--         separación devuelta / vencida / archivada, contrato archivado
--                                            → vuelve al estado que tenía
--       Antes de este archivo nada movía unidades.estado_comercial: una unidad
--       con la separación verificada seguía diciendo «Disponible» en la pantalla
--       Inventario y solo una bandera explicaba por qué no se ofrecía.
--       `entregada` y `no_disponible` los pone una persona; este archivo no los
--       toca nunca.
--   3 · documentos.unidad_id y los tipos de papel de una unidad (minuta,
--       escritura, trámites, carta poder, plano de la unidad): los papeles
--       del inventario maestro, aunque la unidad no tenga titular todavía.
--   4 · fn_guardar_titular_unidad() y fn_quitar_titular_unidad(): quién es el
--       dueño de la unidad y sus datos de contacto.
--   Nada más: ni una tabla nueva, ni un bucket nuevo, ni una vista tocada.
--
-- POR QUÉ
-- Walter (Dirección) abre una unidad que ya no está disponible y la pantalla
-- solo le deja cambiar el código, el área, la ubicación, el estado y la fuente
-- del plano: no hay dónde escribir quién es el dueño ni dónde adjuntar la
-- minuta o el trámite. Es el inventario MAESTRO: ahí es donde tiene que estar.
-- Y la separación que se registra en Separaciones tiene que verse en el
-- inventario como separación, no como «Disponible» con una nota.
--
-- REGLA DE LA FUENTE DE VERDAD (07-crm\CLAUDE.md §2)
--   Ni una cifra. Ni precio, ni monto, ni plazo, ni cantidad de unidades.
--   El estado sigue a los HECHOS (separación, contrato, cuotas); lo que pasa
--   cuando vence un reloj NO se decide aquí: 00-fuente-de-verdad\separacion-vigente.md
--   §3.3 («qué pasa al día 8») sigue sin regla escrita y es de Walter. Hasta
--   entonces, un reloj vencido no libera la unidad: hace falta que una persona
--   devuelva, venza o archive la separación.
--
-- SEGURIDAD (07-crm\CLAUDE.md §5)
--   · Los papeles de una unidad (DNI del titular, minutas) los leen y los
--     suben SOLO Dirección y Administración, igual que quien mantiene el
--     inventario (unidades_escribir). Comercial no ve los papeles de una
--     unidad ni aunque vea la persona. La política de LECTURA del bucket
--     `documentos` no cambia: sigue exigiendo la fila en `documentos`, y el
--     RLS de esa fila decide.
--   · fn_guardar_titular_unidad() y fn_quitar_titular_unidad() son SECURITY
--     DEFINER, con search_path fijo y el rol comprobado al principio con
--     coalesce(es(...), false): es() devuelve NULL —no false— a un usuario sin
--     perfil activo, y `if not es(...)` no dispara con NULL (hallazgo de
--     pruebas/REPORTE-15-perfil-inactivo.md). Anon no las ejecuta.
--   · Las dos funciones del estado de la unidad son internas: nadie las
--     ejecuta (EXECUTE revocado a public, anon y authenticated; solo las
--     llaman los disparadores). Los default privileges de 11 dan EXECUTE a
--     authenticated en toda función nueva: por eso el revoke explícito.
--   · Ley 29733: el titular que se crea aquí nace con consentimiento = false y
--     `fuente_del_dato` diciendo que sale del inventario maestro, igual que los
--     de la carga inicial (14). Su DNI y su teléfono no salen en
--     fn_inventario_publico() (16): la web no los ve.
--
-- IDEMPOTENTE: sí. Se puede correr de nuevo sin efectos (la 2.ª vez, los
-- estados ya están sincronizados).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · EL ESTADO ANTERIOR
-- ---------------------------------------------------------------------
alter table unidades
  add column if not exists estado_comercial_previo estado_unidad;

comment on column unidades.estado_comercial_previo is
  'Estado comercial que tenía la unidad ANTES de que una separacion o un contrato la moviera (fn_sincronizar_estado_unidad). NULL = el estado actual lo puso una persona. Sirve para devolverla a donde estaba si la separacion se devuelve, vence o se archiva.';


-- ---------------------------------------------------------------------
-- 2 · EL ESTADO SIGUE A LA SEPARACIÓN, AL CONTRATO Y A LAS CUOTAS
-- ---------------------------------------------------------------------

-- 2a · Qué dicen los hechos vivos. NULL = no hay ninguno.
-- Orden: contrato > separación verificada > separación pendiente. Es INVOKER
-- y solo la llama fn_sincronizar_estado_unidad (DEFINER).
create or replace function fn_estado_comercial_derivado(p_unidad uuid)
returns estado_unidad
language sql stable set search_path = public as $fn$
  select case
    when exists (select 1 from contratos c
                  where c.unidad_id = p_unidad and c.archivado_el is null) then
      case
        when exists (select 1 from cuotas q join contratos c on c.id = q.contrato_id
                      where c.unidad_id = p_unidad and c.archivado_el is null)
         and not exists (select 1 from cuotas q join contratos c on c.id = q.contrato_id
                          where c.unidad_id = p_unidad and c.archivado_el is null
                            and q.estado in ('pendiente','parcial','vencida'))
        then 'pagada'::estado_unidad
        else 'contratada'::estado_unidad
      end
    when exists (select 1 from separaciones s
                  where s.unidad_id = p_unidad and s.archivado_el is null
                    and s.estado = 'verificada') then 'separada'::estado_unidad
    when exists (select 1 from separaciones s
                  where s.unidad_id = p_unidad and s.archivado_el is null
                    and s.estado = 'pendiente_verificacion') then 'reservada_temporal'::estado_unidad
    else null
  end
$fn$;

comment on function fn_estado_comercial_derivado is
  'Estado comercial que le corresponde a una unidad segun sus separaciones, contratos y cuotas vivos. NULL = ninguno. Interna: la usa fn_sincronizar_estado_unidad.';

-- 2b · Pone la unidad en el estado que dicen los hechos, o la devuelve a donde
-- estaba. DEFINER: quien registra la separación (un comercial) no puede
-- escribir en `unidades` (unidades_escribir es de dirección y administración).
--
-- El ciclo de venta que mueve esta función es SOLO
--   disponible → reservada_temporal → separada → contratada → pagada
-- Fuera de él (`no_disponible`, `entregada`) no toca nada: son decisiones de
-- una persona. Y no pisa un estado puesto a mano que esté MÁS ADELANTE que lo
-- que dicen los hechos (una unidad que el kardex trajo como `contratada` no
-- baja a `reservada_temporal` porque alguien abra una separación encima).
create or replace function fn_sincronizar_estado_unidad(p_unidad uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_u      unidades%rowtype;
  v_der    estado_unidad;
  v_ciclo  estado_unidad[] := array['disponible','reservada_temporal','separada',
                                    'contratada','pagada']::estado_unidad[];
  v_vivos  estado_unidad[] := array['reservada_temporal','separada',
                                    'contratada','pagada']::estado_unidad[];
begin
  if p_unidad is null then
    return;
  end if;
  select * into v_u from unidades where id = p_unidad for update;
  if not found then
    return;
  end if;

  v_der := fn_estado_comercial_derivado(p_unidad);

  if v_der is not null then
    -- Retirada de venta o entregada: de una persona. No se toca.
    if not (v_u.estado_comercial = any (v_ciclo)) then
      return;
    end if;
    if v_u.estado_comercial = v_der then
      return;
    end if;
    -- Un estado puesto a mano que va más adelante que los hechos gana.
    if v_u.estado_comercial_previo is null
       and array_position(v_ciclo, v_u.estado_comercial) > array_position(v_ciclo, v_der) then
      return;
    end if;
    update unidades
       set estado_comercial_previo = coalesce(estado_comercial_previo, v_u.estado_comercial),
           estado_comercial = v_der
     where id = v_u.id;
  elsif v_u.estado_comercial_previo is not null then
    -- Ya no hay separación ni contrato vivos. Si el estado actual lo puso esta
    -- función, vuelve a donde estaba; si una persona lo cambió entre medias,
    -- se respeta y solo se deja de recordar el anterior.
    if v_u.estado_comercial = any (v_vivos) then
      update unidades
         set estado_comercial = v_u.estado_comercial_previo,
             estado_comercial_previo = null
       where id = v_u.id;
    else
      update unidades set estado_comercial_previo = null where id = v_u.id;
    end if;
  end if;
end $fn$;

comment on function fn_sincronizar_estado_unidad is
  'Mueve unidades.estado_comercial segun sus separaciones, contratos y cuotas vivos (reservada_temporal, separada, contratada, pagada) y la devuelve a su estado anterior cuando ya no hay ninguno. No toca no_disponible ni entregada. La llaman los disparadores de separaciones, contratos y cuotas.';

-- 2c · Los disparadores. Después de la fila, para ver la fila ya escrita.
create or replace function fn_t_sync_unidad_separacion() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'UPDATE' and old.unidad_id is distinct from new.unidad_id then
    perform fn_sincronizar_estado_unidad(old.unidad_id);
  end if;
  perform fn_sincronizar_estado_unidad(new.unidad_id);
  return null;
end $fn$;

create or replace function fn_t_sync_unidad_contrato() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'UPDATE' and old.unidad_id is distinct from new.unidad_id then
    perform fn_sincronizar_estado_unidad(old.unidad_id);
  end if;
  perform fn_sincronizar_estado_unidad(new.unidad_id);
  return null;
end $fn$;

create or replace function fn_t_sync_unidad_cuota() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_unidad uuid;
begin
  select unidad_id into v_unidad from contratos where id = new.contrato_id;
  perform fn_sincronizar_estado_unidad(v_unidad);
  return null;
end $fn$;

drop trigger if exists t_sync_unidad_separacion on separaciones;
create trigger t_sync_unidad_separacion
  after insert or update of estado, unidad_id, archivado_el on separaciones
  for each row execute function fn_t_sync_unidad_separacion();

drop trigger if exists t_sync_unidad_contrato on contratos;
create trigger t_sync_unidad_contrato
  after insert or update of unidad_id, archivado_el on contratos
  for each row execute function fn_t_sync_unidad_contrato();

drop trigger if exists t_sync_unidad_cuota on cuotas;
create trigger t_sync_unidad_cuota
  after insert or update of estado, contrato_id on cuotas
  for each row execute function fn_t_sync_unidad_cuota();

-- Internas: nadie las ejecuta (11 da EXECUTE a authenticated en toda función
-- nueva; PostgreSQL solo comprueba EXECUTE al CREAR el disparador).
revoke all on function fn_estado_comercial_derivado(uuid)  from public, anon, authenticated;
revoke all on function fn_sincronizar_estado_unidad(uuid)  from public, anon, authenticated;
revoke all on function fn_t_sync_unidad_separacion()       from public, anon, authenticated;
revoke all on function fn_t_sync_unidad_contrato()         from public, anon, authenticated;
revoke all on function fn_t_sync_unidad_cuota()            from public, anon, authenticated;

-- 2d · Lo que ya estaba separado o contratado antes de este archivo. Idempotente:
-- la 2.ª vez, cada unidad ya está donde dicen los hechos.
do $$
declare r record;
begin
  for r in select unidad_id from separaciones where unidad_id is not null and archivado_el is null
           union
           select unidad_id from contratos where archivado_el is null
  loop
    perform fn_sincronizar_estado_unidad(r.unidad_id);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 3 · LOS PAPELES DE UNA UNIDAD
-- ---------------------------------------------------------------------
-- Se reutiliza `documentos` y su bucket privado (13): misma subida, mismo
-- archivado con motivo (R8), misma bitácora. Cambia a quién se cuelga el papel:
-- a la unidad, aunque todavía no tenga titular ni oportunidad.
alter table documentos
  add column if not exists unidad_id uuid references unidades(id);

create index if not exists documentos_unidad
  on documentos (unidad_id, creado_el desc) where unidad_id is not null;

alter table documentos alter column persona_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documentos_persona_o_unidad') then
    alter table documentos
      add constraint documentos_persona_o_unidad
      check (persona_id is not null or unidad_id is not null);
  end if;
end $$;

-- Los tipos de 13 más los papeles de una unidad. Son etiquetas del archivo, no
-- afirmaciones legales: lo que un papel prueba lo dice el papel.
alter table documentos drop constraint if exists documentos_tipo_valido;
alter table documentos add constraint documentos_tipo_valido
  check (tipo in ('dni','voucher_separacion','constancia_separacion','contrato','recibo',
                  'plano_entregado','material_enviado','otro',
                  'minuta','escritura','tramite_notarial','tramite_registral',
                  'carta_poder','plano_unidad'));

comment on column documentos.unidad_id is
  'Unidad a la que pertenece el papel (inventario maestro). Si esta, solo Direccion y Administracion lo ven y lo suben; persona_id puede ser NULL.';

-- LEER: igual que en 13, salvo que un papel de unidad solo lo leen dirección y
-- administración, tenga o no oportunidad. coalesce: es() es NULL para un
-- usuario sin perfil activo y un NULL en `case` cae en la rama de abajo.
drop policy if exists doc_leer on documentos;
create policy doc_leer on documentos for select to authenticated
  using ((case
            when unidad_id is not null then
              coalesce(es(array['direccion','administracion']::rol_usuario[]), false)
            else
              (oportunidad_id is not null
               and exists (select 1 from oportunidades o where o.id = documentos.oportunidad_id))
              or (oportunidad_id is null
                  and coalesce(es(array['direccion','administracion']::rol_usuario[]), false))
          end)
         and (tipo <> 'dni'
              or coalesce(es(array['direccion','comercial','administracion']::rol_usuario[]), false)));

-- CREAR: igual que en 13, y un papel de unidad solo lo registran dirección y
-- administración, sobre una unidad que existe y no está archivada.
drop policy if exists doc_crear on documentos;
create policy doc_crear on documentos for insert to authenticated
  with check (coalesce(es(array['direccion','comercial','administracion']::rol_usuario[]), false)
              and creado_por = auth.uid()
              and archivado_el is null
              and verificado_el is null
              and (oportunidad_id is null
                   or exists (select 1 from oportunidades o where o.id = documentos.oportunidad_id))
              and (unidad_id is null
                   or (coalesce(es(array['direccion','administracion']::rol_usuario[]), false)
                       and exists (select 1 from unidades u
                                    where u.id = documentos.unidad_id and u.archivado_el is null))));


-- ---------------------------------------------------------------------
-- 4 · EL TITULAR DE LA UNIDAD
-- ---------------------------------------------------------------------
-- El titular es una fila de `personas` (es_socio = true), la misma que usa el
-- resto del CRM: un socio que ayer fue prospecto no se duplica. Esta función
-- crea o actualiza esa persona y la deja como titular, en una transacción.
--   · p_persona_id NULL  → busca por documento y, si no, por teléfono; si no
--     existe, la crea. Una persona que ya existía NO se pisa: solo se marca
--     como socio.
--   · p_persona_id dado   → actualiza SUS datos con lo recibido (un campo
--     vacío lo borra) y la deja como titular. Si el documento ya lo tiene OTRA
--     persona, se rechaza: hay que elegir esa persona, no crear una segunda.
-- Cada cambio queda en la bitácora (t_bit_unidades y t_bit_personas) con quién
-- lo hizo.
create or replace function fn_guardar_titular_unidad(
  p_unidad_id        uuid,
  p_persona_id       uuid,
  p_nombre           text,
  p_doc_tipo         text,
  p_doc_numero       text,
  p_telefono         text,
  p_telefono_alterno text,
  p_email            text,
  p_notas            text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_u          unidades%rowtype;
  v_nombre     text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_doc_tipo   text := nullif(btrim(coalesce(p_doc_tipo, '')), '');
  v_doc_num    text := nullif(btrim(coalesce(p_doc_numero, '')), '');
  v_tel        text := nullif(btrim(coalesce(p_telefono, '')), '');
  v_tel2       text := nullif(btrim(coalesce(p_telefono_alterno, '')), '');
  v_email      text := nullif(btrim(coalesce(p_email, '')), '');
  v_notas      text := nullif(btrim(coalesce(p_notas, '')), '');
  v_per        uuid;
  v_otra       uuid;
  v_archivada  timestamptz;
  v_creada     boolean := false;
  v_reutilizada boolean := false;
begin
  if not coalesce(es(array['direccion','administracion']::rol_usuario[]), false) then
    raise exception 'Solo Dirección o Administración pueden cambiar el titular de una unidad.';
  end if;

  select * into v_u from unidades where id = p_unidad_id and archivado_el is null for update;
  if not found then
    raise exception 'La unidad no existe o está archivada.';
  end if;

  if v_nombre is null then
    raise exception 'El nombre del titular es obligatorio.';
  end if;
  if (v_doc_tipo is null) <> (v_doc_num is null) then
    raise exception 'El documento necesita su tipo y su número, o ninguno de los dos.';
  end if;
  if v_doc_tipo is not null and v_doc_tipo not in ('DNI','CE','RUC','Pasaporte') then
    raise exception 'El tipo de documento debe ser DNI, CE, RUC o Pasaporte.';
  end if;
  if v_tel is not null and v_tel !~ '^\+\d{8,15}$' then
    raise exception 'El teléfono debe llevar el código de país y solo dígitos (formato internacional con +).';
  end if;
  if v_tel2 is not null and v_tel2 !~ '^\+\d{8,15}$' then
    raise exception 'El teléfono alterno debe llevar el código de país y solo dígitos (formato internacional con +).';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'El correo no tiene la forma de un correo.';
  end if;

  if p_persona_id is not null then
    -- Editar a una persona que ya existe.
    select id into v_per from personas where id = p_persona_id and archivado_el is null for update;
    if not found then
      raise exception 'La persona elegida no existe o está archivada.';
    end if;
    if v_doc_tipo is not null then
      select id into v_otra from personas
       where doc_tipo = v_doc_tipo and doc_numero = v_doc_num and id <> v_per limit 1;
      if found then
        raise exception 'Ya hay otra persona registrada con ese documento. Búscala y elígela como titular en vez de crear una segunda.';
      end if;
    end if;
    update personas
       set nombre_completo = v_nombre, doc_tipo = v_doc_tipo, doc_numero = v_doc_num,
           telefono_e164 = v_tel, telefono_alterno = v_tel2, email = v_email,
           notas = v_notas, es_socio = true
     where id = v_per;
  else
    -- Titular nuevo o ya conocido: primero por documento, luego por teléfono.
    if v_doc_tipo is not null then
      select id, archivado_el into v_per, v_archivada from personas
       where doc_tipo = v_doc_tipo and doc_numero = v_doc_num limit 1;
      if found and v_archivada is not null then
        raise exception 'La persona con ese documento está archivada. Pídele a Dirección que la reactive antes de elegirla como titular.';
      end if;
    end if;
    if v_per is null and v_tel is not null then
      select id into v_per from personas
       where archivado_el is null and telefono_e164 = v_tel order by creado_el limit 1;
    end if;

    if v_per is not null then
      v_reutilizada := true;
      update personas set es_socio = true where id = v_per and not es_socio;
    else
      insert into personas (nombre_completo, doc_tipo, doc_numero, telefono_e164, telefono_alterno,
                            email, origen, es_socio, consentimiento, fuente_del_dato, notas, creado_por)
      values (v_nombre, v_doc_tipo, v_doc_num, v_tel, v_tel2, v_email,
              'base_historica', true, false,
              'Inventario maestro del CRM · titular de ' || v_u.codigo_unidad, v_notas, auth.uid())
      returning id into v_per;
      v_creada := true;
    end if;
  end if;

  update unidades set titular_persona_id = v_per where id = v_u.id;

  return jsonb_build_object('ok', true, 'persona_id', v_per,
                            'creada', v_creada, 'reutilizada', v_reutilizada);
end $fn$;

comment on function fn_guardar_titular_unidad is
  'Crea o actualiza la persona titular de una unidad y la deja como titular (inventario maestro). Solo direccion y administracion. Una persona que ya existia no se pisa salvo que se la edite expresamente (p_persona_id).';

-- Quitar al titular de una unidad (se equivocó el nombre, la unidad vuelve a
-- ser de la empresa…). La persona NO se borra (R8): solo se suelta el vínculo.
create or replace function fn_quitar_titular_unidad(p_unidad_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
begin
  if not coalesce(es(array['direccion','administracion']::rol_usuario[]), false) then
    raise exception 'Solo Dirección o Administración pueden cambiar el titular de una unidad.';
  end if;
  update unidades set titular_persona_id = null
   where id = p_unidad_id and archivado_el is null;
  if not found then
    raise exception 'La unidad no existe o está archivada.';
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

comment on function fn_quitar_titular_unidad is
  'Suelta el vinculo entre una unidad y su titular. La persona no se borra (R8). Solo direccion y administracion.';

revoke all on function fn_guardar_titular_unidad(uuid, uuid, text, text, text, text, text, text, text)
  from public, anon;
revoke all on function fn_quitar_titular_unidad(uuid) from public, anon;
grant execute on function fn_guardar_titular_unidad(uuid, uuid, text, text, text, text, text, text, text)
  to authenticated;
grant execute on function fn_quitar_titular_unidad(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 5 · Registro
-- ---------------------------------------------------------------------
insert into migraciones_aplicadas (archivo, aplicado_el, nota) values
  ('17-inventario-maestro.sql', now(),
   'estado de la unidad sigue a separacion/contrato/cuotas; titular y papeles de la unidad')
on conflict (archivo) do nothing;
