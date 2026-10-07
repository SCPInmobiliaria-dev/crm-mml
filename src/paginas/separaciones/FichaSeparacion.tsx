import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  Loader2,
  Paperclip,
  ShieldCheck,
} from 'lucide-react'
import { CabeceraPantalla, MigajaVolver } from '@/componentes/marca/CabeceraPantalla'
import { Badge } from '@/componentes/ui/badge'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import { formatearMonto } from '@/lib/dinero'
import { fechaHora, fechaLarga } from '@/lib/fechas'
import {
  cargarSeparacion,
  cargarVigilancia,
  etiquetaEstadoSeparacion,
  puedeEmitirConstancia,
  urlFirmadaComprobante,
  verificarSeparacion,
  type SeparacionCompleta,
  type SeparacionVigilada,
} from '@/lib/separaciones'
import { AvisoDosRelojes, TarjetaReloj, ValorReloj } from './RelojesSeparacion'

/**
 * FICHA DE UNA SEPARACIÓN — donde se verifica y donde se bloquea la constancia.
 *
 * ===========================================================================
 * LAS DOS DECISIONES DE ESTA PANTALLA LAS TOMA LA BASE, NO ESTE ARCHIVO
 * ===========================================================================
 *  · ¿Quién puede verificar? Lo decide `fn_verificacion_solo_direccion` (R2).
 *    Aquí el botón se le enseña solo a `direccion`, pero eso es COMODIDAD: si
 *    alguien más lo intentara —una sesión vieja, la consola del navegador—, la
 *    base lanza una excepción que cita el Acta 03-O02 y ese texto se muestra
 *    LITERAL. No se reescribe: el mensaje de la base dice la regla y de dónde
 *    sale; cualquier cosa que escribiéramos aquí diría menos.
 *
 *  · ¿Se puede emitir la constancia? Lo decide `puede_emitir_constancia(id)`
 *    (R3). Se le PREGUNTA a la función en cada carga; no hay ninguna copia de
 *    su condición en este archivo decidiendo si el botón se activa. Lo que sí
 *    hay, más abajo, es una explicación de qué falta — y está marcada como
 *    explicación, porque si algún día divergiera de la función, la que manda
 *    es la función.
 *
 * ===========================================================================
 * LOS DOS RELOJES
 * ===========================================================================
 * Dos tarjetas, igual que en el formulario y por el mismo componente. Los días
 * restantes salen de `v_separaciones_vigilancia`, que los resta contra la
 * fecha del servidor: ni se calculan aquí, ni se deriva uno del otro (R4).
 */

export function FichaSeparacion() {
  const { separacionId } = useParams<{ separacionId: string }>()
  const id = separacionId ?? ''

  const separacion = useQuery({
    queryKey: ['separaciones', 'ficha', id],
    queryFn: () => cargarSeparacion(id),
    enabled: id !== '',
  })

  const vigilancia = useQuery({
    queryKey: ['separaciones', 'vigilancia', id],
    queryFn: () => cargarVigilancia(id),
    enabled: id !== '',
  })

  const constancia = useQuery({
    queryKey: ['separaciones', 'puede-constancia', id],
    queryFn: () => puedeEmitirConstancia(id),
    enabled: id !== '',
  })

  if (separacion.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Volver />
        <p className="flex items-center gap-2 py-10 text-sm text-suelo-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          Cargando la separación…
        </p>
      </div>
    )
  }

  if (separacion.error !== null) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Volver />
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-4 text-sm font-bold text-alerta"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {separacion.error.message}
        </p>
      </div>
    )
  }

  const s = separacion.data ?? null

  if (s === null) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Volver />
        <p className="mt-4 rounded-md border border-border bg-card p-4 text-sm">
          No existe ninguna separación con ese identificador, o tu rol no puede leerla
          (política <code>sep_leer</code>).
        </p>
      </div>
    )
  }

  return (
    <>
      {/* La cabecera va fuera del contenedor de ancho máximo y ANTES que nada:
          su franja azul se sube con margen negativo hasta el borde, así que
          cualquier cosa dibujada encima le quedaría debajo. Por eso el
          «volver» es ahora la miga de pan, como en el proyecto de diseño. */}
      <CabeceraPantalla
        ancho="formulario"
        migaja={<MigajaVolver a="/separaciones">Separaciones</MigajaVolver>}
        titulo={s.nombreCompleto ?? 'Persona sin nombre legible'}
        descripcion={`Registrada el ${fechaHora(s.creadoEl)}`}
        distintivos={
          <>
            <Badge variant="cal">{etiquetaEstadoSeparacion(s.estado)}</Badge>
            <Badge variant="outlineCal">
              {s.codigoUnidad === null ? 'Sin unidad asignada' : `Unidad ${s.codigoUnidad}`}
            </Badge>
          </>
        }
      />

      <div className="mx-auto w-full max-w-3xl">
      <div className="space-y-5">
        <DatosDelDeposito separacion={s} />

        <section className="space-y-3">
          <h2 className="text-lg font-black tracking-tight text-foreground">Los dos plazos</h2>
          <AvisoDosRelojes />
          <Relojes separacion={s} vigilada={vigilancia.data ?? null} />
        </section>

        <Verificacion separacion={s} />

        <Constancia
          separacion={s}
          puedeEmitir={constancia.data === true}
          consultando={constancia.isPending}
        />
      </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// El depósito
// ---------------------------------------------------------------------------

function DatosDelDeposito({ separacion }: { separacion: SeparacionCompleta }) {
  const s = separacion

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">El depósito</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pb-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          {/* R7: el monto y su moneda, siempre juntos. */}
          <Dato etiqueta="Monto depositado">
            <span className="tabular-nums">{formatearMonto(s.monto, s.montoMoneda)}</span>
          </Dato>
          <Dato etiqueta="Banco">{s.banco ?? '—'}</Dato>
          <Dato etiqueta="Número de operación">
            <span className="tabular-nums">{s.nroOperacion ?? '—'}</span>
          </Dato>
          <Dato etiqueta="Fecha de depósito efectivo">
            {s.fechaDepositoEfectivo === null ? (
              <span className="text-sm font-bold text-suelo-700">
                Sin registrar: el reloj 1 no ha empezado a correr.
              </span>
            ) : (
              fechaLarga(s.fechaDepositoEfectivo)
            )}
          </Dato>
          <Dato etiqueta="Documento del cliente">
            {s.docTipo === null || s.docNumero === null
              ? '—'
              : `${s.docTipo.toUpperCase()} ${s.docNumero}`}
          </Dato>
          <Dato etiqueta="Teléfono">{s.telefono ?? '—'}</Dato>
        </dl>

        <Comprobante ruta={s.comprobanteRuta} />

        {s.notas !== null && (
          <p className="rounded-md border border-border p-3 text-sm leading-snug text-suelo-700">
            {s.notas}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-suelo-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  )
}

/**
 * El voucher. El bucket es privado, así que no hay URL estable que enseñar:
 * se pide una firmada en el momento y se abre. Caduca en minutos, y es lo
 * correcto — un comprobante lleva nombre, banco y número de operación.
 */
function Comprobante({ ruta }: { ruta: string | null }) {
  const [abriendo, setAbriendo] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  if (ruta === null) {
    return (
      <p className="rounded-md bg-alerta-suave p-2 text-xs font-bold leading-snug text-alerta">
        🔴 Esta separación no tiene comprobante subido. Sin el voucher, Walter está verificando
        de memoria: es exactamente lo que el CRM viene a quitar.
      </p>
    )
  }

  async function abrir() {
    if (ruta === null) return
    setAbriendo(true)
    setFallo(null)
    const url = await urlFirmadaComprobante(ruta)
    setAbriendo(false)

    if (url === null) {
      setFallo(
        'No se pudo abrir el comprobante. El bucket «comprobantes» es privado y la URL firmada ' +
          'no se generó: comprueba que 09-separaciones-storage.sql está ejecutado.',
      )
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-2">
      <Button variant="secondary" size="sm" onClick={() => void abrir()} disabled={abriendo}>
        {abriendo ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Paperclip strokeWidth={1.75} aria-hidden="true" />
        )}
        Ver el comprobante
      </Button>
      <p className="text-xs leading-snug text-suelo-500">
        Se abre con un enlace temporal que caduca. El archivo vive en el bucket privado, no en una
        URL pública.
      </p>
      {fallo !== null && <p className="text-xs font-bold text-alerta">{fallo}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Los dos relojes
// ---------------------------------------------------------------------------

/**
 * Los días los pone la vista. Si la vista ya no vigila esta separación (porque
 * está devuelta, vencida o aplicada a contrato), se enseñan las fechas sin
 * cuenta atrás y se dice por qué. Inventar aquí la resta sería exactamente el
 * cálculo en el cliente que R4 no quiere.
 */
function Relojes({
  separacion,
  vigilada,
}: {
  separacion: SeparacionCompleta
  vigilada: SeparacionVigilada | null
}) {
  const s = separacion

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <TarjetaReloj
          numero={1}
          titulo="Derecho de devolución"
          desdeQue="Se cuenta desde la fecha de depósito efectivo."
          quienLoEscribe={`La fecha límite la escribió la base con el parámetro ${
            s.plazoParametro ?? 'plazo_devolucion_separacion_dias'
          }.`}
        >
          <ValorReloj
            fechaLimite={s.fechaLimiteDevolucion}
            dias={vigilada?.diasParaFinDevolucion ?? null}
            textoSinFecha="Sin depósito efectivo: este reloj no ha empezado a correr."
          />
        </TarjetaReloj>

        <TarjetaReloj
          numero={2}
          titulo="Vigencia del precio post-evento"
          desdeQue="Es un campo independiente. No sale del depósito ni del reloj 1."
          quienLoEscribe="La escribió una persona al registrar la separación."
        >
          <ValorReloj
            fechaLimite={s.fechaLimitePrecio}
            dias={vigilada?.diasParaFinPrecio ?? null}
            textoSinFecha="Sin fecha escrita todavía."
          />
        </TarjetaReloj>
      </div>

      {vigilada === null && (
        <p className="text-xs leading-snug text-suelo-500">
          Esta separación ya no está en <code>v_separaciones_vigilancia</code> —la vista solo trae
          las pendientes de verificar y las verificadas—, así que no hay cuenta atrás que mostrar.
          Las fechas se enseñan tal como están guardadas.
        </p>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// R2 · verificación
// ---------------------------------------------------------------------------

function Verificacion({ separacion }: { separacion: SeparacionCompleta }) {
  const { rol } = useSesion()
  const cliente = useQueryClient()

  const [verificando, setVerificando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  const yaVerificada = separacion.verificadaEl !== null

  async function verificar() {
    setVerificando(true)
    setFallo(null)

    const resultado = await verificarSeparacion(separacion.id)
    setVerificando(false)

    if (!resultado.ok) {
      // TAL CUAL. Si viene de `fn_verificacion_solo_direccion`, este texto cita
      // el Acta 03-O02 — dice la regla y de dónde sale.
      setFallo(resultado.motivo)
      return
    }

    void cliente.invalidateQueries({ queryKey: ['separaciones'] })
    void cliente.invalidateQueries({ queryKey: ['hoy'] })
    // sql/17: verificar mueve la unidad de «reservada temporal» a «separada».
    void cliente.invalidateQueries({ queryKey: ['inventario'] })
  }

  if (yaVerificada) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Verificación</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <p className="flex items-start gap-2 text-sm">
            <ShieldCheck
              className="mt-0.5 h-4 w-4 shrink-0 text-suelo-700"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span className="leading-snug">
              <span className="font-bold text-foreground">
                Verificada el {fechaHora(separacion.verificadaEl)}.
              </span>
              <span className="mt-0.5 block text-suelo-700">
                Quedó registrado quién la verificó (<code>verificada_por</code>), escrito por el
                disparador con la sesión de quien pulsó el botón, no por esta pantalla.
              </span>
            </span>
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Verificación</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        <p className="text-sm leading-snug text-suelo-700">
          🟡 Sin verificar. Mientras <code>verificada_el</code> siga vacío no se emite constancia
          ni recibo (R3, Acta 03-O02).
        </p>

        {/* El botón SOLO se le enseña a dirección. No es la protección —esa es
            el disparador—, es no ofrecer un botón que iba a fallar. */}
        {rol === 'direccion' ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-md bg-azul px-5 py-4">
            <p className="text-xs leading-snug text-azul-300">
              Verifica solo después de <span className="font-bold">ver el comprobante</span>. El
              Acta 03-O02 te nombra único verificador del depósito.
            </p>
            <Button
              onClick={() => void verificar()}
              disabled={verificando}
              className={cn(
                'h-11 shrink-0 px-6 text-base font-bold',
                'bg-ambar text-suelo hover:bg-ambar/90',
                'focus-visible:ring-2 focus-visible:ring-cal',
                'disabled:bg-azul-600 disabled:text-azul-300 disabled:opacity-100',
              )}
            >
              {verificando ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Verificando…
                </>
              ) : (
                'Verificar el depósito'
              )}
            </Button>
          </div>
        ) : (
          <p className="rounded-md border border-border bg-card p-3 text-sm leading-snug text-suelo-700">
            Tu rol (<span className="font-bold">{rol ?? 'sin perfil'}</span>) no verifica
            separaciones. Solo <span className="font-bold">Dirección</span> puede hacerlo, y no es
            una decisión de esta pantalla: lo impone el disparador{' '}
            <code>fn_verificacion_solo_direccion</code> en la base (R2, Acta 03-O02).
          </p>
        )}

        {fallo !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-3 text-sm font-bold leading-snug text-alerta"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              strokeWidth={2}
              aria-hidden="true"
            />
            {fallo}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// R3 · constancia
// ---------------------------------------------------------------------------

/**
 * El botón está deshabilitado mientras `puede_emitir_constancia(id)` diga que
 * no, y al lado se escribe por qué, en gris.
 *
 * `consultando` mantiene el botón apagado mientras la respuesta no ha llegado:
 * en una regla que decide si se imprime un recibo, la duda se resuelve NO
 * imprimiendo.
 */
function Constancia({
  separacion,
  puedeEmitir,
  consultando,
}: {
  separacion: SeparacionCompleta
  puedeEmitir: boolean
  consultando: boolean
}) {
  const s = separacion

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Constancia</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          {puedeEmitir ? (
            <Button asChild>
              <Link to={`/separaciones/${s.id}/constancia`}>
                <FileText strokeWidth={1.75} aria-hidden="true" />
                Emitir constancia
              </Link>
            </Button>
          ) : (
            <Button disabled>
              <FileText strokeWidth={1.75} aria-hidden="true" />
              Emitir constancia
            </Button>
          )}

          {!puedeEmitir && (
            <span className="text-sm text-suelo-500">
              {consultando
                ? 'Comprobando con la base si se puede emitir…'
                : 'Pendiente de verificación de Walter (Acta 03-O02)'}
            </span>
          )}
        </div>

        {!puedeEmitir && !consultando && <QueFalta separacion={s} />}

        <p className="text-xs leading-snug text-suelo-500">
          Quien decide es la función <code>puede_emitir_constancia(id)</code> de la base, a la que
          se le pregunta en cada carga. Esta pantalla no guarda una copia de su condición.
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * EXPLICACIÓN, no la regla.
 *
 * Enumera lo que se ve que falta para que nadie tenga que adivinar por qué el
 * botón está apagado. Si algún día esto y la función no dijeran lo mismo, la
 * que manda es la función: el botón sigue su respuesta, no esta lista.
 */
function QueFalta({ separacion }: { separacion: SeparacionCompleta }) {
  const faltas: string[] = []

  if (separacion.verificadaEl === null) {
    faltas.push('Falta la verificación de Dirección (R3: no se emite recibo antes de verificar).')
  }
  if (separacion.estado !== 'verificada') {
    faltas.push(
      `El estado es «${etiquetaEstadoSeparacion(separacion.estado)}» y la constancia exige «Verificada».`,
    )
  }
  if (!separacion.docClienteRegistrado) {
    faltas.push(
      'El documento del cliente (DNI/CE) no está marcado como registrado en su ficha.',
    )
  }

  if (faltas.length === 0) {
    return (
      <p className="text-xs font-bold leading-snug text-suelo-700">
        🟡 La base dice que todavía no se puede emitir, y en esta ficha no se ve qué falta.
        No se fuerza: manda la función. Revisa la fila en <code>separaciones</code>.
      </p>
    )
  }

  return (
    <ul className="list-disc space-y-1 pl-5 text-xs leading-snug text-suelo-700">
      {faltas.map((f) => (
        <li key={f}>{f}</li>
      ))}
    </ul>
  )
}

function Volver() {
  return (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <Link to="/separaciones">
        <ArrowLeft strokeWidth={1.75} aria-hidden="true" />
        Volver a la bandeja
      </Link>
    </Button>
  )
}
