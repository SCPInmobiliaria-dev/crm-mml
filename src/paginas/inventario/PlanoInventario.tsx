import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { Flag, MapPinOff, Maximize2, Minus, Plus } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { cn } from '@/lib/utils'
import {
  SEMAFORO_DATO,
  esSemaforo,
  leerEstadoComercial,
  type Punto,
  type Unidad,
} from '@/lib/inventario'
import { textoMontoNivel, type NivelPrecio } from '@/lib/precios-unidad'

/**
 * PLANO INVENTARIO — el visor gráfico, portado de
 * D:\SCPCMO\02-marketing\diseño\inventario grafico\public\app.js.
 *
 * ---------------------------------------------------------------------------
 * QUÉ SE CONSERVA DEL VISOR ORIGINAL Y QUÉ NO
 * ---------------------------------------------------------------------------
 * Se conserva el espacio de dibujo (el mismo `viewBox` 85 75 900 1850 sobre la
 * imagen de 1050 × 2048), el zoom con −/+/Ajustar y Ctrl + rueda, el tooltip al
 * pasar el mouse y la lista aparte de las unidades sin ubicación.
 *
 * Los polígonos ya no son los trazados a mano del visor original: desde
 * sql/18 cada uno sale del PDF vectorial de zonificación, de la celda que
 * rodea al rótulo de la unidad, con los bordes en el eje de los muros. Por eso
 * un puesto y la tienda que tiene detrás comparten la misma línea.
 *
 * NO se conservan sus colores (amarillo, verde, lila…): no son de la marca y el
 * amarillo sobre fondo claro es justo lo que prohíbe 07-crm\CLAUDE.md §6. Aquí
 * el plano vive dentro de una superficie `bg-azul`, que es el único sitio donde
 * el ámbar es legal, y cada estado se distingue TAMBIÉN sin color: relleno
 * liso o trama distinta, contorno discontinuo para «por revisar», rayado fino
 * para «dato no verificado», y una leyenda con palabras. Quien no distingue
 * colores, o imprime en blanco y negro, lee lo mismo.
 *
 * ---------------------------------------------------------------------------
 * EL PLANO NO DECIDE NADA
 * ---------------------------------------------------------------------------
 * Igual que la tabla: el relleno dice el ESTADO COMERCIAL que guarda la base, y
 * el tooltip dice si `v_unidades_ofrecibles` deja ofrecerla. Ninguna regla de
 * negocio se recalcula aquí. Tampoco hay aquí ninguna cifra de negocio: las
 * coordenadas son píxeles de dibujo, no metros (comentario de
 * `unidades.geometria` en sql/14).
 */

export type ModoPlano = 'disponibilidad' | 'zonificacion' | 'precio'

/** El espacio de dibujo de los polígonos (sql/14 §1, sql/18). */
const ANCHO_DIBUJO = 1050
const ALTO_DIBUJO = 2048
/** El encuadre del visor original: recorta los márgenes vacíos de la imagen. */
const ENCUADRE = '85 75 900 1850'

/** Dónde se pinta cada lámina de fondo, en unidades de dibujo. */
type Lamina = { href: string; x: number; y: number; ancho: number; alto: number }

/**
 * La lámina de zonificación (2600 × 5073 px) ES el espacio de dibujo: es el
 * render del PDF del que sql/18 sacó los polígonos, encajada en 1050 × 2048.
 */
const ZONIFICACION_PX = { ancho: 2600, alto: 5073 }
const DIBUJO_POR_PX = Math.min(ANCHO_DIBUJO / ZONIFICACION_PX.ancho, ALTO_DIBUJO / ZONIFICACION_PX.alto)
const LAMINA_ZONIFICACION: Lamina = {
  href: '/plano/zonificacion.webp',
  x: 0,
  y: 0,
  ancho: ZONIFICACION_PX.ancho * DIBUJO_POR_PX,
  alto: ZONIFICACION_PX.alto * DIBUJO_POR_PX,
}

/**
 * La de disponibilidad (2600 × 5088 px) es un escaneo de otra impresión del
 * mismo plano, con otro margen y otra escala. Estirada al mismo ancho quedaba
 * corrida respecto de los polígonos. Se registró contra la de zonificación
 * (correlación de las líneas del dibujo, 05/10/2026): escala 0,997 y
 * desplazamiento de 8 px a la derecha y 1 px hacia arriba, en píxeles de la de
 * zonificación. Son medidas del dibujo, no cifras de negocio.
 */
const ESCANEO_PX = { ancho: 2600, alto: 5088, escala: 0.997, dx: 8, dy: -1 }
const LAMINA_DISPONIBILIDAD: Lamina = {
  href: '/plano/disponibilidad.webp',
  x: ESCANEO_PX.dx * DIBUJO_POR_PX,
  y: ESCANEO_PX.dy * DIBUJO_POR_PX,
  ancho: ESCANEO_PX.ancho * ESCANEO_PX.escala * DIBUJO_POR_PX,
  alto: ESCANEO_PX.alto * ESCANEO_PX.escala * DIBUJO_POR_PX,
}

const ZOOM_MIN = 1
const ZOOM_MAX = 5

// ---------------------------------------------------------------------------
// Rellenos — solo tokens de marca, y cada uno con una forma distinta
// ---------------------------------------------------------------------------

/**
 * Grupos del modo Disponibilidad. Responden a la misma pregunta que el
 * semáforo comercial de src/lib/inventario.ts («¿se puede ofrecer hoy?»), pero
 * con relleno en vez de emoji. Las clases se escriben enteras porque Tailwind
 * solo genera las que encuentra literales en el código.
 */
const GRUPOS_DISPONIBILIDAD = [
  { clave: 'disponible', etiqueta: 'Disponible', relleno: 'fill-ambar', estados: ['disponible'] },
  {
    clave: 'reservada',
    etiqueta: 'Reservada temporal',
    relleno: '[fill:url(#plano-trama-reservada)]',
    estados: ['reservada_temporal'],
  },
  {
    clave: 'colocada',
    etiqueta: 'Colocada (separada, contratada, pagada o entregada)',
    relleno: 'fill-azul-300',
    estados: ['separada', 'contratada', 'pagada', 'entregada'],
  },
  {
    clave: 'no_disponible',
    etiqueta: 'No disponible',
    relleno: '[fill:url(#plano-trama-cruz)]',
    estados: ['no_disponible'],
  },
] as const

/** Un estado que este cliente no conoce: se ve distinto, no se maquilla. */
const RELLENO_DESCONOCIDO = 'fill-azul-500'

function rellenoDisponibilidad(estado: string): string {
  const grupo = GRUPOS_DISPONIBILIDAD.find((g) => (g.estados as readonly string[]).includes(estado))
  return grupo?.relleno ?? RELLENO_DESCONOCIDO
}

/**
 * Rellenos del modo Zonificación. Con cuatro colores de marca no se pueden
 * pintar todos los rubros de colores distintos, así que se combinan color y
 * trama. Si el plano trae más rubros que rellenos, se repiten: el NOMBRE del
 * rubro (tooltip, ficha y filtro) es el dato; el relleno solo agrupa a la vista.
 */
const RELLENOS_RUBRO = [
  'fill-cal',
  'fill-ambar',
  'fill-azul-300',
  '[fill:url(#plano-trama-rayas-cal)]',
  '[fill:url(#plano-trama-puntos)]',
  '[fill:url(#plano-trama-rayas-azul)]',
  '[fill:url(#plano-trama-reservada)]',
  '[fill:url(#plano-trama-cruz)]',
] as const

const RELLENO_SIN_RUBRO = 'fill-azul-500'
const RELLENO_SIN_PRECIO = 'fill-azul-500'

function rellenoRubro(rubro: string | null, rubros: readonly string[]): string {
  if (rubro === null) return RELLENO_SIN_RUBRO
  const i = rubros.indexOf(rubro)
  return i < 0 ? RELLENO_SIN_RUBRO : (RELLENOS_RUBRO[i % RELLENOS_RUBRO.length] ?? RELLENO_SIN_RUBRO)
}

/** «Dato no verificado» = el estado del dato no es 🟢 contra plano. */
function datoNoVerificado(u: Unidad): boolean {
  return u.estadoDato !== 'verde'
}

function puntosSvg(p: readonly Punto[]): string {
  return p.map(([x, y]) => `${x},${y}`).join(' ')
}

function centro(p: readonly Punto[]): Punto {
  let x = 0
  let y = 0
  for (const [px, py] of p) {
    x += px
    y += py
  }
  return [x / p.length, y / p.length]
}

/** En el polígono cabe poco: se quita el prefijo «P-» como hacía el visor original. */
function rotulo(codigo: string): string {
  return codigo.replace(/^P-/i, '')
}

// ---------------------------------------------------------------------------
// Tramas (defs del SVG)
// ---------------------------------------------------------------------------

/**
 * Los ids son fijos porque las clases de relleno los citan literalmente. Solo
 * hay un plano por pantalla; si algún día hubiera dos, compartirían las mismas
 * tramas, que son idénticas.
 */
function Tramas() {
  return (
    <defs>
      <pattern id="plano-trama-reservada" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" className="fill-azul-600" />
        <rect width="3" height="6" className="fill-ambar" />
      </pattern>
      <pattern id="plano-trama-cruz" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" className="fill-azul-500" />
        <path d="M0 0L6 6M6 0L0 6" className="stroke-azul-300" strokeWidth="1" />
      </pattern>
      <pattern id="plano-trama-rayas-cal" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" className="fill-azul-500" />
        <rect width="2" height="6" className="fill-cal" />
      </pattern>
      <pattern id="plano-trama-rayas-azul" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <rect width="6" height="6" className="fill-cal" />
        <rect width="2" height="6" className="fill-azul-500" />
      </pattern>
      <pattern id="plano-trama-puntos" width="5" height="5" patternUnits="userSpaceOnUse">
        <rect width="5" height="5" className="fill-azul-400" />
        <circle cx="2.5" cy="2.5" r="1.2" className="fill-cal" />
      </pattern>
      {/* Rayado fino y transparente que se SUPERPONE al relleno: dos líneas,
          una oscura y una clara, para que se vea sobre cualquier fondo. */}
      <pattern id="plano-trama-dato" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <rect width="1" height="5" className="fill-azul-900" />
        <rect x="1" width="1" height="5" className="fill-cal" />
      </pattern>
    </defs>
  )
}

// ---------------------------------------------------------------------------
// La capa de polígonos — memorizada: el tooltip se mueve sin redibujar 485 formas
// ---------------------------------------------------------------------------

type PropsCapa = {
  unidades: readonly Unidad[]
  visibles: ReadonlySet<string>
  modo: ModoPlano
  rubros: readonly string[]
  seleccionada: string | null
  atenuada: boolean
  niveles: ReadonlyMap<string, NivelPrecio>
  intensidad: ReadonlyMap<string, number>
}

/**
 * Modo Precio: el nivel de cada unidad como intensidad de ámbar, del más
 * barato (tenue) al más caro (pleno) DENTRO de su tipo (puestos con puestos,
 * tiendas con tiendas). Sin nivel: el azul de «sin dato». Un nivel que no es
 * 🟢 (propuesta, por validar) lleva además el rayado fino: no se ofrece ni se
 * publica. La cifra está en el tooltip y en la ficha; el color solo ordena.
 */
function intensidadesPorNivel(niveles: ReadonlyMap<string, NivelPrecio>): Map<string, number> {
  const out = new Map<string, number>()
  for (const tipo of ['puesto', 'tienda'] as const) {
    const montos = [...new Set([...niveles.values()].filter((n) => n.tipo === tipo && n.monto !== null).map((n) => n.monto as number))].sort(
      (a, b) => a - b,
    )
    for (const n of niveles.values()) {
      if (n.tipo !== tipo || n.monto === null) continue
      const i = montos.indexOf(n.monto)
      out.set(n.id, montos.length <= 1 ? 1 : 0.25 + (0.75 * i) / (montos.length - 1))
    }
  }
  return out
}

function nivelNoVigente(u: Unidad, niveles: ReadonlyMap<string, NivelPrecio>): boolean {
  const n = u.precioParametro === null ? undefined : niveles.get(u.precioParametro)
  return n !== undefined && n.semaforo !== 'verde'
}

const CapaUnidades = memo(function CapaUnidades({
  unidades,
  visibles,
  modo,
  rubros,
  seleccionada,
  atenuada,
  niveles,
  intensidad,
}: PropsCapa) {
  const elegida = unidades.find((u) => u.id === seleccionada && u.geometria !== null) ?? null

  return (
    <g className={cn('transition-opacity', atenuada && 'opacity-20')}>
      {unidades.map((u) => {
        if (u.geometria === null) return null
        const visible = visibles.has(u.id)
        const puntos = puntosSvg(u.geometria)
        const [cx, cy] = centro(u.geometria)
        const comercial = leerEstadoComercial(u.estadoComercial)
        const opacidadPrecio = u.precioParametro === null ? undefined : intensidad.get(u.precioParametro)
        const relleno =
          modo === 'zonificacion'
            ? rellenoRubro(u.zonaRubro, rubros)
            : modo === 'precio'
              ? opacidadPrecio === undefined
                ? RELLENO_SIN_PRECIO
                : 'fill-ambar'
              : rellenoDisponibilidad(u.estadoComercial)
        const nivel = u.precioParametro === null ? undefined : niveles.get(u.precioParametro)
        const etiqueta = [
          u.codigoUnidad,
          u.tipo,
          comercial.etiqueta,
          u.zonaRubro,
          modo === 'precio' ? (nivel === undefined ? 'sin precio asignado' : textoMontoNivel(nivel)) : null,
          u.revisar !== null ? 'por revisar' : null,
          datoNoVerificado(u) ? 'dato no verificado' : null,
        ]
          .filter((p): p is string => p !== null)
          .join(', ')

        return (
          <g
            key={u.id}
            data-unidad={u.id}
            role="button"
            tabIndex={visible ? 0 : -1}
            aria-label={etiqueta}
            aria-pressed={seleccionada === u.id}
            aria-hidden={visible ? undefined : true}
            className={cn('group cursor-pointer outline-none', !visible && 'pointer-events-none opacity-10')}
          >
            <polygon
              points={puntos}
              className={cn(
                relleno,
                u.revisar !== null ? 'stroke-cal' : 'stroke-azul-900',
                'group-hover:stroke-cal group-focus-visible:stroke-cal',
              )}
              strokeWidth={u.revisar !== null ? 1.8 : 0.8}
              strokeDasharray={u.revisar !== null ? '3 2' : undefined}
              fillOpacity={modo === 'precio' ? opacidadPrecio : undefined}
            />
            {((modo === 'disponibilidad' && datoNoVerificado(u)) || (modo === 'precio' && nivelNoVigente(u, niveles))) && (
              <polygon points={puntos} className="pointer-events-none [fill:url(#plano-trama-dato)]" opacity={0.55} />
            )}
            {/* Foco y hover: un contorno grueso extra, porque cambiar solo el
                color del borde no se nota sobre el ámbar. */}
            <polygon
              points={puntos}
              className="pointer-events-none fill-none stroke-cal opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
              strokeWidth={2.5}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="middle"
              className="pointer-events-none fill-azul-900 stroke-cal font-bold"
              strokeWidth={2}
              paintOrder="stroke"
              fontSize={7}
            >
              {rotulo(u.codigoUnidad)}
            </text>
          </g>
        )
      })}

      {/* La seleccionada va al final para quedar encima: contorno doble, claro
          por fuera y oscuro por dentro, legible sobre cualquier relleno. */}
      {elegida !== null && elegida.geometria !== null && (
        <g className="pointer-events-none">
          <polygon points={puntosSvg(elegida.geometria)} className="fill-none stroke-cal" strokeWidth={4} />
          <polygon points={puntosSvg(elegida.geometria)} className="fill-none stroke-azul-900" strokeWidth={1.2} />
        </g>
      )}
    </g>
  )
})

// ---------------------------------------------------------------------------
// El visor
// ---------------------------------------------------------------------------

type Flotante = { id: string; x: number; y: number }

export function PlanoInventario({
  unidades,
  visibles,
  titulares,
  modo,
  rubros,
  seleccionada,
  alSeleccionar,
  niveles,
}: {
  unidades: readonly Unidad[]
  /** Ids que pasan los filtros. Las demás se atenúan, no desaparecen: el plano sigue entero. */
  visibles: ReadonlySet<string>
  titulares: ReadonlyMap<string, string>
  modo: ModoPlano
  /** Rubros distintos, en orden estable: fijan qué relleno toca a cada uno. */
  rubros: readonly string[]
  seleccionada: string | null
  alSeleccionar: (id: string) => void
  /** Los niveles de precio por id (sql/19): modo Precio y tooltip. */
  niveles: ReadonlyMap<string, NivelPrecio>
}) {
  const intensidad = useMemo(() => intensidadesPorNivel(niveles), [niveles])
  const [zoom, setZoom] = useState(ZOOM_MIN)
  const [original, setOriginal] = useState(false)
  const [flotante, setFlotante] = useState<Flotante | null>(null)
  const [verSinUbicacion, setVerSinUbicacion] = useState(false)
  const visor = useRef<HTMLDivElement>(null)

  const porId = useMemo(() => new Map(unidades.map((u) => [u.id, u])), [unidades])
  const sinUbicacion = useMemo(() => unidades.filter((u) => u.geometria === null), [unidades])
  const sinUbicacionVisibles = sinUbicacion.filter((u) => visibles.has(u.id))
  const dibujadas = unidades.length - sinUbicacion.length

  function fijarZoom(valor: number) {
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(valor * 10) / 10)))
  }

  // Ctrl + rueda amplía, como en el visor original. Tiene que ser un listener
  // nativo con `passive: false`: el `onWheel` de React es pasivo y no puede
  // impedir que el navegador haga zoom a la página entera.
  useEffect(() => {
    const nodo = visor.current
    if (nodo === null) return
    function alRodar(e: WheelEvent) {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + (e.deltaY < 0 ? 0.2 : -0.2)) * 10) / 10)))
    }
    nodo.addEventListener('wheel', alRodar, { passive: false })
    return () => nodo.removeEventListener('wheel', alRodar)
  }, [])

  /** Delegación: un solo manejador para todas las formas. */
  function idDelEvento(objetivo: EventTarget | null): string | null {
    if (!(objetivo instanceof Element)) return null
    const g = objetivo.closest('[data-unidad]')
    return g?.getAttribute('data-unidad') ?? null
  }

  function alClic(e: MouseEvent<SVGGElement>) {
    const id = idDelEvento(e.target)
    if (id !== null && visibles.has(id)) {
      setFlotante(null)
      alSeleccionar(id)
    }
  }

  function alTecla(e: KeyboardEvent<SVGGElement>) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const id = idDelEvento(e.target)
    if (id === null) return
    e.preventDefault()
    alSeleccionar(id)
  }

  function alMover(e: PointerEvent<SVGGElement>) {
    // En pantallas táctiles no hay «pasar por encima»: el toque selecciona y
    // la ficha de abajo enseña lo mismo que el tooltip.
    if (e.pointerType !== 'mouse') return
    const id = idDelEvento(e.target)
    if (id === null || !visibles.has(id)) {
      setFlotante(null)
      return
    }
    setFlotante({ id, x: e.clientX, y: e.clientY })
  }

  const imagen = modo === 'disponibilidad' && original ? LAMINA_DISPONIBILIDAD : LAMINA_ZONIFICACION

  return (
    <section aria-label="Plano del mercado" className="rounded-lg bg-azul p-3 text-cal sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-black">
            {modo === 'zonificacion' ? 'Zonificación por rubro' : modo === 'precio' ? 'Precio por unidad' : 'Disponibilidad'}
          </span>
          <span className="ml-2 text-xs text-azul-300">
            {dibujadas} en el plano · {visibles.size} con los filtros
          </span>
        </p>

        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Zoom del plano">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 text-cal hover:bg-azul-600 hover:text-cal sm:h-9 sm:w-9"
            onClick={() => fijarZoom(zoom - 0.5)}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Alejar"
          >
            <Minus strokeWidth={2} aria-hidden="true" />
          </Button>
          <span className="w-12 text-center text-xs font-bold tabular-nums" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 text-cal hover:bg-azul-600 hover:text-cal sm:h-9 sm:w-9"
            onClick={() => fijarZoom(zoom + 0.5)}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Acercar"
          >
            <Plus strokeWidth={2} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-11 text-cal hover:bg-azul-600 hover:text-cal sm:h-9"
            onClick={() => {
              fijarZoom(ZOOM_MIN)
              visor.current?.scrollTo(0, 0)
            }}
          >
            <Maximize2 strokeWidth={1.75} aria-hidden="true" />
            Ajustar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-11 text-cal hover:bg-azul-600 hover:text-cal sm:h-9"
            aria-pressed={original}
            onClick={() => setOriginal((o) => !o)}
          >
            {original ? 'Ocultar plano de origen' : 'Ver plano de origen'}
          </Button>
        </div>
      </div>

      <Leyenda modo={modo} rubros={rubros} hayRubroVacio={unidades.some((u) => u.zonaRubro === null)} />

      <div
        ref={visor}
        className="h-[70vh] min-h-[420px] overflow-auto rounded-md bg-azul-800"
        onPointerLeave={() => setFlotante(null)}
      >
        <div className="h-full min-w-[320px]" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
          <svg viewBox={ENCUADRE} className="block h-full w-full" role="group" aria-label={`Plano: ${dibujadas} unidades dibujadas`}>
            <Tramas />
            <image
              href={imagen.href}
              x={imagen.x}
              y={imagen.y}
              width={imagen.ancho}
              height={imagen.alto}
              opacity={original ? 1 : 0.17}
              preserveAspectRatio="none"
              aria-hidden="true"
            />
            <g onClick={alClic} onKeyDown={alTecla} onPointerMove={alMover}>
              <CapaUnidades
                unidades={unidades}
                visibles={visibles}
                modo={modo}
                rubros={rubros}
                seleccionada={seleccionada}
                atenuada={original}
                niveles={niveles}
                intensidad={intensidad}
              />
            </g>
          </svg>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-azul-300">
          Pasa el mouse para consultar · toca o haz clic para ver la ficha · Ctrl + rueda para ampliar
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-11 text-cal hover:bg-azul-600 hover:text-cal sm:h-9"
          aria-expanded={verSinUbicacion}
          onClick={() => setVerSinUbicacion((v) => !v)}
          disabled={sinUbicacion.length === 0}
        >
          <MapPinOff strokeWidth={1.75} aria-hidden="true" />
          Sin ubicación en plano ({sinUbicacion.length})
        </Button>
      </div>

      {verSinUbicacion && (
        <div className="mt-2 rounded-md bg-velo p-3">
          <p className="text-xs text-azul-300">
            Existen en el cuadro de áreas pero no tienen un lugar inequívoco en el dibujo. Se listan
            aparte en vez de dibujarlas en un sitio inventado.
          </p>
          {sinUbicacionVisibles.length === 0 ? (
            <p className="mt-2 text-sm">Ninguna coincide con los filtros.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {sinUbicacionVisibles.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => alSeleccionar(u.id)}
                    aria-pressed={seleccionada === u.id}
                    className={cn(
                      'min-h-11 rounded-md border border-velo-borde px-3 text-sm font-bold sm:min-h-9',
                      'hover:bg-azul-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cal',
                      seleccionada === u.id && 'bg-cal text-azul',
                    )}
                  >
                    {u.codigoUnidad}
                    {u.revisar !== null && <Flag className="ml-1 inline h-3 w-3" strokeWidth={2} aria-label="por revisar" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {flotante !== null && (
        <Tooltip
          unidad={porId.get(flotante.id) ?? null}
          titular={titulares.get(flotante.id) ?? null}
          niveles={niveles}
          x={flotante.x}
          y={flotante.y}
        />
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Leyenda y tooltip
// ---------------------------------------------------------------------------

function Muestra({
  relleno,
  rayado = false,
  discontinuo = false,
  opacidad,
}: {
  relleno: string
  rayado?: boolean
  discontinuo?: boolean
  opacidad?: number
}) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="14"
        height="14"
        className={cn(relleno, discontinuo ? 'stroke-cal' : 'stroke-azul-900')}
        strokeWidth={discontinuo ? 1.8 : 0.8}
        strokeDasharray={discontinuo ? '3 2' : undefined}
        fillOpacity={opacidad}
      />
      {rayado && <rect x="1" y="1" width="14" height="14" className="[fill:url(#plano-trama-dato)]" opacity={0.55} />}
    </svg>
  )
}

function Leyenda({ modo, rubros, hayRubroVacio }: { modo: ModoPlano; rubros: readonly string[]; hayRubroVacio: boolean }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-label="Leyenda del plano">
      {modo === 'disponibilidad' ? (
        <>
          {GRUPOS_DISPONIBILIDAD.map((g) => (
            <li key={g.clave} className="flex items-center gap-1.5">
              <Muestra relleno={g.relleno} />
              {g.etiqueta}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <Muestra relleno="fill-azul-300" rayado />
            Rayado fino: dato no verificado contra plano
          </li>
        </>
      ) : modo === 'precio' ? (
        <>
          <li className="flex items-center gap-1.5">
            <Muestra relleno="fill-ambar" opacidad={0.25} />
            <Muestra relleno="fill-ambar" opacidad={0.6} />
            <Muestra relleno="fill-ambar" />
            Más intenso = nivel más caro, dentro de su tipo (puestos con puestos, tiendas con tiendas)
          </li>
          <li className="flex items-center gap-1.5">
            <Muestra relleno="fill-ambar" opacidad={0.6} rayado />
            Rayado fino: nivel en propuesta o por validar (no se ofrece ni se publica)
          </li>
          <li className="flex items-center gap-1.5">
            <Muestra relleno={RELLENO_SIN_PRECIO} />
            Sin precio asignado
          </li>
        </>
      ) : (
        <>
          {rubros.map((r) => (
            <li key={r} className="flex items-center gap-1.5">
              <Muestra relleno={rellenoRubro(r, rubros)} />
              {r}
            </li>
          ))}
          {hayRubroVacio && (
            <li className="flex items-center gap-1.5">
              <Muestra relleno={RELLENO_SIN_RUBRO} />
              Sin rubro en el plano
            </li>
          )}
        </>
      )}
      <li className="flex items-center gap-1.5">
        <Muestra relleno="fill-none" discontinuo />
        Borde discontinuo: por revisar
      </li>
    </ul>
  )
}

function Tooltip({
  unidad,
  titular,
  niveles,
  x,
  y,
}: {
  unidad: Unidad | null
  titular: string | null
  niveles: ReadonlyMap<string, NivelPrecio>
  x: number
  y: number
}) {
  if (unidad === null) return null
  const nivel = unidad.precioParametro === null ? undefined : niveles.get(unidad.precioParametro)
  const comercial = leerEstadoComercial(unidad.estadoComercial)
  const dato = esSemaforo(unidad.estadoDato)
    ? SEMAFORO_DATO[unidad.estadoDato]
    : { simbolo: '❔', etiqueta: unidad.estadoDato }
  // Se corre hacia dentro de la ventana para no cortarse en los bordes.
  const izquierda = Math.min(x + 16, window.innerWidth - 300)
  const arriba = Math.min(y + 16, window.innerHeight - 190)

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-72 rounded-md border border-velo-borde bg-azul-900 p-3 text-xs text-cal shadow-lg"
      style={{ left: izquierda, top: arriba }}
    >
      <p>
        <span className="text-sm font-black">{unidad.codigoUnidad}</span>
        <span className="ml-2 text-azul-300">{unidad.tipo ?? 'tipo sin dato'}</span>
      </p>
      <p className="mt-1">
        {comercial.etiqueta} · {unidad.areaM2 === null ? 'área sin dato' : `${unidad.areaM2} m²`}
      </p>
      <p className="mt-0.5">{unidad.zonaRubro ?? 'Sin rubro en el plano'}</p>
      <p className="mt-0.5">
        {nivel === undefined
          ? unidad.precioParametro === null
            ? 'Sin precio asignado'
            : `Precio: nivel ${unidad.precioParametro}`
          : `Precio: ${textoMontoNivel(nivel)}`}
      </p>
      <p className="mt-0.5">{titular ?? 'Sin titular visible'}</p>
      <p className="mt-0.5 text-azul-300">
        <span aria-hidden="true">{dato.simbolo}</span> {dato.etiqueta} ·{' '}
        {unidad.ofrecible === true ? 'se puede ofrecer' : 'no se puede ofrecer'}
      </p>
      {unidad.revisar !== null && (
        <p className="mt-1 font-bold text-ambar">
          <Flag className="mr-1 inline h-3 w-3" strokeWidth={2} aria-hidden="true" />
          Por revisar
        </p>
      )}
      <p className="mt-1 text-azul-300">Clic para ver la ficha</p>
    </div>
  )
}
