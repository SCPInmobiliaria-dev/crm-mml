import { useState } from 'react'
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
import { cn } from '@/lib/utils'
import { cargarParametros } from '@/lib/parametros'
import { etiquetaEstadoNivel, nivelesDePrecio, nivelesParaTipo, textoOpcionNivel } from '@/lib/precios-unidad'
import {
  ESTADOS_UNIDAD,
  SEMAFORO_DATO,
  SEMAFOROS,
  guardarUnidad,
  unidadAFormulario,
  unidadEnBlanco,
  type CampoUnidad,
  type DatosUnidad,
  type EstadoUnidad,
  type Semaforo,
  type Unidad,
} from '@/lib/inventario'

/**
 * Alta y edición de una unidad.
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
 */
export function FormularioUnidad({
  unidad,
  cerrar,
  alGuardar,
}: {
  /** `null` = alta. */
  unidad: Unidad | null
  cerrar: () => void
  alGuardar: () => void
}) {
  const esAlta = unidad === null

  const [datos, setDatos] = useState<DatosUnidad>(() =>
    unidad === null ? unidadEnBlanco() : unidadAFormulario(unidad),
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<{ motivo: string; campo?: CampoUnidad | undefined } | null>(
    null,
  )

  const parametros = useQuery({
    queryKey: ['inventario', 'parametros'],
    queryFn: cargarParametros,
  })
  const opcionesPrecio = nivelesParaTipo(nivelesDePrecio(parametros.data?.filas ?? []), datos.tipo)
  const nivelElegido = opcionesPrecio.find((n) => n.id === datos.precioParametro) ?? null

  function cambiar<C extends CampoUnidad>(campo: C, valor: DatosUnidad[C]) {
    setDatos((previo) => ({ ...previo, [campo]: valor }))
  }

  async function enviar() {
    if (guardando) return
    setGuardando(true)
    setError(null)

    const resultado = await guardarUnidad(datos, unidad?.id ?? null)
    setGuardando(false)

    if (!resultado.ok) {
      setError({ motivo: resultado.motivo, campo: resultado.campo })
      return
    }
    alGuardar()
  }

  const exigePlano = datos.estadoDato === 'verde'

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{esAlta ? 'Nueva unidad' : `Editar ${unidad.codigoUnidad}`}</DialogTitle>
          <DialogDescription>
            El precio no se escribe aquí: se elige a qué fila de <code>parametros</code> apunta.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(evento) => {
            evento.preventDefault()
            void enviar()
          }}
          className="space-y-4"
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
              Fuente del plano{exigePlano && <span className="text-alerta"> · obligatoria</span>}
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
                Declarar una unidad verificada sin decir contra qué plano es exactamente el hueco
                rellenado que produjo las 4 cifras en conflicto. La base lo rechaza
                (<code>verde_exige_plano</code>).
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
              {datos.precioParametro !== '' && !opcionesPrecio.some((n) => n.id === datos.precioParametro) && (
                <option value={datos.precioParametro}>{datos.precioParametro} (no es un nivel de este tipo)</option>
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
              elige a qué nivel apunta esta unidad. Solo salen los niveles de su tipo
              (<code>precio_puesto…</code> / <code>precio_tienda…</code>); crear o cambiar un monto lo hace
              Dirección en Parámetros.
            </p>
          </div>

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
            <Button type="button" variant="ghost" onClick={cerrar} disabled={guardando}>
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
  ayuda,
  modo,
}: {
  id: string
  etiqueta: string
  valor: string
  alCambiar: (valor: string) => void
  error?: boolean
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
        {...(modo === undefined ? {} : { inputMode: modo })}
        aria-invalid={error}
        className={cn(error && 'border-alerta')}
      />
      {ayuda !== undefined && <p className="text-xs text-suelo-500">{ayuda}</p>}
    </div>
  )
}
