-- =====================================================================
-- CRM Mercado Media Luna — 16 · INVENTARIO PÚBLICO (la web lee el plano)
-- Estado: 🟡 POR APLICAR · 02/10/2026 (03/10/2026: el aviso de
--         oportunidades pasa a ser por fila y solo con unidad, §3c)
--         Escrito y revisado a mano. NO ensayado todavía: ni en el arnés
--         PGlite (COMO-PROBAR.md §9.1) ni en Supabase. NO está aplicado en
--         ningún proyecto. Quien lo aplique corre después
--         pruebas/reglas-16.sql y anota el resultado; la fila de
--         migraciones_aplicadas la escribe la última sentencia de este archivo.
--
-- Orden de ejecución: … → 13-seguimiento-comercial → 14-inventario-grafico
--                     → 15-perfil-inactivo → 16
-- Depende de 03 (v_unidades_ofrecibles), 10 (migraciones_aplicadas) y 14
-- (geometria, zona_rubro y el parámetro inventario_disponibilidad_corte).
-- NO depende de 15: no llama a es() ni a mi_rol(); da igual aplicarlo antes
-- o después.
--
-- QUÉ AÑADE
--   1 · fn_inventario_publico(): UNA función, sin argumentos, que devuelve el
--       inventario vivo con una lista CERRADA de campos (ver «Contrato»). La
--       llama sin sesión la página de planos de mercadomedialuna.com
--       (08-web/mercado-media-luna, planos.html), con la clave publicable.
--   2 · fn_inventario_publico_aviso() y sus disparadores (uno en unidades,
--       uno en separaciones, tres por fila en oportunidades y uno en
--       parametros): cuando cambia
--       algo que mueve la disponibilidad (unidades, separaciones, la
--       asignación de una oportunidad, el corte de disponibilidad), la base
--       avisa por Realtime al canal PÚBLICO «inventario-publico», evento
--       «cambio». El aviso NO lleva datos —solo el nombre de la tabla—: la web
--       vuelve a pedir fn_inventario_publico() y se entera de lo que haya.
--   Nada más: ni una tabla, ni una política RLS, ni un grant de tabla.
--
-- POR QUÉ
-- Hasta hoy la página de planos de la web enseñaba dos imágenes de la lista
-- de disponibilidad del 18/08/2026. Desde el 02/10/2026 el inventario del CRM
-- (la carga de 14, que Rosa mantiene unidad por unidad desde /inventario,
-- Acta 03-O02) es la ÚNICA fuente de la disponibilidad, y la web tiene que
-- enseñar lo mismo que el CRM y al momento: lo que se separa en el CRM deja
-- de aparecer libre en la web sin que nadie suba una imagen nueva. Una
-- imagen que se actualiza a mano
-- es exactamente cómo se llegó a varias cifras de libres que no cuadran
-- (00-fuente-de-verdad\inventario-maestro.md §4).
--
-- Contrato con la web (08-web/mercado-media-luna/assets/config.js, bloque
-- `inventario`, y el script que dibuja el plano). Cambiar una clave aquí
-- rompe la web en silencio: se cambia en los dos lados a la vez.
--   GET <supabaseUrl>/rest/v1/rpc/fn_inventario_publico?apikey=<publicable>
--   {
--     "version": 1,
--     "generado_el": "<timestamptz ISO 8601>",
--     "revision": "<md5 hex del texto del arreglo `unidades`>",
--     "disponibilidad": { "semaforo": "<estado_semaforo del corte | null>",
--                         "corte": "<valor_texto SOLO si semaforo = verde | null>" },
--     "unidades": [ { "codigo", "tipo", "area_m2", "zona_rubro", "geometria",
--                     "estado": "disponible" | "separada" | "no_disponible" } ]
--   }
--   · Solo unidades no archivadas, ordenadas por codigo_unidad.
--   · "estado", en este orden:
--       disponible     ⇔ la unidad está en v_unidades_ofrecibles. Se CONSULTA
--                        esa vista, no se recalcula: es la única definición
--                        de «qué se puede ofrecer» (03-vistas.sql §7).
--       separada       ⇔ estado_comercial reservada_temporal o separada, o
--                        una separación viva (pendiente_verificacion o
--                        verificada, sin archivar).
--       no_disponible  ⇔ todo lo demás: contratada, pagada, entregada,
--                        retirada de venta (no_disponible), sin verificar
--                        contra plano (estado_dato no verde) o asignada a una
--                        oportunidad activa. Una asignación sin separación
--                        sale como no_disponible a propósito: decir
--                        «separada» ahí sería enseñar el embudo de ventas.
--   · "geometria" sale solo si es un arreglo de 3 a 64 puntos [x, y]
--     numéricos (espacio de dibujo 1050 × 2048 de 14); si no, null: la
--     unidad existe, pero no tiene un polígono que se pueda dibujar.
--   · Realtime: canal público «inventario-publico», evento «cambio»,
--     carga {"tabla": "<tabla>"}. Un solo aviso por transacción.
--
-- SEGURIDAD (07-crm\CLAUDE.md §5)
--   · Ésta es la SEGUNDA excepción consciente a «anon no toca nada» de
--     02-rls.sql §0 y 11-privilegios.sql §4. La primera es
--     fn_captar_prospecto (12), que solo escribe; ésta solo lee. `anon` sigue
--     sin un solo privilegio de tabla o de vista: no lee `unidades`, ni
--     `v_unidades_ofrecibles`, ni `v_unidades_tablero` (revocadas en 08, 09 y
--     14), ni `parametros`. Lo único que obtiene es lo que esta función decide
--     devolver.
--   · La función es SECURITY DEFINER porque `anon` no puede leer las tablas.
--     Por eso devuelve una LISTA CERRADA, construida campo a campo con
--     jsonb_build_object y no con to_jsonb(fila): seis claves por unidad y
--     ninguna más. Una columna nueva en `unidades` NO aparece en la web hasta
--     que alguien la añada aquí a propósito.
--   · Lo que NO sale, nunca: el id de la unidad, titular_persona_id ni nada
--     de `personas` (nombres, DNI, teléfonos: Ley 29733), observaciones,
--     revisar, fuente_disponibilidad, fuente_plano, tipo_socio, estado_legal,
--     estado_fisico, documento_sustento, precio_parametro, etapa, bloque,
--     ubicacion, estado_comercial y estado_dato en crudo, oportunidades,
--     separaciones, montos ni fechas del CRM. De las seis claves, solo
--     `codigo` y `zona_rubro` son texto libre: que nadie escriba ahí un
--     nombre (hoy salen del plano y del rótulo de la zona, 14).
--   · Lo que SÍ sale, a propósito: código, tipo, área, rubro de la zona,
--     polígono de dibujo y uno de tres estados por unidad viva. Con eso
--     cualquiera puede contar cuántas hay en cada estado. La web ya
--     publicaba la disponibilidad por unidad, como imagen (lista del
--     18/08/2026); lo nuevo es que sale de la base, al día, y que distingue
--     «separada». 🔵 Publicar «separada» como estado propio viene del
--     contrato acordado con la web el 02/10/2026; si Dirección prefiere no
--     mostrarlo, basta con mapearlo a no_disponible aquí.
--   · `set search_path = public`, STABLE (PostgREST solo admite GET en
--     funciones STABLE o IMMUTABLE) y sin argumentos: no hay nada que
--     inyectar. Leer como su dueño (`postgres`, con BYPASSRLS en Supabase)
--     atraviesa el FORCE RLS de `unidades`; si el dueño fuera otro rol sin
--     BYPASSRLS, la lista saldría VACÍA sin error. pruebas/reglas-16.sql lo
--     comprueba (CONTRATO · totales).
--   · El aviso de Realtime no puede bloquear ni deshacer NUNCA una escritura
--     del CRM: todo su cuerpo va dentro de `begin … exception when others`
--     y lo peor que hace es un WARNING. Si `realtime.send` no existe en el
--     proyecto, no hace nada: la web sigue al día por su consulta periódica.
--     Es SECURITY DEFINER porque quien escribe (un `authenticated`) no tiene
--     permiso sobre el esquema `realtime`; no es invocable por nadie (EXECUTE
--     revocado a public, anon y authenticated: un disparador no lo necesita,
--     PostgreSQL solo comprueba EXECUTE al CREAR el disparador; la fila
--     ESCRITURA de pruebas/reglas-16.sql lo comprueba con RLS de verdad).
--   · El canal es PÚBLICO a propósito: lo escucha un navegador sin sesión. Por
--     eso el aviso no lleva datos. Y por eso tampoco puede salir un aviso por
--     algo que anon provoca y que no cambia el inventario: el INSERT de un
--     lead de la web (fn_captar_prospecto, 12) delataría si un teléfono ya
--     era prospecto. En oportunidades solo avisa lo que lleva unidad (§3c).
--   · Sin límite de frecuencia en la base: cualquiera puede pedir la función
--     tantas veces como quiera. Es una lectura de unos cientos de filas; si
--     alguna vez hiciera falta frenar abusos, se hace delante (Supabase), no
--     aquí.
--
-- REALTIME — LO QUE TIENE QUE ESTAR EN EL PROYECTO
--   · `realtime.send(jsonb, text, text, boolean)` («Broadcast from Database»).
--     Los proyectos actuales de Supabase la traen. Comprobar:
--       select to_regprocedure('realtime.send(jsonb,text,text,boolean)');
--     NULL = no existe: este archivo se aplica igual y la web funciona solo
--     por consulta periódica.
--   · Canales PÚBLICOS permitidos: Dashboard → Project Settings → Realtime →
--     que NO esté activado «solo canales privados» (en algunas versiones del
--     panel: «Allow public access» encendido). Según la prueba en vivo del
--     02/10/2026 (sesión de la web), un canal público se une con la clave
--     publicable sin error; que los avisos LLEGUEN no se ha visto todavía.
--
-- REGLA DE LA FUENTE DE VERDAD
-- Aquí no hay precios, ni cantidades de unidades, ni plazos, ni ninguna cifra
-- de negocio. La función devuelve lo que ya está en `unidades` (cuyo origen
-- dice `fuente_plano` / `fuente_disponibilidad`) y el corte tal como está en
-- `parametros`. Los precios que enseña la web NO salen de aquí: salen de
-- 00-fuente-de-verdad\precios-vigentes.md y viven en la web. Los únicos
-- números de este archivo son de forma, no de negocio: `version` 1 del
-- contrato y el tope de 3 a 64 puntos por polígono.
--   ⚠ `corte` SALE de la base tal cual en cuanto su semáforo pasa a verde
--   (cualquiera puede leerlo con la clave publicable). Hoy su valor_texto lo
--   escribe fn_importar_inventario (14) pensando en el equipo (habla de
--   listas internas y de confirmar con Rosa). La web ya no lo pinta tal
--   cual (03/10/2026): con verde muestra una frase fija, y la fecha solo si
--   el texto es EXACTAMENTE una fecha (dd/mm/aaaa o aaaa-mm-dd). Quien lo
--   ponga en verde tiene que reescribirlo antes como esa sola fecha de corte.
--
-- IDEMPOTENTE: `create or replace`, `drop trigger if exists` + `create`,
-- revoke/grant y `on conflict do nothing`. Se puede correr dos veces seguidas
-- sin error y sin cambiar nada.
--
-- ⚠️ sql/00-instalacion-completa.sql NO incluye este archivo: es generado y
-- hay que regenerarlo, no editarlo a mano.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · fn_inventario_publico() — lo que lee la web
-- ---------------------------------------------------------------------
-- `revision` es el md5 del texto del arreglo `unidades`: el texto de un jsonb
-- es canónico (mismas claves en el mismo orden), así que mismo inventario ⇒
-- misma revisión. La web lo usa para no redibujar si nada cambió. No cubre
-- `disponibilidad`: si cambia solo el corte, la revisión no se mueve.
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
             'estado',     case
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
                           end
           ) as unidad
      from unidades u
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
  'Inventario PUBLICO para la web (planos de mercadomedialuna.com), sin sesion. Lista cerrada: codigo, tipo, area_m2, zona_rubro, geometria y estado (disponible = esta en v_unidades_ofrecibles; separada; no_disponible) de cada unidad no archivada, mas el semaforo del corte de disponibilidad y su texto solo si esta en verde. Sin ids ni datos personales. Segunda excepcion consciente para anon (16-inventario-publico.sql); la primera es fn_captar_prospecto.';

-- La excepción consciente a «anon no toca nada»: solo esta función, que
-- solo lee. Ver el encabezado.
revoke all on function fn_inventario_publico() from public;
grant execute on function fn_inventario_publico() to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2 · fn_inventario_publico_aviso() — el aviso por Realtime
-- ---------------------------------------------------------------------
-- · Un solo aviso por transacción: la marca `mml.inventario_publico_aviso`
--   (set_config con is_local = true: muere con la transacción) guarda el
--   txid que ya avisó. La carga inicial de 14 hace cientos de INSERT sueltos
--   en una sola transacción; sin esta marca serían cientos de avisos, y cada
--   navegador abierto volvería a pedir el inventario cientos de veces. Uno
--   basta: el mensaje se entrega al CONFIRMARSE la transacción (Realtime lo
--   lee del WAL), así que la web lee el estado final. Si la transacción se
--   deshace, el mensaje se deshace con ella y no llega a nadie.
-- · `mml.inventario_publico_tabla` guarda qué tabla disparó por última vez.
--   No sale de la base ni de la transacción: es el rastro con el que
--   pruebas/reglas-16.sql comprueba que cada disparador salta, haya Realtime
--   o no.
-- · EXECUTE y no una llamada directa: el cuerpo no menciona `realtime` hasta
--   que to_regprocedure confirma que existe.
-- · Sirve para disparadores por sentencia y por fila: devuelve NULL, que en
--   un AFTER se ignora.
create or replace function fn_inventario_publico_aviso()
returns trigger
language plpgsql security definer set search_path = public
as $fn$
declare
  v_tx text;
begin
  begin
    perform set_config('mml.inventario_publico_tabla', tg_table_name::text, true);

    v_tx := txid_current()::text;
    if current_setting('mml.inventario_publico_aviso', true) is not distinct from v_tx then
      return null;   -- esta transacción ya avisó
    end if;

    if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
      return null;   -- sin Broadcast from Database: la web se queda con la consulta periódica
    end if;

    execute 'select realtime.send($1, $2, $3, $4)'
      using jsonb_build_object('tabla', tg_table_name::text),
            'cambio'::text,
            'inventario-publico'::text,
            false;      -- canal PÚBLICO: lo escucha un navegador sin sesión

    perform set_config('mml.inventario_publico_aviso', v_tx, true);
  exception when others then
    -- Ni una escritura del CRM se pierde por el aviso: se anota y se sigue.
    raise warning 'Inventario publico: no se pudo avisar por Realtime (%). El cambio se guardo igual; la web lo vera en su proxima consulta.', sqlerrm;
  end;
  return null;
end $fn$;

comment on function fn_inventario_publico_aviso() is
  'Disparador: avisa por Realtime (canal publico inventario-publico, evento cambio, sin datos) de que el inventario publico cambio. Una vez por transaccion; si realtime.send no existe no hace nada; nunca bloquea ni deshace la escritura (16-inventario-publico.sql).';

-- Nadie la llama a mano (PostgreSQL no lo permite con una función de
-- disparador) y los disparadores no necesitan EXECUTE para saltar: se quita
-- a todos para que no aparezca como ejecutable por anon ni por authenticated.
revoke all on function fn_inventario_publico_aviso() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3 · Los disparadores
-- ---------------------------------------------------------------------
-- Por SENTENCIA, no por fila, en unidades y separaciones: un UPDATE de 400
-- unidades es un solo aviso (y la marca de §2 deja uno por transacción).
-- oportunidades va POR FILA con WHEN (ver 3c: sin unidad no avisa). Las
-- columnas de `update of` son las que mueven el estado que publica
-- fn_inventario_publico(): un cambio de notas, de responsable o de
-- temperatura no avisa a nadie.
-- En separaciones y oportunidades el DELETE ya lo impide R8
-- (t_no_delete_*, 01-schema.sql §11); se escucha igual por si eso cambia.

-- 3a · unidades: cualquier cambio (estado, verificación, área, polígono, rubro,
--      archivado o una unidad nueva).
drop trigger if exists t_inventario_publico_unidades on unidades;
create trigger t_inventario_publico_unidades
  after insert or update or delete on unidades
  for each statement execute function fn_inventario_publico_aviso();

-- 3b · separaciones: una nueva, una que cambia de estado (verificada,
--      devuelta, vencida, aplicada a contrato), de unidad, o se archiva.
drop trigger if exists t_inventario_publico_separaciones on separaciones;
create trigger t_inventario_publico_separaciones
  after insert or update of estado, archivado_el, unidad_id or delete on separaciones
  for each statement execute function fn_inventario_publico_aviso();

-- 3c · oportunidades: la asignación de una unidad (R1) entra o sale de
--      v_unidades_ofrecibles por estas tres columnas. Aquí NO por sentencia
--      sino POR FILA, con WHEN: solo avisa si hay una unidad de por medio.
--      ⚠ Un INSERT que avisara siempre sería un oráculo de teléfonos:
--      fn_captar_prospecto (12, ejecutable por anon) inserta una oportunidad
--      SOLO si el teléfono no tiene ya una activa, y a propósito responde lo
--      mismo en los dos casos («no filtra si el telefono ya existia»). Con un
--      aviso por cada INSERT, cualquiera escuchando el canal público sabría si
--      un número ya es prospecto de SCP (Ley 29733), y vería en vivo cada lead
--      y cada cambio de situación del embudo. Una oportunidad sin unidad no
--      mueve fn_inventario_publico(): no avisa.
--      Por fila cuesta poco: la marca de §2 deja igual un solo aviso por
--      transacción. El DELETE ya lo impide R8; se escucha igual por si cambia.
drop trigger if exists t_inventario_publico_oportunidades on oportunidades;   -- el de sentencia (versión anterior de este archivo)
drop trigger if exists t_inventario_publico_oportunidades_ins on oportunidades;
create trigger t_inventario_publico_oportunidades_ins
  after insert on oportunidades
  for each row when (new.unidad_asignada_id is not null)
  execute function fn_inventario_publico_aviso();
drop trigger if exists t_inventario_publico_oportunidades_upd on oportunidades;
create trigger t_inventario_publico_oportunidades_upd
  after update of unidad_asignada_id, situacion, archivado_el on oportunidades
  for each row when (old.unidad_asignada_id is not null or new.unidad_asignada_id is not null)
  execute function fn_inventario_publico_aviso();
drop trigger if exists t_inventario_publico_oportunidades_del on oportunidades;
create trigger t_inventario_publico_oportunidades_del
  after delete on oportunidades
  for each row when (old.unidad_asignada_id is not null)
  execute function fn_inventario_publico_aviso();

-- 3d · parametros: SOLO la fila del corte de disponibilidad (por fila, con
--      WHEN), para que la web se entere cuando Dirección lo pase a verde.
drop trigger if exists t_inventario_publico_parametros on parametros;
create trigger t_inventario_publico_parametros
  after insert or update on parametros
  for each row when (new.id = 'inventario_disponibilidad_corte')
  execute function fn_inventario_publico_aviso();


-- ---------------------------------------------------------------------
-- 4 · Que PostgREST vea la función nueva sin esperar
-- ---------------------------------------------------------------------
-- Supabase ya recarga la caché de esquema de PostgREST por su cuenta después
-- de un DDL; esto es la red de seguridad. Se entrega al confirmar la
-- transacción.
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- 5 · Comprobar a mano, después de aplicarlo
-- ---------------------------------------------------------------------
--   1. SQL Editor → pruebas/reglas-16.sql entero → Run (va entre
--      begin … rollback; no deja rastro ni manda ningún aviso).
--   2. Desde cualquier terminal, como lo hará la web (sin sesión, solo la
--      clave publicable, que está en 08-web/mercado-media-luna/assets/config.js):
--        curl -s "https://nmqwibcxqkaifszzbloo.supabase.co/rest/v1/rpc/fn_inventario_publico?apikey=<clave sb_publishable_…>"
--      Debe responder 200 con {"version": 1, …}. Un 404 PGRST202 = PostgREST
--      no ve la función (repetir `notify pgrst, 'reload schema';`). Un 401 o
--      un 403 «permission denied for function» = falta el grant de §1.
--   3. Realtime, sin tocar ningún dato: con la web abierta en planos (y las
--      herramientas de desarrollo en «Red»), mandar a mano un aviso vacío
--      desde el SQL Editor:
--        select realtime.send('{"tabla":"prueba"}'::jsonb, 'cambio', 'inventario-publico', false);
--      La web tiene que volver a pedir fn_inventario_publico en segundos. Si
--      solo la pide al cabo de su consulta periódica, Realtime no está
--      llegando (ver «REALTIME» en el encabezado). El aviso no lleva datos:
--      mandarlo de más solo cuesta una relectura por navegador abierto.
--
-- Para cortarle el inventario a la web sin borrar nada (la web deja de
-- recibirlo; qué enseña entonces lo decide la web):
--   revoke execute on function fn_inventario_publico() from anon;
-- y para callar los avisos:
--   alter table unidades      disable trigger t_inventario_publico_unidades;
--   alter table separaciones  disable trigger t_inventario_publico_separaciones;
--   alter table oportunidades disable trigger t_inventario_publico_oportunidades_ins;
--   alter table oportunidades disable trigger t_inventario_publico_oportunidades_upd;
--   alter table oportunidades disable trigger t_inventario_publico_oportunidades_del;
--   alter table parametros    disable trigger t_inventario_publico_parametros;


-- ---------------------------------------------------------------------
-- 6 · Registro
-- ---------------------------------------------------------------------
insert into migraciones_aplicadas (archivo, aplicado_el, nota) values
  ('16-inventario-publico.sql', now(),
   'fn_inventario_publico() para anon (planos de la web) + aviso por Realtime al canal publico inventario-publico')
on conflict (archivo) do nothing;
