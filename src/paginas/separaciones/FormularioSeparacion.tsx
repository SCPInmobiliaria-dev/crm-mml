import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Loader2, Paperclip } from 'lucide-react'
import { CabeceraPantalla, MigajaVolver } from '@/componentes/marca/CabeceraPantalla'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { Input, claseCampo } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import { MONEDAS, type Moneda } from '@/lib/dinero'
import { cargarTarjetas, etiquetaEstado } from '@/lib/embudo'
import { cargarUnidadesOfrecibles } from '@/lib/inventario'
import {
  PARAMETRO,
  PARAMETROS_DEL_FORMULARIO,
  crearSeparacion,
  separacionEnBlanco,
  type CampoSeparacion,
  type DatosSeparacion,
} from '@/lib/separaciones'
import {
  PENDIENTE,
  cargarParametrosPorId,
  enteroDeParametro,
  numeroDeParametro,
  sePuedeProponer,
  simboloSemaforo,
  textoDeParametro,
  type Parametro,
} from '@/lib/parametros'
import { AvisoDosRelojes, TarjetaReloj } from './RelojesSeparacion'

/**
 * FORMULARIO DE SEPARACIÓN — el alta del S/500.
 *
 * ===========================================================================
 * AQUI NO SE INVENTA NI UN NUMERO
 * ===========================================================================
 * El monto se PROPONE desde `parametros('separacion_monto')`. Ese parámetro
 * está hoy en 🔴 rojo (04-seed-parametros.sql), así que lo que se muestra es
 * «[PENDIENTE — ver 00-fuente-de-verdad]» y la casilla se queda VACÍA. No se
 * escribe una cifra por nuestra cuenta: así nacieron los 8 precios en
 * conflicto que documenta 00-fuente-de-verdad.
 *
 * Lo que sí se pide es el monto REALMENTE depositado, que es un hecho del
 * voucher, no una condición comercial. Son cosas distintas y por eso una se
 * teclea y la otra no.
 *
 * ===========================================================================
 * LOS DOS RELOJES, EN DOS TARJETAS
 * ===========================================================================
 * Ver el encabezado de RelojesSeparacion.tsx. Aquí lo importante es lo que el
 * formulario NO manda: `fecha_limite_devolucion`. Esa fecha la escribe la base
 * a partir del depósito efectivo. Calcularla aquí sería romper R4 en el sitio
 * exacto donde más caro sale.
 *
 * ===========================================================================
 * EL SELECTOR DE UNIDAD
 * ===========================================================================
 * Solo ofrece lo que devuelve `v_unidades_ofrecibles`. No es una lista de
 * unidades con un filtro: es la vista, tal cual.
 */
export function FormularioSeparacion() {
  const { perfil } = useSesion()
  const navegar = useNavigate()
  const clienteConsultas = useQueryClient()

  const [datos, setDatos] = useState<DatosSeparacion>(separacionEnBlanco)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<{ motivo: string; campo?: CampoSeparacion | undefined } | null>(
    null,
  )

  const oportunidades = useQuery({ queryKey: ['embudo', 'tarjetas'], queryFn: cargarTarjetas })
  const unidades = useQuery({
    queryKey: ['inventario', 'ofrecibles'],
    queryFn: cargarUnidadesOfrecibles,
  })
  const parametros = useQuery({
    queryKey: ['parametros', PARAMETROS_DEL_FORMULARIO],
    queryFn: () => cargarParametrosPorId(PARAMETROS_DEL_FORMULARIO),
  })

  const pMonto = parametros.data?.[PARAMETRO.monto] ?? null
  const pPlazo = parametros.data?.[PARAMETRO.plazoDevolucion] ?? null
  const pBanco = parametros.data?.[PARAMETRO.banco] ?? null

  /**
   * La propuesta se escribe UNA sola vez, cuando llegan los parámetros, y
   * nunca vuelve a pisar lo que haya tecleado la persona. Un formulario que
   * te reescribe el monto mientras escribes es un formulario en el que acabas
   * guardando otra cifra.
   */
  const yaPropuesto = useRef(false)
  useEffect(() => {
    if (yaPropuesto.current || parametros.data === undefined) return
    yaPropuesto.current = true

    const propuesto = numeroDeParametro(pMonto)
    const banco = sePuedeProponer(pBanco) ? pBanco?.valorTexto : null

    setDatos((previo) => ({
      ...previo,
      monto: propuesto === null ? previo.monto : String(propuesto),
      montoMoneda:
        propuesto !== null && esMonedaConocida(pMonto?.valorMoneda) && previo.montoMoneda === ''
          ? pMonto.valorMoneda
          : previo.montoMoneda,
      banco: banco ?? previo.banco,
    }))
  }, [parametros.data, pMonto, pBanco])

  function cambiar<C extends CampoSeparacion>(campo: C, valor: DatosSeparacion[C]) {
    setDatos((previo) => ({ ...previo, [campo]: valor }))
  }

  /** Al elegir la oportunidad se arrastra su persona: no se pide dos veces. */
  function elegirOportunidad(oportunidadId: string) {
    const elegida = (oportunidades.data?.filas ?? []).find((t) => t.id === oportunidadId)
    setDatos((previo) => ({
      ...previo,
      oportunidadId,
      personaId: elegida?.personaId ?? '',
    }))
  }

  async function enviar() {
    if (guardando || perfil === null) return
    setGuardando(true)
    setError(null)

    const resultado = await crearSeparacion(datos, archivo, perfil.id)
    setGuardando(false)

    if (!resultado.ok) {
      setError({ motivo: resultado.motivo, campo: resultado.campo })
      return
    }
    // sql/17: la base ya movió la unidad a «reservada temporal». Inventario (y la
    // lista de unidades ofrecibles de este mismo formulario) deben releerse.
    void clienteConsultas.invalidateQueries({ queryKey: ['inventario'] })
    void clienteConsultas.invalidateQueries({ queryKey: ['separaciones'] })
    navegar(`/separaciones/${resultado.id}`)
  }

  if (perfil === null) return null

  // `sep_crear` de 02-rls.sql. Esconder el formulario no protege nada: evita
  // que alguien lo rellene entero para que la base se lo rechace al final.
  const puedeRegistrar = ['direccion', 'comercial', 'administracion'].includes(perfil.rol)

  if (!puedeRegistrar) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Volver />
        <p className="mt-4 rounded-md border border-border bg-card p-4 text-sm">
          Tu rol (<span className="font-bold">{perfil.rol}</span>) no puede registrar
          separaciones. La política <code>sep_crear</code> las reserva a dirección, comercial y
          administración.
        </p>
      </div>
    )
  }

  const faltaPlazo = enteroDeParametro(pPlazo) === null
  const hayDeposito = datos.fechaDepositoEfectivo !== ''

  return (
    <>
      <CabeceraPantalla
        ancho="formulario"
        migaja={<MigajaVolver a="/separaciones">Separaciones</MigajaVolver>}
        titulo="Nueva separación"
        descripcion="Lo que se registre aquí es dinero recibido y dos plazos legales. Nada se rellena solo."
      />

      <div className="mx-auto w-full max-w-3xl">

      <form
        onSubmit={(evento) => {
          evento.preventDefault()
          void enviar()
        }}
        className="space-y-5"
      >
        {/* ---- 1 · PERSONA Y OPORTUNIDAD ---- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Persona</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            <div className="space-y-2">
              <Label htmlFor="oportunidad">Persona y oportunidad</Label>
              <select
                id="oportunidad"
                value={datos.oportunidadId}
                onChange={(e) => elegirOportunidad(e.target.value)}
                className={cn(claseCampo, error?.campo === 'oportunidadId' && 'border-alerta')}
                disabled={oportunidades.isPending}
              >
                <option value="">— elige a quién separa —</option>
                {(oportunidades.data?.filas ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombreCompleto} · {etiquetaEstado(t.estado)}
                    {t.lanzamiento === null ? '' : ` · ${t.lanzamiento}`}
                  </option>
                ))}
              </select>
              <p className="text-xs leading-snug text-suelo-500">
                La separación va atada a una oportunidad, no solo a una persona:{' '}
                <code>separaciones.oportunidad_id</code> es obligatorio y es lo que la conecta con
                el embudo. Solo salen las oportunidades <span className="font-bold">activas</span>.
              </p>
              {oportunidades.error !== null && (
                <p className="text-xs font-bold text-alerta">{oportunidades.error.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ---- 2 · UNIDAD ---- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Unidad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pb-4">
            <Label htmlFor="unidad" className="sr-only">
              Unidad
            </Label>
            <select
              id="unidad"
              value={datos.unidadId}
              onChange={(e) => cambiar('unidadId', e.target.value)}
              className={claseCampo}
              disabled={unidades.isPending}
            >
              <option value="">— sin unidad asignada todavía —</option>
              {(unidades.data?.filas ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.codigoUnidad}
                  {u.tipo === null ? '' : ` · ${u.tipo}`}
                  {u.areaM2 === null ? '' : ` · ${u.areaM2} m²`}
                </option>
              ))}
            </select>

            <p className="text-xs leading-snug text-suelo-500">
              Solo aparecen las unidades de <code>v_unidades_ofrecibles</code>: disponibles,
              verificadas contra plano, sin asignación activa y sin separación viva (Acta 03-O02).
            </p>

            {unidades.data !== undefined && unidades.data.filas.length === 0 && (
              <p className="rounded-md bg-alerta-suave p-2 text-xs font-bold leading-snug text-alerta">
                🔴 No hay ninguna unidad ofrecible ahora mismo: solo se ofrecen las que están
                disponibles, verificadas contra el plano y sin asignación ni separación viva.
                Revisa el inventario.
              </p>
            )}

            {datos.unidadId === '' && (
              <p className="text-xs font-bold leading-snug text-suelo-700">
                🟡 Sin unidad, esta separación no bloquea nada en el inventario: cualquiera podrá
                separar ese mismo puesto. El esquema lo permite; conviene volver y asignarla.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ---- 3 · EL DINERO ---- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">El depósito</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pb-4">
            <PropuestaDelMonto parametro={pMonto} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="monto">Monto depositado</Label>
                <Input
                  id="monto"
                  value={datos.monto}
                  onChange={(e) => cambiar('monto', e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="Lo que dice el voucher"
                  aria-invalid={error?.campo === 'monto'}
                  className={cn('tabular-nums', error?.campo === 'monto' && 'border-alerta')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="moneda">Moneda</Label>
                <select
                  id="moneda"
                  value={datos.montoMoneda}
                  onChange={(e) => cambiar('montoMoneda', e.target.value as Moneda | '')}
                  className={cn(claseCampo, error?.campo === 'montoMoneda' && 'border-alerta')}
                >
                  <option value="">— elige —</option>
                  {MONEDAS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                {/* R7: nunca un número suelto. Y no se elige una por defecto,
                    porque la moneda de control del negocio sigue pendiente. */}
                <p className="text-xs text-suelo-500">
                  Sin moneda por defecto: <code>moneda_de_control</code> sigue {PENDIENTE}.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="banco">Banco</Label>
                <Input
                  id="banco"
                  value={datos.banco}
                  onChange={(e) => cambiar('banco', e.target.value)}
                  autoComplete="off"
                />
                {sePuedeProponer(pBanco) && (
                  <p className="text-xs text-suelo-500">
                    Propuesto desde <code>parametros(banco_receptor)</code>{' '}
                    {simboloSemaforo(pBanco?.estadoSemaforo ?? '')}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="operacion">Número de operación</Label>
                <Input
                  id="operacion"
                  value={datos.nroOperacion}
                  onChange={(e) => cambiar('nroOperacion', e.target.value)}
                  autoComplete="off"
                  inputMode="numeric"
                />
              </div>
            </div>

            {hayDeposito && (datos.banco.trim() === '' || datos.nroOperacion.trim() === '') && (
              <p className="text-xs font-bold leading-snug text-suelo-700">
                🟡 Has puesto fecha de depósito efectivo pero falta el banco o el número de
                operación. No es obligatorio para guardar, pero sin eso el depósito no se puede
                rastrear cuando alguien lo reclame.
              </p>
            )}

            {/* ---- COMPROBANTE ---- */}
            <div className="space-y-2">
              <Label htmlFor="comprobante">Comprobante</Label>
              <input
                id="comprobante"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                className={cn(
                  'block w-full rounded-md border border-input bg-transparent text-sm',
                  'file:mr-3 file:cursor-pointer file:border-0 file:bg-secondary',
                  'file:px-3 file:py-2 file:text-sm file:font-bold file:text-secondary-foreground',
                )}
              />
              <p className="flex items-start gap-1.5 text-xs leading-snug text-suelo-500">
                <Paperclip className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                Se sube al bucket privado <code>comprobantes</code>, no a la galería del celular
                ni a un grupo de WhatsApp. Solo lo ve quien tiene sesión en el CRM.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ---- 4 · LOS DOS RELOJES ---- */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-black tracking-tight text-foreground">Los dos plazos</h2>
          </div>
          <AvisoDosRelojes />

          <div className="grid gap-4 md:grid-cols-2">
            <TarjetaReloj
              numero={1}
              titulo="Derecho de devolución"
              desdeQue="Se cuenta desde la fecha de depósito efectivo."
              quienLoEscribe="La fecha límite la calcula la base de datos. Aquí solo se dice cuándo entró el dinero."
            >
              <Label htmlFor="deposito" className="text-xs">
                Fecha de depósito efectivo
              </Label>
              <Input
                id="deposito"
                type="date"
                value={datos.fechaDepositoEfectivo}
                onChange={(e) => cambiar('fechaDepositoEfectivo', e.target.value)}
                className="tabular-nums"
              />

              {!hayDeposito && (
                <p className="text-xs leading-snug text-suelo-700">
                  Vacío: el reloj 1 <span className="font-bold">no ha empezado a correr</span>. Se
                  puede registrar la separación igual y volver cuando el depósito se confirme.
                </p>
              )}

              {hayDeposito && faltaPlazo && (
                <p className="rounded-md bg-alerta-suave p-2 text-xs font-bold leading-snug text-alerta">
                  🔴 La base va a rechazar el registro: el parámetro{' '}
                  <code>{PARAMETRO.plazoDevolucion}</code> no tiene valor cargado, y sin él no se
                  puede calcular hasta cuándo hay derecho a devolución. Cárgalo desde{' '}
                  <code>00-fuente-de-verdad</code>, o deja la fecha vacía por ahora.
                </p>
              )}

              {hayDeposito && !faltaPlazo && (
                <p className="text-xs leading-snug text-suelo-500">
                  La base sumará los días de <code>{PARAMETRO.plazoDevolucion}</code>{' '}
                  {simboloSemaforo(pPlazo?.estadoSemaforo ?? '')} a esta fecha.
                </p>
              )}
            </TarjetaReloj>

            <TarjetaReloj
              numero={2}
              titulo="Vigencia del precio post-evento"
              desdeQue="Es un campo independiente. No sale del depósito ni del reloj 1."
              quienLoEscribe="La escribes tú, con la fecha que corresponda según lo pactado."
            >
              <Label htmlFor="limite-precio" className="text-xs">
                Fecha límite de vigencia del precio
              </Label>
              <Input
                id="limite-precio"
                type="date"
                value={datos.fechaLimitePrecio}
                onChange={(e) => cambiar('fechaLimitePrecio', e.target.value)}
                className="tabular-nums"
              />
              <p className="text-xs leading-snug text-suelo-500">
                Este campo no se rellena solo a propósito. Derivarlo del otro plazo es el error
                que la regla R4 existe para impedir.
              </p>
            </TarjetaReloj>
          </div>
        </section>

        {/* ---- 5 · DOCUMENTO DEL CLIENTE ---- */}
        <Card>
          <CardContent className="space-y-3 pt-5">
            <div className="flex items-start gap-3 rounded-md border border-border p-3">
              <input
                id="doc-cliente"
                type="checkbox"
                checked={datos.docClienteRegistrado}
                onChange={(e) => cambiar('docClienteRegistrado', e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-azul"
              />
              <Label htmlFor="doc-cliente" className="cursor-pointer text-sm font-normal leading-snug">
                El documento del cliente (DNI/CE) quedó registrado en su ficha.
                <span className="mt-0.5 block text-xs text-suelo-500">
                  Es una de las tres condiciones de <code>puede_emitir_constancia</code>: sin
                  esto, la constancia no se podrá emitir aunque Walter verifique.
                </span>
              </Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notas">Notas</Label>
              <textarea
                id="notas"
                value={datos.notas}
                onChange={(e) => cambiar('notas', e.target.value)}
                rows={2}
                className={cn(claseCampo, 'h-auto py-2')}
              />
            </div>
          </CardContent>
        </Card>

        {error !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-alerta bg-alerta-suave p-3 text-sm font-bold text-alerta"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {error.motivo}
          </p>
        )}

        {/* La acción principal, en ámbar sobre azul: la regla dura de marca
            dice que el ámbar nunca toca una superficie clara. */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md bg-azul px-5 py-4">
          <p className="text-xs leading-snug text-azul-300">
            Nace <span className="font-bold">sin verificar</span>: la política{' '}
            <code>sep_crear</code> lo exige. Solo Dirección puede verificarla después (R2).
          </p>
          <Button
            type="submit"
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
              'Registrar separación'
            )}
          </Button>
        </div>
      </form>
      </div>
    </>
  )
}

/**
 * Qué dice `parametros('separacion_monto')` hoy.
 *
 * Si está en rojo (o no tiene valor), se escribe el marcador y NADA MÁS: no se
 * propone ninguna cifra. Si está en amarillo o azul, se propone pero con su
 * símbolo delante, para que quien lo mire sepa que no está confirmado.
 */
function PropuestaDelMonto({ parametro }: { parametro: Parametro | null }) {
  const proponible = sePuedeProponer(parametro)

  return (
    <div
      className={cn(
        'rounded-md p-3 text-xs leading-snug',
        proponible ? 'bg-secondary text-secondary-foreground' : 'bg-alerta-suave text-alerta',
      )}
    >
      <p className="font-bold">
        Monto de separación según <code>parametros(separacion_monto)</code>:{' '}
        {proponible ? (
          <>
            {simboloSemaforo(parametro?.estadoSemaforo ?? '')}{' '}
            {String(numeroDeParametro(parametro) ?? textoDeParametro(parametro))}{' '}
            {parametro?.valorMoneda ?? ''}
          </>
        ) : (
          PENDIENTE
        )}
      </p>
      {!proponible && (
        <p className="mt-1 font-normal text-suelo-700">
          No se rellena ninguna cifra por nuestra cuenta. Escribe el monto que dice el voucher.
          Fuente del parámetro: <code>{parametro?.fuente ?? 'sin cargar'}</code>
        </p>
      )}
      {proponible && parametro?.estadoSemaforo !== 'verde' && (
        <p className="mt-1 font-normal">
          Ojo: ese parámetro no está confirmado ({simboloSemaforo(parametro?.estadoSemaforo ?? '')}
          ). Comprueba contra el voucher antes de guardar.
        </p>
      )}
    </div>
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

function esMonedaConocida(valor: string | null | undefined): valor is Moneda {
  return typeof valor === 'string' && (MONEDAS as readonly string[]).includes(valor)
}
