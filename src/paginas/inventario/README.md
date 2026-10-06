# Pantalla: inventario (`/inventario`)

🟢 Escrita · 10 de septiembre de 2026 · plano interactivo añadido el 30 de septiembre de 2026 ·
geometría recalculada desde el PDF de arquitectura y casilla de precio por unidad el 6 de octubre de 2026

El plano del mercado y la tabla de unidades con sus dos semáforos: la defensa visible contra la
doble asignación.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.tsx` | la pantalla: aviso calculado, modos Disponibilidad / Zonificación / Precios / Lista, filtros, ficha de la unidad elegida |
| `PlanoInventario.tsx` | el visor SVG, portado de `D:/SCPCMO/02-marketing/diseño/inventario grafico/public/app.js` |
| `ImportarInventario.tsx` | la carga inicial (CSV del cuadro de áreas + `seed.json`) — solo con la tabla vacía y para `direccion` / `administracion` |
| `FormularioUnidad.tsx` | alta y edición — solo se dibuja para `direccion` y `administracion`; el desplegable de precio solo ofrece niveles del tipo de la unidad |
| `AsignarPrecio.tsx` | asignar un nivel de precio (o quitarlo) a las unidades filtradas, en bloque y con confirmación — solo `direccion` y `administracion` |
| `../../lib/precios-unidad.ts` | los niveles de precio leídos de `parametros`, sus textos y la llamada a `fn_asignar_precio` |
| `../../lib/inventario.ts` | los dos semáforos, la consulta, los motivos del bloqueo, los filtros, los titulares y el guardado |
| `../../../public/plano/` | `zonificacion.webp` (el render del PDF de arquitectura del que sale la geometría) y `disponibilidad.webp` (escaneo de origen, registrado sobre la zonificación) |
| `../../../sql/14-inventario-grafico.sql` | `geometria`, `zona_rubro`, `revisar`, `fuente_disponibilidad` y el parámetro `inventario_disponibilidad_corte` |
| `../../../sql/18-geometria-plano.sql` | los 473 polígonos calculados de los vectores del PDF de arquitectura (paredes, no trazo a mano) |
| `../../../sql/19-precio-por-unidad.sql` | `t_unidades_precio_valido`, `fn_asignar_precio` y el `precio` en `fn_inventario_publico` |
| `../../../sql/08-vistas-embudo-e-inventario.sql` | la vista `v_unidades_tablero` y la restricción `verde_exige_plano` — **hay que ejecutarlas en Supabase** |

## Quién decide qué se puede ofrecer

**No esta pantalla.** Lo decide `v_unidades_ofrecibles` (`03-vistas.sql` §7), que exige las dos
condiciones del Acta 03-O02 —estado comercial `disponible` **y** dato `verde` contra plano— más
que no haya asignación activa ni separación viva. La pantalla lee esa respuesta en la columna
`ofrecible` y la obedece: fila en gris y casilla desactivada. **No hay ninguna copia de esa regla
en el código de la pantalla.**

Lo único que añade la interfaz es la **explicación** del bloqueo, que sale de las banderas de
`v_unidades_tablero` y se muestra de dos formas: visible en la fila y al pasar el cursor. Si la
explicación y la vista discreparan alguna vez, manda la vista: la fila se apaga igual y la
pantalla dice que no sabe por qué.

### Por qué `v_unidades_tablero` **no** lleva `security_invoker`

Es lo contrario de lo que se hizo con las vistas de Hoy, y es deliberado. `oport_leer` esconde a
un comercial las oportunidades de otro comercial. Si esta vista evaluara RLS con el usuario que
consulta, la asignación activa de un compañero daría *falso*, la unidad aparecería libre y la
pantalla la ofrecería: exactamente la doble asignación que **R1** existe para evitar. La vista
devuelve **booleanos** — dice «está tomada», nunca por quién.

## El precio no se escribe: se apunta

El formulario **no tiene casilla de importe**. El precio de una unidad es `precio_parametro`, un
puntero a una fila de `parametros` que cita su archivo de `00-fuente-de-verdad` y lleva semáforo.
Por eso el campo es un desplegable. Así esta pantalla no puede crear el noveno precio en
conflicto.

## La restricción nueva: `verde_exige_plano`

Declarar una unidad 🟢 «verificada contra plano» sin decir **contra qué plano** es una afirmación
que nadie puede comprobar — el hueco rellenado que produjo las 4 cifras en conflicto. Va como
restricción de base de datos (`08-…sql` §3) y no como validación de formulario, porque un
formulario se esquiva (un CSV, el panel de Supabase) y una restricción no. El formulario también
lo comprueba, pero solo para ahorrar el viaje.

🟡 **Por validar con Dirección.** Se quita en una línea si se decide otra cosa:
`alter table unidades drop constraint verde_exige_plano;`

## Los dos semáforos

| Columna | Qué es |
|---|---|
| **Estado del dato** | literal: `unidades.estado_dato` **es** el enum `semaforo`. Aquí no se interpreta nada |
| **Estado comercial** | 🔵 **propuesta**: `estado_unidad` no tiene color en la base. El símbolo responde a «¿se puede ofrecer hoy?» — 🟢 libre · 🟡 bloqueo temporal · ⚫ ya colocada · 🔴 fuera de venta — y **nunca va solo**: al lado va siempre la palabra exacta del enum |

La leyenda está impresa en la pantalla, no solo aquí.

## El aviso de arriba se calcula

Ya no es un texto fijo. Con filas: 🟢 «Plano vigente cargado: N unidades (P puestos · T tiendas)»,
**contado de las filas leídas** y con la fuente `00-fuente-de-verdad/inventario-maestro.md`; y 🟡
de qué lista y fecha sale la disponibilidad, leído del parámetro `inventario_disponibilidad_corte`
(`[PENDIENTE]` si está vacío). Sin filas: 🔴 «El inventario todavía no está cargado en el CRM».
Ninguna cifra ni fecha está escrita en el código.

## El plano

- `viewBox` `85 75 900 1850` sobre la imagen de 1050 × 2048, igual que el visor original, para que
  los polígonos de `unidades.geometria` caigan donde se trazaron. `geometria` nula = la unidad sale
  en «Sin ubicación en plano», nunca dibujada en un sitio inventado.
- **Colores de marca, no los del visor original.** El plano vive dentro de una superficie
  `bg-azul` (el único sitio donde el ámbar es legal) y cada estado se lee también **sin color**:
  relleno liso o trama distinta, borde discontinuo = por revisar, rayado fino = dato no verificado,
  y leyenda con palabras. En Zonificación, color + trama por rubro; el nombre del rubro es el dato.
- Titular: solo el **nombre**, pedido aparte a `unidades` con `personas` embebida por
  `unidades_titular_fk`. Si RLS no deja verlo, sale «sin titular visible»; si la consulta falla, el
  plano funciona sin nombres. `v_unidades_tablero` sigue sin datos personales.
- Si el código se publica antes de aplicar `sql/14`, la pantalla relee sin las columnas nuevas y lo
  dice (🟡), en vez de romperse.
- **La geometría se calcula, no se traza** (`sql/18`): cada polígono es la celda que cierran las
  paredes del PDF de arquitectura alrededor del rótulo de la unidad, ajustada a los ejes de pared.
  Puestos espalda con espalda y tiendas quedan con el mismo eje que el plano. Las unidades sin
  rótulo en el PDF quedan sin polígono (en «Sin ubicación en plano»), no dibujadas por aproximación.
- «Ver plano de origen» superpone el escaneo de disponibilidad con un registro medido
  (`ESCANEO_PX` en `PlanoInventario.tsx`), no estirado a ojo.

## El precio de cada unidad

Una unidad **no guarda un importe**: `precio_parametro` apunta a un **nivel** de `parametros`
(`precio_puesto…` o `precio_tienda…`) con monto, moneda, fuente y semáforo. La base impide
asignar un nivel de otro tipo o sin moneda (`t_unidades_precio_valido`), y solo `direccion` /
`administracion` pueden asignar (`fn_asignar_precio`).

- **Modo Precios** del plano: ámbar más intenso cuanto más caro es el nivel dentro de su tipo;
  rayado = nivel que todavía no es 🟢; gris = sin precio asignado. El tooltip y la ficha dicen el
  monto y el estado del nivel.
- **La web solo ve el precio de una unidad disponible cuyo nivel está en 🟢 verde**
  (`fn_inventario_publico`, clave `precio`). Un nivel 🔵 propuesta o 🟡 por validar se ve aquí,
  marcado, y no sale de aquí. Al pasar un nivel a verde en Parámetros, la web se entera por el
  mismo aviso Realtime del inventario.
- Ninguna cifra vive en este código: los montos se leen de `parametros`.

## Lo que todavía no hace

Elegir una unidad (en el plano, en la lista o en «sin ubicación») abre su ficha con el botón de
editar, pero **no la asigna**: la separación se registra desde Separaciones, cuyo selector solo
ofrece unidades de `v_unidades_ofrecibles`. No hay ningún botón que aparente asignar desde aquí.
