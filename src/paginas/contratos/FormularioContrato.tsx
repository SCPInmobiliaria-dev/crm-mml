import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FileSignature, Loader2 } from 'lucide-react'
import { CabeceraPantalla, MigajaVolver } from '@/componentes/marca/CabeceraPantalla'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { Input, claseCampo } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import { MONEDAS, esMoneda, formatearMonto, type Moneda } from '@/lib/dinero'
import { etiquetaEstado } from '@/lib/embudo'
import {
  PENDIENTE,
  cargarParametrosPorId,
  numeroDeParametro,
  sePuedeProponer,
  simboloSemaforo,
  textoDeParametro,
  type Parametro,
} from '@/lib/parametros'
import {
  ESTADOS_LEGALES,
  MODALIDADES,
  PARAMETROS_DEL_CONTRATO,
  PARAMETRO_MONEDA,
  PARAMETRO_PRECIO,
  cargarOportunidadesContratables,
  constanciaDePrecioManual,
  contratoEnBlanco,
  crearContrato,
  financiablePropuesto,
  type CampoContrato,
  type DatosContrato,
  type OportunidadContratable,
} from '@/lib/contratos'
import { CalendarioCuotas } from './CalendarioCuotas'

/**
 * ALTA DE CONTRATO — y el único sitio del CRM donde alguien teclea un precio.
 *
 * ===========================================================================
 * EL PRECIO SE PROPONE. NO SE SUPONE.
 * ===========================================================================
 * La casilla del precio nace VACÍA y se rellena sola solo si
 * `parametros('precio_puesto_9m2')` se puede proponer (🟢 verde, o 🟡/🔵 con
 * su símbolo al lado). Hoy ese parámetro está en 🔴 rojo —su fuente es
 * `00-fuente-de-verdad\precios-vigentes.md`, el archivo que documenta los 8
 * precios en conflicto—, así que lo que se ve es el marcador de pendiente y la
 * cifra la escribe una persona.
 *
 * Cuando eso pasa no se guarda en silencio: se exige marcar la casilla de
 * constancia, y se escribe en `observaciones` el párrafo de
 * `constanciaDePrecioManual`, con fecha, nombre y el parámetro que estaba sin
 * confirmar. `contratos` no tiene columna para la procedencia del precio, así
 * que ese párrafo es TODO el rastro que va a quedar de que ese número no salió
 * de 00-fuente-de-verdad.
 *
 * ===========================================================================
 * QUÉ NO HACE ESTA PANTALLA
 * ===========================================================================
 * No decide si una unidad puede contratarse. Lo decide el índice
 * `unidad_un_contrato_vivo` de la base: una unidad, un contrato vivo. Aquí no
 * hay ninguna copia de esa regla, y si la base la hace saltar se enseña su
 * mensaje tal cual.
 *
 * Tampoco mueve la oportunidad a `07_contrato`. Ese cambio de estado tiene sus
 * propias reglas (R5, R9) y vive en el embudo; hacerlo de rebote desde aquí
 * sería un cambio de estado sin actor visible.
 */
export function FormularioContrato() {
  const navegar = useNavigate()
  const { perfil } = useSesion()
  const clienteConsultas = useQueryClient()

  const oportunidades = useQuery({
    queryKey: ['contratos', 'contratables'],
    queryFn: cargarOportunidadesContratables,
  })

  const parametros = useQuery({
    queryKey: ['parametros', PARAMETROS_DEL_CONTRATO],
    queryFn: () => cargarParametrosPorId(PARAMETROS_DEL_CONTRATO),
  })

  const pPrecio = parametros.data?.[PARAMETRO_PRECIO] ?? null
  const pMoneda = parametros.data?.[PARAMETRO_MONEDA] ?? null

  const [datos, setDatos] = useState<DatosContrato>(contratoEnBlanco)
  const [constanciaAceptada, setConstanciaAceptada] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<{ motivo: string; campo?: CampoContrato | undefined } | null>(
    null,
  )
  const [creado, setCreado] = useState<{ id: string; moneda: Moneda } | null>(null)
  const [cuotasGeneradas, setCuotasGeneradas] = useState<number | null>(null)

  // Se recuerda si el precio se tocó a mano DESPUÉS de proponerse. No se
  // deduce comparando cadenas: «1000» y «1000.00» son el mismo precio, y
  // compararlos como texto haría aparecer o desaparecer una constancia por un
  // cero de más.
  const tocado = useRef(false)

  const elegida: OportunidadContratable | null = useMemo(
    () => oportunidades.data?.filas.find((o) => o.id === datos.oportunidadId) ?? null,
    [oportunidades.data, datos.oportunidadId],
  )

  const propuesta = numeroDeParametro(pPrecio)
  const hayPropuesta = sePuedeProponer(pPrecio) && propuesta !== null

  /**
   * El precio es «escrito a mano» siempre que NO venga tal cual del parámetro.
   * Fallar hacia la constancia es lo correcto: sobra un párrafo de más en unas
   * observaciones; falta el que explique de dónde salió un precio.
   */
  const precioAMano = datos.precioTotal.trim() !== '' && (!hayPropuesta || tocado.current)

  const textoConstancia = constanciaDePrecioManual(
    perfil?.nombre ?? 'usuario sin nombre en perfiles',
    datos.precioParametro === '' ? PARAMETRO_PRECIO : datos.precioParametro,
    pPrecio?.estadoSemaforo ?? null,
  )

  function cambiar<C extends keyof DatosContrato>(campo: C, valor: DatosContrato[C]) {
    setDatos((previo) => ({ ...previo, [campo]: valor }))
    setError(null)
  }

  /** Al elegir la oportunidad se copian sus punteros y se propone el precio. */
  function elegirOportunidad(id: string) {
    const o = oportunidades.data?.filas.find((f) => f.id === id) ?? null
    tocado.current = false
    setConstanciaAceptada(false)
    setError(null)

    if (o === null) {
      setDatos(contratoEnBlanco())
      return
    }

    const monedaDelParametro = pMoneda === null ? null : pMoneda.valorTexto
    const monedaPropuesta: Moneda | '' = esMoneda(o.precioMoneda)
      ? o.precioMoneda
      : sePuedeProponer(pMoneda) && esMoneda(monedaDelParametro)
        ? monedaDelParametro
        : ''

    setDatos((previo) => ({
      ...previo,
      oportunidadId: o.id,
      personaId: o.personaId,
      unidadId: o.unidadId ?? '',
      separacionId: o.separacionId ?? '',
      // Solo se propone lo que el parámetro permite proponer. Si está en rojo,
      // la casilla se queda vacía a propósito.
      precioTotal: hayPropuesta ? String(propuesta) : '',
      precioMoneda: monedaPropuesta,
      precioParametro: hayPropuesta ? (pPrecio?.id ?? '') : '',
    }))
  }

  async function guardar() {
    if (guardando) return

    // `creado_por` no se deja a que lo adivine la base: sin perfil en sesión no
    // se guarda nada, porque un contrato sin autor es un contrato que nadie
    // firmó (R9).
    if (perfil === null) {
      setError({ motivo: 'No hay perfil en sesión. Vuelve a entrar al CRM.' })
      return
    }

    if (precioAMano && !constanciaAceptada) {
      setError({
        motivo:
          'El precio no viene de un parámetro confirmado. Marca la constancia: va a quedar ' +
          'escrito en las observaciones del contrato quién lo tecleó y por qué.',
        campo: 'precioTotal',
      })
      return
    }

    setGuardando(true)
    setError(null)

    // La constancia se AÑADE a lo que haya escrito la persona, no lo sustituye.
    const observaciones = precioAMano
      ? [
          constanciaDePrecioManual(
            perfil.nombre,
            datos.precioParametro === '' ? PARAMETRO_PRECIO : datos.precioParametro,
            pPrecio?.estadoSemaforo ?? null,
          ),
          datos.observaciones.trim(),
        ]
          .filter((t) => t !== '')
          .join('\n\n')
      : datos.observaciones

    const resultado = await crearContrato(
      { ...datos, observaciones, precioEscritoAMano: precioAMano },
      perfil.id,
    )
    setGuardando(false)

    if (!resultado.ok) {
      setError({ motivo: resultado.motivo, campo: resultado.campo })
      return
    }

    void clienteConsultas.invalidateQueries({ queryKey: ['contratos'] })
    void clienteConsultas.invalidateQueries({ queryKey: ['cobranza'] })
    // sql/17: un contrato vivo mueve la unidad a «contratada».
    void clienteConsultas.invalidateQueries({ queryKey: ['inventario'] })
    void clienteConsultas.invalidateQueries({ queryKey: ['separaciones'] })

    // La moneda ya pasó la validación de `crearContrato`, que rechaza ''. Si
    // aun así no fuera legible, se vuelve a la lista en vez de ofrecer un
    // calendario cuya moneda habría que suponer (R7).
    if (esMoneda(datos.precioMoneda)) {
      setCreado({ id: resultado.id, moneda: datos.precioMoneda })
    } else {
      navegar('/contratos')
    }
  }

  // -------------------------------------------------------------------------
  // Guardado: ahora se OFRECE el calendario
  // -------------------------------------------------------------------------
  if (creado !== null) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <p className="mb-4 flex items-start gap-2 rounded-md border border-border bg-card p-4 text-sm">
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-suelo-700"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="leading-snug">
            <span className="font-bold text-foreground">El contrato quedó registrado.</span>{' '}
            <span className="text-suelo-700">
              Ahora puedes generar su calendario de cuotas, o dejarlo para después: mientras el
              contrato no tenga ninguna, se puede generar desde la lista de contratos.
            </span>
          </span>
        </p>

        {cuotasGeneradas === null ? (
          <CalendarioCuotas
            contratoId={creado.id}
            moneda={creado.moneda}
            financiablePropuesto={financiablePropuesto(datos.precioTotal, datos.inicialMonto)}
            alGenerar={(generadas) => {
              setCuotasGeneradas(generadas)
              void clienteConsultas.invalidateQueries({ queryKey: ['contratos'] })
              void clienteConsultas.invalidateQueries({ queryKey: ['cobranza'] })
            }}
          />
        ) : (
          <p className="rounded-md border border-border bg-card p-4 text-sm leading-snug">
            <span className="font-bold text-foreground">
              Se escribieron {cuotasGeneradas} {cuotasGeneradas === 1 ? 'cuota' : 'cuotas'}.
            </span>{' '}
            <span className="text-suelo-700">
              Ya aparecen en Cobranza. Nada se borra (R8): una cuota mal generada se corrige, no
              se elimina.
            </span>
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="outline" asChild>
            <Link to="/contratos">Ir a la lista de contratos</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/cobranza">Ver Cobranza</Link>
          </Button>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // El formulario
  // -------------------------------------------------------------------------
  const filas = oportunidades.data?.filas ?? []

  return (
    <>
      <CabeceraPantalla
        ancho="formulario"
        migaja={<MigajaVolver a="/contratos">Contratos</MigajaVolver>}
        titulo="Nuevo contrato"
        descripcion={
          <span className="block leading-snug">
            Nace de una oportunidad que ya llegó a separación o más allá. El precio se propone
            desde <code>parametros</code>; si el parámetro no está confirmado, lo escribes tú y
            queda constancia de ello dentro del propio contrato.
          </span>
        }
      />

      <div className="mx-auto w-full max-w-3xl">

      {oportunidades.isPending && (
        <p className="mt-8 flex items-center gap-2 text-sm text-suelo-500">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          Cargando las oportunidades contratables…
        </p>
      )}

      {oportunidades.error !== null && (
        <div className="mt-6">
          <Alerta>{oportunidades.error.message}</Alerta>
        </div>
      )}

      {!oportunidades.isPending && oportunidades.error === null && (
        <div className="mt-6 space-y-6">
          {/* ------------------- 1 · La oportunidad ------------------- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">1 · ¿De qué oportunidad nace?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pb-4">
              <div className="space-y-2">
                <Label htmlFor="oportunidad">Oportunidad</Label>
                <select
                  id="oportunidad"
                  value={datos.oportunidadId}
                  onChange={(e) => elegirOportunidad(e.target.value)}
                  className={cn(claseCampo, error?.campo === 'oportunidadId' && 'border-alerta')}
                >
                  <option value="">Elige una…</option>
                  {filas.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nombreCompleto} · {etiquetaEstado(o.estado)}
                      {o.codigoUnidad === null ? ' · sin unidad' : ` · ${o.codigoUnidad}`}
                    </option>
                  ))}
                </select>
                <p className="text-xs leading-snug text-suelo-500">
                  Solo salen las oportunidades activas desde{' '}
                  <span className="font-bold">separación</span> en adelante. Ese filtro lo hace la
                  base con el orden del enum <code>estado_embudo</code>, no esta pantalla.
                </p>
              </div>

              {filas.length === 0 && (
                <p className="rounded-md border border-border bg-cal p-3 text-xs leading-snug text-suelo-700">
                  No hay ninguna oportunidad en separación o más allá. Un contrato no nace de la
                  nada: primero se registra la separación.
                </p>
              )}

              {elegida !== null && <ResumenOportunidad oportunidad={elegida} />}
            </CardContent>
          </Card>

          {/* ------------------- 2 · El precio ------------------- */}
          {elegida !== null && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">2 · El precio</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pb-4">
                <PropuestaDelPrecio parametro={pPrecio} />

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="precio">Precio total</Label>
                    <Input
                      id="precio"
                      value={datos.precioTotal}
                      onChange={(e) => {
                        tocado.current = true
                        cambiar('precioTotal', e.target.value)
                      }}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={hayPropuesta ? '' : PENDIENTE}
                      className={cn(
                        'tabular-nums',
                        error?.campo === 'precioTotal' && 'border-alerta',
                      )}
                    />
                  </div>

                  {/* R7: la moneda va al lado del monto, siempre. */}
                  <div className="space-y-2">
                    <Label htmlFor="moneda">Moneda</Label>
                    <select
                      id="moneda"
                      value={datos.precioMoneda}
                      onChange={(e) => cambiar('precioMoneda', e.target.value as Moneda | '')}
                      className={cn(
                        claseCampo,
                        error?.campo === 'precioMoneda' && 'border-alerta',
                      )}
                    >
                      <option value="">Elige…</option>
                      {MONEDAS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {precioAMano && (
                  <ConstanciaPrecio
                    aceptada={constanciaAceptada}
                    cambiar={setConstanciaAceptada}
                    texto={textoConstancia}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* ------------------- 3 · Condiciones ------------------- */}
          {elegida !== null && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">3 · Condiciones y documento</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 pb-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="codigo">Código del contrato (opcional)</Label>
                  <Input
                    id="codigo"
                    value={datos.codigo}
                    onChange={(e) => cambiar('codigo', e.target.value)}
                    autoComplete="off"
                    placeholder="Es único: la base rechaza un duplicado"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="firma">Fecha de firma</Label>
                  <Input
                    id="firma"
                    type="date"
                    value={datos.fechaFirma}
                    onChange={(e) => cambiar('fechaFirma', e.target.value)}
                    className="tabular-nums"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="modalidad">Modalidad de pago</Label>
                  <select
                    id="modalidad"
                    value={datos.modalidadPago}
                    onChange={(e) => cambiar('modalidadPago', e.target.value)}
                    className={claseCampo}
                  >
                    <option value="">Sin especificar</option>
                    {MODALIDADES.map((m) => (
                      <option key={m.valor} value={m.valor}>
                        {m.etiqueta}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="inicial">
                    Inicial {datos.precioMoneda === '' ? '' : `(${datos.precioMoneda})`}
                  </Label>
                  <Input
                    id="inicial"
                    value={datos.inicialMonto}
                    onChange={(e) => cambiar('inicialMonto', e.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    className={cn(
                      'tabular-nums',
                      error?.campo === 'inicialMonto' && 'border-alerta',
                    )}
                  />
                  <p className="text-xs leading-snug text-suelo-500">
                    Sin valor sugerido: la política de financiamiento tiene 4 versiones en
                    conflicto en <code>00-fuente-de-verdad</code>.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="legal">Estado legal</Label>
                  <select
                    id="legal"
                    value={datos.estadoLegal}
                    onChange={(e) => cambiar('estadoLegal', e.target.value)}
                    className={claseCampo}
                  >
                    <option value="">Sin especificar</option>
                    {ESTADOS_LEGALES.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="observaciones">Observaciones</Label>
                  <textarea
                    id="observaciones"
                    value={datos.observaciones}
                    onChange={(e) => cambiar('observaciones', e.target.value)}
                    rows={3}
                    className={cn(claseCampo, 'h-auto py-2')}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {error !== null && <Alerta>{error.motivo}</Alerta>}

          {elegida !== null && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-md bg-azul px-5 py-4">
              <p className="text-xs leading-snug text-azul-300">
                Al guardar no se mueve el estado de la oportunidad: eso se hace en el embudo, con
                su actor y su fecha (R9).
              </p>
              <Button
                onClick={() => void guardar()}
                disabled={guardando}
                className={cn(
                  'h-11 shrink-0 px-6 text-base font-bold',
                  'bg-ambar text-suelo hover:bg-ambar/90',
                  'focus-visible:ring-2 focus-visible:ring-cal',
                  'disabled:bg-azul-600 disabled:text-azul-300 disabled:opacity-100',
                )}
              >
                {guardando ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Guardando…
                  </>
                ) : (
                  <>
                    <FileSignature strokeWidth={2} aria-hidden="true" />
                    Registrar el contrato
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

function ResumenOportunidad({ oportunidad }: { oportunidad: OportunidadContratable }) {
  const o = oportunidad
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-md border border-border bg-cal p-3 text-sm sm:grid-cols-2">
      <Dato titulo="Persona" valor={o.nombreCompleto} />
      <Dato titulo="Estado" valor={etiquetaEstado(o.estado)} />
      <Dato
        titulo="Unidad"
        valor={
          o.codigoUnidad === null ? (
            <span className="font-bold text-alerta">
              🔴 sin unidad: ni asignada ni en una separación viva — y el contrato la exige
            </span>
          ) : o.unidadDeLaSeparacion ? (
            `${o.codigoUnidad} (la de su separación)`
          ) : (
            o.codigoUnidad
          )
        }
      />
      <Dato
        titulo="Separación viva"
        valor={o.separacionId === null ? 'ninguna: el contrato no colgará de una' : 'sí, se enlaza'}
      />
      {o.precioPactado !== null && (
        <div className="sm:col-span-2">
          <Dato
            titulo="Precio ya pactado en la oportunidad"
            valor={
              <>
                {formatearMonto(o.precioPactado, o.precioMoneda)}{' '}
                <span className="text-xs font-normal text-suelo-500">
                  {o.precioParametro === null
                    ? '· sin parámetro anotado: no consta de dónde salió'
                    : `· congelado contra parametros(${o.precioParametro})`}
                </span>
              </>
            }
          />
        </div>
      )}
    </dl>
  )
}

function Dato({ titulo, valor }: { titulo: string; valor: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-suelo-500">{titulo}</dt>
      <dd className="font-bold leading-snug text-foreground">{valor}</dd>
    </div>
  )
}

/** Qué dice hoy `parametros('precio_puesto_9m2')`. Sin adornos. */
function PropuestaDelPrecio({ parametro }: { parametro: Parametro | null }) {
  const proponible = sePuedeProponer(parametro)

  return (
    <div className="rounded-md border border-border bg-cal p-3 text-xs leading-snug">
      <p className="text-suelo-700">
        Precio de lista según <code>parametros({PARAMETRO_PRECIO})</code>:{' '}
        {proponible ? (
          <span className="font-bold text-foreground">
            {simboloSemaforo(parametro?.estadoSemaforo ?? '')}{' '}
            {String(numeroDeParametro(parametro) ?? textoDeParametro(parametro))}{' '}
            {parametro?.valorMoneda ?? ''}
          </span>
        ) : (
          <span className="font-bold text-alerta">
            {simboloSemaforo(parametro?.estadoSemaforo ?? '')} {PENDIENTE}
          </span>
        )}
      </p>
      <p className="mt-1 text-suelo-500">
        Fuente del parámetro: <code>{parametro?.fuente ?? 'sin cargar'}</code>
      </p>
      {!proponible && (
        <p className="mt-2 font-bold text-suelo-700">
          Ese parámetro no se puede proponer, así que la casilla nace vacía. Escribe el precio que
          diga el contrato firmado — y quedará constancia de que lo escribiste tú.
        </p>
      )}
      {proponible && parametro?.estadoSemaforo !== 'verde' && (
        <p className="mt-2 font-bold text-suelo-700">
          Ojo: ese parámetro no está confirmado ({simboloSemaforo(parametro?.estadoSemaforo ?? '')}
          ). Se propone con su símbolo delante; no es un hecho.
        </p>
      )}
    </div>
  )
}

/**
 * La casilla de constancia.
 *
 * Enseña el párrafo COMPLETO que se va a guardar antes de dejar marcarla. Una
 * constancia que se firma sin leer no es una constancia.
 */
function ConstanciaPrecio({
  aceptada,
  cambiar,
  texto,
}: {
  aceptada: boolean
  cambiar: (valor: boolean) => void
  texto: string
}) {
  return (
    <div className="space-y-2 rounded-md border border-alerta bg-alerta-suave p-3">
      <p className="flex items-start gap-2 text-sm font-bold leading-snug text-alerta">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        Este precio no viene de un parámetro confirmado.
      </p>
      <p className="text-xs leading-snug text-suelo-700">
        Se va a añadir esto a las observaciones del contrato, palabra por palabra:
      </p>
      <p className="rounded border border-border bg-card p-2 text-xs leading-snug text-suelo-700">
        {texto}
      </p>
      <label className="flex items-start gap-2 text-sm leading-snug text-foreground">
        <input
          type="checkbox"
          checked={aceptada}
          onChange={(e) => cambiar(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-azul"
        />
        <span className="font-bold">
          Lo he escrito yo, contra el contrato firmado, y entiendo que queda anotado.
        </span>
      </label>
    </div>
  )
}

function Alerta({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-3 text-sm font-bold leading-snug text-alerta"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      {children}
    </p>
  )
}
