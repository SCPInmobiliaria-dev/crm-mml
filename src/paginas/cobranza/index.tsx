import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card as TarjetaTremor, Metric } from '@tremor/react'
import {
  AlertTriangle,
  CalendarRange,
  Clock,
  Copy,
  Download,
  Loader2,
  MessageSquare,
  Search,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CabeceraPantalla } from '@/componentes/marca/CabeceraPantalla'
import { Badge } from '@/componentes/ui/badge'
import { Button } from '@/componentes/ui/button'
import { Input } from '@/componentes/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/componentes/ui/table'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import { formatearMonto } from '@/lib/dinero'
import { fechaCorta } from '@/lib/fechas'
import { exportarCSV } from '@/lib/csv'
import {
  LIMITE_COBRANZA,
  TRAMOS,
  cargarCobranza,
  copiarAlPortapapeles,
  enMora,
  etiquetaEstadoCuota,
  leerTramo,
  mensajeDeCobranza,
  porCobrarEsteMes,
  type FilaCobranza,
  type TotalPorMoneda,
} from '@/lib/cobranza'
import { DialogoGestion } from './DialogoGestion'
import { DialogoPago } from './DialogoPago'

/**
 * COBRANZA — el tablero de Rosa.
 *
 * ===========================================================================
 * LAS DOS TARJETAS DE ARRIBA NUNCA SUMAN DOS MONEDAS
 * ===========================================================================
 * «Por cobrar este mes» y «En mora» se calculan POR MONEDA y se pintan como
 * una cifra por cada una. Si hay cuotas en PEN y en USD salen dos números, no
 * uno: la moneda de control del negocio sigue [PENDIENTE] en
 * 00-fuente-de-verdad\moneda-de-comunicacion.md, y convertir exigiría un tipo
 * de cambio que nadie ha cargado.
 *
 * Y se calculan sobre la cartera ENTERA, no sobre lo que deje ver el buscador.
 * Un total que cambia al escribir en una casilla de búsqueda deja de ser un
 * total.
 *
 * ===========================================================================
 * EL COLOR NO DICE NADA. EL PESO, SÍ.
 * ===========================================================================
 * El brief de marca prohíbe expresamente inventar un rojo/verde de estado de
 * pago: «comunica el estado con texto + icono + peso tipográfico». Así que lo
 * que crece con la antigüedad de la mora es el PESO de la letra y el contraste
 * de la etiqueta, dentro de los colores que ya existen. Ningún color nuevo, y
 * ningún ámbar sobre fondo claro (contraste 1.79:1, incumple WCAG).
 *
 * ===========================================================================
 * LOS TRAMOS SON LOS DE LA VISTA, NO LOS DEL BRIEF
 * ===========================================================================
 * Cuatro: por vencer · mora 1-30 · mora 31-60 · mora 60+, tal como los calcula
 * `v_cobranza`. 🟡 El brief de diseño pide seis (al día / esta semana / 1-15 /
 * 16-30 / 31-60 / 60+). NO se parten aquí los de la vista para fingir seis:
 * eso sería una escala inventada en el navegador. Queda como decisión
 * pendiente — o se cambia la vista, o se cambia el brief.
 *
 * 🔴 Y falta la referencia visual: el encargo cita `03-diseno\04-cobranza.png`
 * y ese archivo no existe en el repositorio (03-diseno solo tiene
 * BRIEF-CLAUDE-DESIGN.md). Lo que se ha seguido es el §3.4 escrito de ese
 * brief: dos totales arriba, tabla agrupada por tramo, buscador por socio o
 * unidad encima de la tabla, y acción de registrar el pago en cada fila.
 */
const CLAVE = ['cobranza', 'tablero'] as const

export function PantallaCobranza() {
  const { rol } = useSesion()
  const clienteConsultas = useQueryClient()
  const consulta = useQuery({ queryKey: CLAVE, queryFn: cargarCobranza })

  const [busqueda, setBusqueda] = useState('')
  const [pagoDe, setPagoDe] = useState<FilaCobranza | null>(null)
  const [gestionDe, setGestionDe] = useState<FilaCobranza | null>(null)
  const [nota, setNota] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)

  const filas = useMemo(() => consulta.data?.filas ?? [], [consulta.data])

  // Los KPI, sobre la cartera entera. El buscador no los toca.
  const esteMes = useMemo(() => porCobrarEsteMes(filas), [filas])
  const mora = useMemo(() => enMora(filas), [filas])

  const visibles = useMemo(() => {
    const aguja = busqueda.trim().toLowerCase()
    if (aguja === '') return filas
    return filas.filter(
      (f) =>
        f.nombreCompleto.toLowerCase().includes(aguja) ||
        (f.codigoUnidad ?? '').toLowerCase().includes(aguja),
    )
  }, [filas, busqueda])

  async function copiarFila(fila: FilaCobranza) {
    const ok = await copiarAlPortapapeles(mensajeDeCobranza(fila))
    setCopiado(
      ok
        ? `Mensaje de ${fila.nombreCompleto} copiado al portapapeles.`
        : 'El navegador no dejó copiar. Abre «Gestión» para ver el texto y copiarlo a mano.',
    )
  }

  function refrescar() {
    void clienteConsultas.invalidateQueries({ queryKey: ['cobranza'] })
    void clienteConsultas.invalidateQueries({ queryKey: ['reportes'] })
    // sql/17: pagar la última cuota pendiente mueve la unidad a «pagada».
    void clienteConsultas.invalidateQueries({ queryKey: ['inventario'] })
  }

  return (
    <div className="w-full">
      <CabeceraPantalla
        titulo="Cobranza"
        descripcion={
          <>
            Las cuotas vivas de los socios que ya compraron. Sale de <code>v_cobranza</code>.
          </>
        }
        acciones={
          <Button
            variant="outlineCal"
            onClick={() => exportar(visibles)}
            disabled={visibles.length === 0}
          >
            <Download strokeWidth={1.75} aria-hidden="true" />
            Exportar CSV
          </Button>
        }
      />

      {/* ------------------------- Los dos KPI ------------------------- */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <TarjetaKPI
          titulo="Por cobrar este mes"
          Icono={CalendarRange}
          explicacion="Todas las cuotas que vencen entre el 1 y el último día del mes en curso, estén ya vencidas o no."
          totales={esteMes}
        />
        <TarjetaKPI
          titulo="En mora"
          Icono={Clock}
          explicacion="Todo lo que ya pasó su fecha de vencimiento, sea de este mes o de hace un año. Se solapa a propósito con la tarjeta de al lado: una cuota vencida este mes está en las dos."
          totales={mora}
          destacada
        />
      </div>

      {/* ------------------------- El buscador ------------------------- */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-suelo-500"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por socio o por código de unidad"
            className="pl-9"
            aria-label="Buscar por socio o por código de unidad"
          />
        </div>
        {busqueda.trim() !== '' && (
          <p className="text-xs text-suelo-500">
            {visibles.length} de {filas.length} cuotas. Las tarjetas de arriba siguen contando la
            cartera entera.
          </p>
        )}
      </div>

      {nota !== null && (
        <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm font-bold leading-snug text-foreground">
          {nota}
        </p>
      )}
      {copiado !== null && (
        <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm leading-snug text-suelo-700">
          {copiado}
        </p>
      )}

      {consulta.isPending && (
        <p className="flex items-center gap-2 py-10 text-sm text-suelo-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          Cargando la cartera…
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

      {/* ------------------------- La tabla ------------------------- */}
      {consulta.error === null && !consulta.isPending && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Socio</TableHead>
                <TableHead>Unidad</TableHead>
                <TableHead className="w-16">Cuota</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="text-right">Pagado</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead className="text-right">Días</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-56">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {visibles.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={10} className="py-10 text-center text-sm">
                    <p className="font-bold text-foreground">
                      {filas.length === 0
                        ? 'No hay ninguna cuota pendiente.'
                        : 'Ninguna cuota coincide con la búsqueda.'}
                    </p>
                    <p className="mt-1 text-suelo-500">
                      {filas.length === 0
                        ? 'v_cobranza solo trae las cuotas que no están pagadas. Si no hay contratos con calendario, aquí no hay nada que cobrar.'
                        : 'Se busca por nombre del socio y por código de unidad.'}
                    </p>
                  </TableCell>
                </TableRow>
              )}

              {/* Un bloque por tramo, en el orden del encargo: por vencer
                  primero, y la mora más vieja al final. */}
              {TRAMOS.map((tramo) => {
                const delTramo = visibles.filter((f) => f.tramo === tramo.valor)
                if (delTramo.length === 0) return null

                return (
                  <GrupoTramo
                    key={tramo.valor}
                    valor={tramo.valor}
                    cuantas={delTramo.length}
                    filas={delTramo}
                    copiar={(f) => void copiarFila(f)}
                    registrarPago={setPagoDe}
                    gestionar={setGestionDe}
                  />
                )
              })}

              {/* Un tramo que la vista devuelva y este cliente no conozca no se
                  esconde: se enseña al final con su nombre crudo. */}
              {(() => {
                const conocidos = TRAMOS.map((t) => t.valor) as readonly string[]
                const raros = visibles.filter((f) => !conocidos.includes(f.tramo))
                if (raros.length === 0) return null
                const nombres = [...new Set(raros.map((f) => f.tramo))]
                return nombres.map((valor) => (
                  <GrupoTramo
                    key={valor}
                    valor={valor}
                    cuantas={raros.filter((f) => f.tramo === valor).length}
                    filas={raros.filter((f) => f.tramo === valor)}
                    copiar={(f) => void copiarFila(f)}
                    registrarPago={setPagoDe}
                    gestionar={setGestionDe}
                  />
                ))
              })()}
            </TableBody>
          </Table>
        </div>
      )}

      <Pie
        descartadas={consulta.data?.descartadas ?? 0}
        cuantas={filas.length}
        rol={rol}
      />

      {pagoDe !== null && (
        <DialogoPago
          fila={pagoDe}
          cerrar={() => setPagoDe(null)}
          alRegistrar={(aviso) => {
            setPagoDe(null)
            setNota(
              aviso ??
                'Pago registrado. Si saldó la cuota, ya no vuelve a aparecer en esta lista.',
            )
            refrescar()
          }}
        />
      )}

      {gestionDe !== null && (
        <DialogoGestion
          fila={gestionDe}
          cerrar={() => setGestionDe(null)}
          alRegistrar={() => {
            setGestionDe(null)
            setNota('Gestión registrada en interacciones, con tu nombre y la fecha.')
            refrescar()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Los KPI
// ---------------------------------------------------------------------------

/**
 * Una tarjeta por indicador, con UNA CIFRA POR MONEDA dentro.
 *
 * `destacada` pinta la tarjeta sobre azul y la cifra en ámbar. Es el único
 * ámbar de esta pantalla y está sobre azul, que es su único uso permitido
 * (contraste ámbar sobre cal = 1.79:1, incumple WCAG).
 */
function TarjetaKPI({
  titulo,
  Icono,
  explicacion,
  totales,
  destacada = false,
}: {
  titulo: string
  Icono: LucideIcon
  explicacion: string
  totales: readonly TotalPorMoneda[]
  destacada?: boolean
}) {
  return (
    <TarjetaTremor
      className={cn(
        'ring-border shadow-tarjeta',
        destacada && 'bg-azul ring-azul-600',
      )}
    >
      <p
        className={cn(
          'flex items-center gap-2 text-sm font-bold',
          destacada ? 'text-azul-300' : 'text-suelo-700',
        )}
      >
        <Icono className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        {titulo}
      </p>

      {totales.length === 0 ? (
        <Metric className={cn('mt-2', destacada ? 'text-cal' : 'text-foreground')}>—</Metric>
      ) : (
        <div className="mt-2 space-y-1">
          {totales.map((t) => (
            <div key={t.moneda} className="flex flex-wrap items-baseline gap-x-3">
              <Metric
                className={cn('tabular-nums', destacada ? 'text-ambar' : 'text-foreground')}
              >
                {formatearMonto(t.monto, t.moneda === '[MONEDA PENDIENTE]' ? null : t.moneda)}
              </Metric>
              <span
                className={cn(
                  'text-xs',
                  destacada ? 'text-azul-300' : 'text-suelo-500',
                )}
              >
                {t.cuotas} {t.cuotas === 1 ? 'cuota' : 'cuotas'}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className={cn('mt-3 text-xs leading-snug', destacada ? 'text-azul-300' : 'text-suelo-500')}>
        {explicacion}
      </p>

      {totales.length > 1 && (
        <p
          className={cn(
            'mt-2 text-xs font-bold leading-snug',
            destacada ? 'text-cal' : 'text-suelo-700',
          )}
        >
          Hay {totales.length} monedas y NO se suman. La moneda de control del negocio sigue
          [PENDIENTE] (R7).
        </p>
      )}
    </TarjetaTremor>
  )
}

// ---------------------------------------------------------------------------
// La tabla, por tramos
// ---------------------------------------------------------------------------

function GrupoTramo({
  valor,
  cuantas,
  filas,
  copiar,
  registrarPago,
  gestionar,
}: {
  valor: string
  cuantas: number
  filas: readonly FilaCobranza[]
  copiar: (fila: FilaCobranza) => void
  registrarPago: (fila: FilaCobranza) => void
  gestionar: (fila: FilaCobranza) => void
}) {
  const tramo = leerTramo(valor)

  return (
    <>
      <TableRow className="bg-cal hover:bg-cal">
        <TableCell colSpan={10} className="py-2">
          <span className="flex items-center gap-3">
            {/* El peso visual crece con la antigüedad. No hay color nuevo. */}
            <Badge variant={tramo.variante} className={tramo.peso}>
              {tramo.etiqueta}
            </Badge>
            <span className="text-xs tabular-nums text-suelo-500">
              {cuantas} {cuantas === 1 ? 'cuota' : 'cuotas'}
            </span>
          </span>
        </TableCell>
      </TableRow>

      {filas.map((f) => (
        <FilaCuota
          key={`${f.contratoId}-${f.numero}`}
          fila={f}
          peso={tramo.peso}
          copiar={copiar}
          registrarPago={registrarPago}
          gestionar={gestionar}
        />
      ))}
    </>
  )
}

function FilaCuota({
  fila,
  peso,
  copiar,
  registrarPago,
  gestionar,
}: {
  fila: FilaCobranza
  peso: string
  copiar: (fila: FilaCobranza) => void
  registrarPago: (fila: FilaCobranza) => void
  gestionar: (fila: FilaCobranza) => void
}) {
  const f = fila

  return (
    <TableRow>
      <TableCell className={cn('text-foreground', peso)}>{f.nombreCompleto}</TableCell>
      <TableCell className="text-sm">{f.codigoUnidad ?? '—'}</TableCell>
      <TableCell className="tabular-nums">{f.numero}</TableCell>
      <TableCell className="whitespace-nowrap text-sm tabular-nums">
        {fechaCorta(f.fechaVencimiento)}
      </TableCell>

      {/* R7: cada monto con su moneda, en las tres columnas. */}
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {formatearMonto(f.monto, f.montoMoneda)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums text-suelo-700">
        {formatearMonto(f.pagado, f.montoMoneda)}
      </TableCell>
      <TableCell className={cn('whitespace-nowrap text-right tabular-nums', peso)}>
        {formatearMonto(f.saldo, f.montoMoneda)}
      </TableCell>

      <TableCell className={cn('text-right tabular-nums', peso)}>
        {f.diasDeAtraso === null ? '—' : f.diasDeAtraso > 0 ? f.diasDeAtraso : '—'}
      </TableCell>

      <TableCell className="text-sm">{etiquetaEstadoCuota(f.estado)}</TableCell>

      <TableCell>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" onClick={() => registrarPago(f)}>
            Pago
          </Button>
          <Button variant="ghost" size="sm" onClick={() => copiar(f)} title="Copiar el mensaje">
            <Copy strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">Copiar mensaje de cobranza</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => gestionar(f)}>
            <MessageSquare strokeWidth={1.75} aria-hidden="true" />
            Gestión
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------

function Pie({
  descartadas,
  cuantas,
  rol,
}: {
  descartadas: number
  cuantas: number
  rol: string | null
}) {
  const soloMira = rol === 'contabilidad' || rol === 'lectura'

  return (
    <div className="mt-3 space-y-2">
      {descartadas > 0 && (
        <p className="text-xs font-bold text-alerta">
          🔴 {descartadas}{' '}
          {descartadas === 1 ? 'fila no se pudo leer' : 'filas no se pudieron leer'} y no están ni
          en la tabla ni en los totales de arriba. En cobranza, una fila que falta es dinero que
          nadie está pidiendo.
        </p>
      )}

      {cuantas >= LIMITE_COBRANZA && (
        <p className="text-xs font-bold text-alerta">
          🔴 Se han traído {LIMITE_COBRANZA} cuotas, que es el tope de esta pantalla. Puede haber
          más, y los totales de arriba solo cuentan lo traído. Hay que paginar antes de usar esto
          como cifra de cartera.
        </p>
      )}

      {soloMira && (
        <p className="text-xs leading-snug text-suelo-700">
          Tu rol lee la cobranza pero no la escribe: las políticas <code>pagos_crear</code> y{' '}
          <code>cuotas_escribir</code> la reservan a dirección y administración. Los botones están
          a la vista porque quien manda es la base, no este menú — si pulsas uno, te lo dirá ella.
        </p>
      )}

      <p className="text-xs leading-relaxed text-suelo-500">
        <code>v_cobranza</code> solo trae las cuotas que no están <span className="font-bold">pagadas</span>,
        así que esto no es el total contratado: es lo que queda por cobrar. Los días de atraso los
        resta la vista contra la fecha del servidor, no contra el reloj de este equipo. 🔴 La vista
        calcula <code>pagado</code> sin mirar la moneda del pago; esta pantalla lo evita por el
        único lado que controla —rechaza registrar un pago en otra moneda—, pero arreglarlo de
        verdad es una migración pendiente.
      </p>
    </div>
  )
}

/**
 * El CSV de la cartera: monto y moneda en columnas separadas, sin formatear,
 * sin fila de total. Ver el encabezado de `src/lib/csv.ts`.
 */
function exportar(filas: readonly FilaCobranza[]): void {
  exportarCSV('cobranza', filas, [
    { titulo: 'Tramo', valor: (f) => leerTramo(f.tramo).etiqueta },
    { titulo: 'Socio', valor: (f) => f.nombreCompleto },
    { titulo: 'Teléfono', valor: (f) => f.telefono },
    { titulo: 'Unidad', valor: (f) => f.codigoUnidad },
    { titulo: 'N.º de cuota', valor: (f) => f.numero },
    { titulo: 'Vence', valor: (f) => f.fechaVencimiento },
    { titulo: 'Monto', valor: (f) => f.monto },
    { titulo: 'Pagado', valor: (f) => f.pagado },
    { titulo: 'Saldo', valor: (f) => f.saldo },
    { titulo: 'Moneda', valor: (f) => f.montoMoneda },
    { titulo: 'Días de atraso', valor: (f) => f.diasDeAtraso },
    { titulo: 'Estado', valor: (f) => etiquetaEstadoCuota(f.estado) },
  ])
}
