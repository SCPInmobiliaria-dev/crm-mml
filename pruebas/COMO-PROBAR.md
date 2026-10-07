# Cómo ejecutar las pruebas de las reglas duras

**Estado:** 🟡 El archivo está escrito y su sintaxis validada; el resultado
contra un proyecto real todavía no está anotado. Ver §7.
**Qué se prueba:** `pruebas/reglas.sql` (y, desde 13, `pruebas/reglas-13.sql`: ver §9)
**Cuánto tarda:** menos de un minuto.

---

## 1. Para qué sirve esto

`07-crm/CLAUDE.md` §4 dice que las nueve reglas de negocio **se implementan como
restricciones de base de datos, no como validaciones de formulario** — porque un
formulario se esquiva y una restricción no. Este archivo comprueba que eso es
verdad: intenta romper cada regla a propósito y anota si la base lo impidió.

Es la prueba de que el esquema quedó bien instalado. Si una de estas pruebas
falla, el CRM *parece* funcionar y en realidad no está protegiendo nada.

**Lo que estas pruebas NO son:** la batería de RLS. Aquí solo se comprueba que
todas las tablas tienen `rowsecurity = true`. Que las *políticas* dejen ver a
cada rol exactamente lo que debe es otra cosa, y vive en
`01-documentacion/05-SEGURIDAD-BACKUPS-Y-LEY-29733.md` §4. Una tabla puede tener
RLS activado y una política `using (true)` que lo enseñe todo: esta prueba
diría ✅ y la base seguiría abierta. **Hay que correr las dos.**

---

## 2. Antes de empezar

1. Haber ejecutado, en este orden, los archivos de `02-codigo/sql/`:
   `01-schema` → `02-rls` → `03-vistas` → `04-seed-parametros` → `06` → `07` →
   `08` → `09`.
   Sin `04-seed-parametros` falla ya la preparación: `separaciones.plazo_parametro`
   referencia una fila de `parametros` que ese archivo siembra.

2. **No hace falta un proyecto vacío.** Todo el archivo corre dentro de un
   `begin … rollback`, así que al terminar la base queda exactamente como
   estaba: ni una persona de prueba, ni una unidad, ni un parámetro tocado.

   Aun así, la primera vez córrelo en un proyecto de prueba. No por lo que hace
   —no deja rastro—, sino para que veas el resultado sin la presión de estar
   apuntando a la base buena.

---

## 3. Ejecutarlo en el SQL Editor de Supabase

1. Abre tu proyecto en [supabase.com](https://supabase.com) → **SQL Editor** →
   **New query**.
2. Abre `pruebas/reglas.sql`, cópialo **entero** y pégalo.
3. Pulsa **Run** (o `Ctrl`+`Enter`).

Se ejecuta de una sola vez. No hay que ir bloque por bloque: los errores que
*deben* ocurrir se capturan por dentro y se anotan, en lugar de reventar el
script.

### Tres cosas que conviene saber del editor

- **Solo enseña el último resultado.** Por eso el archivo termina en un único
  `SELECT` que trae todas las filas y el resumen al final. Si partieras el
  archivo, perderías los cuadros intermedios.
- **Puede avisar de que ya hay una transacción abierta** al llegar al `begin;`.
  Es un aviso, no un error: el editor ya envolvía la consulta. El `rollback`
  del final sigue deshaciendo todo igual.
- **⚠️ No borres el `rollback` de la última línea.** Es lo único que impide que
  este archivo deje basura en la base — y, peor, que deje `parametros` con el
  plazo de juguete que usa la prueba R4b. (Aun así, R4b devuelve el parámetro a
  su valor original por su cuenta, incluso si algo falla a mitad: dos redes, no
  una.)

---

## 4. Cómo se lee el resultado

Sale un cuadro con una fila por prueba y esta última columna:

| Veredicto | Qué significa | Qué hacer |
|---|---|---|
| ✅ PASA | La regla se comporta como debe | Nada |
| 🔴 FALLA | La regla **no** protege lo que dice proteger | Arreglar antes de cargar datos reales |
| 🔴 FALLA CONOCIDA | Defecto ya documentado, con decisión pendiente | Ver §6 |
| 🟡 OMITIDA | No se pudo probar, y dice por qué | Ver §5 |
| 🟡 REVISAR | Hallazgo que no es un agujero, pero conviene mirar | Leer la fila |

La última fila es el **RESUMEN**, con el recuento de cada tipo.

> **Un error esperado es una prueba superada.** Casi todas estas pruebas
> intentan hacer algo prohibido; que la base lo impida es exactamente el
> resultado bueno. Además de que falle, cada prueba comprueba que el mensaje
> sea **el suyo**: una prueba que pasara porque saltó otro error distinto no
> probaría nada, y por eso saldría 🔴.

### Lo que debe salir cuando todo está bien

- **0 filas 🔴 FALLA.**
- **1 fila 🔴 FALLA CONOCIDA** — `R7b`, mientras no se arregle `v_cobranza` (§6).
- Las 🟡 OMITIDA que correspondan a lo que aún no exista en tu proyecto (§5).
- Todo lo demás en ✅.

---

## 5. Si una prueba no da el resultado esperado

### 5.1 Sale 🟡 OMITIDA

No es un fallo: es que faltan datos para poder probarla. La columna
`obtenido` dice cuáles.

| Prueba | Por qué se omite | Cómo hacer que corra |
|---|---|---|
| `R2b` | No hay ningún perfil activo con rol `comercial` | Crea el usuario en **Authentication → Users** y pon `update perfiles set rol='comercial' where id='…'` |
| `R2c`, `R3b`, `R3c` | No hay ningún perfil activo con rol `direccion` | Igual, con `rol='direccion'` (es el de Walter) |
| `R4a` | El parámetro `plazo_devolucion_separacion_dias` **ya tiene valor** | Es buena noticia: significa que se cargó desde 00-fuente-de-verdad. La prueba no vacía un parámetro de la fuente de verdad para forzar un error |
| `R4c` | No se pudo crear la separación de prueba en R4b | Arregla primero R4b |
| `R6b` | La tabla `perfiles` está vacía | Crea al menos un usuario |
| `R8 · …` | Esa tabla está vacía | Normal en un proyecto recién instalado |

**`R2c` es la que más importa.** Sin ella, R2 solo demuestra que el disparador
bloquea a *todo el mundo* — no que distinga a Dirección del resto. Y esa
distinción **es** el Acta 03-O02. Mientras R2c salga OMITIDA, R2 no está
validada: no la des por buena.

### 5.2 Sale 🔴 FALLA

Compara `esperado` con `obtenido` en esa fila y busca aquí:

| Regla | Qué la sostiene | Si falla, revisa |
|---|---|---|
| **R1a** | índice `unidad_una_sola_asignacion_activa` | `01-schema.sql`. Es **la** defensa contra la doble asignación: no cargues datos reales hasta arreglarlo |
| **R1b** | índice `unidad_una_separacion_viva` | Ídem |
| **R1c** | índice `unidad_un_contrato_vivo` | Ídem |
| **R2a/b/c** | disparador `fn_verificacion_solo_direccion` | Que el disparador `t_separacion_verificacion` exista y que el perfil que suplantas tenga el rol que crees |
| **R3a/b/c** | función `puede_emitir_constancia()` | Exige las **tres** cosas: verificada, estado `verificada` y `doc_cliente_registrado`. Si R3b da `true`, alguien relajó la función |
| **R4a** | disparador `fn_calcular_limite_devolucion` | Debe lanzar excepción nombrando el parámetro que falta |
| **R4b/R4c** | que sean **dos campos**, no uno derivado del otro | Si uno mueve al otro, alguien mezcló los relojes. Es un problema legal, no cosmético (R4) |
| **R5a/b/d** | restricción `calificado_requiere_las_4_respuestas` | Que sea `CHECK` en la tabla, no una validación en el formulario |
| **R5c** | la misma restricción, por el lado bueno | Si falla, la restricción es demasiado estricta y bloquea el flujo normal |
| **R6a/b** | vista `v_sin_siguiente_paso` | `03-vistas.sql`. Si R6b falla, la vista no mira `tareas.completada_el` |
| **R7a** | que toda vista con dinero lleve su moneda | `obtenido` nombra la vista y la columna culpables |
| **R8 · …** | disparadores `t_no_delete_*` | Falta el disparador en **esa** tabla. El original solo probaba `personas`; por eso ahora se prueban las cinco |
| **R9a/b** | disparador `fn_registrar_cambio_estado` | Sin él no hay trazabilidad, y el reporte de 7 partes se queda sin su parte 3 |
| **R9c** | que el disparador sea `after update **of estado**` | Si falla, se dispara en cada `UPDATE` y el historial deja de ser evidencia de nada |
| **RLS** | `02-rls.sql` §2 | `obtenido` nombra las tablas sin RLS. **Una tabla sin RLS con la clave `anon` publicada es una base de datos pública.** Arréglalo antes que nada |

### 5.3 Falla la preparación y no sale ningún cuadro

Si el error aparece antes del cuadro de resultados, el problema está en el
montaje, no en una regla:

- `relation "…" does not exist` → falta ejecutar alguno de los archivos de
  `02-codigo/sql/` (§2).
- `violates foreign key constraint "separaciones_plazo_parametro_fkey"` → falta
  `04-seed-parametros.sql`.
- `duplicate key … unidades_codigo_unidad_key` sobre `PRUEBA-U1` → quedó basura
  de una ejecución anterior a la que se le quitó el `rollback`. Bórrala a mano
  y vuelve a poner el `rollback`.

---

## 6. La falla conocida: `R7b`

`v_cobranza` (03-vistas.sql §6) calcula `pagado` como `sum(pagos.monto)` **sin
mirar `pagos.monto_moneda`**, y `saldo` como `cuota.monto − ese sum`. Si una
cuota recibe pagos en dos monedas, el saldo es una resta entre monedas
distintas: un número falso.

La prueba lo pone en números con fichas de juguete: cuota de 10 PEN, un pago de
3 PEN y otro de 7 USD. Lo que de verdad se debe son 7 PEN. **La vista dice 0**,
es decir, dice que la cuota está saldada.

- **El CRM no crea ese dato**: `registrarPago` (`src/lib/cobranza.ts`) rechaza un
  pago cuya moneda no sea la de la cuota, y lo dice con ese motivo.
- **La base sí lo permite**, y esta prueba lo demuestra. Se puede llegar ahí por
  una importación, por el panel de Supabase o por cualquier otro cliente.
- **Arreglarlo es una migración de la vista**, no un parche desde el navegador.
  Queda como decisión pendiente.

Cuando se arregle, `R7b` pasará sola a ✅ y habrá que borrar el párrafo de aviso
que lleva encima en `reglas.sql`.

---

## 7. Anota aquí lo que salga

Este archivo no declara VALIDADO nada que nadie haya visto pasar. Cuando lo
ejecutes, rellena una fila:

| Fecha | Quién | Proyecto | Pasan | Fallan | Conocidas | Omitidas | Notas |
|---|---|---|---|---|---|---|---|
| _(pendiente)_ | | | | | | | |

Si alguna 🔴 FALLA aparece y se arregla, anota también **qué** se arregló: el
siguiente que lea esto necesita saber si el ✅ de hoy es el de siempre o el de
después de una corrección.

---

## 8. Qué queda fuera de estas pruebas

Para que nadie las lea como más de lo que son:

- **Las políticas de RLS.** Se comprueba que RLS está activado, no que cada rol
  vea lo que debe. Eso es `01-documentacion/05-SEGURIDAD-BACKUPS-Y-LEY-29733.md` §4.
- **R7 completo.** Se comprueba que toda vista con dinero lleva su moneda al
  lado (`R7a`) y se demuestra el agujero de `v_cobranza` (`R7b`). No se
  demuestra que *ninguna otra* vista sume monedas: eso, hoy, es lectura del SQL.
- **Lo que hace la interfaz.** Que el CRM no escriba un precio literal, que
  marque los pendientes, que no ofrezca la constancia cuando no toca — nada de
  eso se prueba aquí. Estas pruebas son de la base, que es donde viven las
  reglas.
- **Los plazos reales.** `R4b` usa un plazo de juguete (3 días) solo para
  comprobar que los dos relojes se mueven por separado. El plazo de verdad
  sigue 🔴 en `parametros`, y esta prueba no lo carga ni lo sugiere.

---

## 9. Pruebas de 13 (`pruebas/reglas-13.sql`)

**Estado:** 🟡 **30 de 30 pasan en un ensayo LOCAL** (PGlite, 30/09/2026), con la base
vacía y con una copia simulada de la base viva. Contra el proyecto real de Supabase
**todavía no se ha corrido**: hasta anotarlo en §7 no se declara nada VALIDADO.

**Qué cubre:** lo que pide SPEC §4.8 (secciones 1–8 del archivo: alta sin duplicar,
lotes, fríos, 01→02 con motivo, «no contactar», R5/R7 por el perfil, visitas, RLS del
perfil y de la bandeja, «tomar» gana el primero, R8, `anon` sin EXECUTE, contrato de
`v_cartera`) y un **§9 de humo**: cada RPC que la ficha llama y que 1–8 no tocaban
(aviso de visita, confirmar/realizada, enfriar/reactivar/descartar, temperatura a mano,
asignar, equipo, campaña, documento + storage) se ejecuta al menos una vez. Un cuerpo
plpgsql solo se valida de verdad al correr: una columna mal escrita compila igual.

**En Supabase:** después de aplicar 13, SQL Editor → pegar `reglas-13.sql` entero → Run.
Necesita un perfil activo de cada rol operativo (si falta uno, la fila PRE sale 🟡).
Todo va entre `begin … rollback`. Lo esperado: la fila 9999 dice
`30 pasan · 0 fallan · 0 omitidas`.

### 9.1 Ensayo local, sin tocar la base viva (arnés PGlite)

PGlite es PostgreSQL real compilado a WASM que corre dentro de Node: se levanta en
memoria, se le cargan los SQL del repo y se tira al terminar. Nada sale de la máquina.

- **Dónde está:** en el scratchpad de la sesión que lo armó
  (`…\scratchpad\pglite\`: `harness.mjs`, `contrato.mjs`, `consulta.mjs`). No está
  versionado. 🔵 Propuesta: moverlo a `pruebas/local/` si se va a usar en cada entrega.
- **Cómo se corre:** `npm install @electric-sql/pglite` en esa carpeta, y luego
  `node harness.mjs pruebas` (migraciones + `reglas-13.sql`), `node harness.mjs contrato`
  (contrato frontend ↔ base) o `node harness.mjs todo`. Con `SEMBRAR_VIVO=1` imita la base
  viva antes de 13 (1 persona, su oportunidad `perdida` con historial y un valor de
  `cal_operar_o_invertir` fuera de lista, que debe dejar el CHECK en NOT VALID sin romper).
- **Qué hace, en orden:** stubs de Supabase (roles `anon`/`authenticated`/`service_role`,
  `auth.users` + `auth.uid()`, `storage.buckets`/`storage.objects` con RLS, privilegios por
  defecto de `public`) → 01..12 sin 05 → 4 perfiles de prueba (uno por rol, vía
  `auth.users` y el trigger de alta) → 13 → **13 otra vez**, comparando una huella del
  catálogo (funciones y sus permisos, vistas, columnas, políticas, triggers, CHECKs,
  índices, parámetros, buckets): debe salir «sin cambios» → 14 → `reglas-13.sql` → contrato.
- **El contrato:** lee `src/` y `supabase/functions/`, y para cada `rpc('fn', {…})` /
  `llamarRpc('fn', {…})` comprueba que la función exista con esos nombres de argumento,
  que no falte uno obligatorio y que `authenticated` pueda ejecutarla; para cada
  `.from('x')`, que existan la tabla o vista, las columnas del `select` (también las
  constantes `COLUMNAS_*` y los recursos embebidos, con su FK), las de los filtros y las
  de `insert`/`update`, y que `authenticated` tenga el permiso.

### 9.2 Lo que el ensayo local NO demuestra

- **Superusuario.** En PGlite `postgres` es superusuario; en Supabase no lo es, pero tiene
  BYPASSRLS. Para las funciones SECURITY DEFINER y FORCE RLS el efecto es el mismo; las
  pruebas de RLS cambian a `set local role authenticated`, que sí se comporta igual.
- **Versión.** PGlite trae PostgreSQL 18.3; la base viva, 17.6.
- **Auth y Storage son maquetas.** Se prueban sus políticas en SQL, no GoTrue ni la API de
  Storage (subida real, límite de 10 MB, tipos MIME).
- **Sin PostgREST.** El contrato se verifica contra el catálogo, no con llamadas HTTP: no
  detecta, por ejemplo, un embebido ambiguo por dos FK hacia la misma tabla.
- **Datos reales.** La copia simulada imita lo que `analisis/sql.md` vio en vivo; si la
  base cambió desde entonces, el ensayo no lo sabe.

| Fecha | Dónde | Resultado |
|---|---|---|
| 30/09/2026 | PGlite local (vacía y con copia simulada) | 30 pasan · 0 fallan · 0 omitidas; 13 dos veces sin cambios; contrato sin desajustes |
| — | Supabase (proyecto real) | [PENDIENTE] |

---

## 11. Pruebas de 17 (`pruebas/reglas-17.sql`)

**Estado:** 🟡 **29 de 29 pasan en un ensayo LOCAL** (PGlite, 07/10/2026) sobre una copia del
estado de producción (01..14 + 16 + 18 + 19, más una separación y un contrato vivos de antes de
17), con 17 aplicado **dos veces** (la segunda no cambia nada). También con 20 aplicado encima.
Contra el proyecto real de Supabase **todavía no se ha corrido**: hasta anotarlo en §7 no se
declara nada VALIDADO.

**Qué cubre:**

| Grupo | Qué |
|---|---|
| SEG | Las funciones de titular son DEFINER con `search_path` fijo, las ejecuta `authenticated` y ni `anon` ni PUBLIC; las cinco funciones internas del estado no las ejecuta nadie |
| EST | Separación pendiente → `reservada_temporal`; verificada → `separada`; devuelta, vencida o archivada → vuelve a donde estaba; contrato → `contratada`; cuotas pagadas o condonadas → `pagada`; contrato archivado → vuelve; no pisa `no_disponible`, `entregada` ni un estado a mano más adelantado; un cambio a mano entre medias se respeta; mover la separación de unidad; R1 sigue en pie; bitácora con actor; idempotencia; la web ve «separada» |
| TIT | Dirección y Administración sí; Comercial, Lectura, un usuario desactivado (`es()` NULL) y `anon` no; no duplica personas por documento; valida nombre, documento, teléfono y correo; quitar el titular no borra a la persona |
| CIERRE | Crear el contrato pasa su separación a `aplicada_a_contrato`; con contrato vivo una unidad nunca es ofrecible (aunque su estado diga disponible) y el tablero lo marca; no hay constancia de una separación archivada; `fn_cerrar_separacion` por rol (un comercial solo anula una suya sin verificar; sin motivo, fecha futura o doble cierre se rechazan) y la unidad vuelve a disponible; el documento del cliente se registra después si la ficha ya lo tiene |
| DOC | Papeles de una unidad: solo Dirección y Administración los suben y los leen (tabla y bucket); persona o unidad obligatoria; tipos nuevos; archivar con motivo; los documentos de una persona siguen igual |

**En Supabase:** después de aplicar 17, SQL Editor → pegar `reglas-17.sql` entero → Run. Necesita
un perfil activo de dirección, administración, comercial y lectura o contabilidad (si falta uno, la
fila PRE sale 🟡). Todo va entre `begin … rollback`. Lo esperado: la fila 9999 dice
`29 pasan · 0 fallan · 0 omitidas`.

**Ojo con 20:** si `sql/20-inventario-publico-como-crm.sql` está aplicado, `reglas-16.sql` (filas 7
y 9) y `reglas-19.sql` (fila 14) fallan porque siguen exigiendo las claves EXACTAS de antes de 20
(20 añade `verificada` y `precios_publicados`). No es un agujero: esas pruebas hay que actualizarlas
junto con 20.

| Fecha | Dónde | Resultado |
|---|---|---|
| 07/10/2026 | PGlite local (01..14 + 16 + 18 + 19 + 17, y también con 20) | 29 pasan · 0 fallan · 0 omitidas (cinco mutaciones de las reglas de cierre, atrapadas); 17 dos veces sin cambios; 13, 16, 19 y `reglas.sql` sin regresiones |
| — | Supabase (proyecto real) | [PENDIENTE] |
