import { comoRegistro, llamarRpc, type ResultadoAccion } from '@/lib/acciones'
import { aNumero, esMoneda, formatearMonto, type Moneda } from '@/lib/dinero'
import { PENDIENTE, simboloSemaforo, type Parametro } from '@/lib/parametros'

/**
 * PRECIO POR UNIDAD — la casilla de precio de /inventario (sql/19).
 *
 * Una unidad NO guarda un importe: apunta (`precio_parametro`) a un NIVEL DE
 * PRECIO, que es una fila de `parametros` con monto, moneda, fuente y
 * semáforo (07-crm\CLAUDE.md §2: así no nace el noveno precio en conflicto).
 * La convención la impone la base (fn_tipo_de_nivel_precio, 19 §1):
 *   precio_puesto…  → vale para puestos
 *   precio_tienda…  → vale para tiendas
 * Aquí solo se replica para filtrar los desplegables; si el cliente se
 * equivocara, la base rechaza el cambio igual (t_unidades_precio_valido).
 *
 * La web (fn_inventario_publico, 19 §4) ve el precio SOLO de una unidad
 * disponible y SOLO si su nivel está en 🟢 verde. Un 🔵 propuesta o un 🟡 por
 * validar se ven aquí, marcados, y no salen de aquí.
 *
 * Este archivo no tiene ninguna cifra del negocio.
 */

export type TipoNivel = 'puesto' | 'tienda'

export type NivelPrecio = {
  id: string
  tipo: TipoNivel
  descripcion: string
  monto: number | null
  moneda: Moneda | null
  semaforo: string
  fuente: string
  nota: string | null
}

/** Espejo de fn_tipo_de_nivel_precio (sql/19 §1). */
export function tipoDeNivel(idParametro: string): TipoNivel | null {
  if (idParametro.startsWith('precio_puesto')) return 'puesto'
  if (idParametro.startsWith('precio_tienda')) return 'tienda'
  return null
}

/** Mismo criterio que la base: minúsculas y sin espacios ('tienda' y 'Tienda' conviven). */
export function tipoDeUnidad(tipo: string | null): TipoNivel | null {
  const t = (tipo ?? '').trim().toLowerCase()
  return t === 'puesto' || t === 'tienda' ? t : null
}

/** Los niveles de precio entre todos los parámetros, del más barato al más caro. */
export function nivelesDePrecio(parametros: readonly Parametro[]): NivelPrecio[] {
  const niveles: NivelPrecio[] = []
  for (const p of parametros) {
    const tipo = tipoDeNivel(p.id)
    if (tipo === null) continue
    niveles.push({
      id: p.id,
      tipo,
      descripcion: p.descripcion,
      monto: aNumero(p.valorNumerico),
      moneda: esMoneda(p.valorMoneda) ? p.valorMoneda : null,
      semaforo: p.estadoSemaforo,
      fuente: p.fuente,
      nota: p.nota,
    })
  }
  return niveles.sort(
    (a, b) =>
      a.tipo.localeCompare(b.tipo) ||
      (a.monto ?? Number.POSITIVE_INFINITY) - (b.monto ?? Number.POSITIVE_INFINITY) ||
      a.id.localeCompare(b.id),
  )
}

export function nivelesParaTipo(niveles: readonly NivelPrecio[], tipoUnidad: string | null): NivelPrecio[] {
  const t = tipoDeUnidad(tipoUnidad)
  return t === null ? [] : niveles.filter((n) => n.tipo === t)
}

/** Qué significa el semáforo de un nivel para quien vende. */
export function etiquetaEstadoNivel(semaforo: string): string {
  switch (semaforo) {
    case 'verde':
      return 'vigente: la web lo muestra en las unidades disponibles'
    case 'azul':
      return 'propuesta, no se ofrece ni se publica'
    case 'amarillo':
      return 'por validar, no se publica'
    case 'negro':
      return 'histórico, no se usa'
    default:
      return 'sin valor confirmado'
  }
}

/** «🟢 US$ 25,000.00» · sin monto: el marcador de pendiente, nunca un número inventado. */
export function textoMontoNivel(n: NivelPrecio): string {
  const monto = n.monto === null ? PENDIENTE : formatearMonto(n.monto, n.moneda)
  return `${simboloSemaforo(n.semaforo)} ${monto}`
}

/** Para un desplegable: monto, semáforo y nombre del nivel. */
export function textoOpcionNivel(n: NivelPrecio): string {
  return `${textoMontoNivel(n)} · ${n.descripcion} (${n.id})`
}

/** Lo que dice la ficha de una unidad sobre su precio. */
export function textoPrecioUnidad(
  idNivel: string | null,
  niveles: ReadonlyMap<string, NivelPrecio>,
): { precio: string; detalle: string } {
  if (idNivel === null) return { precio: 'sin precio asignado', detalle: 'Sin precio propio: la web sigue con su precio general.' }
  const n = niveles.get(idNivel)
  if (n === undefined) return { precio: `nivel ${idNivel}`, detalle: 'No se pudo leer el nivel en Parámetros.' }
  return { precio: textoMontoNivel(n), detalle: `${n.descripcion} · ${etiquetaEstadoNivel(n.semaforo)}` }
}

// ---------------------------------------------------------------------------
// La asignación en bloque (fn_asignar_precio, sql/19 §3)
// ---------------------------------------------------------------------------

export type ResultadoAsignacion = {
  actualizadas: number
  sinCambio: number
  omitidas: { codigo: string; motivo: string }[]
}

function interpretarAsignacion(r: unknown): ResultadoAsignacion | null {
  const o = comoRegistro(r)
  if (o === null) return null
  const actualizadas = aNumero(o['actualizadas'] as number | string | null)
  const sinCambio = aNumero(o['sin_cambio'] as number | string | null)
  if (actualizadas === null || sinCambio === null) return null
  const omitidas = Array.isArray(o['omitidas'])
    ? o['omitidas'].flatMap((x) => {
        const e = comoRegistro(x)
        const codigo = e?.['codigo']
        const motivo = e?.['motivo']
        return typeof codigo === 'string' && typeof motivo === 'string' ? [{ codigo, motivo }] : []
      })
    : []
  return { actualizadas, sinCambio, omitidas }
}

/** `idNivel` null = quitar el precio a esas unidades. */
export async function asignarPrecio(
  unidadIds: readonly string[],
  idNivel: string | null,
): Promise<ResultadoAccion<ResultadoAsignacion>> {
  const r = await llamarRpc('fn_asignar_precio', { p_unidades: unidadIds, p_parametro: idNivel }, interpretarAsignacion)
  // mensajeDeError nombra sql/13 para cualquier función que falte: aquí la que falta es la de 19.
  if (!r.ok && r.motivo.includes('sql/13')) {
    return { ok: false, motivo: 'La base todavía no tiene la asignación de precios. Hay que ejecutar sql/19-precio-por-unidad.sql en Supabase.' }
  }
  return r
}
