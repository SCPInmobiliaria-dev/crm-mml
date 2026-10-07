-- =====================================================================
-- CRM Mercado Media Luna — PRUEBAS DE LAS REGLAS DURAS
--
-- Origen: 02-codigo\sql\05-pruebas-reglas.sql (🟢 ejecutado contra
--         PostgreSQL 16 el 08/09/2026: las 9 reglas dieron el resultado
--         esperado). Esta copia lo reordena para que corra de una sola vez
--         en el SQL Editor de Supabase y añade lo que allí no se cubría.
--
-- 🟡 ESTADO DE ESTA COPIA — LÉELO
--    Las pruebas heredadas están verificadas. Las AÑADIDAS aquí (R1b, R1c,
--    R2a/b/c, R3b/c, R4b/c, R5b/d, R6b, R7a, R7b, R8 sobre las cinco
--    tablas, R9b/c y el detalle de RLS) todavía NO se han ejecutado contra
--    ningún proyecto. Córrelas y anota el resultado siguiendo
--    pruebas\COMO-PROBAR.md. Este archivo no declara VALIDADO nada que
--    nadie haya visto pasar.
--
-- ---------------------------------------------------------------------
-- CÓMO SE LEE
-- ---------------------------------------------------------------------
-- Cada prueba dice qué DEBE pasar y compara el resultado obtenido contra
-- ese esperado. Muchas tienen que dar error: un error esperado es una
-- prueba SUPERADA, no un fallo. Por eso los errores se capturan y se
-- anotan en una tabla en lugar de reventar el script — así el archivo
-- entero corre de una vez y al final imprime un cuadro con el veredicto
-- de cada regla.
--
-- Veredictos:
--   ✅ PASA            la regla se comporta como debe
--   🔴 FALLA           la regla NO protege lo que dice proteger → urgente
--   🔴 FALLA CONOCIDA  defecto ya documentado, con su decisión pendiente
--   🟡 OMITIDA         faltan datos para poder probarla (dice cuáles)
--   🟡 REVISAR         hallazgo que no es un agujero, pero hay que mirarlo
--
-- Y no basta con que falle: cada prueba de error comprueba además que el
-- mensaje sea EL SUYO. Una prueba que pasa porque saltó un error distinto
-- no prueba nada.
--
-- ---------------------------------------------------------------------
-- ESTE ARCHIVO NO DEJA RASTRO
-- ---------------------------------------------------------------------
-- Todo va dentro de un `begin … rollback`. Al terminar, la base queda
-- exactamente como estaba: ni una persona de prueba, ni una unidad, ni un
-- parámetro tocado. Por eso puede correrse incluso sobre un proyecto con
-- datos reales — pero ⚠️ NO borres el `rollback` del final, y si tienes
-- que ejecutarlo por trozos, lee antes pruebas\COMO-PROBAR.md.
--
-- ---------------------------------------------------------------------
-- AQUÍ NO HAY NI UNA CIFRA DEL NEGOCIO
-- ---------------------------------------------------------------------
-- Todo número que aparece aquí es una FICHA DE JUGUETE: los montos (10, 3,
-- 7), el plazo de 3 días y los desplazamientos de fecha (+5, +12, +30).
-- Están elegidos para que un error de aritmética se vea a simple vista, y
-- ninguno es un precio, una separación, un plazo ni una condición
-- comercial: ninguno sale de 00-fuente-de-verdad y ninguno persiste.
-- 07-crm\CLAUDE.md §2 lo permite expresamente para valores obviamente
-- falsos y marcados como tales — que es lo que son.
--
-- Si alguna vez hace falta probar con el plazo REAL, se carga en
-- `parametros` desde su archivo fuente y la prueba R4a pasará a OMITIDA
-- sola. Nunca se escribe la cifra aquí.
--
-- ---------------------------------------------------------------------
-- REQUISITOS
-- ---------------------------------------------------------------------
-- Haber ejecutado antes, en este orden: 01-schema, 02-rls, 03-vistas,
-- 04-seed-parametros, 06, 07, 08 y 09. Sin 04 falla ya la preparación:
-- `separaciones.plazo_parametro` referencia una fila de `parametros`.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0 · EL CUADERNO DE RESULTADOS
-- ---------------------------------------------------------------------
create temporary table resultado (
  n         serial primary key,
  regla     text not null,
  prueba    text not null,
  esperado  text not null,
  obtenido  text not null,
  veredicto text not null
) on commit drop;

/* Veredicto de una prueba que DEBE dar error. `p_fragmento` es el trozo de
   mensaje que demuestra que falló por el motivo correcto.

   Se busca con `strpos`, no con LIKE: los fragmentos son nombres de
   restricciones llenos de guiones bajos, y en LIKE un `_` vale por
   cualquier carácter. Comparar literal es más estricto, que es lo que
   queremos — una prueba que pasa porque saltó otro error no prueba nada. */
create function pg_temp.veredicto_error(
  p_fallo boolean, p_mensaje text, p_fragmento text
) returns text language sql immutable as $$
  select case
    when not p_fallo                          then '🔴 FALLA'
    when strpos(p_mensaje, p_fragmento) > 0   then '✅ PASA'
    else '🔴 FALLA'
  end
$$;

-- ---------------------------------------------------------------------
-- 0b · DATOS DE PRUEBA
-- ---------------------------------------------------------------------
create temporary table fixture (clave text primary key, id uuid) on commit drop;

/* `fuente_plano` lo exige `verde_exige_plano` (08 §3) para toda unidad
   'verde'. Sin él la preparación revienta antes de la primera prueba.
   'PRUEBA plano' es una ficha de juguete, como los montos: no nombra ningún
   plano real y no persiste. */
insert into unidades (codigo_unidad, tipo, estado_comercial, estado_dato, fuente_plano)
values ('PRUEBA-U1', 'puesto', 'disponible', 'verde', 'PRUEBA plano'),
       ('PRUEBA-U2', 'puesto', 'disponible', 'verde', 'PRUEBA plano');

insert into personas (nombre_completo, telefono_e164)
values ('PRUEBA Ana',  '+51900000001'),
       ('PRUEBA Luis', '+51900000002');

insert into fixture (clave, id)
            select 'u1',   id from unidades where codigo_unidad = 'PRUEBA-U1'
  union all select 'u2',   id from unidades where codigo_unidad = 'PRUEBA-U2'
  union all select 'ana',  id from personas where nombre_completo = 'PRUEBA Ana'
  union all select 'luis', id from personas where nombre_completo = 'PRUEBA Luis';

/* Perfiles REALES del proyecto, para lo que no se puede falsear.
   R2 y R3 necesitan un usuario de rol `direccion` de verdad: no se puede
   inventar uno porque `perfiles.id` referencia `auth.users`. Si no
   existen, esas pruebas salen OMITIDA. Nunca se dan por pasadas: R2 es el
   Acta 03-O02, y darla por buena sin verla sería justo el hueco rellenado
   que el CRM viene a impedir. */
insert into fixture (clave, id)
select 'comercial', id from perfiles where rol = 'comercial' and activo limit 1;
insert into fixture (clave, id)
select 'direccion', id from perfiles where rol = 'direccion' and activo limit 1;
insert into fixture (clave, id)
select 'cualquiera', id from perfiles limit 1;


-- =====================================================================
-- R9 · TODO CAMBIO DE ESTADO SE REGISTRA, CON ACTOR Y FECHA
-- Va primero porque el alta de la oportunidad de prueba ya es su primer
-- caso: si el disparador faltara, lo sabríamos antes que nada.
-- =====================================================================

-- R9a · el INSERT de una oportunidad escribe su historial solo
do $$
declare v_op uuid; v_filas int;
begin
  insert into oportunidades (persona_id, unidad_asignada_id)
  select (select id from fixture where clave = 'ana'),
         (select id from fixture where clave = 'u1')
  returning id into v_op;

  insert into fixture values ('op_ana', v_op);

  select count(*) into v_filas from estado_historial
   where oportunidad_id = v_op
     and de_estado is null
     and a_estado = '01_prospecto_captado';

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R9a',
   'Insertar una oportunidad escribe estado_historial sin que nadie la escriba',
   '1 fila con de_estado NULL y a_estado 01_prospecto_captado',
   v_filas || ' fila(s)',
   case when v_filas = 1 then '✅ PASA' else '🔴 FALLA' end);
end $$;


-- =====================================================================
-- R1 · UNA UNIDAD, UNA ASIGNACIÓN ACTIVA
-- El peor riesgo del proyecto. Tres índices únicos lo sostienen, uno por
-- cada sitio donde una unidad queda comprometida.
-- =====================================================================

-- R1a · dos oportunidades activas sobre la misma unidad
do $$
declare v_fallo boolean := false; v_msg text := 'se insertó la segunda asignación';
begin
  begin
    insert into oportunidades (persona_id, unidad_asignada_id)
    values ((select id from fixture where clave = 'luis'),
            (select id from fixture where clave = 'u1'));
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R1a',
   'Asignar la misma unidad a dos oportunidades activas',
   '❌ ERROR del índice único unidad_una_sola_asignacion_activa',
   v_msg,
   pg_temp.veredicto_error(v_fallo, v_msg, 'unidad_una_sola_asignacion_activa'));
end $$;

-- R1b · dos separaciones vivas sobre la misma unidad
-- (el índice existe desde 01-schema.sql; 05-pruebas-reglas.sql no lo probaba)
do $$
declare v_fallo boolean := false; v_msg text := 'se insertó la segunda separación';
begin
  -- La primera es legítima. Sin fecha de depósito, para no tropezar
  -- todavía con el parámetro de plazo: eso es la prueba R4a.
  insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda)
  values ((select id from fixture where clave = 'op_ana'),
          (select id from fixture where clave = 'ana'),
          (select id from fixture where clave = 'u1'),
          0, 'PEN');

  begin
    insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda)
    values ((select id from fixture where clave = 'op_ana'),
            (select id from fixture where clave = 'luis'),
            (select id from fixture where clave = 'u1'),
            0, 'PEN');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R1b',
   'Dos separaciones vivas sobre la misma unidad',
   '❌ ERROR del índice único unidad_una_separacion_viva',
   v_msg,
   pg_temp.veredicto_error(v_fallo, v_msg, 'unidad_una_separacion_viva'));
end $$;

-- R1c · dos contratos vivos sobre la misma unidad
do $$
declare v_fallo boolean := false; v_msg text := 'se insertó el segundo contrato';
begin
  insert into contratos (persona_id, unidad_id, precio_total, precio_moneda)
  values ((select id from fixture where clave = 'ana'),
          (select id from fixture where clave = 'u1'), 0, 'PEN');

  begin
    insert into contratos (persona_id, unidad_id, precio_total, precio_moneda)
    values ((select id from fixture where clave = 'luis'),
            (select id from fixture where clave = 'u1'), 0, 'PEN');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R1c',
   'Dos contratos vivos sobre la misma unidad',
   '❌ ERROR del índice único unidad_un_contrato_vivo',
   v_msg,
   pg_temp.veredicto_error(v_fallo, v_msg, 'unidad_un_contrato_vivo'));
end $$;


-- =====================================================================
-- R5 · SIN LAS 4 RESPUESTAS NO HAY ESTADO 06
-- =====================================================================

-- R5a · a 06_calificado con las cuatro vacías
do $$
declare v_fallo boolean := false; v_msg text := 'llegó a 06_calificado sin cualificar';
begin
  begin
    update oportunidades set estado = '06_calificado'
     where id = (select id from fixture where clave = 'op_ana');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R5a',
   'Pasar a 06_calificado sin ninguna de las 4 respuestas',
   '❌ ERROR de la restricción calificado_requiere_las_4_respuestas',
   v_msg,
   pg_temp.veredicto_error(v_fallo, v_msg, 'calificado_requiere_las_4_respuestas'));
end $$;

-- R5b · con TRES de las cuatro, tampoco. Es la prueba que distingue
-- «exige las cuatro» de «exige alguna».
do $$
declare v_fallo boolean := false; v_msg text := 'pasó con solo 3 respuestas';
begin
  begin
    update oportunidades set
      cal_operar_o_invertir = 'operar',
      cal_compro_antes      = false,
      cal_forma_pago        = 'contado',
      cal_decide_solo       = null,            -- la que falta
      estado                = '06_calificado'
     where id = (select id from fixture where clave = 'op_ana');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R5b',
   'Pasar a 06_calificado con 3 de las 4 respuestas',
   '❌ ERROR de la restricción calificado_requiere_las_4_respuestas',
   v_msg,
   pg_temp.veredicto_error(v_fallo, v_msg, 'calificado_requiere_las_4_respuestas'));
end $$;

-- R5c · con las cuatro, sí pasa. Una regla que no deja pasar nunca nada
-- no es una regla, es un muro.
do $$
declare v_estado text; v_msg text;
begin
  begin
    update oportunidades set
      cal_operar_o_invertir = 'operar',
      cal_compro_antes      = false,
      cal_forma_pago        = 'contado',
      cal_decide_solo       = true,
      estado                = '06_calificado'
     where id = (select id from fixture where clave = 'op_ana');

    select estado into v_estado from oportunidades
     where id = (select id from fixture where clave = 'op_ana');
    v_msg := 'estado = ' || v_estado;
  exception when others then
    v_estado := null; v_msg := sqlerrm;
  end;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R5c',
   'Pasar a 06_calificado con las 4 respuestas',
   '✅ se guarda, estado = 06_calificado',
   v_msg,
   case when v_estado = '06_calificado' then '✅ PASA' else '🔴 FALLA' end);
end $$;

-- R5d · la exigencia vale del 06 EN ADELANTE, no solo en el 06.
-- La restricción dice `estado < '06_calificado' or (las 4 no son nulas)`.
do $$
declare v_fallo boolean := false; v_msg text := 'llegó a 07_contrato con una respuesta borrada';
begin
  begin
    update oportunidades set cal_decide_solo = null, estado = '07_contrato'
     where id = (select id from fixture where clave = 'op_ana');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R5d',
   'Pasar a 07_contrato borrando una de las 4 respuestas',
   '❌ ERROR: la exigencia vale del 06 en adelante, no solo en el 06',
   v_msg,
   pg_temp.veredicto_error(v_fallo, v_msg, 'calificado_requiere_las_4_respuestas'));
end $$;


-- =====================================================================
-- R9 (continuación) · el historial distingue qué es un cambio de estado
-- =====================================================================

-- R9b · el UPDATE de estado escribió su fila, con de_estado y a_estado
do $$
declare v_filas int;
begin
  select count(*) into v_filas from estado_historial
   where oportunidad_id = (select id from fixture where clave = 'op_ana')
     and de_estado = '01_prospecto_captado'
     and a_estado  = '06_calificado';

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R9b',
   'Cambiar el estado escribe su fila con de_estado y a_estado',
   '1 fila 01_prospecto_captado → 06_calificado',
   v_filas || ' fila(s)',
   case when v_filas = 1 then '✅ PASA' else '🔴 FALLA' end);
end $$;

-- R9c · un UPDATE que NO toca el estado no debe ensuciar el historial.
-- Sin esta prueba, un disparador que escribiera en CADA update también
-- pasaría R9a y R9b, y el historial dejaría de servir como evidencia.
do $$
declare v_antes int; v_despues int;
begin
  select count(*) into v_antes from estado_historial
   where oportunidad_id = (select id from fixture where clave = 'op_ana');

  update oportunidades set notas = 'PRUEBA: esto no es un cambio de estado'
   where id = (select id from fixture where clave = 'op_ana');

  select count(*) into v_despues from estado_historial
   where oportunidad_id = (select id from fixture where clave = 'op_ana');

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R9c',
   'Un UPDATE que no toca el estado NO escribe historial',
   'el conteo no cambia (' || v_antes || ')',
   'antes ' || v_antes || ', después ' || v_despues,
   case when v_antes = v_despues then '✅ PASA' else '🔴 FALLA' end);
end $$;


-- =====================================================================
-- R4 · LOS DOS RELOJES SON DOS CAMPOS. NUNCA UNO DERIVADO DEL OTRO.
-- =====================================================================

-- R4a · sin el parámetro cargado, la base NO deja registrar el depósito.
-- Hoy `plazo_devolucion_separacion_dias` está en 🔴 y sin valor_entero, así
-- que esta prueba corre tal cual. Si alguien ya lo cargó, sale OMITIDA: no
-- se vacía un parámetro de la fuente de verdad para forzar un error.
do $$
declare v_dias int; v_fallo boolean := false; v_msg text := 'aceptó el depósito sin plazo cargado';
begin
  select valor_entero into v_dias from parametros
   where id = 'plazo_devolucion_separacion_dias';

  if v_dias is not null then
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('R4a',
     'Registrar un depósito efectivo sin el plazo cargado en parametros',
     '❌ ERROR nombrando plazo_devolucion_separacion_dias',
     'el parámetro ya tiene valor (' || v_dias || '): no se puede provocar el caso',
     '🟡 OMITIDA');
  else
    begin
      insert into separaciones (oportunidad_id, persona_id, unidad_id, monto,
                                monto_moneda, fecha_deposito_efectivo)
      values ((select id from fixture where clave = 'op_ana'),
              (select id from fixture where clave = 'ana'),
              (select id from fixture where clave = 'u2'),
              0, 'PEN', current_date);
    exception when others then
      v_fallo := true; v_msg := sqlerrm;
    end;

    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('R4a',
     'Registrar un depósito efectivo sin el plazo cargado en parametros',
     '❌ ERROR nombrando plazo_devolucion_separacion_dias',
     v_msg,
     pg_temp.veredicto_error(v_fallo, v_msg, 'plazo_devolucion_separacion_dias'));
  end if;
end $$;

-- R4b · MOVER fecha_deposito_efectivo NO ALTERA fecha_limite_precio.
-- ⚠️ Necesita UN plazo para poder hacer la resta. Usa uno de juguete (3) y
-- devuelve el parámetro a como estaba pase lo que pase — ni aunque alguien
-- se saltara el `rollback` del final quedaría tocado.
do $$
declare
  v_plazo_falso constant int := 3;   -- ficha de juguete. NO es el plazo del negocio.
  v_dias_antes  int;
  -- `text` y no `semaforo` a propósito: así el archivo lo puede parsear un
  -- validador fuera de la base, que sin catálogo no sabe que ese enum es
  -- escalar. El valor se devuelve con un cast explícito, más abajo.
  v_sem_antes   text;
  v_sep         uuid;
  v_precio_1    date;  v_precio_2 date;
  v_devol_1     date;  v_devol_2  date;
  v_dep_2       date;
begin
  select valor_entero, estado_semaforo into v_dias_antes, v_sem_antes
    from parametros where id = 'plazo_devolucion_separacion_dias';

  update parametros set valor_entero = v_plazo_falso
   where id = 'plazo_devolucion_separacion_dias';

  -- Alta con los DOS relojes puestos a mano.
  insert into separaciones (oportunidad_id, persona_id, unidad_id, monto, monto_moneda,
                            fecha_deposito_efectivo, fecha_limite_precio)
  values ((select id from fixture where clave = 'op_ana'),
          (select id from fixture where clave = 'ana'),
          (select id from fixture where clave = 'u2'),
          0, 'PEN', current_date, current_date + 12)
  returning id, fecha_limite_precio, fecha_limite_devolucion
       into v_sep, v_precio_1, v_devol_1;

  insert into fixture values ('sep_u2', v_sep);

  -- Se mueve el reloj 1. El reloj 2 no debe enterarse.
  update separaciones set fecha_deposito_efectivo = current_date + 5
   where id = v_sep
  returning fecha_deposito_efectivo, fecha_limite_precio, fecha_limite_devolucion
       into v_dep_2, v_precio_2, v_devol_2;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R4b',
   'Mover fecha_deposito_efectivo NO altera fecha_limite_precio',
   'precio sigue en ' || v_precio_1 || ' · devolución pasa a ' || (v_dep_2 + v_plazo_falso),
   'precio: ' || v_precio_1 || ' → ' || v_precio_2
     || ' · devolución: ' || v_devol_1 || ' → ' || v_devol_2,
   case when v_precio_2 = v_precio_1 and v_devol_2 = v_dep_2 + v_plazo_falso
        then '✅ PASA' else '🔴 FALLA' end);

  update parametros set valor_entero = v_dias_antes, estado_semaforo = v_sem_antes::semaforo
   where id = 'plazo_devolucion_separacion_dias';

exception when others then
  -- El rollback del subbloque ya deshizo el parámetro; se reescribe por si
  -- acaso y se anota el fallo en vez de abortar el resto del archivo.
  update parametros set valor_entero = v_dias_antes, estado_semaforo = v_sem_antes::semaforo
   where id = 'plazo_devolucion_separacion_dias';
  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R4b',
   'Mover fecha_deposito_efectivo NO altera fecha_limite_precio',
   'los dos relojes se mueven por separado',
   sqlerrm, '🔴 FALLA');
end $$;

-- R4c · la simétrica: mover fecha_limite_precio NO altera el reloj 1.
do $$
declare v_sep uuid; v_devol_1 date; v_devol_2 date; v_precio_2 date;
begin
  select id into v_sep from fixture where clave = 'sep_u2';

  if v_sep is null then
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('R4c',
     'Mover fecha_limite_precio NO altera fecha_limite_devolucion',
     'el reloj 1 no se mueve',
     'no se pudo crear la separación de prueba en R4b',
     '🟡 OMITIDA');
    return;
  end if;

  select fecha_limite_devolucion into v_devol_1 from separaciones where id = v_sep;

  update separaciones set fecha_limite_precio = current_date + 30
   where id = v_sep
  returning fecha_limite_devolucion, fecha_limite_precio into v_devol_2, v_precio_2;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R4c',
   'Mover fecha_limite_precio NO altera fecha_limite_devolucion',
   'devolución sigue en ' || coalesce(v_devol_1::text, 'null'),
   'devolución: ' || coalesce(v_devol_1::text, 'null') || ' → ' || coalesce(v_devol_2::text, 'null')
     || ' · precio ahora ' || v_precio_2,
   case when v_devol_1 is not distinct from v_devol_2 then '✅ PASA' else '🔴 FALLA' end);
end $$;


-- =====================================================================
-- R3 · SIN VERIFICACIÓN NO HAY CONSTANCIA NI RECIBO
-- =====================================================================

-- R3a · separación sin verificar → false
do $$
declare v_puede boolean; v_sep uuid;
begin
  select id into v_sep from fixture where clave = 'sep_u2';

  if v_sep is null then
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('R3a', 'puede_emitir_constancia() sobre una separación sin verificar',
     'false', 'no hay separación de prueba (ver R4b)', '🟡 OMITIDA');
    return;
  end if;

  select puede_emitir_constancia(v_sep) into v_puede;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R3a',
   'puede_emitir_constancia() sobre una separación sin verificar',
   'false',
   coalesce(v_puede::text, 'null'),
   case when v_puede is false then '✅ PASA' else '🔴 FALLA' end);
end $$;


-- =====================================================================
-- R2 · SOLO DIRECCIÓN VERIFICA UNA SEPARACIÓN
--
-- El disparador lee el rol de `perfiles` usando `auth.uid()`. En el SQL
-- Editor no hay sesión: `auth.uid()` es NULL y el disparador bloquea a
-- todo el mundo. Eso prueba que SALTA, pero no que DISTINGA por rol. Para
-- probar lo segundo hay que suplantar a un usuario poniendo
-- `request.jwt.claims`, que es lo que hacen R2b y R2c.
-- =====================================================================

-- R2a · sin sesión (nadie) → excepción
do $$
declare v_fallo boolean := false; v_msg text := 'verificó una separación sin sesión';
begin
  begin
    update separaciones set verificada_el = now(), estado = 'verificada'
     where id = (select id from fixture where clave = 'sep_u2');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R2a',
   'Verificar una separación sin sesión (auth.uid() nulo)',
   '❌ ERROR citando el Acta 03-O02',
   v_msg,
   pg_temp.veredicto_error(v_fallo, v_msg, 'Acta 03-O02'));
end $$;

-- R2b · suplantando a un usuario de rol `comercial` → excepción
do $$
declare v_uid uuid; v_fallo boolean := false; v_msg text := 'un comercial verificó la separación';
begin
  select id into v_uid from fixture where clave = 'comercial';

  if v_uid is null then
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('R2b',
     'Un usuario de rol comercial marca una separación como verificada',
     '❌ ERROR citando el Acta 03-O02',
     'no hay ningún perfil activo con rol comercial en este proyecto',
     '🟡 OMITIDA');
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);

  begin
    update separaciones set verificada_el = now(), estado = 'verificada'
     where id = (select id from fixture where clave = 'sep_u2');
  exception when others then
    v_fallo := true; v_msg := sqlerrm;
  end;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R2b',
   'Un usuario de rol comercial marca una separación como verificada',
   '❌ ERROR citando el Acta 03-O02',
   v_msg,
   pg_temp.veredicto_error(v_fallo, v_msg, 'Acta 03-O02'));

exception when others then
  -- Nunca se deja la suplantación puesta: las pruebas de abajo correrían
  -- como otra persona y dirían cualquier cosa.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R2b', 'Un usuario de rol comercial marca una separación como verificada',
   '❌ ERROR citando el Acta 03-O02', sqlerrm, '🔴 FALLA');
end $$;

-- R2c · suplantando a DIRECCIÓN → sí verifica. Y el disparador escribe
-- `verificada_por` él mismo, sin fiarse de lo que mande el cliente.
do $$
declare v_uid uuid; v_por uuid; v_estado text; v_msg text;
begin
  select id into v_uid from fixture where clave = 'direccion';

  if v_uid is null then
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('R2c',
     'Un usuario de rol direccion marca la separación como verificada',
     '✅ se guarda y verificada_por queda con su id',
     'no hay ningún perfil activo con rol direccion en este proyecto',
     '🟡 OMITIDA');
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);

  begin
    update separaciones set verificada_el = now(), estado = 'verificada'
     where id = (select id from fixture where clave = 'sep_u2')
    returning verificada_por, estado into v_por, v_estado;
    v_msg := 'estado = ' || coalesce(v_estado, 'null')
             || ', verificada_por = ' || coalesce(v_por::text, 'null');
  exception when others then
    v_estado := null; v_msg := sqlerrm;
  end;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R2c',
   'Un usuario de rol direccion marca la separación como verificada',
   '✅ estado = verificada y verificada_por = su propio id',
   v_msg,
   case when v_estado = 'verificada' and v_por = v_uid then '✅ PASA' else '🔴 FALLA' end);

exception when others then
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R2c', 'Un usuario de rol direccion marca la separación como verificada',
   '✅ estado = verificada y verificada_por = su propio id', sqlerrm, '🔴 FALLA');
end $$;

-- R3b · verificada pero SIN documento del cliente → sigue siendo false.
-- La función exige las TRES cosas; esta prueba impide que se relaje a una.
do $$
declare v_puede boolean; v_verificada timestamptz; v_sep uuid;
begin
  select id into v_sep from fixture where clave = 'sep_u2';
  select verificada_el into v_verificada from separaciones where id = v_sep;

  if v_verificada is null then
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('R3b',
     'Separación verificada pero con doc_cliente_registrado = false',
     'false',
     'la separación no llegó a verificarse (ver R2c)',
     '🟡 OMITIDA');
    return;
  end if;

  select puede_emitir_constancia(v_sep) into v_puede;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R3b',
   'Separación verificada pero con doc_cliente_registrado = false',
   'false: la constancia exige las tres condiciones, no solo la verificación',
   coalesce(v_puede::text, 'null'),
   case when v_puede is false then '✅ PASA' else '🔴 FALLA' end);
end $$;

-- R3c · verificada Y con documento → ahora sí, true.
do $$
declare v_puede boolean; v_verificada timestamptz; v_sep uuid;
begin
  select id into v_sep from fixture where clave = 'sep_u2';
  select verificada_el into v_verificada from separaciones where id = v_sep;

  if v_verificada is null then
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('R3c',
     'Separación verificada y con doc_cliente_registrado = true',
     'true',
     'la separación no llegó a verificarse (ver R2c)',
     '🟡 OMITIDA');
    return;
  end if;

  update separaciones set doc_cliente_registrado = true where id = v_sep;
  select puede_emitir_constancia(v_sep) into v_puede;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R3c',
   'Separación verificada y con doc_cliente_registrado = true',
   'true: es el único caso en que se puede emitir',
   coalesce(v_puede::text, 'null'),
   case when v_puede is true then '✅ PASA' else '🔴 FALLA' end);
end $$;


-- =====================================================================
-- R6 · TODA OPORTUNIDAD ACTIVA DEBE TENER UNA TAREA ABIERTA
-- =====================================================================

-- R6a · sin tarea → sale en la lista de fuga
do $$
declare v_sale boolean;
begin
  select exists (select 1 from v_sin_siguiente_paso
                  where id = (select id from fixture where clave = 'op_ana'))
    into v_sale;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R6a',
   'v_sin_siguiente_paso detecta una oportunidad activa sin tarea abierta',
   'la oportunidad de prueba aparece en la vista',
   case when v_sale then 'aparece' else 'NO aparece' end,
   case when v_sale then '✅ PASA' else '🔴 FALLA' end);
end $$;

-- R6b · al abrirle una tarea, desaparece. Una vista que enseñara siempre
-- lo mismo pasaría R6a y no serviría para nada.
do $$
declare v_responsable uuid; v_sale boolean;
begin
  select id into v_responsable from fixture where clave = 'cualquiera';

  if v_responsable is null then
    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('R6b',
     'Con una tarea abierta, la oportunidad sale de v_sin_siguiente_paso',
     'deja de aparecer',
     'no hay ningún perfil en la base y tareas.responsable_id es obligatorio',
     '🟡 OMITIDA');
    return;
  end if;

  insert into tareas (titulo, oportunidad_id, responsable_id, vence_el)
  values ('PRUEBA: siguiente paso',
          (select id from fixture where clave = 'op_ana'),
          v_responsable, now() + interval '1 day');

  select exists (select 1 from v_sin_siguiente_paso
                  where id = (select id from fixture where clave = 'op_ana'))
    into v_sale;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R6b',
   'Con una tarea abierta, la oportunidad sale de v_sin_siguiente_paso',
   'deja de aparecer en la vista',
   case when v_sale then 'sigue apareciendo' else 'ya no aparece' end,
   case when v_sale then '🔴 FALLA' else '✅ PASA' end);
end $$;


-- =====================================================================
-- R7 · TODO MONTO LLEVA SU MONEDA. NINGUNA VISTA SUMA DOS DISTINTAS.
-- =====================================================================

-- R7a · estructural: toda vista con columna de dinero expone también una
-- columna de moneda. Se excluyen tres cosas que son numéricas y no son
-- dinero; si mañana aparece una cuarta, esta prueba la delata y hay que
-- decidir a mano si es dinero o no.
do $$
declare v_malas text;
begin
  select string_agg(distinct c.table_name || '.' || c.column_name, ', ')
    into v_malas
    from information_schema.columns c
    join information_schema.views   v
      on v.table_schema = c.table_schema and v.table_name = c.table_name
   where c.table_schema = 'public'
     and c.data_type    = 'numeric'
     and c.column_name not like '%\_pct'     -- porcentajes de v_conversion
     and c.column_name <> 'area_m2'          -- metros cuadrados, no soles
     and c.column_name <> 'pen_por_usd'      -- el propio tipo de cambio
     and not exists (
       select 1 from information_schema.columns m
        where m.table_schema = c.table_schema
          and m.table_name   = c.table_name
          and (m.udt_name = 'moneda' or m.column_name like '%moneda%'));

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R7a',
   'Toda vista con columna de dinero expone también su columna de moneda',
   'ninguna vista incumple',
   coalesce(v_malas, 'ninguna'),
   case when v_malas is null then '✅ PASA' else '🔴 FALLA' end);
end $$;

-- R7b · 🔴 EL AGUJERO CONOCIDO, PUESTO EN NÚMEROS.
--
-- `v_cobranza` calcula `pagado` como sum(pagos.monto) SIN mirar
-- `pagos.monto_moneda`, y `saldo` como cuota.monto − ese sum. Si una cuota
-- recibe pagos en dos monedas, el saldo es una resta entre monedas: un
-- número falso.
--
-- Fichas de juguete: cuota de 10 PEN, un pago de 3 PEN y otro de 7 USD. Lo
-- que de verdad se debe son 7 PEN. La vista va a decir 0 — es decir, va a
-- decir que está saldada. Ninguna de estas cifras es un dato del negocio.
--
-- El CRM evita CREAR este dato por el único lado que controla
-- (`registrarPago` rechaza un pago en otra moneda), pero la base lo permite
-- y esta prueba lo demuestra. Arreglarlo es una migración de la vista:
-- decisión pendiente, no un descuido. Cuando se haga, esta prueba pasa
-- sola a ✅ y hay que borrar este párrafo.
do $$
declare
  v_contrato uuid; v_cuota uuid;
  v_pagado numeric; v_saldo numeric;
  v_correcto constant numeric := 7;
begin
  insert into contratos (persona_id, unidad_id, precio_total, precio_moneda)
  values ((select id from fixture where clave = 'ana'),
          (select id from fixture where clave = 'u2'), 0, 'PEN')
  returning id into v_contrato;

  insert into cuotas (contrato_id, numero, fecha_vencimiento, monto, monto_moneda)
  values (v_contrato, 1, current_date, 10, 'PEN')
  returning id into v_cuota;

  insert into pagos (cuota_id, persona_id, monto, monto_moneda, fecha_pago) values
    (v_cuota, (select id from fixture where clave = 'ana'), 3, 'PEN', current_date),
    (v_cuota, (select id from fixture where clave = 'ana'), 7, 'USD', current_date);

  select pagado, saldo into v_pagado, v_saldo
    from v_cobranza where contrato_id = v_contrato and numero = 1;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('R7b',
   'v_cobranza con pagos en dos monedas sobre la misma cuota',
   'saldo = ' || v_correcto || ' PEN (7 USD no son 7 soles y no deberían restarse)',
   'pagado = ' || coalesce(v_pagado::text, 'null')
     || ', saldo = ' || coalesce(v_saldo::text, 'null'),
   case when v_saldo = v_correcto then '✅ PASA' else '🔴 FALLA CONOCIDA' end);
end $$;


-- =====================================================================
-- R8 · NADA SE BORRA. Las cinco tablas protegidas, una por una.
-- 05-pruebas-reglas.sql solo probaba `personas`: un disparador que faltara
-- en las otras cuatro habría pasado desapercibido.
-- =====================================================================
do $$
declare v_tabla text; v_id uuid; v_fallo boolean; v_msg text;
begin
  foreach v_tabla in array array['personas','oportunidades','separaciones','contratos','pagos']
  loop
    execute format('select id from %I limit 1', v_tabla) into v_id;

    if v_id is null then
      insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
      ('R8 · ' || v_tabla, 'delete sobre ' || v_tabla,
       '❌ ERROR "Nada se borra en este sistema"',
       'la tabla está vacía: no hay nada que intentar borrar', '🟡 OMITIDA');
      continue;
    end if;

    v_fallo := false;
    v_msg   := 'la fila se borró';
    begin
      execute format('delete from %I where id = $1', v_tabla) using v_id;
    exception when others then
      v_fallo := true; v_msg := sqlerrm;
    end;

    insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
    ('R8 · ' || v_tabla, 'delete sobre ' || v_tabla,
     '❌ ERROR "Nada se borra en este sistema"',
     v_msg,
     pg_temp.veredicto_error(v_fallo, v_msg, 'Nada se borra'));
  end loop;
end $$;


-- =====================================================================
-- RLS · TODAS LAS TABLAS DE public CON rowsecurity = true
-- Una tabla sin RLS y con la clave `anon` publicada es una base de datos
-- pública. Esta prueba no cuenta: NOMBRA a las que faltan, porque un «2»
-- no dice qué hay que arreglar.
-- =====================================================================
do $$
declare v_sin text; v_total int;
begin
  select count(*) into v_total from pg_tables where schemaname = 'public';
  select string_agg(tablename, ', ' order by tablename) into v_sin
    from pg_tables where schemaname = 'public' and not rowsecurity;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('RLS',
   'Todas las tablas de public tienen rowsecurity = true',
   '0 tablas sin RLS (de ' || v_total || ')',
   coalesce('sin RLS: ' || v_sin, 'ninguna sin RLS'),
   case when v_sin is null then '✅ PASA' else '🔴 FALLA' end);
end $$;

-- RLS-b · `force row level security`, para que la regla valga también para
-- el dueño de la tabla. 02-rls.sql lo aplica a las 15 tablas del CRM.
do $$
declare v_sin text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_sin
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relrowsecurity and not c.relforcerowsecurity;

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('RLS-b',
   'Las tablas con RLS lo tienen además en modo FORCE',
   'ninguna tabla con RLS sin FORCE',
   coalesce('sin FORCE: ' || v_sin, 'ninguna'),
   case when v_sin is null then '✅ PASA' else '🟡 REVISAR' end);
end $$;

-- RLS-c · informativo: una tabla con RLS y CERO políticas no la lee nadie.
-- No es un agujero —es lo contrario—, pero casi siempre es un descuido.
do $$
declare v_mudas text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_mudas
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.relname);

  insert into resultado (regla, prueba, esperado, obtenido, veredicto) values
  ('RLS-c',
   'Tablas con RLS activado y ninguna política (no las lee nadie)',
   'ninguna, o solo las que se quieren cerradas a propósito',
   coalesce(v_mudas, 'ninguna'),
   case when v_mudas is null then '✅ PASA' else '🟡 REVISAR' end);
end $$;


-- =====================================================================
-- EL CUADRO FINAL
--
-- Un solo resultado, con el resumen como última fila: el SQL Editor de
-- Supabase enseña únicamente el último conjunto de resultados, así que
-- tres SELECT seguidos harían desaparecer los dos primeros.
-- =====================================================================
with resumen as (
  select 9999 as n,
         'RESUMEN' as regla,
         count(*) filter (where veredicto = '✅ PASA')           || ' pasan · ' ||
         count(*) filter (where veredicto = '🔴 FALLA')          || ' fallan · ' ||
         count(*) filter (where veredicto = '🔴 FALLA CONOCIDA') || ' conocidas · ' ||
         count(*) filter (where veredicto = '🟡 OMITIDA')        || ' omitidas · ' ||
         count(*) filter (where veredicto = '🟡 REVISAR')        || ' a revisar'
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
order by n;


-- =====================================================================
-- ⚠️ NO BORRES ESTA LÍNEA
-- Deshace TODO lo anterior: personas, unidades, oportunidades,
-- separaciones, contratos, cuotas, pagos y tareas de prueba, y el plazo
-- de juguete. Sin esto, el archivo ensucia la base en vez de comprobarla.
-- =====================================================================
rollback;
