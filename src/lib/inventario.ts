import { supabase } from '@/lib/supabase'
import { booleano, leerLote, monto, texto, type Lote } from '@/lib/lectura'
import { comoRegistro, llamarRpc, type ResultadoAccion } from '@/lib/acciones'
import { normalizarTelefono } from '@/lib/telefono'
import type { Rol } from '@/auth/tipos-sesion'

/**
 * Datos de la pantalla Inventario.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTE ARCHIVO NO PUEDE HACER
 * ---------------------------------------------------------------------------
 * No decide que unidad se puede ofrecer. Eso lo decide `v_unidades_ofrecibles`
 * (03-vistas.sql §7), y la pantalla se limita a obedecerla. Aqui solo se
 * TRADUCE el «no» de esa vista a una frase que un humano pueda leer, usando
 * las banderas que devuelve `v_unidades_tablero`.
 *
 * Si algun dia la explicacion y la vista discreparan, manda la vista: la
 * pantalla apaga la fila igual, y dice que no sabe por que. Preferimos un
 * «no se» a una explicacion inventada — es literalmente la regla de
 * 07-crm\CLAUDE.md §3.
 *
 * ---------------------------------------------------------------------------
 * NINGUNA CIFRA DE NEGOCIO VIVE AQUI
 * ---------------------------------------------------------------------------
 * Ni precios, ni total de unidades, ni areas. El precio de una unidad no es un
 * numero en esta tabla: es `precio_parametro`, un PUNTERO a una fila de
 * `parametros`, que a su vez cita su archivo de 00-fuente-de-verdad. Por eso el
 * formulario de alta ofrece un desplegable de parametros y no una casilla
 * donde escribir soles.
 */

// ---------------------------------------------------------------------------
// El aviso permanente
// ---------------------------------------------------------------------------

/**
 * El aviso que encabeza la pantalla YA NO es un texto fijo.
 *
 * Hasta la migracion 14 decia «el inventario maestro esta bloqueado: falta el
 * plano vigente y hay 4 cifras en conflicto». Con el plano vigente conciliado
 * en 00-fuente-de-verdad\inventario-maestro.md y cargado con
 * fn_importar_inventario, esa frase seria falsa. Pero tampoco se reemplaza por
 * otra frase fija con el total: el total de unidades es una cifra de negocio y
 * no puede vivir literal en el codigo (07-crm\CLAUDE.md §2). Por eso la
 * pantalla CUENTA las filas que de verdad cargo (`resumirInventario`) y cita la
 * fuente; si la tabla esta vacia, lo dice en rojo.
 */

/** Parametro con la fuente y la fecha de corte de la disponibilidad (sql/14 §3). */
export const PARAMETRO_CORTE_DISPONIBILIDAD = 'inventario_disponibilidad_corte'

/** Lo que se cuenta para el aviso. Solo filas leidas; nada tecleado a mano. */
export type ResumenInventario = {
  total: number
  puestos: number
  tiendas: number
  /** Filas con un tipo que no es ni puesto ni tienda: se cuentan aparte, no se esconden. */
  otros: number
  sinUbicacion: number
  porRevisar: number
}

export function resumirInventario(unidades: readonly Unidad[]): ResumenInventario {
  let puestos = 0
  let tiendas = 0
  let sinUbicacion = 0
  let porRevisar = 0
  for (const u of unidades) {
    const tipo = (u.tipo ?? '').toLowerCase()
    if (tipo === 'puesto') puestos++
    else if (tipo === 'tienda') tiendas++
    if (u.geometria === null) sinUbicacion++
    if (u.revisar !== null) porRevisar++
  }
  return {
    total: unidades.length,
    puestos,
    tiendas,
    otros: unidades.length - puestos - tiendas,
    sinUbicacion,
    porRevisar,
  }
}

export const FUENTE_INVENTARIO = '00-fuente-de-verdad/inventario-maestro.md'

/**
 * Roles que pueden dar de alta o editar una unidad.
 *
 * ESTO NO ES SEGURIDAD: es comodidad, igual que src/auth/secciones.ts. Se
 * COPIA de la politica `unidades_escribir` de 02-rls.sql —
 * `es(array['direccion','administracion'])`, que a su vez viene del Acta
 * 03-O02 («Rosa es responsable de mantener el inventario»). Quien impide de
 * verdad la escritura es RLS, en el servidor. Aqui solo se evita dibujar un
 * formulario que iba a fallar al guardar.
 */
export const ROLES_QUE_MANTIENEN_INVENTARIO: readonly Rol[] = ['direccion', 'administracion']

export function puedeMantenerInventario(rol: Rol | null): boolean {
  return rol !== null && ROLES_QUE_MANTIENEN_INVENTARIO.includes(rol)
}

/** Tope de filas por consulta. Si se alcanza, la pantalla lo dice. */
export const LIMITE_UNIDADES = 1000

// ---------------------------------------------------------------------------
// Los dos semaforos de cada fila
// ---------------------------------------------------------------------------

/**
 * SEMAFORO 2 · estado del dato. Es literal: `unidades.estado_dato` ES el enum
 * `semaforo` de 01-schema.sql, con el significado que fija la tabla de
 * 07-crm\CLAUDE.md §3. Aqui no se interpreta nada, solo se pone el simbolo.
 */
export const SEMAFORO_DATO = {
  verde: { simbolo: '🟢', etiqueta: 'Verificada contra plano' },
  amarillo: { simbolo: '🟡', etiqueta: 'Por validar' },
  rojo: { simbolo: '🔴', etiqueta: 'Sin verificar' },
  azul: { simbolo: '🔵', etiqueta: 'Propuesta' },
  negro: { simbolo: '⚫', etiqueta: 'Histórico' },
} as const

export type Semaforo = keyof typeof SEMAFORO_DATO

export const SEMAFOROS: readonly Semaforo[] = ['verde', 'amarillo', 'rojo', 'azul', 'negro']

export function esSemaforo(valor: unknown): valor is Semaforo {
  return typeof valor === 'string' && (SEMAFOROS as readonly string[]).includes(valor)
}

/**
 * SEMAFORO 1 · estado comercial.
 *
 * 🔵 PROPUESTA — a diferencia del anterior, este NO es un enum semaforo en la
 * base: `unidades.estado_comercial` es el enum `estado_unidad`, que tiene siete
 * valores y ningun color asociado. El simbolo de aqui es una LECTURA, y
 * responde a una sola pregunta, la que se hace quien mira el inventario:
 *
 *     ¿se puede ofrecer hoy?
 *
 *   🟢 libre · 🟡 bloqueo temporal (reservada o separada) · ⚫ vendida · 🔴 fuera de venta
 *
 * Por eso el simbolo NUNCA va solo: al lado va siempre la palabra exacta del
 * enum. La palabra es el dato; el simbolo es la urgencia. Y por eso una unidad
 * `contratada` sale en ⚫ y no en rojo: esta fuera de la oferta, que no es lo
 * mismo que estar mal.
 *
 * Sin ratificar por Direccion. Si Walter prefiere otra lectura, se cambia esta
 * tabla y no hay que tocar la base.
 */
export const ESTADOS_UNIDAD = [
  { valor: 'disponible', etiqueta: 'Disponible', simbolo: '🟢' },
  { valor: 'reservada_temporal', etiqueta: 'Reservada temporal', simbolo: '🟡' },
  // 🟡 y no ⚫ (07/10/2026): una separación «no es venta, no es contrato
  // firmado y no asigna definitivamente una unidad física»
  // (00-fuente-de-verdad\separacion-vigente.md §1). Es un bloqueo, no una
  // unidad colocada; y la web la enseña como «separada», no como vendida.
  { valor: 'separada', etiqueta: 'Separada', simbolo: '🟡' },
  { valor: 'contratada', etiqueta: 'Contratada', simbolo: '⚫' },
  { valor: 'pagada', etiqueta: 'Pagada', simbolo: '⚫' },
  { valor: 'entregada', etiqueta: 'Entregada', simbolo: '⚫' },
  { valor: 'no_disponible', etiqueta: 'No disponible', simbolo: '🔴' },
] as const

export type EstadoUnidad = (typeof ESTADOS_UNIDAD)[number]['valor']

export function esEstadoUnidad(valor: unknown): valor is EstadoUnidad {
  return (
    typeof valor === 'string' && ESTADOS_UNIDAD.some((e) => e.valor === valor)
  )
}

/** Estado comercial desconocido: se muestra crudo, no se maquilla. */
export function leerEstadoComercial(valor: string): { etiqueta: string; simbolo: string } {
  const conocido = ESTADOS_UNIDAD.find((e) => e.valor === valor)
  return conocido ?? { etiqueta: valor, simbolo: '❔' }
}

// ---------------------------------------------------------------------------
// Lo que el PLANO enseña de una unidad
// ---------------------------------------------------------------------------

/**
 * La situación de una unidad tal como la pinta el plano del CRM.
 *
 * Hasta el 07/10/2026 el plano pintaba SOLO `estado_comercial`, y nada movía
 * ese estado al registrar una separación: una unidad recién separada seguía
 * pintada como «Disponible» (o como estaba) y solo la ficha decía que no se
 * podía ofrecer. Ahora se pinta por los HECHOS, igual que la web:
 *
 *   separada    hay una separación viva, o una oportunidad activa la tiene
 *               asignada, o el estado guardado es reservada_temporal/separada
 *   vendida     contratada, pagada o entregada
 *   no_disponible  retirada de venta (el estado lo puso una persona)
 *   disponible  el estado guardado dice disponible y nada la está tomando
 *
 * La separación va PRIMERO, como en fn_inventario_publico (sql/16 y 19): si
 * una unidad tiene una separación viva, eso es lo que se ve, diga lo que diga
 * el estado guardado. Que se pueda OFRECER lo sigue decidiendo
 * `v_unidades_ofrecibles` (columna `ofrecible`); esto solo decide el color.
 *
 * Una diferencia a propósito con la web: la web enseña una unidad ASIGNADA a
 * una oportunidad (sin separación) como «no disponible», para no publicar el
 * embudo de ventas. El equipo sí necesita verla como lo que es —un bloqueo
 * mientras se cierra, que es la definición de `reservada_temporal` en
 * 01-schema.sql—, así que aquí sale con las franjas de reservada.
 */
export type SituacionPlano = 'disponible' | 'separada' | 'vendida' | 'no_disponible' | 'desconocida'

export const SITUACIONES_PLANO: readonly { valor: SituacionPlano; etiqueta: string }[] = [
  { valor: 'disponible', etiqueta: 'Disponible' },
  { valor: 'separada', etiqueta: 'Separada o reservada' },
  { valor: 'vendida', etiqueta: 'Vendida (contratada, pagada o entregada)' },
  { valor: 'no_disponible', etiqueta: 'No disponible (retirada de venta)' },
]

export function situacionEnPlano(u: Unidad): SituacionPlano {
  const e = u.estadoComercial
  if (u.tieneSeparacionViva === true || e === 'reservada_temporal' || e === 'separada') return 'separada'
  if (e === 'contratada' || e === 'pagada' || e === 'entregada') return 'vendida'
  if (e === 'no_disponible') return 'no_disponible'
  if (e === 'disponible') return u.tieneAsignacionActiva === true ? 'separada' : 'disponible'
  return 'desconocida'
}

/** La frase corta de la situación, con el PORQUÉ cuando no sale del estado guardado. */
export function textoSituacion(u: Unidad): string {
  const s = situacionEnPlano(u)
  if (s === 'separada') {
    if (u.tieneSeparacionViva === true) return 'Separada · separación viva'
    if (u.tieneAsignacionActiva === true && u.estadoComercial === 'disponible') {
      return 'Reservada · asignada a una oportunidad activa'
    }
    return leerEstadoComercial(u.estadoComercial).etiqueta
  }
  if (s === 'desconocida') return leerEstadoComercial(u.estadoComercial).etiqueta
  return SITUACIONES_PLANO.find((x) => x.valor === s)?.etiqueta ?? u.estadoComercial
}

/**
 * Una separación viva que el estado GUARDADO no refleja. Antes de sql/17 pasa
 * con toda separación; después, solo si una persona puso el estado a mano
 * encima (p. ej. «No disponible»). Se enseña para que alguien lo mire, no se
 * corrige desde la pantalla.
 */
export function separacionSinReflejar(u: Unidad): boolean {
  return (
    u.tieneSeparacionViva === true &&
    u.estadoComercial !== 'reservada_temporal' &&
    u.estadoComercial !== 'separada'
  )
}

// ---------------------------------------------------------------------------
// La fila
// ---------------------------------------------------------------------------

export type Unidad = {
  id: string
  codigoUnidad: string
  tipo: string | null
  /** `numeric` de Postgres: se conserva como llega (ver src/lib/lectura.ts). */
  areaM2: number | string | null
  etapa: string | null
  bloque: string | null
  ubicacion: string | null
  estadoComercial: string
  estadoDato: string
  fuentePlano: string | null
  /** Puntero a `parametros.id`. NUNCA un precio. */
  precioParametro: string | null
  tipoSocio: string | null
  estadoLegal: string | null
  observaciones: string | null
  actualizadoEl: string | null

  /** LA respuesta, tal cual la da `v_unidades_ofrecibles`. */
  ofrecible: boolean | null
  /** Los motivos. Solo explican; no deciden. */
  verificadaContraPlano: boolean | null
  disponibleComercialmente: boolean | null
  tieneAsignacionActiva: boolean | null
  tieneSeparacionViva: boolean | null

  // --- Desde sql/14-inventario-grafico.sql (null si la migracion no esta) ---
  /** Poligono en el espacio 1050 × 2048 de public/plano/zonificacion.webp. null = sin ubicacion. */
  geometria: Punto[] | null
  /** Rubro de la zona tal como lo rotula el plano. Texto libre, no se normaliza aqui. */
  zonaRubro: string | null
  /** Aviso de revision (fuentes que no coinciden). Se muestra, no se corrige. */
  revisar: string | null
  /** De donde sale el estado comercial de la fila, con su fecha. */
  fuenteDisponibilidad: string | null
}

/** Un vertice del poligono, en coordenadas de DIBUJO (pixeles), no metros. */
export type Punto = readonly [number, number]

const COLUMNAS_UNIDAD =
  'id, codigo_unidad, tipo, area_m2, etapa, bloque, ubicacion, estado_comercial, ' +
  'estado_dato, fuente_plano, precio_parametro, tipo_socio, estado_legal, observaciones, ' +
  'actualizado_el, ofrecible, verificada_contra_plano, disponible_comercialmente, ' +
  'tiene_asignacion_activa, tiene_separacion_viva'

/**
 * Las cuatro columnas que anade sql/14 al FINAL de v_unidades_tablero. Van
 * aparte porque la pantalla tiene que seguir funcionando si el codigo se
 * publica antes de aplicar la migracion: en ese caso se relee sin ellas y el
 * plano dice que no hay geometria, en vez de romper la pantalla entera.
 */
const COLUMNAS_PLANO = 'geometria, zona_rubro, revisar, fuente_disponibilidad'

/**
 * Lee `geometria` sin fiarse de ella. Un poligono necesita al menos tres
 * vertices numericos; cualquier otra forma se trata como «sin ubicacion en
 * plano» — preferimos listar la unidad aparte a dibujarla en un sitio
 * inventado.
 */
function leerGeometria(valor: unknown): Punto[] | null {
  if (!Array.isArray(valor) || valor.length < 3) return null
  const puntos: Punto[] = []
  for (const v of valor as unknown[]) {
    if (!Array.isArray(v) || v.length < 2) return null
    const x: unknown = v[0]
    const y: unknown = v[1]
    if (typeof x !== 'number' || typeof y !== 'number') return null
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    puntos.push([x, y])
  }
  return puntos
}

function interpretarUnidad(fila: unknown): Unidad | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const codigoUnidad = texto(f['codigo_unidad'])
  const estadoComercial = texto(f['estado_comercial'])
  const estadoDato = texto(f['estado_dato'])
  if (id === null || codigoUnidad === null) return null
  if (estadoComercial === null || estadoDato === null) return null

  return {
    id,
    codigoUnidad,
    tipo: texto(f['tipo']),
    areaM2: monto(f['area_m2']),
    etapa: texto(f['etapa']),
    bloque: texto(f['bloque']),
    ubicacion: texto(f['ubicacion']),
    estadoComercial,
    estadoDato,
    fuentePlano: texto(f['fuente_plano']),
    precioParametro: texto(f['precio_parametro']),
    tipoSocio: texto(f['tipo_socio']),
    estadoLegal: texto(f['estado_legal']),
    observaciones: texto(f['observaciones']),
    actualizadoEl: texto(f['actualizado_el']),
    ofrecible: booleano(f['ofrecible']),
    verificadaContraPlano: booleano(f['verificada_contra_plano']),
    disponibleComercialmente: booleano(f['disponible_comercialmente']),
    tieneAsignacionActiva: booleano(f['tiene_asignacion_activa']),
    tieneSeparacionViva: booleano(f['tiene_separacion_viva']),
    geometria: leerGeometria(f['geometria']),
    zonaRubro: texto(f['zona_rubro']),
    revisar: texto(f['revisar']),
    fuenteDisponibilidad: texto(f['fuente_disponibilidad']),
  }
}

/**
 * ¿Se puede seleccionar esta unidad para asignarla?
 *
 * `ofrecible === true` y nada mas. Un `null` (la vista no devolvio la bandera,
 * o llego con una forma que este cliente no reconoce) cuenta como NO: ante la
 * duda, en la defensa contra la doble asignacion se falla cerrado.
 */
export function esSeleccionable(u: Unidad): boolean {
  return u.ofrecible === true
}

/**
 * Por que esta unidad no se puede ofrecer, en frases sueltas.
 *
 * Devuelve TODOS los motivos que apliquen, no el primero: una unidad puede
 * estar a la vez sin verificar y ya asignada, y arreglar solo uno de los dos
 * no la desbloquea. Que la pantalla los liste todos ahorra un viaje.
 */
export function motivosNoOfrecible(u: Unidad): string[] {
  if (esSeleccionable(u)) return []

  const motivos: string[] = []

  if (u.verificadaContraPlano === false) {
    motivos.push('sin verificar contra plano')
  }
  if (u.tieneAsignacionActiva === true) {
    motivos.push('ya tiene una asignación activa')
  }
  if (u.tieneSeparacionViva === true) {
    motivos.push('tiene una separación viva (pendiente de verificar o verificada)')
  }
  if (u.disponibleComercialmente === false) {
    motivos.push(
      `su estado comercial es «${leerEstadoComercial(u.estadoComercial).etiqueta}», no «Disponible»`,
    )
  }

  if (motivos.length === 0) {
    // La vista dice que no, y ninguna bandera lo explica. Se dice tal cual.
    motivos.push(
      'la base la excluye de v_unidades_ofrecibles y este cliente no sabe por qué. ' +
        'No se ofrece hasta saberlo',
    )
  }

  return motivos
}

/**
 * Traduce el error de Postgres. Solo lo que se conoce con certeza; el resto se
 * muestra crudo.
 */
function mensajeDeError(mensaje: string): string {
  if (mensaje.includes('v_unidades_tablero') || mensaje.includes('v_unidades_ofrecibles')) {
    return (
      'Falta ejecutar 02-codigo\\sql\\08-vistas-embudo-e-inventario.sql en Supabase. ' +
      'Sin esa vista la pantalla no puede saber qué unidad se puede ofrecer, y no va a adivinarlo.'
    )
  }
  if (mensaje.includes('verde_exige_plano')) {
    return (
      'La base rechazó el guardado: una unidad no puede declararse 🟢 verificada sin decir ' +
      'contra qué plano. Rellena «Fuente del plano» o baja el estado del dato.'
    )
  }
  if (mensaje.includes('unidades_codigo_unidad_key') || mensaje.includes('duplicate key')) {
    return 'Ya existe una unidad con ese código. Los códigos son únicos.'
  }
  if (mensaje.includes('row-level security') || mensaje.includes('violates row-level')) {
    return (
      'Tu rol no puede escribir en el inventario (política unidades_escribir de RLS: solo ' +
      'dirección y administración). Habla con Walter o con Rosa.'
    )
  }
  if (mensaje.includes('JWT') || mensaje.includes('sesión activa')) {
    return 'Se cerró tu sesión. Vuelve a entrar al CRM.'
  }
  return mensaje
}

/** El lote, mas si la base ya tiene las columnas del plano (sql/14). */
export type LoteInventario = Lote<Unidad> & { conPlano: boolean }

/** Postgres 42703 = columna inexistente: la migracion 14 no esta aplicada. */
function faltaColumna(error: { code?: string; message: string }): boolean {
  return error.code === '42703' || /column .* does not exist/i.test(error.message)
}

export async function cargarUnidades(): Promise<LoteInventario> {
  const completa = await supabase
    .from('v_unidades_tablero')
    .select(`${COLUMNAS_UNIDAD}, ${COLUMNAS_PLANO}`)
    .order('codigo_unidad', { ascending: true })
    .limit(LIMITE_UNIDADES)

  if (completa.error === null) {
    return { ...leerLote(completa.data, interpretarUnidad), conPlano: true }
  }
  if (!faltaColumna(completa.error)) throw new Error(mensajeDeError(completa.error.message))

  const basica = await supabase
    .from('v_unidades_tablero')
    .select(COLUMNAS_UNIDAD)
    .order('codigo_unidad', { ascending: true })
    .limit(LIMITE_UNIDADES)

  if (basica.error !== null) throw new Error(mensajeDeError(basica.error.message))
  return { ...leerLote(basica.data, interpretarUnidad), conPlano: false }
}

// ---------------------------------------------------------------------------
// Titulares — solo el nombre, y solo si RLS deja verlo
// ---------------------------------------------------------------------------

/**
 * `v_unidades_tablero` no lleva datos personales a proposito (comentario de la
 * vista en sql/14). El nombre del titular se pide APARTE, a la tabla
 * `unidades` con la persona embebida por su clave foranea, y solo el nombre:
 * ni DNI ni telefono, que el plano no necesita (Ley 29733, minimo necesario;
 * 07-crm\CLAUDE.md §5).
 *
 * Si RLS no deja ver a la persona, PostgREST devuelve el embebido en null y la
 * unidad sale «sin titular visible». Si la consulta entera falla, el plano
 * sigue funcionando sin nombres: el error se devuelve para decirlo, no para
 * tumbar la pantalla.
 */
export type Titulares = { nombres: ReadonlyMap<string, string>; error: string | null }

function nombreEmbebido(valor: unknown): string | null {
  // PostgREST puede devolver el embebido como objeto o, segun como infiera la
  // relacion, como arreglo de uno. Se aceptan las dos formas.
  const persona: unknown = Array.isArray(valor) ? (valor as unknown[])[0] : valor
  if (typeof persona !== 'object' || persona === null) return null
  return texto((persona as Record<string, unknown>)['nombre_completo'])
}

export async function cargarTitulares(): Promise<Titulares> {
  const { data, error } = await supabase
    .from('unidades')
    .select('id, titular_persona_id, personas!unidades_titular_fk(nombre_completo)')
    .not('titular_persona_id', 'is', null)
    .limit(LIMITE_UNIDADES)

  if (error !== null) return { nombres: new Map(), error: mensajeDeError(error.message) }

  const nombres = new Map<string, string>()
  if (Array.isArray(data)) {
    for (const fila of data as unknown[]) {
      if (typeof fila !== 'object' || fila === null) continue
      const f = fila as Record<string, unknown>
      const id = texto(f['id'])
      const nombre = nombreEmbebido(f['personas'])
      if (id !== null && nombre !== null) nombres.set(id, nombre)
    }
  }
  return { nombres, error: null }
}

// ---------------------------------------------------------------------------
// Filtros del plano y de la lista (los mismos para los tres modos)
// ---------------------------------------------------------------------------

export type FiltrosInventario = {
  busqueda: string
  /** '' = todos. Un valor de `estado_unidad`. */
  estado: string
  /** '' = todos. */
  tipo: string
  /** '' = todos. SIN_RUBRO = las que no tienen rubro. */
  rubro: string
  soloPorRevisar: boolean
}

export const SIN_RUBRO = '__sin_rubro__'

export const FILTROS_VACIOS: FiltrosInventario = {
  busqueda: '',
  estado: '',
  tipo: '',
  rubro: '',
  soloPorRevisar: false,
}

/** Minusculas y sin tildes: «Pérez» se encuentra escribiendo «perez». */
function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Busca por codigo o por titular (el nombre que se pudo leer, si se pudo). */
export function coincideConFiltros(
  u: Unidad,
  filtros: FiltrosInventario,
  titular: string | null,
): boolean {
  const q = normalizar(filtros.busqueda.trim())
  if (q !== '' && !normalizar(`${u.codigoUnidad} ${titular ?? ''}`).includes(q)) return false
  if (filtros.estado !== '' && u.estadoComercial !== filtros.estado) return false
  if (filtros.tipo !== '' && (u.tipo ?? '') !== filtros.tipo) return false
  if (filtros.rubro === SIN_RUBRO && u.zonaRubro !== null) return false
  if (filtros.rubro !== '' && filtros.rubro !== SIN_RUBRO && u.zonaRubro !== filtros.rubro) {
    return false
  }
  if (filtros.soloPorRevisar && u.revisar === null) return false
  return true
}

/** Valores distintos de un campo, ordenados, para los desplegables. */
export function valoresDistintos(
  unidades: readonly Unidad[],
  campo: (u: Unidad) => string | null,
): string[] {
  const vistos = new Set<string>()
  for (const u of unidades) {
    const v = campo(u)
    if (v !== null) vistos.add(v)
  }
  return [...vistos].sort((a, b) => a.localeCompare(b, 'es'))
}

// ---------------------------------------------------------------------------
// Unidades ofrecibles — el selector de la pantalla de separaciones
// ---------------------------------------------------------------------------

export type UnidadOfrecible = {
  id: string
  codigoUnidad: string
  tipo: string | null
  areaM2: number | string | null
}

function interpretarOfrecible(fila: unknown): UnidadOfrecible | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const codigoUnidad = texto(f['codigo_unidad'])
  if (id === null || codigoUnidad === null) return null

  return {
    id,
    codigoUnidad,
    tipo: texto(f['tipo']),
    areaM2: monto(f['area_m2']),
  }
}

/**
 * Las unidades que se pueden ofrecer, leidas de `v_unidades_ofrecibles`.
 *
 * Se consulta LA VISTA, no la tabla con un filtro: es la unica definicion de
 * «que se puede ofrecer» (Acta 03-O02) y reconstruirla aqui con un par de
 * `.eq()` seria tener dos criterios que un dia van a discrepar. Lo que esta
 * lista devuelve es lo unico que el formulario de separacion puede ofrecer.
 */
export async function cargarUnidadesOfrecibles(): Promise<Lote<UnidadOfrecible>> {
  const { data, error } = await supabase
    .from('v_unidades_ofrecibles')
    .select('id, codigo_unidad, tipo, area_m2')
    .order('codigo_unidad', { ascending: true })
    .limit(LIMITE_UNIDADES)

  if (error !== null) throw new Error(mensajeDeError(error.message))
  return leerLote(data, interpretarOfrecible)
}

// ---------------------------------------------------------------------------
// Alta y edicion
// ---------------------------------------------------------------------------

/** Lo que escribe el formulario. Todo cadena: es lo que dan los `<input>`. */
export type DatosUnidad = {
  codigoUnidad: string
  tipo: string
  areaM2: string
  etapa: string
  bloque: string
  ubicacion: string
  estadoComercial: EstadoUnidad
  estadoDato: Semaforo
  fuentePlano: string
  /** Id de `parametros`, o cadena vacia. Nunca un importe. */
  precioParametro: string
  observaciones: string
  // --- El inventario maestro (columnas de 01-schema, no estan en v_unidades_tablero) ---
  /** Fundador / Nuevo 2023 / … / Nuevo 2026. Texto libre: lo dice el kardex. */
  tipoSocio: string
  /** Minuta / Notaría / Registros Públicos / Titulado. Texto libre. */
  estadoLegal: string
  estadoFisico: string
  /** Que documento respalda lo que dice esta fila (texto, no un archivo). */
  documentoSustento: string
}

export type CampoUnidad = keyof DatosUnidad

export type ResultadoGuardado =
  | { ok: true; id: string }
  | { ok: false; motivo: string; campo?: CampoUnidad }

/** Cadena vacia -> null. Un campo en blanco es «no hay dato», no una cadena. */
function oNulo(valor: string): string | null {
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

/**
 * Comprobaciones previas.
 *
 * La de `verde` + `fuente_plano` es un ESPEJO de la restriccion
 * `verde_exige_plano` (08-vistas-embudo-e-inventario.sql §3), no un sustituto:
 * esta ahorra el viaje a la red, aquella es la que de verdad lo impide. Si
 * alguna vez discrepan, gana la base y el mensaje de error lo dira.
 */
function validar(datos: DatosUnidad): { motivo: string; campo: CampoUnidad } | null {
  if (datos.codigoUnidad.trim() === '') {
    return { motivo: 'El código de la unidad es obligatorio.', campo: 'codigoUnidad' }
  }
  if (datos.tipo.trim() === '') {
    return { motivo: 'El tipo es obligatorio (puesto, tienda… según el plano).', campo: 'tipo' }
  }

  const area = datos.areaM2.trim()
  if (area !== '') {
    const n = Number(area.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) {
      return { motivo: 'El área debe ser un número mayor que cero, o quedarse vacía.', campo: 'areaM2' }
    }
  }

  if (datos.estadoDato === 'verde' && datos.fuentePlano.trim() === '') {
    return {
      motivo:
        'Para marcarla 🟢 verificada hay que decir contra qué plano se verificó. ' +
        'Sin eso, «verificada» no es comprobable por nadie (restricción verde_exige_plano).',
      campo: 'fuentePlano',
    }
  }

  return null
}

/**
 * `conMaestro` = incluir los cuatro campos del inventario maestro. Al EDITAR
 * solo van si la pantalla pudo leer los valores que ya tenia la unidad: esas
 * columnas no estan en `v_unidades_tablero`, y guardar «en blanco» lo que no se
 * llego a leer borraria el dato.
 */
function aFila(datos: DatosUnidad, conMaestro: boolean): Record<string, string | number | null> {
  const area = datos.areaM2.trim()
  return {
    codigo_unidad: datos.codigoUnidad.trim(),
    tipo: datos.tipo.trim(),
    area_m2: area === '' ? null : Number(area.replace(',', '.')),
    etapa: oNulo(datos.etapa),
    bloque: oNulo(datos.bloque),
    ubicacion: oNulo(datos.ubicacion),
    estado_comercial: datos.estadoComercial,
    estado_dato: datos.estadoDato,
    fuente_plano: oNulo(datos.fuentePlano),
    precio_parametro: oNulo(datos.precioParametro),
    observaciones: oNulo(datos.observaciones),
    ...(conMaestro
      ? {
          tipo_socio: oNulo(datos.tipoSocio),
          estado_legal: oNulo(datos.estadoLegal),
          estado_fisico: oNulo(datos.estadoFisico),
          documento_sustento: oNulo(datos.documentoSustento),
        }
      : {}),
  }
}

/**
 * Da de alta o actualiza una unidad.
 *
 * `id === null` es alta. Igual que en el embudo, el `.select()` no es
 * decoracion: con RLS, un `update` que no encaja en la politica devuelve 200 y
 * cero filas, sin error. Sin comprobarlo, la pantalla diria «guardado» sobre
 * una base que no cambio.
 *
 * Nada se borra (R8): para retirar una unidad se usa `archivado_el`, y eso no
 * se hace desde este formulario.
 */
export async function guardarUnidad(
  datos: DatosUnidad,
  id: string | null,
  /** Al editar: ¿se leyeron los campos del inventario maestro? Ver `aFila`. En el alta, siempre. */
  conMaestro = true,
): Promise<ResultadoGuardado> {
  const fallo = validar(datos)
  if (fallo !== null) return { ok: false, motivo: fallo.motivo, campo: fallo.campo }

  const fila = aFila(datos, id === null || conMaestro)

  const { data, error } =
    id === null
      ? await supabase.from('unidades').insert(fila).select('id')
      : await supabase.from('unidades').update(fila).eq('id', id).select('id')

  if (error !== null) return { ok: false, motivo: mensajeDeError(error.message) }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      motivo:
        'La base no guardó nada y tampoco devolvió un error: tu rol no puede escribir en el ' +
        'inventario (política unidades_escribir de RLS).',
    }
  }

  const guardadoId = texto((data[0] as Record<string, unknown>)['id'])
  if (guardadoId === null) {
    return {
      ok: false,
      motivo: 'Se guardó, pero la base devolvió una respuesta que este cliente no reconoce.',
    }
  }

  return { ok: true, id: guardadoId }
}

/** Los valores del formulario cuando se abre para dar de alta. */
export function unidadEnBlanco(): DatosUnidad {
  return {
    codigoUnidad: '',
    tipo: '',
    areaM2: '',
    etapa: '',
    bloque: '',
    ubicacion: '',
    // Una unidad nace como la hace nacer 01-schema.sql: no disponible y con el
    // dato en rojo. Nada entra al inventario dandose por bueno.
    estadoComercial: 'no_disponible',
    estadoDato: 'rojo',
    fuentePlano: '',
    precioParametro: '',
    observaciones: '',
    tipoSocio: '',
    estadoLegal: '',
    estadoFisico: '',
    documentoSustento: '',
  }
}

/** Los valores del formulario cuando se abre para editar una fila existente. */
export function unidadAFormulario(u: Unidad): DatosUnidad {
  return {
    codigoUnidad: u.codigoUnidad,
    tipo: u.tipo ?? '',
    areaM2: u.areaM2 === null ? '' : String(u.areaM2),
    etapa: u.etapa ?? '',
    bloque: u.bloque ?? '',
    ubicacion: u.ubicacion ?? '',
    // Si la base trae un valor que este cliente no conoce (alguien amplio el
    // enum sin actualizar la interfaz), el formulario cae al valor mas cerrado
    // en vez de mostrar uno inventado. Es un cambio visible: quien edite lo
    // vera en el desplegable antes de guardar.
    estadoComercial: esEstadoUnidad(u.estadoComercial) ? u.estadoComercial : 'no_disponible',
    estadoDato: esSemaforo(u.estadoDato) ? u.estadoDato : 'rojo',
    fuentePlano: u.fuentePlano ?? '',
    precioParametro: u.precioParametro ?? '',
    observaciones: u.observaciones ?? '',
    // Estos dos si vienen en la vista; los otros dos se completan al leer el
    // detalle (`cargarDetalleUnidad`) y mientras tanto no se guardan.
    tipoSocio: u.tipoSocio ?? '',
    estadoLegal: u.estadoLegal ?? '',
    estadoFisico: '',
    documentoSustento: '',
  }
}

// ---------------------------------------------------------------------------
// El titular y el detalle de una unidad (inventario maestro · sql/17)
// ---------------------------------------------------------------------------

/**
 * Quien figura como dueño de la unidad. Es una fila de `personas` (es_socio):
 * la misma persona que usa el resto del CRM, no una copia. Lleva DNI y
 * telefonos de un tercero — Ley 29733, minimo necesario: solo se pide cuando
 * Direccion o Administracion abre el detalle (07-crm\CLAUDE.md §5), y nunca sale
 * en la web (fn_inventario_publico no lo devuelve).
 */
export type Titular = {
  personaId: string
  nombreCompleto: string
  docTipo: string | null
  docNumero: string | null
  telefono: string | null
  telefonoAlterno: string | null
  email: string | null
  notas: string | null
}

/** Lo que no esta en `v_unidades_tablero`: el kardex de la unidad y su titular. */
export type DetalleUnidad = {
  tipoSocio: string | null
  estadoLegal: string | null
  estadoFisico: string | null
  documentoSustento: string | null
  titular: Titular | null
}

export const TIPOS_DOCUMENTO_PERSONA = ['DNI', 'CE', 'RUC', 'Pasaporte'] as const

const COLUMNAS_DETALLE =
  'tipo_socio, estado_legal, estado_fisico, documento_sustento, titular_persona_id, ' +
  'personas!unidades_titular_fk(id, nombre_completo, doc_tipo, doc_numero, telefono_e164, ' +
  'telefono_alterno, email, notas)'

function interpretarTitular(valor: unknown): Titular | null {
  // PostgREST puede devolver el embebido como objeto o como arreglo de uno.
  const persona = comoRegistro(Array.isArray(valor) ? (valor as unknown[])[0] : valor)
  if (persona === null) return null
  const personaId = texto(persona['id'])
  const nombreCompleto = texto(persona['nombre_completo'])
  if (personaId === null || nombreCompleto === null) return null
  return {
    personaId,
    nombreCompleto,
    docTipo: texto(persona['doc_tipo']),
    docNumero: texto(persona['doc_numero']),
    telefono: texto(persona['telefono_e164']),
    telefonoAlterno: texto(persona['telefono_alterno']),
    email: texto(persona['email']),
    notas: texto(persona['notas']),
  }
}

/**
 * El detalle de UNA unidad, leido de la tabla (no de la vista). Lanza si falla,
 * para `useQuery`. Si RLS no deja ver a la persona, `titular` sale null aunque
 * la unidad tenga titular: la pantalla lo dice («sin titular visible»).
 */
export async function cargarDetalleUnidad(unidadId: string): Promise<DetalleUnidad> {
  const { data, error } = await supabase
    .from('unidades')
    .select(COLUMNAS_DETALLE)
    .eq('id', unidadId)
    .limit(1)

  if (error !== null) throw new Error(mensajeDeError(error.message))
  const fila = comoRegistro(Array.isArray(data) ? (data as unknown[])[0] : null)
  if (fila === null) throw new Error('La unidad no se encontró (¿está archivada?).')

  return {
    tipoSocio: texto(fila['tipo_socio']),
    estadoLegal: texto(fila['estado_legal']),
    estadoFisico: texto(fila['estado_fisico']),
    documentoSustento: texto(fila['documento_sustento']),
    titular: interpretarTitular(fila['personas']),
  }
}

/** Lo que escribe el formulario del titular. Todo cadena: es lo que dan los `<input>`. */
export type DatosTitular = {
  nombre: string
  docTipo: string
  docNumero: string
  telefono: string
  telefonoAlterno: string
  email: string
  notas: string
}

export function titularEnBlanco(): DatosTitular {
  return { nombre: '', docTipo: '', docNumero: '', telefono: '', telefonoAlterno: '', email: '', notas: '' }
}

export function titularAFormulario(t: Titular): DatosTitular {
  return {
    nombre: t.nombreCompleto,
    docTipo: t.docTipo ?? '',
    docNumero: t.docNumero ?? '',
    telefono: t.telefono ?? '',
    telefonoAlterno: t.telefonoAlterno ?? '',
    email: t.email ?? '',
    notas: t.notas ?? '',
  }
}

export type CampoTitular = keyof DatosTitular

export type ResultadoTitular =
  | { ok: true; personaId: string; creada: boolean; reutilizada: boolean }
  | { ok: false; motivo: string; campo?: CampoTitular }

/** Un telefono vacio es «sin telefono»; uno escrito se lleva a E.164 o se rechaza con su motivo. */
function telefonoParaGuardar(
  valor: string,
  campo: CampoTitular,
): { ok: true; e164: string } | { ok: false; motivo: string; campo: CampoTitular } {
  const limpio = valor.trim()
  if (limpio === '') return { ok: true, e164: '' }
  const r = normalizarTelefono(limpio)
  return r.ok ? { ok: true, e164: r.e164 } : { ok: false, motivo: r.motivo, campo }
}

/** La base nombra sql/17 donde `llamarRpc` solo conoce a sql/13: se corrige aqui. */
function motivoDeTitular(motivo: string): string {
  return motivo.includes('sql/13')
    ? 'Falta ejecutar sql/17-inventario-maestro.sql en Supabase: sin él no se puede guardar el titular.'
    : motivo
}

/**
 * Guarda al titular de una unidad (Direccion y Administracion). `personaId` =
 * editar a esa persona; `null` = titular nuevo o ya conocido (la base busca por
 * documento y luego por telefono, y NO pisa a quien ya existia). Todo el
 * trabajo —crear o reutilizar la persona y vincularla— es una sola funcion de
 * la base: `fn_guardar_titular_unidad`.
 */
export async function guardarTitular(
  unidadId: string,
  personaId: string | null,
  datos: DatosTitular,
): Promise<ResultadoTitular> {
  if (datos.nombre.trim() === '') {
    return { ok: false, motivo: 'El nombre del titular es obligatorio.', campo: 'nombre' }
  }
  if ((datos.docTipo.trim() === '') !== (datos.docNumero.trim() === '')) {
    return {
      ok: false,
      motivo: 'El documento necesita su tipo y su número, o ninguno de los dos.',
      campo: datos.docTipo.trim() === '' ? 'docTipo' : 'docNumero',
    }
  }
  const tel = telefonoParaGuardar(datos.telefono, 'telefono')
  if (!tel.ok) return tel
  const tel2 = telefonoParaGuardar(datos.telefonoAlterno, 'telefonoAlterno')
  if (!tel2.ok) return tel2

  const r = await llamarRpc(
    'fn_guardar_titular_unidad',
    {
      p_unidad_id: unidadId,
      p_persona_id: personaId,
      p_nombre: datos.nombre.trim(),
      p_doc_tipo: datos.docTipo.trim(),
      p_doc_numero: datos.docNumero.trim(),
      p_telefono: tel.e164,
      p_telefono_alterno: tel2.e164,
      p_email: datos.email.trim(),
      p_notas: datos.notas.trim(),
    },
    (resp) => {
      const f = comoRegistro(resp)
      const id = f === null ? null : texto(f['persona_id'])
      if (f === null || id === null) return null
      return { personaId: id, creada: f['creada'] === true, reutilizada: f['reutilizada'] === true }
    },
  )
  if (!r.ok) return { ok: false, motivo: motivoDeTitular(r.motivo) }
  return { ok: true, ...r.datos }
}

/** Suelta el vinculo con el titular. La persona NO se borra (R8). */
export async function quitarTitular(unidadId: string): Promise<ResultadoAccion<true>> {
  const r = await llamarRpc('fn_quitar_titular_unidad', { p_unidad_id: unidadId }, (resp) =>
    comoRegistro(resp)?.['ok'] === true ? true : null,
  )
  return r.ok ? r : { ok: false, motivo: motivoDeTitular(r.motivo) }
}
