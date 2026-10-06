-- =====================================================================
-- CRM Mercado Media Luna — 19 · PRECIO POR UNIDAD
--   la casilla de precio de cada unidad y el precio en vivo para la web
-- Estado: 🟢 APLICADO en producción el 06/10/2026 (migraciones_aplicadas).
--         pruebas/reglas-19.sql: 20/20 en el arnés PGlite local y 20/20 en
--         producción, dentro de una transacción que se deshizo entera.
--
-- Orden de ejecución: … → 14-inventario-grafico → 16-inventario-publico
--                     → 18-geometria-plano → 19
-- Depende de 01 (unidades.precio_parametro → parametros.id), 02 (es()), 03
-- (v_unidades_ofrecibles), 10 (migraciones_aplicadas) y 16 (redefine
-- fn_inventario_publico y uno de sus disparadores). NO depende de 15, 17 ni 18.
--
-- QUÉ AÑADE
--   1 · La convención de los NIVELES DE PRECIO: un precio de lista es una fila
--       de `parametros` cuyo id empieza por `precio_puesto` (vale para puestos)
--       o por `precio_tienda` (vale para tiendas), con su monto, su MONEDA
--       (R7), su fuente y su semáforo. La unidad apunta a uno con
--       `precio_parametro` (01). Lo que ya existía: `precio_puesto_9m2`.
--   2 · t_unidades_precio_valido: la base RECHAZA que una unidad apunte a un
--       parámetro que no es un precio, a uno sin moneda, o a uno del otro tipo
--       (un puesto con precio de tienda). Es restricción de base, no de
--       formulario: vale igual para el formulario, la asignación en bloque y
--       el panel de Supabase.
--   3 · fn_asignar_precio(unidades, parametro): la asignación EN BLOQUE desde
--       /inventario («a todas las disponibles filtradas»). Dirección y
--       Administración, los mismos que mantienen el inventario
--       (unidades_escribir). Las que no son del tipo del nivel se saltan y se
--       devuelven en la respuesta, no se fuerzan.
--   4 · fn_inventario_publico(): una SÉPTIMA clave por unidad, `precio`
--       {monto, moneda}, SOLO si la unidad está «disponible» y su nivel está
--       en 🟢 verde con monto y moneda. Si no, null. La web la pinta en la
--       ficha de la unidad; con null, sigue con su precio general.
--   5 · El aviso de Realtime también salta cuando cambia un nivel de precio
--       (`parametros` con id `precio_%`): si Dirección sube un nivel, la web
--       se entera sin recargar.
--   Nada más: ni tablas, ni columnas, ni políticas, ni grants de tabla.
--
-- POR QUÉ
-- Hasta hoy el precio de lista era UNO por tipo (precio_puesto_9m2) y la web
-- lo tenía escrito en su propio config.js. La empresa quiere poner precio a
-- cada unidad según su ubicación y que la web lo lea en vivo del CRM. Un
-- importe por unidad tecleado en `unidades` es exactamente lo que
-- 07-crm\CLAUDE.md §2 prohíbe (así nacieron los 8 precios en conflicto): por
-- eso la unidad no guarda un número, apunta a un NIVEL de `parametros`, que
-- cita su fuente y lleva semáforo. Editar un nivel cambia a la vez todas las
-- unidades que apuntan a él; cambiar una unidad de nivel es elegir otro en su
-- casilla.
--
-- CONTRATO CON LA WEB (cambia: 08-web/mercado-media-luna/assets/inventario.js)
--   Igual que en 16, más una clave en cada unidad:
--     "precio": { "monto": <numeric>, "moneda": "USD" | "PEN" } | null
--   · Solo con estado = "disponible" (separadas y no disponibles: null).
--   · Solo con el nivel en 🟢 verde: un 🔵 propuesta o un 🟡 por validar NO
--     salen a la web (es la misma regla que parametro_publico() de 13 para
--     todo lo que ve el cliente).
--   · `version` sigue en 1: la clave es nueva y la web vieja la ignora.
--   · `revision` cambia cuando cambia un precio publicado: la web redibuja.
--
-- REGLA DE LA FUENTE DE VERDAD (07-crm\CLAUDE.md §2)
--   Este archivo no trae ni un monto. Los montos viven en `parametros`, con
--   su fuente en 00-fuente-de-verdad\precios-vigentes.md (los vigentes) o en
--   el documento de la propuesta (los 🔵). La web solo ve los 🟢.
--
-- SEGURIDAD (07-crm\CLAUDE.md §5)
--   · fn_inventario_publico sigue siendo una LISTA CERRADA: la clave nueva se
--     construye campo a campo (monto y moneda), nunca con to_jsonb. No sale
--     el id del nivel, ni su fuente, ni su nota, ni el de una unidad que no
--     esté disponible.
--   · fn_asignar_precio: SECURITY DEFINER, search_path fijo, rol comprobado
--     al principio con coalesce(es(...), false) (es() devuelve NULL a un
--     perfil inactivo: pruebas/REPORTE-15-perfil-inactivo.md). Anon no la
--     ejecuta.
--   · La función del disparador es interna: EXECUTE revocado a todos.
--
-- IDEMPOTENTE: sí. `create or replace`, `drop trigger if exists` + `create`,
-- revoke/grant y `on conflict do nothing`.
--
-- ⚠️ sql/00-instalacion-completa.sql NO incluye este archivo: es generado y
-- hay que regenerarlo, no editarlo a mano.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · ¿A qué tipo de unidad sirve un nivel de precio?
-- ---------------------------------------------------------------------
-- 'puesto' | 'tienda' | NULL (no es un nivel de precio). La comparación del
-- tipo de la unidad va en minúsculas y sin espacios: en la base conviven
-- 'tienda' y 'Tienda'.
create or replace function fn_tipo_de_nivel_precio(p_parametro text)
returns text
language sql immutable set search_path = public
as $fn$
  select case
           when p_parametro like 'precio\_puesto%' then 'puesto'
           when p_parametro like 'precio\_tienda%' then 'tienda'
         end
$fn$;

comment on function fn_tipo_de_nivel_precio(text) is
  'Convencion de 19-precio-por-unidad.sql: un nivel de precio es un parametro precio_puesto% (puestos) o precio_tienda% (tiendas). Devuelve puesto, tienda o NULL.';

revoke all on function fn_tipo_de_nivel_precio(text) from public, anon;
grant execute on function fn_tipo_de_nivel_precio(text) to authenticated;


-- ---------------------------------------------------------------------
-- 2 · La base no deja apuntar a un precio que no corresponde
-- ---------------------------------------------------------------------
create or replace function fn_unidades_precio_valido()
returns trigger
language plpgsql security invoker set search_path = public
as $fn$
declare
  v_tipo_nivel text;
  v_moneda     moneda;
begin
  if new.precio_parametro is null then
    return new;
  end if;

  v_tipo_nivel := fn_tipo_de_nivel_precio(new.precio_parametro);
  if v_tipo_nivel is null then
    raise exception 'El parámetro «%» no es un precio de lista: un precio de unidad empieza por precio_puesto o precio_tienda (19-precio-por-unidad.sql).',
      new.precio_parametro;
  end if;

  if lower(btrim(coalesce(new.tipo, ''))) <> v_tipo_nivel then
    raise exception 'La unidad % es de tipo «%» y el precio «%» es para %s. Elige un precio de su tipo.',
      new.codigo_unidad, coalesce(new.tipo, 'sin tipo'), new.precio_parametro, v_tipo_nivel;
  end if;

  select p.valor_moneda into v_moneda from parametros p where p.id = new.precio_parametro;
  if v_moneda is null then
    raise exception 'El precio «%» no tiene moneda. Todo dinero lleva su moneda al lado (R7): Dirección la completa en Parámetros.',
      new.precio_parametro;
  end if;

  return new;
end $fn$;

comment on function fn_unidades_precio_valido() is
  'Disparador de unidades (19): precio_parametro solo puede apuntar a un nivel de precio (precio_puesto% / precio_tienda%) del mismo tipo que la unidad y con moneda (R7).';

revoke all on function fn_unidades_precio_valido() from public, anon, authenticated;

drop trigger if exists t_unidades_precio_valido on unidades;
create trigger t_unidades_precio_valido
  before insert or update of precio_parametro, tipo on unidades
  for each row execute function fn_unidades_precio_valido();


-- ---------------------------------------------------------------------
-- 3 · fn_asignar_precio — la asignación en bloque
-- ---------------------------------------------------------------------
-- p_parametro NULL = quitar el precio a esas unidades.
-- Respuesta: {ok, actualizadas, sin_cambio, omitidas: [{codigo, motivo}]}.
-- Un solo UPDATE: un solo aviso a la web (16 §3a, por sentencia).
create or replace function fn_asignar_precio(p_unidades uuid[], p_parametro text)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_tipo_nivel  text;
  v_moneda      moneda;
  v_n           integer := 0;
  v_sin_cambio  integer := 0;
  v_omitidas    jsonb := '[]'::jsonb;
begin
  if not coalesce(es(array['direccion','administracion']::rol_usuario[]), false) then
    return jsonb_build_object('ok', false, 'motivo',
      'Solo Dirección o Administración asignan precios a las unidades (los mismos que mantienen el inventario).');
  end if;

  if p_unidades is null or cardinality(p_unidades) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'No llegó ninguna unidad.');
  end if;
  if cardinality(p_unidades) > 2000 then
    return jsonb_build_object('ok', false, 'motivo', 'Demasiadas unidades en una sola asignación.');
  end if;

  if p_parametro is not null then
    v_tipo_nivel := fn_tipo_de_nivel_precio(p_parametro);
    if v_tipo_nivel is null then
      return jsonb_build_object('ok', false, 'motivo',
        format('«%s» no es un precio de lista (precio_puesto… o precio_tienda…).', p_parametro));
    end if;
    select p.valor_moneda into v_moneda from parametros p where p.id = p_parametro;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', format('No existe el precio «%s» en Parámetros.', p_parametro));
    end if;
    if v_moneda is null then
      return jsonb_build_object('ok', false, 'motivo',
        format('El precio «%s» no tiene moneda (R7). Dirección la completa en Parámetros.', p_parametro));
    end if;
  end if;

  -- Las que no se tocan, con su motivo (no se fuerza ninguna).
  select coalesce(jsonb_agg(jsonb_build_object('codigo', u.codigo_unidad, 'motivo', m.motivo) order by u.codigo_unidad), '[]'::jsonb)
    into v_omitidas
    from unidades u
    cross join lateral (
      select case
               when u.archivado_el is not null then 'archivada'
               when p_parametro is not null
                and lower(btrim(coalesce(u.tipo, ''))) <> v_tipo_nivel
                 then format('es %s y el precio es para %ss', coalesce(u.tipo, 'sin tipo'), v_tipo_nivel)
             end as motivo
    ) m
   where u.id = any(p_unidades)
     and m.motivo is not null;

  select count(*) into v_sin_cambio
    from unidades u
   where u.id = any(p_unidades)
     and u.archivado_el is null
     and (p_parametro is null or lower(btrim(coalesce(u.tipo, ''))) = v_tipo_nivel)
     and u.precio_parametro is not distinct from p_parametro;

  update unidades u
     set precio_parametro = p_parametro
   where u.id = any(p_unidades)
     and u.archivado_el is null
     and (p_parametro is null or lower(btrim(coalesce(u.tipo, ''))) = v_tipo_nivel)
     and u.precio_parametro is distinct from p_parametro;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'actualizadas', v_n, 'sin_cambio', v_sin_cambio, 'omitidas', v_omitidas);
end $fn$;

comment on function fn_asignar_precio(uuid[], text) is
  'Asigna (o quita, con NULL) un nivel de precio a varias unidades de una vez, desde /inventario. Direccion y Administracion. Salta y devuelve las de otro tipo o archivadas. 19-precio-por-unidad.sql.';

revoke all on function fn_asignar_precio(uuid[], text) from public, anon;
grant execute on function fn_asignar_precio(uuid[], text) to authenticated;


-- ---------------------------------------------------------------------
-- 4 · fn_inventario_publico() — la clave `precio`
-- ---------------------------------------------------------------------
-- Copia de 16 §1 con dos cambios: el estado se calcula una sola vez (lateral)
-- y se añade `precio`. Todo lo demás, idéntico (ver el contrato en 16).
create or replace function fn_inventario_publico()
returns jsonb
language sql stable security definer set search_path = public
as $fn$
  with corte as (
    select p.estado_semaforo::text                                      as semaforo,
           case when p.estado_semaforo = 'verde' then p.valor_texto end as corte
      from parametros p
     where p.id = 'inventario_disponibilidad_corte'
  ),
  filas as (
    select u.codigo_unidad,
           jsonb_build_object(
             'codigo',     u.codigo_unidad,
             'tipo',       u.tipo,
             'area_m2',    u.area_m2,
             'zona_rubro', u.zona_rubro,
             -- Solo un polígono bien formado: 3..64 puntos, cada uno [x, y]
             -- numérico. CASE y no AND: el orden de evaluación de un AND no
             -- está garantizado, y jsonb_array_length revienta sobre algo que
             -- no sea un arreglo.
             'geometria',  case
                             when jsonb_typeof(u.geometria) is distinct from 'array' then null
                             when jsonb_array_length(u.geometria) not between 3 and 64 then null
                             when exists (
                               select 1
                                 from jsonb_array_elements(u.geometria) as pt(punto)
                                where case
                                        when jsonb_typeof(pt.punto) <> 'array'  then true
                                        when jsonb_array_length(pt.punto) <> 2 then true
                                        else jsonb_typeof(pt.punto -> 0) <> 'number'
                                          or jsonb_typeof(pt.punto -> 1) <> 'number'
                                      end
                             ) then null
                             else u.geometria
                           end,
             'estado',     e.estado,
             -- 19: el precio SOLO de una unidad disponible y SOLO si su nivel
             -- está en verde, con monto y moneda. Campo a campo: ni el id del
             -- nivel, ni su fuente, ni su nota salen a la web.
             'precio',     case
                             when e.estado = 'disponible'
                              and pr.estado_semaforo = 'verde'
                              and pr.valor_numerico is not null
                              and pr.valor_moneda is not null
                               then jsonb_build_object('monto',  pr.valor_numerico,
                                                       'moneda', pr.valor_moneda::text)
                           end
           ) as unidad
      from unidades u
      left join parametros pr on pr.id = u.precio_parametro
      cross join lateral (
        select case
                 -- Se consulta la vista, no se recalcula (03 §7).
                 when exists (select 1 from v_unidades_ofrecibles v where v.id = u.id)
                   then 'disponible'
                 when u.estado_comercial in ('reservada_temporal', 'separada')
                   or exists (select 1
                                from separaciones s
                               where s.unidad_id = u.id
                                 and s.estado in ('pendiente_verificacion', 'verificada')
                                 and s.archivado_el is null)
                   then 'separada'
                 else 'no_disponible'
               end as estado
      ) e
     where u.archivado_el is null
  ),
  lista as (
    select coalesce(jsonb_agg(f.unidad order by f.codigo_unidad), '[]'::jsonb) as unidades
      from filas f
  )
  select jsonb_build_object(
           'version',        1,
           'generado_el',    now(),
           'revision',       md5(l.unidades::text),
           'disponibilidad', jsonb_build_object(
                               'semaforo', (select c.semaforo from corte c),
                               'corte',    (select c.corte    from corte c)),
           'unidades',       l.unidades)
    from lista l
$fn$;

comment on function fn_inventario_publico() is
  'Inventario PUBLICO para la web (planos de mercadomedialuna.com), sin sesion. Lista cerrada: codigo, tipo, area_m2, zona_rubro, geometria, estado (disponible = esta en v_unidades_ofrecibles; separada; no_disponible) y, desde 19, precio {monto, moneda} solo de una unidad disponible cuyo nivel de precio esta en verde. Mas el semaforo del corte de disponibilidad y su texto solo si esta en verde. Sin ids ni datos personales. Segunda excepcion consciente para anon (16-inventario-publico.sql); la primera es fn_captar_prospecto.';

revoke all on function fn_inventario_publico() from public;
grant execute on function fn_inventario_publico() to anon, authenticated;


-- ---------------------------------------------------------------------
-- 5 · El aviso de Realtime también por los niveles de precio
-- ---------------------------------------------------------------------
-- 16 §3d escuchaba solo el corte de disponibilidad. Ahora también cualquier
-- nivel de precio: subirlo, bajarlo o pasarlo a verde cambia lo que ve la web.
drop trigger if exists t_inventario_publico_parametros on parametros;
create trigger t_inventario_publico_parametros
  after insert or update on parametros
  for each row
  when (new.id = 'inventario_disponibilidad_corte' or new.id like 'precio\_%')
  execute function fn_inventario_publico_aviso();


-- ---------------------------------------------------------------------
-- 6 · Registro
-- ---------------------------------------------------------------------
insert into migraciones_aplicadas (archivo, aplicado_el, nota) values
  ('19-precio-por-unidad.sql', now(),
   'niveles de precio por unidad (precio_puesto%/precio_tienda%), t_unidades_precio_valido, fn_asignar_precio, clave precio en fn_inventario_publico solo con nivel verde')
on conflict (archivo) do nothing;
