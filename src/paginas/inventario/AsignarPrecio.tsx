import { useState } from 'react'
import { AlertTriangle, Check, Loader2, Tag } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { claseCampoCompacto } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import type { Unidad } from '@/lib/inventario'
import {
  asignarPrecio,
  etiquetaEstadoNivel,
  textoOpcionNivel,
  tipoDeUnidad,
  type NivelPrecio,
  type ResultadoAsignacion,
} from '@/lib/precios-unidad'

/**
 * «Asignar un precio a las unidades filtradas» — la asignación EN BLOQUE de
 * la casilla de precio (fn_asignar_precio, sql/19 §3).
 *
 * Trabaja sobre lo que el usuario ya filtró en la pantalla (tipo, rubro,
 * estado, búsqueda…): filtra primero, mira cuántas son, elige el nivel y
 * confirma. Por defecto solo toca las disponibles: una vendida no cambia de
 * precio por mover un filtro. Las de otro tipo las salta la base y las
 * devuelve con su motivo.
 *
 * La cifra NO se escribe aquí: se elige un nivel de `parametros` (con fuente
 * y semáforo). Crear o cambiar el monto de un nivel lo hace Dirección en
 * Parámetros (07-crm\CLAUDE.md §2).
 */
export function AsignarPrecio({
  unidades,
  niveles,
  alAsignar,
}: {
  /** Las unidades que pasan los filtros de la pantalla. */
  unidades: readonly Unidad[]
  niveles: readonly NivelPrecio[]
  alAsignar: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [nivel, setNivel] = useState('')
  const [soloDisponibles, setSoloDisponibles] = useState(true)
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<ResultadoAsignacion | null>(null)

  const QUITAR = '__quitar__'
  const elegido = niveles.find((n) => n.id === nivel) ?? null
  const objetivo = unidades.filter((u) => !soloDisponibles || u.estadoComercial === 'disponible')
  const delTipo = elegido === null ? objetivo : objetivo.filter((u) => tipoDeUnidad(u.tipo) === elegido.tipo)
  const saltadas = objetivo.length - delTipo.length

  function reiniciar() {
    setConfirmando(false)
    setError(null)
    setHecho(null)
  }

  async function aplicar() {
    if (nivel === '' || objetivo.length === 0) return
    setOcupado(true)
    setError(null)
    const r = await asignarPrecio(
      objetivo.map((u) => u.id),
      nivel === QUITAR ? null : nivel,
    )
    setOcupado(false)
    setConfirmando(false)
    if (!r.ok) {
      setError(r.motivo)
      return
    }
    setHecho(r.datos)
    alAsignar()
  }

  if (!abierto) {
    return (
      <div className="mb-3">
        <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
          <Tag strokeWidth={1.75} aria-hidden="true" />
          Asignar precio a las unidades filtradas
        </Button>
      </div>
    )
  }

  const puestos = niveles.filter((n) => n.tipo === 'puesto')
  const tiendas = niveles.filter((n) => n.tipo === 'tienda')

  return (
    <section aria-label="Asignar precio en bloque" className="mb-4 rounded-md border border-border bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-black text-azul">Asignar precio a las unidades filtradas</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAbierto(false)
            reiniciar()
          }}
        >
          Cerrar
        </Button>
      </div>
      <p className="mt-1 text-xs text-suelo-700">
        Filtra arriba (tipo, rubro, estado, búsqueda) y elige el nivel. La cifra vive en Parámetros con su
        fuente y su semáforo: aquí solo se elige a qué nivel apunta cada unidad. La web solo publica los
        niveles 🟢.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="nivel-precio-bloque">Nivel de precio</Label>
          <select
            id="nivel-precio-bloque"
            value={nivel}
            onChange={(e) => {
              setNivel(e.target.value)
              reiniciar()
            }}
            className={claseCampoCompacto}
          >
            <option value="">— elige un nivel —</option>
            {puestos.length > 0 && (
              <optgroup label="Puestos">
                {puestos.map((n) => (
                  <option key={n.id} value={n.id}>
                    {textoOpcionNivel(n)}
                  </option>
                ))}
              </optgroup>
            )}
            {tiendas.length > 0 && (
              <optgroup label="Tiendas">
                {tiendas.map((n) => (
                  <option key={n.id} value={n.id}>
                    {textoOpcionNivel(n)}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={QUITAR}>— quitar el precio —</option>
          </select>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-xs font-bold text-suelo-700">
          <input
            type="checkbox"
            checked={soloDisponibles}
            onChange={(e) => {
              setSoloDisponibles(e.target.checked)
              reiniciar()
            }}
          />
          Solo las disponibles
        </label>
      </div>

      {niveles.length === 0 && (
        <p className="mt-2 text-xs font-bold text-alerta">
          No hay niveles de precio en Parámetros (precio_puesto… / precio_tienda…). Dirección los crea allí.
        </p>
      )}

      {nivel !== '' && (
        <p className="mt-3 text-xs text-suelo-700">
          {nivel === QUITAR ? 'Se quita el precio a ' : 'Se asigna a '}
          <span className="font-bold">
            {delTipo.length} {delTipo.length === 1 ? 'unidad' : 'unidades'}
          </span>
          {soloDisponibles ? ' disponibles' : ''} de las {unidades.length} filtradas
          {saltadas > 0 && elegido !== null ? ` (${saltadas} de otro tipo se saltan)` : ''}.
          {elegido !== null && <> Este nivel está {etiquetaEstadoNivel(elegido.semaforo)}.</>}
        </p>
      )}

      {error !== null && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-xs font-bold text-alerta">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {hecho !== null && (
        <div role="status" className="mt-3 rounded-md bg-tinta-fila p-3 text-xs">
          <p className="flex items-center gap-2 font-bold text-azul">
            <Check className="h-4 w-4" aria-hidden="true" />
            {hecho.actualizadas} {hecho.actualizadas === 1 ? 'unidad actualizada' : 'unidades actualizadas'} ·{' '}
            {hecho.sinCambio} ya {hecho.sinCambio === 1 ? 'lo tenía' : 'lo tenían'}
            {hecho.omitidas.length > 0 ? ` · ${hecho.omitidas.length} saltadas` : ''}
          </p>
          {hecho.omitidas.length > 0 && (
            <p className="mt-1 text-suelo-700">
              {hecho.omitidas
                .slice(0, 12)
                .map((o) => `${o.codigo} (${o.motivo})`)
                .join(' · ')}
              {hecho.omitidas.length > 12 ? ` · y ${hecho.omitidas.length - 12} más` : ''}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!confirmando ? (
          <Button size="sm" disabled={nivel === '' || delTipo.length === 0 || ocupado} onClick={() => setConfirmando(true)}>
            {nivel === QUITAR ? 'Quitar el precio' : 'Asignar'}
          </Button>
        ) : (
          <>
            <Button size="sm" disabled={ocupado} onClick={() => void aplicar()}>
              {ocupado && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Confirmar: {delTipo.length} {delTipo.length === 1 ? 'unidad' : 'unidades'}
            </Button>
            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => setConfirmando(false)}>
              Volver
            </Button>
          </>
        )}
      </div>
    </section>
  )
}
