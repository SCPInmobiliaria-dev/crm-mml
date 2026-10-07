import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog'
import { Input, claseCampo } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/componentes/ui/tabs'
import { cn } from '@/lib/utils'
import { cargarParametros } from '@/lib/parametros'
import {
  etiquetaEstadoNivel,
  nivelesDePrecio,
  nivelesParaTipo,
  textoOpcionNivel,
} from '@/lib/precios-unidad'
import {
  ESTADOS_UNIDAD,
  SEMAFORO_DATO,
  SEMAFOROS,
  cargarDetalleUnidad,
  guardarUnidad,
  unidadAFormulario,
  unidadEnBlanco,
  type CampoUnidad,
  type DatosUnidad,
  type EstadoUnidad,
  type Semaforo,
  type Unidad,
} from '@/lib/inventario'
import { PapelesUnidad } from './PapelesUnidad'
import { TitularUnidad } from './TitularUnidad'

export type PestanaUnidad = 'datos' | 'titular' | 'papeles'

/**
 * Alta y edición de una unidad — el inventario MAESTRO.
 *
 * Tres pestañas, porque tres cosas distintas se mantienen aquí:
 *   · Datos      lo de la unidad misma (código, área, estados, plano, kardex).
 *   · Titular    quién es el dueño y cómo contactarlo (sql/17).
 *   · Papeles    minuta, escritura, trámites… adjuntos a la unidad (sql/17).
 * Las dos últimas se guardan SOLAS, cada una con su botón: no hace falta
 * «Guardar cambios» de la primera para que el titular o un papel queden. El
 * diálogo sigue montado las tres para que cambiar de pestaña no pierda lo
 * escrito. Al cerrar, si algo cambió, se refresca el inventario.
 *
 * ---------------------------------------------------------------------------
 * AQUI NO SE ESCRIBE UN PRECIO. NUNCA.
 * ---------------------------------------------------------------------------
 * No hay casilla de importe, y no es un olvido: el precio de una unidad no es
 * un numero de la tabla `unidades`, es `precio_parametro`, un PUNTERO a una
 * fila de `parametros` que a su vez cita su archivo de 00-fuente-de-verdad y
 * lleva su semaforo. Por eso el campo es un desplegable de parametros. Asi es
 * imposible que esta pantalla cree el noveno precio en conflicto.
 *
 * ---------------------------------------------------------------------------
 * LA VALIDACION DE VERDAD NO ESTA AQUI
 * ---------------------------------------------------------------------------
 * Este formulario comprueba lo evidente antes de gastar un viaje a la red,
 * pero quien impide guardar una unidad 🟢 verificada sin plano es la
 * restriccion `verde_exige_plano` de la base
 * (08-vistas-embudo-e-inventario.sql §3). Un formulario se esquiva —una
 * importacion de CSV, el panel de Supabase—; una restriccion no.
 *
 * ---------------------------------------------------------------------------
 * EL ESTADO COMERCIAL LO MUEVEN LAS SEPARACIONES
 * ---------------------------------------------------------------------------
 * Desde sql/17, registrar o verificar una separación, firmar un contrato o
 * pagar sus cuotas mueve solo el estado de la unidad. El desplegable sigue
 * ahí para lo que decide una persona (retirarla de venta, marcarla entregada),
 * pero si hay una separación viva se avisa: cambiarlo a mano contra lo que
 * dicen los hechos se deshace en la siguiente separación.
 */
export function FormularioUnidad({
  unidad,
  cerrar,
  alGuardar,
  pestanaInicial = 'datos',
}: {
  /** `null` = alta. */
  unidad: Unidad | null
  cerrar: () => void
  alGuardar: () => void
  pestanaInicial?: PestanaUnidad
}) {
  const esAlta = unidad === null

  const [datos, setDatos] = useState<DatosUnidad>(() =>
    unidad === null ? unidadEnBlanco() : unidadAFormulario(unidad),
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<{ motivo: string; campo?: CampoUnidad | undefined } | null>(
    null,
  )
  const [pestana, setPestana] = useState<PestanaUnidad>(esAlta ? 'datos' : pestanaInicial)
  /** El titular o un papel cambiaron en otra pestaña: al cerrar hay que refrescar el inventario. */
  const huboCambios = useRef(false)
  const maestroLeido = useRef(false)

  const parametros = useQuery({
    queryKey: ['inventario', 'parametros'],
    queryFn: cargarParametros,
  })
  const opcionesPrecio = nivelesParaTipo(nivelesDePrecio(parametros.data?.filas ?? []), datos.tipo)
  const nivelElegido = opcionesPrecio.find((n) => n.id === datos.precioParametro) ?? null

  // El detalle (kardex y titular) no viene en `v_unidades_tablero`: se pide
  // aparte y, al llegar, completa los campos del inventario maestro.
  const detalle = useQuery({
    queryKey: ['inventario', 'detalle', unidad?.id ?? 'alta'],
    queryFn: () => cargarDetalleUnidad(unidad?.id ?? ''),
    enabled: unidad !== null,
  })

  useEffect(() => {
    if (maestroLeido.current || detalle.data === undefined) return
    maestroLeido.current = true
    const d = detalle.data
    setDatos((previo) => ({
      ...previo,
      tipoSocio: d.tipoSocio ?? '',
      estadoLegal: d.estadoLegal ?? '',
      estadoFisico: d.estadoFisico ?? '',
      documentoSustento: d.documentoSustento ?? '',
    }))
  }, [detalle.data])

  function cambiar<C extends CampoUnidad>(campo: C, valor: DatosUnidad[C]) {
    setDatos((previo) => ({ ...previo, [campo]: valor }))
  }

  function cerrarYRefrescar() {
    if (huboCambios.current) alGuardar()
    else cerrar()
  }

  async function enviar() {
    if (guardando) return
    setGuardando(true)
    setError(null)

    // Al editar, los cuatro campos del kardex solo se guardan si se llegaron a
    // leer: guardar «en blanco» lo que no se vio borraría el dato.
    const resultado = await guardarUnidad(datos, unidad?.id ?? null, maestroLeido.current)
    setGuardando(false)

    if (!resultado.ok) {
      setError({ motivo: resultado.motivo, campo: resultado.campo })
      return
    }
    alGuardar()
  }

  const exigePlano = datos.estadoDato === 'verde'
  const kardexPendiente = !esAlta && !maestroLeido.current && detalle.isPending

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && cerrarYRefrescar()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{esAlta ? 'Nueva unidad' : `Editar ${unidad.codigoUnidad}`}</DialogTitle>
          <DialogDescription>
            {esAlta
              ? 'Primero la unidad; el titular y los papeles se añaden después de crearla.'
              : 'Los datos de la unidad, su titular y los papeles que la respaldan. El precio no se escribe aquí: se elige a qué fila de parametros apunta.'}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={pestana} onValueChange={(v) => setPestana(v as PestanaUnidad)}>
          <TabsList className="grid h-auto w-full grid-cols-3">
            <TabsTrigger value="datos" className="h-10 font-bold sm:h-8">
              Datos
            </TabsTrigger>
            <TabsTrigger value="titular" disabled={esAlta} className="h-10 font-bold sm:h-8">
              Titular
            </TabsTrigger>
            <TabsTrigger value="papeles" disabled={esAlta} className="h-10 font-bold sm:h-8">
              Papeles y trámites
            </TabsTrigger>
          </TabsList>

          {/* ======================== DATOS ======================== */}
          <TabsContent value="datos" forceMount className="data-[state=inactive]:hidden">
            <form
              onSubmit={(evento) => {
                evento.preventDefault()
                void enviar()
              }}
              className="space-y-4 pt-2"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo
                  id="codigo"
                  etiqueta="Código de la unidad"
                  valor={datos.codigoUnidad}
                  alCambiar={(v) => cambiar('codigoUnidad', v)}
                  error={error?.campo === 'codigoUnidad'}
                  ayuda="Único. Es como se nombra la unidad en el plano."
                />
                <Campo
                  id="tipo"
                  etiqueta="Tipo"
                  valor={datos.tipo}
                  alCambiar={(v) => cambiar('tipo', v)}
                  error={error?.campo === 'tipo'}
                  ayuda="puesto · tienda · lo que diga el plano"
                />
                <Campo
                  id="area"
                  etiqueta="Área (m²)"
                  valor={datos.areaM2}
                  alCambiar={(v) => cambiar('areaM2', v)}
                  error={error?.campo === 'areaM2'}
                  modo="decimal"
                  ayuda="Vacío si todavía no se ha medido contra el plano."
                />
                <Campo
                  id="etapa"
                  etiqueta="Etapa"
                  valor={datos.etapa}
                  alCambiar={(v) => cambiar('etapa', v)}
                />
                <Campo
                  id="bloque"
                  etiqueta="Bloque"
                  valor={datos.bloque}
                  alCambiar={(v) => cambiar('bloque', v)}
                />
                <Campo
                  id="ubicacion"
                  etiqueta="Ubicación"
                  valor={datos.ubicacion}
                  alCambiar={(v) => cambiar('ubicacion', v)}
                  ayuda="Esquina, pasaje, frente… afecta al precio."
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* ---- SEMAFORO 1 · estado comercial ---- */}
                <div className="space-y-2">
                  <Label htmlFor="estado-comercial">Estado comercial</Label>
                  <select
                    id="estado-comercial"
                    value={datos.estadoComercial}
                    onChange={(e) => cambiar('estadoComercial', e.target.value as EstadoUnidad)}
                    className={claseCampo}
                  >
                    {ESTADOS_UNIDAD.map((e) => (
                      <option key={e.valor} value={e.valor}>
                        {e.simbolo} {e.etiqueta}
                      </option>
                    ))}
                  </select>
                  {unidad?.tieneSeparacionViva === true && (
                    <p className="text-xs font-bold leading-snug text-suelo-700">
                      Hay una separación viva: su estado lo mueve la separación (y el contrato, y las
                      cuotas). Cámbialo a mano solo para retirarla de venta o marcarla entregada.
                    </p>
                  )}
                </div>

                {/* ---- SEMAFORO 2 · estado del dato ---- */}
                <div className="space-y-2">
                  <Label htmlFor="estado-dato">Estado del dato</Label>
                  <select
                    id="estado-dato"
                    value={datos.estadoDato}
                    onChange={(e) => cambiar('estadoDato', e.target.value as Semaforo)}
                    className={claseCampo}
                  >
                    {SEMAFOROS.map((s) => (
                      <option key={s} value={s}>
                        {SEMAFORO_DATO[s].simbolo} {SEMAFORO_DATO[s].etiqueta}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-suelo-500">
                    Solo 🟢 permite ofrecer la unidad, y solo si además está disponible y libre.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fuente-plano">
                  Fuente del plano
                  {exigePlano && <span className="text-alerta"> · obligatoria</span>}
                </Label>
                <Input
                  id="fuente-plano"
                  value={datos.fuentePlano}
                  onChange={(e) => cambiar('fuentePlano', e.target.value)}
                  placeholder="Qué plano y de qué fecha respalda esta fila"
                  aria-invalid={error?.campo === 'fuentePlano'}
                  className={cn(error?.campo === 'fuentePlano' && 'border-alerta')}
                />
                {exigePlano && (
                  <p className="text-xs leading-snug text-suelo-700">
                    Declarar una unidad verificada sin decir contra qué plano es exactamente el
                    hueco rellenado que produjo las 4 cifras en conflicto. La base lo rechaza (
                    <code>verde_exige_plano</code>).
                  </p>
                )}
              </div>

              {/* ---- EL PRECIO, COMO PUNTERO ---- */}
              <div className="space-y-2">
                <Label htmlFor="precio-parametro">Precio de lista (nivel de Parámetros)</Label>
                <select
                  id="precio-parametro"
                  value={datos.precioParametro}
                  onChange={(e) => cambiar('precioParametro', e.target.value)}
                  className={claseCampo}
                  disabled={parametros.isPending}
                >
                  <option value="">— sin precio asignado —</option>
                  {opcionesPrecio.map((n) => (
                    <option key={n.id} value={n.id}>
                      {textoOpcionNivel(n)}
                    </option>
                  ))}
                  {/* Un nivel guardado que ya no es de su tipo (la base no lo deja, pero
                      un dato viejo sí podría): se muestra para no borrarlo sin querer. */}
                  {datos.precioParametro !== '' &&
                    !opcionesPrecio.some((n) => n.id === datos.precioParametro) && (
                      <option value={datos.precioParametro}>
                        {datos.precioParametro} (no es un nivel de este tipo)
                      </option>
                    )}
                </select>
                {nivelElegido !== null && (
                  <p className="text-xs font-bold text-suelo-700">
                    Este nivel está {etiquetaEstadoNivel(nivelElegido.semaforo)}.
                  </p>
                )}
                {parametros.error !== null && (
                  <p className="text-xs font-bold text-alerta">
                    No se pudieron leer los parámetros: {parametros.error.message}
                  </p>
                )}
                <p className="text-xs text-suelo-500">
                  La cifra vive en <code>parametros</code>, con su fuente y su semáforo: aquí solo se
                  elige a qué nivel apunta esta unidad. Solo salen los niveles de su tipo (
                  <code>precio_puesto…</code> / <code>precio_tienda…</code>); crear o cambiar un monto
                  lo hace Dirección en Parámetros.
                </p>
              </div>

              {/* ---- EL KARDEX DE LA UNIDAD ---- */}
              <fieldset className="space-y-3 rounded-md border border-input p-3">
                <legend className="px-1 text-sm font-black text-suelo">Kardex de la unidad</legend>
                {kardexPendiente && (
                  <p className="flex items-center gap-2 text-xs text-suelo-700">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    Leyendo lo que ya tiene la unidad…
                  </p>
                )}
                {!esAlta && detalle.isError && (
                  <p className="text-xs font-bold leading-snug text-suelo-700">
                    🟡 No se pudo leer el kardex ({detalle.error.message}). Estos cuatro campos no
                    se guardarán para no borrar lo que ya tengan.
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo
                    id="tipo-socio"
                    etiqueta="Tipo de socio"
                    valor={datos.tipoSocio}
                    alCambiar={(v) => cambiar('tipoSocio', v)}
                    deshabilitado={kardexPendiente || (!esAlta && detalle.isError)}
                    ayuda="Como lo dice el kardex (fundador, nuevo 2023…)."
                  />
                  <Campo
                    id="estado-legal"
                    etiqueta="Estado legal"
                    valor={datos.estadoLegal}
                    alCambiar={(v) => cambiar('estadoLegal', v)}
                    deshabilitado={kardexPendiente || (!esAlta && detalle.isError)}
                    ayuda="Minuta · Notaría · Registros Públicos · Titulado."
                  />
                  <Campo
                    id="estado-fisico"
                    etiqueta="Estado físico"
                    valor={datos.estadoFisico}
                    alCambiar={(v) => cambiar('estadoFisico', v)}
                    deshabilitado={kardexPendiente || (!esAlta && detalle.isError)}
                    ayuda="En obra, construido, entregado…"
                  />
                  <Campo
                    id="documento-sustento"
                    etiqueta="Documento de sustento"
                    valor={datos.documentoSustento}
                    alCambiar={(v) => cambiar('documentoSustento', v)}
                    deshabilitado={kardexPendiente || (!esAlta && detalle.isError)}
                    ayuda="Qué papel respalda lo anterior. Los archivos van en «Papeles y trámites»."
                  />
                </div>
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="observaciones">Observaciones</Label>
                <textarea
                  id="observaciones"
                  value={datos.observaciones}
                  onChange={(e) => cambiar('observaciones', e.target.value)}
                  rows={2}
                  className={cn(claseCampo, 'h-auto py-2')}
                />
              </div>

              {error !== null && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta"
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  {error.motivo}
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={cerrarYRefrescar} disabled={guardando}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={guardando}>
                  {guardando ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden="true" />
                      Guardando…
                    </>
                  ) : esAlta ? (
                    'Crear unidad'
                  ) : (
                    'Guardar cambios'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          {/* ======================== TITULAR ======================== */}
          {unidad !== null && (
            <TabsContent value="titular" forceMount className="data-[state=inactive]:hidden">
              <div className="pt-2">
                <TitularUnidad
                  unidad={unidad}
                  detalle={detalle}
                  alCambiar={() => {
                    huboCambios.current = true
                  }}
                />
              </div>
            </TabsContent>
          )}

          {/* ======================== PAPELES ======================== */}
          {unidad !== null && (
            <TabsContent value="papeles" forceMount className="data-[state=inactive]:hidden">
              <div className="pt-2">
                <PapelesUnidad
                  unidad={unidad}
                  alCambiar={() => {
                    huboCambios.current = true
                  }}
                />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function Campo({
  id,
  etiqueta,
  valor,
  alCambiar,
  error = false,
  deshabilitado = false,
  ayuda,
  modo,
}: {
  id: string
  etiqueta: string
  valor: string
  alCambiar: (valor: string) => void
  error?: boolean
  deshabilitado?: boolean
  ayuda?: string
  modo?: 'decimal'
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input
        id={id}
        value={valor}
        onChange={(evento) => alCambiar(evento.target.value)}
        autoComplete="off"
        disabled={deshabilitado}
        {...(modo === undefined ? {} : { inputMode: modo })}
        aria-invalid={error}
        className={cn(error && 'border-alerta')}
      />
      {ayuda !== undefined && <p className="text-xs text-suelo-500">{ayuda}</p>}
    </div>
  )
}
