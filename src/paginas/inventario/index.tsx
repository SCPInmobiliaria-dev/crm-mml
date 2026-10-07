import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Flag,
  Loader2,
  Lock,
  MapPinOff,
  Pencil,
  Plus,
  Search,
  UserRound,
} from 'lucide-react'
import { CabeceraPantalla, PestanaCabecera } from '@/componentes/marca/CabeceraPantalla'
import { Button } from '@/componentes/ui/button'
import { claseCampoCompacto } from '@/componentes/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/componentes/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/componentes/ui/tooltip'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import { PENDIENTE, cargarParametros, cargarParametrosPorId } from '@/lib/parametros'
import { nivelesDePrecio, textoPrecioUnidad, type NivelPrecio } from '@/lib/precios-unidad'
import {
  ESTADOS_UNIDAD,
  FILTROS_VACIOS,
  FUENTE_INVENTARIO,
  LIMITE_UNIDADES,
  PARAMETRO_CORTE_DISPONIBILIDAD,
  SEMAFORO_DATO,
  SIN_RUBRO,
  cargarTitulares,
  cargarUnidades,
  coincideConFiltros,
  esSeleccionable,
  esSemaforo,
  leerEstadoComercial,
  motivosNoOfrecible,
  puedeMantenerInventario,
  separacionSinReflejar,
  textoSituacion,
  resumirInventario,
  valoresDistintos,
  type FiltrosInventario,
  type Unidad,
} from '@/lib/inventario'
import { escucharCambiosInventario } from '@/lib/inventario-en-vivo'
import { AsignarPrecio } from './AsignarPrecio'
import { FormularioUnidad, type PestanaUnidad } from './FormularioUnidad'
import { ImportarInventario } from './ImportarInventario'
import { PlanoInventario, type ModoPlano } from './PlanoInventario'

/**
 * INVENTARIO — el plano del mercado y la defensa visible contra la doble
 * asignación.
 *
 * ---------------------------------------------------------------------------
 * LA PANTALLA NO DECIDE NADA
 * ---------------------------------------------------------------------------
 * Que una unidad se pueda ofrecer lo decide `v_unidades_ofrecibles`
 * (03-vistas.sql §7), que exige LAS DOS cosas del Acta 03-O02: estado comercial
 * disponible Y dato verde contra plano, y ademas que no haya ni asignacion
 * activa ni separacion viva. Esta pantalla lee esa respuesta en la columna
 * `ofrecible` de `v_unidades_tablero` y la obedece. No hay ninguna copia de esa
 * regla en este archivo, ni un `if` que la reconstruya. Lo unico que anade es
 * la EXPLICACION: una fila apagada sin motivo acaba en «preguntale a Walter».
 *
 * ---------------------------------------------------------------------------
 * TRES MODOS, UNOS MISMOS FILTROS
 * ---------------------------------------------------------------------------
 * Disponibilidad y Zonificacion son el plano (PlanoInventario.tsx, portado del
 * inventario grafico de 02-marketing); Lista es la tabla de siempre. Los
 * filtros y la unidad elegida se comparten: se filtra en el plano, se cambia a
 * la lista y se sigue viendo lo mismo. Elegir una unidad (clic en el plano, en
 * la lista o en «sin ubicacion») abre su ficha abajo, con el mismo boton de
 * editar que ya tenia la tabla.
 *
 * ---------------------------------------------------------------------------
 * EL AVISO DE ARRIBA SE CALCULA, NO SE ESCRIBE
 * ---------------------------------------------------------------------------
 * Ni el total de unidades ni la fecha de corte de la disponibilidad son
 * literales: el total se cuenta de las filas cargadas y el corte sale del
 * parametro `inventario_disponibilidad_corte` (sql/14 §3). Con la tabla vacia
 * el aviso lo dice en rojo. No se puede cerrar: es el estado del inventario,
 * no un incidente pasajero.
 */

const CLAVE = ['inventario', 'unidades'] as const
const CLAVE_TITULARES = ['inventario', 'titulares'] as const
const CLAVE_CORTE = ['inventario', 'corte'] as const
const CLAVE_PRECIOS = ['inventario', 'parametros'] as const

type Modo = ModoPlano | 'lista'

const MODOS: readonly { valor: Modo; etiqueta: string }[] = [
  { valor: 'disponibilidad', etiqueta: 'Disponibilidad' },
  { valor: 'zonificacion', etiqueta: 'Zonificación' },
  { valor: 'precio', etiqueta: 'Precios' },
  { valor: 'lista', etiqueta: 'Lista' },
] as const

export function PantallaInventario() {
  const { rol } = useSesion()
  const cliente = useQueryClient()

  // Una separación, un contrato o un pago movidos por OTRA persona cambian el
  // estado de las unidades: al volver a esta pestaña se vuelve a leer (el
  // QueryClient del CRM no lo hace por defecto), y el aviso en vivo de abajo
  // lo adelanta cuando el proyecto lo tiene.
  // Respaldo del aviso en vivo: si Realtime no llega (nunca se ha visto llegar en
  // producción, PENDIENTES-WEB I2), cada minuto se vuelve a leer igual que la web.
  const consulta = useQuery({
    queryKey: CLAVE,
    queryFn: cargarUnidades,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  })
  const titulares = useQuery({
    queryKey: CLAVE_TITULARES,
    queryFn: cargarTitulares,
    refetchOnWindowFocus: true,
  })
  const corte = useQuery({
    queryKey: CLAVE_CORTE,
    queryFn: () => cargarParametrosPorId([PARAMETRO_CORTE_DISPONIBILIDAD]),
  })
  // Los niveles de precio (sql/19). Misma clave que el formulario de unidad:
  // una sola lectura de `parametros` para los dos.
  const precios = useQuery({ queryKey: CLAVE_PRECIOS, queryFn: cargarParametros })

  const [modo, setModo] = useState<Modo>('disponibilidad')
  const [filtros, setFiltros] = useState<FiltrosInventario>(FILTROS_VACIOS)
  const [seleccionada, setSeleccionada] = useState<string | null>(null)
  /** `undefined` = cerrado · `null` = alta · `Unidad` = edicion. */
  const [editando, setEditando] = useState<Unidad | null | undefined>(undefined)
  /** Pestaña con la que se abre la edición (la ficha tiene un acceso directo a «Titular»). */
  const [pestanaEdicion, setPestanaEdicion] = useState<PestanaUnidad>('datos')

  function abrirEdicion(u: Unidad | null, pestana: PestanaUnidad = 'datos') {
    setPestanaEdicion(pestana)
    setEditando(u)
  }

  const mantiene = puedeMantenerInventario(rol)
  const unidades = useMemo(() => consulta.data?.filas ?? [], [consulta.data])
  const nombres = useMemo(
    () => titulares.data?.nombres ?? new Map<string, string>(),
    [titulares.data],
  )
  const elegida = unidades.find((u) => u.id === seleccionada) ?? null
  const niveles = useMemo(() => nivelesDePrecio(precios.data?.filas ?? []), [precios.data])
  const nivelesPorId = useMemo(() => new Map<string, NivelPrecio>(niveles.map((n) => [n.id, n])), [niveles])

  const rubros = useMemo(() => valoresDistintos(unidades, (u) => u.zonaRubro), [unidades])
  const tipos = useMemo(() => valoresDistintos(unidades, (u) => u.tipo), [unidades])
  const visibles = useMemo(
    () =>
      new Set(
        unidades
          .filter((u) => coincideConFiltros(u, filtros, nombres.get(u.id) ?? null))
          .map((u) => u.id),
      ),
    [unidades, filtros, nombres],
  )
  const filtradas = unidades.filter((u) => visibles.has(u.id))
  const cargada = consulta.error === null && !consulta.isPending

  /** Tras cualquier escritura: todo lo que cuelga de ['inventario'] (incluidas las ofrecibles). */
  function refrescar() {
    void cliente.invalidateQueries({ queryKey: ['inventario'] })
  }

  // El aviso de la base (sql/16): algo que mueve la disponibilidad cambió.
  useEffect(
    () => escucharCambiosInventario(() => void cliente.invalidateQueries({ queryKey: ['inventario'] })),
    [cliente],
  )

  return (
    <div className="w-full">
      <CabeceraPantalla
        titulo="Inventario"
        descripcion="El plano del mercado, unidad por unidad, con su estado comercial y el estado del dato."
        acciones={
          /* Alta: solo dirección y administración, copiado de `unidades_escribir`.
             Esconderlo no protege nada — lo protege RLS. Evita ofrecer un
             formulario que iba a fallar al guardar. */
          mantiene ? (
            <Button variant="ambar" onClick={() => abrirEdicion(null)}>
              <Plus strokeWidth={2} aria-hidden="true" />
              Nueva unidad
            </Button>
          ) : undefined
        }
        pestanas={MODOS.map((m) => (
          <PestanaCabecera key={m.valor} activa={modo === m.valor} onClick={() => setModo(m.valor)}>
            {m.etiqueta}
          </PestanaCabecera>
        ))}
      />

      {cargada && (
        <AvisoInventario
          unidades={unidades}
          corte={corte.data?.[PARAMETRO_CORTE_DISPONIBILIDAD]?.valorTexto ?? null}
          errorCorte={corte.error?.message ?? null}
        />
      )}

      {cargada && unidades.length === 0 && mantiene && (
        <div className="mb-4">
          <ImportarInventario alCargar={refrescar} />
        </div>
      )}

      {consulta.isPending && (
        <p className="flex items-center gap-2 py-10 text-sm text-suelo-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          Cargando el inventario…
        </p>
      )}

      {consulta.error !== null && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-4 text-sm font-bold text-alerta"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {consulta.error.message}
        </p>
      )}

      {cargada && unidades.length > 0 && (
        <>
          <BarraFiltros
            filtros={filtros}
            alCambiar={setFiltros}
            tipos={tipos}
            rubros={rubros}
            hayRubroVacio={unidades.some((u) => u.zonaRubro === null)}
            conteo={filtradas.length}
            total={unidades.length}
          />

          {/* Precio en bloque: los mismos que mantienen el inventario (fn_asignar_precio, sql/19). */}
          {mantiene && <AsignarPrecio unidades={filtradas} niveles={niveles} alAsignar={refrescar} />}

          {modo === 'lista' ? (
            <>
              <Leyenda />
              <TablaUnidades
                unidades={filtradas}
                titulares={nombres}
                seleccionada={seleccionada}
                alSeleccionar={setSeleccionada}
                mantiene={mantiene}
                alEditar={(u) => abrirEdicion(u)}
                conPlano={consulta.data?.conPlano ?? false}
              />
            </>
          ) : (
            <PlanoInventario
              unidades={unidades}
              visibles={visibles}
              titulares={nombres}
              modo={modo}
              rubros={rubros}
              seleccionada={seleccionada}
              alSeleccionar={setSeleccionada}
              niveles={nivelesPorId}
            />
          )}
        </>
      )}

      {elegida !== null && (
        <FichaUnidad
          unidad={elegida}
          titular={nombres.get(elegida.id) ?? null}
          precio={textoPrecioUnidad(elegida.precioParametro, nivelesPorId)}
          mantiene={mantiene}
          alEditar={(pestana) => abrirEdicion(elegida, pestana)}
          alQuitar={() => setSeleccionada(null)}
        />
      )}

      <Advertencias
        descartadas={consulta.data?.descartadas ?? 0}
        filas={unidades.length}
        conPlano={consulta.data?.conPlano ?? true}
        errorTitulares={titulares.data?.error ?? titulares.error?.message ?? null}
      />

      {editando !== undefined && (
        <FormularioUnidad
          unidad={editando}
          pestanaInicial={pestanaEdicion}
          cerrar={() => setEditando(undefined)}
          alGuardar={() => {
            setEditando(undefined)
            refrescar()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// El aviso
// ---------------------------------------------------------------------------

/**
 * Tres frases, ninguna tecleada con cifras: el total y el desglose salen de
 * las filas, el corte sale de `parametros`. Si el parametro esta vacio se dice
 * PENDIENTE — nunca se completa con «la ultima fecha que se vio».
 */
function AvisoInventario({
  unidades,
  corte,
  errorCorte,
}: {
  unidades: readonly Unidad[]
  corte: string | null
  errorCorte: string | null
}) {
  if (unidades.length === 0) {
    return (
      <div
        role="note"
        className="mb-4 flex items-start gap-3 rounded-md border border-alerta bg-alerta-suave p-4"
      >
        <span className="mt-0.5 text-base leading-none" aria-hidden="true">
          🔴
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-bold leading-snug text-alerta">
            El inventario todavía no está cargado en el CRM.
          </p>
          <p className="mt-1 text-xs text-suelo-700">
            Mientras la tabla <code>unidades</code> esté vacía no se puede ofrecer ni separar
            ninguna unidad. Lo carga Dirección o Administración desde esta pantalla. Fuente:{' '}
            <code>{FUENTE_INVENTARIO}</code>
          </p>
        </div>
      </div>
    )
  }

  const r = resumirInventario(unidades)
  const desglose = [
    `${r.puestos} ${r.puestos === 1 ? 'puesto' : 'puestos'}`,
    `${r.tiendas} ${r.tiendas === 1 ? 'tienda' : 'tiendas'}`,
    r.otros > 0 ? `${r.otros} de otro tipo` : null,
  ]
    .filter((p): p is string => p !== null)
    .join(' · ')

  return (
    <div role="note" className="mb-4 rounded-md border border-border bg-card p-4 text-sm">
      <p className="font-bold leading-snug text-foreground">
        <span aria-hidden="true">🟢</span> Plano vigente cargado: {r.total}{' '}
        {r.total === 1 ? 'unidad' : 'unidades'} ({desglose}).
        <span className="ml-1 text-xs font-normal text-suelo-700">
          Fuente: <code>{FUENTE_INVENTARIO}</code>
        </span>
      </p>
      <p className="mt-1.5 leading-snug text-suelo-700">
        <span aria-hidden="true">🟡</span>{' '}
        <span className="font-bold">Disponibilidad según:</span>{' '}
        {errorCorte !== null ? `no se pudo leer el parámetro (${errorCorte})` : (corte ?? PENDIENTE)}{' '}
        <span className="text-xs">
          (parámetro <code>{PARAMETRO_CORTE_DISPONIBILIDAD}</code>)
        </span>
      </p>
      <p className="mt-1 text-xs leading-snug text-suelo-700">
        Las unidades sin área en el plano no se ofrecen ni se separan.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

function BarraFiltros({
  filtros,
  alCambiar,
  tipos,
  rubros,
  hayRubroVacio,
  conteo,
  total,
}: {
  filtros: FiltrosInventario
  alCambiar: (f: FiltrosInventario) => void
  tipos: readonly string[]
  rubros: readonly string[]
  hayRubroVacio: boolean
  conteo: number
  total: number
}) {
  const campo = cn(claseCampoCompacto, 'h-11 sm:h-9')
  const hayFiltros =
    filtros.busqueda !== '' ||
    filtros.estado !== '' ||
    filtros.tipo !== '' ||
    filtros.rubro !== '' ||
    filtros.soloPorRevisar

  return (
    <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
      <label className="relative block">
        <span className="sr-only">Buscar por código o titular</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-suelo-500"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <input
          type="search"
          value={filtros.busqueda}
          onChange={(e) => alCambiar({ ...filtros, busqueda: e.target.value })}
          placeholder="Buscar por código o titular…"
          className={cn(campo, 'pl-9')}
        />
      </label>

      <label className="block">
        <span className="sr-only">Estado comercial</span>
        <select
          value={filtros.estado}
          onChange={(e) => alCambiar({ ...filtros, estado: e.target.value })}
          className={campo}
        >
          <option value="">Todos los estados</option>
          {ESTADOS_UNIDAD.map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.etiqueta}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="sr-only">Tipo</span>
        <select
          value={filtros.tipo}
          onChange={(e) => alCambiar({ ...filtros, tipo: e.target.value })}
          className={campo}
        >
          <option value="">Todos los tipos</option>
          {tipos.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="sr-only">Rubro</span>
        <select
          value={filtros.rubro}
          onChange={(e) => alCambiar({ ...filtros, rubro: e.target.value })}
          className={campo}
        >
          <option value="">Todos los rubros</option>
          {rubros.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          {hayRubroVacio && <option value={SIN_RUBRO}>Sin rubro</option>}
        </select>
      </label>

      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
        <input
          type="checkbox"
          checked={filtros.soloPorRevisar}
          onChange={(e) => alCambiar({ ...filtros, soloPorRevisar: e.target.checked })}
          className="h-4 w-4 accent-azul"
        />
        Por revisar
      </label>

      <p className="flex flex-wrap items-center gap-2 text-xs text-suelo-700 sm:col-span-2 lg:col-span-5">
        <span aria-live="polite">
          {conteo} de {total} {total === 1 ? 'unidad' : 'unidades'}
        </span>
        {hayFiltros && (
          <Button variant="link" size="sm" className="h-11 px-0 sm:h-auto" onClick={() => alCambiar(FILTROS_VACIOS)}>
            Quitar filtros
          </Button>
        )}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modo lista — la tabla de siempre, con rubro, titular y plano
// ---------------------------------------------------------------------------

/** Qué significa cada símbolo. Sin esto, el semáforo comercial es adivinanza. */
function Leyenda() {
  return (
    <p className="mb-3 text-xs leading-relaxed text-suelo-500">
      <span className="font-bold text-suelo-700">Estado comercial</span> — ¿se puede ofrecer hoy?:
      🟢 libre · 🟡 bloqueo temporal (reservada o separada) · ⚫ vendida · 🔴 fuera de venta.{' '}
      <span className="font-bold text-suelo-700">Estado del dato</span> — 🟢 verificada contra
      plano · 🟡 por validar · 🔴 sin verificar · 🔵 propuesta · ⚫ histórico.
    </p>
  )
}

function TablaUnidades({
  unidades,
  titulares,
  seleccionada,
  alSeleccionar,
  mantiene,
  alEditar,
  conPlano,
}: {
  unidades: readonly Unidad[]
  titulares: ReadonlyMap<string, string>
  seleccionada: string | null
  alSeleccionar: (id: string) => void
  mantiene: boolean
  alEditar: (u: Unidad) => void
  conPlano: boolean
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">
                <span className="sr-only">Seleccionar</span>
              </TableHead>
              <TableHead>Código</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Área m²</TableHead>
              <TableHead>Ubicación y rubro</TableHead>
              <TableHead>Estado comercial</TableHead>
              <TableHead>Estado del dato</TableHead>
              <TableHead>¿Se puede ofrecer?</TableHead>
              {mantiene && (
                <TableHead className="w-16">
                  <span className="sr-only">Editar</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>

          <TableBody>
            {unidades.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={mantiene ? 9 : 8} className="py-10 text-center text-sm">
                  Ninguna unidad coincide con los filtros.
                </TableCell>
              </TableRow>
            )}

            {unidades.map((u) => (
              <FilaUnidad
                key={u.id}
                unidad={u}
                titular={titulares.get(u.id) ?? null}
                seleccionada={seleccionada === u.id}
                alSeleccionar={() => alSeleccionar(u.id)}
                mantiene={mantiene}
                alEditar={() => alEditar(u)}
                conPlano={conPlano}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  )
}

function FilaUnidad({
  unidad,
  titular,
  seleccionada,
  alSeleccionar,
  mantiene,
  alEditar,
  conPlano,
}: {
  unidad: Unidad
  titular: string | null
  seleccionada: boolean
  alSeleccionar: () => void
  mantiene: boolean
  alEditar: () => void
  conPlano: boolean
}) {
  const u = unidad
  const ofrecible = esSeleccionable(u)
  const motivos = motivosNoOfrecible(u)
  const comercial = leerEstadoComercial(u.estadoComercial)
  const dato = esSemaforo(u.estadoDato)
    ? SEMAFORO_DATO[u.estadoDato]
    : { simbolo: '❔', etiqueta: u.estadoDato }

  return (
    <TableRow
      // Gris, no invisible: la unidad existe y hay que poder verla. Lo que no
      // se puede es ofrecerla.
      className={cn(!ofrecible && 'bg-cal-200/50 text-suelo-500', seleccionada && 'bg-tinta-banda')}
      data-ofrecible={ofrecible}
    >
      <TableCell>
        {ofrecible ? (
          <label className="flex min-h-11 cursor-pointer items-center justify-center">
            <span className="sr-only">Seleccionar la unidad {u.codigoUnidad}</span>
            <input
              type="radio"
              name="unidad-seleccionada"
              checked={seleccionada}
              onChange={alSeleccionar}
              className="h-4 w-4 accent-azul"
            />
          </label>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="flex min-h-11 cursor-not-allowed items-center justify-center"
                tabIndex={0}
                aria-label={`${u.codigoUnidad} no se puede ofrecer: ${motivos.join('; ')}`}
              >
                <Lock className="h-4 w-4 text-suelo-500" strokeWidth={1.75} aria-hidden="true" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              <p className="font-bold">No se puede ofrecer</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {motivos.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        )}
      </TableCell>

      <TableCell className="font-bold text-foreground">
        {/* El código abre la ficha de abajo, sea o no ofrecible: ver no es asignar. */}
        <button
          type="button"
          onClick={alSeleccionar}
          className={cn(
            'min-h-11 text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            !ofrecible && 'text-suelo-500',
          )}
        >
          {u.codigoUnidad}
        </button>
        {u.revisar !== null && (
          <span className="block text-xs font-bold text-suelo-700">
            <Flag className="mr-1 inline h-3 w-3" strokeWidth={2} aria-hidden="true" />
            Por revisar
          </span>
        )}
      </TableCell>

      <TableCell>{u.tipo ?? '—'}</TableCell>

      <TableCell className="text-right tabular-nums">{u.areaM2 ?? '—'}</TableCell>

      <TableCell className="text-xs">
        {textoUbicacion(u)}
        {u.zonaRubro !== null && <span className="block">{u.zonaRubro}</span>}
        {titular !== null && <span className="block text-suelo-700">{titular}</span>}
        {conPlano && u.geometria === null && (
          <span className="block font-bold">
            <MapPinOff className="mr-1 inline h-3 w-3" strokeWidth={2} aria-hidden="true" />
            Sin ubicación en plano
          </span>
        )}
      </TableCell>

      <TableCell>
        <span className="whitespace-nowrap">
          <span aria-hidden="true">{comercial.simbolo}</span>{' '}
          <span className="text-xs">{comercial.etiqueta}</span>
        </span>
      </TableCell>

      <TableCell>
        <span className="whitespace-nowrap">
          <span aria-hidden="true">{dato.simbolo}</span>{' '}
          <span className="text-xs">{dato.etiqueta}</span>
        </span>
      </TableCell>

      <TableCell className="max-w-64">
        {ofrecible ? (
          <span className="text-xs font-bold text-foreground">Sí</span>
        ) : (
          <>
            <span className="text-xs font-bold">No</span>
            {/* Tambien visible, no solo al pasar el cursor: en una tableta no
                hay cursor que pasar. */}
            <span className="block text-xs leading-snug">{motivos.join(' · ')}</span>
          </>
        )}
      </TableCell>

      {mantiene && (
        <TableCell>
          <Button variant="ghost" size="sm" className="h-11 w-11 sm:h-9 sm:w-9" onClick={alEditar}>
            <Pencil strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">Editar la unidad {u.codigoUnidad}</span>
          </Button>
        </TableCell>
      )}
    </TableRow>
  )
}

function textoUbicacion(u: Unidad): string {
  const partes = [u.etapa, u.bloque, u.ubicacion].filter((p): p is string => p !== null)
  return partes.length === 0 ? '—' : partes.join(' · ')
}

// ---------------------------------------------------------------------------
// La ficha de la unidad elegida
// ---------------------------------------------------------------------------

/**
 * Lo mismo que el tooltip del plano, pero fijo y legible en una tableta, con
 * el boton de editar para quien mantiene el inventario.
 *
 * No hay boton de «asignar»: la separacion se registra desde Separaciones, y su
 * selector solo ofrece unidades de `v_unidades_ofrecibles`. Un boton que
 * pareciera asignar desde aqui seria una segunda puerta a la misma regla.
 */
function FichaUnidad({
  unidad,
  titular,
  precio,
  mantiene,
  alEditar,
  alQuitar,
}: {
  unidad: Unidad
  titular: string | null
  /** El nivel de precio al que apunta la unidad, ya en texto (src/lib/precios-unidad.ts). */
  precio: { precio: string; detalle: string }
  mantiene: boolean
  alEditar: (pestana: PestanaUnidad) => void
  alQuitar: () => void
}) {
  const u = unidad
  const comercial = leerEstadoComercial(u.estadoComercial)
  const dato = esSemaforo(u.estadoDato)
    ? SEMAFORO_DATO[u.estadoDato]
    : { simbolo: '❔', etiqueta: u.estadoDato }
  const motivos = motivosNoOfrecible(u)
  const caja = useRef<HTMLElement>(null)

  // El plano ocupa casi toda la pantalla: sin esto, en un celular el toque
  // abre una ficha que queda fuera de la vista y parece que no paso nada.
  // `nearest` no mueve nada si la ficha ya se ve.
  useEffect(() => {
    caja.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [u.id])

  const filas: readonly [string, string][] = [
    ['Tipo', u.tipo ?? 'sin dato'],
    ['Área', u.areaM2 === null ? 'sin dato en el plano' : `${u.areaM2} m²`],
    ['Estado comercial', `${comercial.simbolo} ${comercial.etiqueta}`],
    ['En el plano', textoSituacion(u)],
    ['Estado del dato', `${dato.simbolo} ${dato.etiqueta}`],
    ['Rubro', u.zonaRubro ?? 'sin rubro en el plano'],
    ['Precio de lista', precio.precio],
    ['Titular', titular ?? 'sin titular visible'],
    ['Tipo de socio', u.tipoSocio ?? 'sin dato'],
    ['Estado legal', u.estadoLegal ?? 'sin dato'],
    ['Ubicación', textoUbicacion(u)],
    ['Disponibilidad según', u.fuenteDisponibilidad ?? PENDIENTE],
    ['Plano', u.geometria === null ? 'sin ubicación en plano' : (u.fuentePlano ?? 'dibujada en el plano')],
  ]

  return (
    <section
      ref={caja}
      aria-label={`Ficha de la unidad ${u.codigoUnidad}`}
      className="mt-4 rounded-md bg-azul px-4 py-3 text-cal"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm">
          Unidad <span className="text-lg font-black">{u.codigoUnidad}</span>
          <span className="ml-2 text-xs font-bold">
            {u.ofrecible === true ? 'Se puede ofrecer' : 'No se puede ofrecer'}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          {mantiene && (
            <>
              <Button
                variant="ambar"
                size="sm"
                className="h-11 sm:h-9"
                onClick={() => alEditar('datos')}
              >
                <Pencil strokeWidth={1.75} aria-hidden="true" />
                Editar
              </Button>
              {/* El dueño y los papeles de CUALQUIER unidad, esté o no disponible:
                  es el inventario maestro. */}
              <Button
                variant="outline"
                size="sm"
                className="h-11 border-velo-borde bg-transparent text-cal hover:bg-azul-600 hover:text-cal sm:h-9"
                onClick={() => alEditar('titular')}
              >
                <UserRound strokeWidth={1.75} aria-hidden="true" />
                Titular y papeles
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={alQuitar}
            className="h-11 text-cal hover:bg-azul-600 hover:text-cal sm:h-9"
          >
            Cerrar la ficha
          </Button>
        </div>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {filas.map(([etiqueta, valor]) => (
          <div key={etiqueta}>
            <dt className="text-azul-300">{etiqueta}</dt>
            <dd className="font-bold">{valor}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-xs text-azul-300">Precio: {precio.detalle}</p>

      {motivos.length > 0 && (
        <p className="mt-2 text-xs">
          <span className="font-bold">Por qué no se ofrece:</span> {motivos.join(' · ')}
        </p>
      )}

      {separacionSinReflejar(u) && (
        <p className="mt-2 text-xs">
          <Flag className="mr-1 inline h-3 w-3 text-ambar" strokeWidth={2} aria-hidden="true" />
          <span className="font-bold text-ambar">Separación viva:</span> el estado guardado dice
          «{comercial.etiqueta}». El plano la pinta separada igual. Si sql/17 ya está aplicado, alguien
          cambió el estado a mano encima de la separación: revísalo.
        </p>
      )}

      {u.revisar !== null && (
        <p className="mt-2 text-xs">
          <Flag className="mr-1 inline h-3 w-3 text-ambar" strokeWidth={2} aria-hidden="true" />
          <span className="font-bold text-ambar">Por revisar:</span> {u.revisar}
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Advertencias
// ---------------------------------------------------------------------------

function Advertencias({
  descartadas,
  filas,
  conPlano,
  errorTitulares,
}: {
  descartadas: number
  filas: number
  conPlano: boolean
  errorTitulares: string | null
}) {
  return (
    <div className="mt-3 space-y-2">
      {descartadas > 0 && (
        <p className="text-xs font-bold text-alerta">
          🔴 {descartadas}{' '}
          {descartadas === 1 ? 'fila no se pudo leer' : 'filas no se pudieron leer'} y no están en
          el inventario. Revisa el esquema antes de fiarte de este inventario.
        </p>
      )}

      {!conPlano && (
        <p className="text-xs font-bold text-suelo-700">
          🟡 La base todavía no tiene las columnas del plano (falta aplicar{' '}
          <code>sql/14-inventario-grafico.sql</code>): todas las unidades salen «sin ubicación en
          plano» hasta entonces.
        </p>
      )}

      {errorTitulares !== null && (
        <p className="text-xs font-bold text-suelo-700">
          🟡 No se pudieron leer los titulares ({errorTitulares}). El plano funciona igual, sin
          nombres, y la búsqueda solo encuentra por código.
        </p>
      )}

      {filas >= LIMITE_UNIDADES && (
        <p className="text-xs font-bold text-suelo-700">
          🟡 Se alcanzó el tope de {LIMITE_UNIDADES} unidades por carga: el inventario puede estar
          incompleto. Hay que paginar la consulta antes de seguir usándolo con este volumen.
        </p>
      )}

      <p className="text-xs text-suelo-500">
        Las unidades salen de <code>v_unidades_tablero</code> y «¿Se puede ofrecer?» lo decide{' '}
        <code>v_unidades_ofrecibles</code>. El precio de cada unidad no se escribe aquí: es un
        puntero a un nivel de <code>parametros</code>, con su fuente y su semáforo, y la web solo
        publica los niveles 🟢.
      </p>
    </div>
  )
}
