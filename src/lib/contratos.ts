import { addDays, addMonths, format, isValid, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { entero, leerLote, monto, texto, type Lote } from '@/lib/lectura'
import { aNumero, type Moneda } from '@/lib/dinero'
import { ordenEstado } from '@/lib/embudo'

/**
 * Contratos y su calendario de cuotas.
 *
 * ===========================================================================
 * AQUI NO HAY NINGUN PRECIO
 * ===========================================================================
 * Ni el del puesto, ni la inicial, ni el numero de cuotas «de siempre». El
 * precio se PROPONE desde `parametros`, y si el parametro elegido esta en
 * 🔴 rojo no se propone nada: se enseña el marcador de pendiente y la persona
 * escribe la cifra a mano, dejando constancia de que la escribio ella y de que
 * el parametro no estaba confirmado (ver `constanciaDePrecioManual`).
 *
 * Esa constancia no es burocracia. `contratos` no tiene columna
 * `precio_parametro` —solo la tiene `oportunidades`—, asi que sin una nota
 * escrita no quedaria ni rastro de que ese numero se tecleo en vez de salir de
 * 00-fuente-de-verdad. Y un precio sin procedencia es exactamente como
 * nacieron los 8 precios en conflicto.
 *
 * ===========================================================================
 * EL REPARTO DE LAS CUOTAS NO ESCONDE CENTIMOS
 * ===========================================================================
 * `repartirCuotas` divide un monto entre N cuotas y mete el resto en la
 * ULTIMA, en vez de repartirlo en silencio o dejarlo perderse en el redondeo.
 * El formulario enseña la tabla completa antes de guardar: si la ultima cuota
 * es distinta, se ve.
 *
 * ===========================================================================
 * R7 · MONEDA
 * ===========================================================================
 * Las cuotas heredan la moneda del contrato y no se ofrece cambiarla: un
 * calendario con cuotas en dos monedas no se puede sumar, y la moneda de
 * control del negocio sigue [PENDIENTE].
 */

// ---------------------------------------------------------------------------
// El parametro del que se PROPONE el precio
// ---------------------------------------------------------------------------

/**
 * De donde sale la propuesta de precio del contrato.
 *
 * `precio_puesto_9m2` esta hoy en 🔴 rojo (04-seed-parametros.sql) y su
 * fuente es 00-fuente-de-verdad\precios-vigentes.md, el archivo que documenta
 * los 8 precios en conflicto. Mientras siga en rojo NO hay propuesta: el
 * formulario enseña el marcador de pendiente y exige que la cifra la escriba
 * una persona, con la constancia de `constanciaDePrecioManual`.
 *
 * Es un ID, no un precio. Aqui no hay ninguna cifra.
 */
export const PARAMETRO_PRECIO = 'precio_puesto_9m2'

/** El de la moneda de control, que tambien sigue [PENDIENTE]. */
export const PARAMETRO_MONEDA = 'moneda_de_control'

export const PARAMETROS_DEL_CONTRATO = [PARAMETRO_PRECIO, PARAMETRO_MONEDA] as const

// ---------------------------------------------------------------------------
// De que oportunidades se puede sacar un contrato
// ---------------------------------------------------------------------------

/**
 * El encargo dice «desde una oportunidad en estado separacion o superior».
 * `05_separacion` es el quinto de los 10 estados de `estado_embudo`
 * (01-schema.sql §0); el orden lo da `ordenEstado` de src/lib/embudo.ts, que
 * ya es la unica lista de estados del cliente.
 */
export const ESTADO_MINIMO_CONTRATO = '05_separacion'

export type OportunidadContratable = {
  id: string
  personaId: string
  nombreCompleto: string
  estado: string
  lanzamiento: string | null
  unidadAsignadaId: string | null
  /**
   * La unidad del contrato: la asignada a la oportunidad o, si no hay (lo normal:
   * ninguna pantalla asigna), la de su separación viva. Antes solo se miraba la
   * asignada y el contrato no se podía crear desde el CRM (auditoría 07/10/2026).
   */
  unidadId: string | null
  /** true = la unidad sale de la separación viva, no de una asignación. */
  unidadDeLaSeparacion: boolean
  codigoUnidad: string | null
  /** A que parametro quedo congelado el precio, si se anoto en su momento. */
  precioParametro: string | null
  precioPactado: number | string | null
  precioMoneda: string | null
  separacionId: string | null
}

const COLUMNAS_CONTRATABLE =
  'id, persona_id, estado, lanzamiento, unidad_asignada_id, precio_parametro, ' +
  'precio_pactado, precio_moneda, personas(nombre_completo), ' +
  'unidades!oportunidades_unidad_asignada_id_fkey(codigo_unidad), ' +
  'separaciones(id, estado, archivado_el, unidad_id, unidades(codigo_unidad))'

function relacionada(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null
}

function interpretarContratable(fila: unknown): OportunidadContratable | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const personaId = texto(f['persona_id'])
  const estado = texto(f['estado'])
  if (id === null || personaId === null || estado === null) return null

  const persona = relacionada(f['personas'])
  const unidad = relacionada(f['unidades'])

  // `separaciones` llega como lista: una oportunidad puede tener mas de una a
  // lo largo del tiempo (una devuelta y otra viva). Se coge la que sigue viva,
  // que es la unica que tiene sentido colgar del contrato.
  const separaciones = Array.isArray(f['separaciones']) ? f['separaciones'] : []
  const viva = separaciones
    .map((s) => relacionada(s))
    .find(
      (s) =>
        s !== null &&
        s['archivado_el'] == null &&
        (texto(s['estado']) === 'verificada' || texto(s['estado']) === 'pendiente_verificacion'),
    )
  const unidadAsignadaId = texto(f['unidad_asignada_id'])
  const unidadSeparacion = viva === undefined || viva === null ? null : texto(viva['unidad_id'])
  const unidadDeLaSeparacionRel = viva === undefined || viva === null ? null : relacionada(viva['unidades'])

  return {
    id,
    personaId,
    nombreCompleto: (persona === null ? null : texto(persona['nombre_completo'])) ?? '[sin nombre]',
    estado,
    lanzamiento: texto(f['lanzamiento']),
    unidadAsignadaId,
    unidadId: unidadAsignadaId ?? unidadSeparacion,
    unidadDeLaSeparacion: unidadAsignadaId === null && unidadSeparacion !== null,
    codigoUnidad:
      unidadAsignadaId !== null
        ? unidad === null
          ? null
          : texto(unidad['codigo_unidad'])
        : unidadDeLaSeparacionRel === null
          ? null
          : texto(unidadDeLaSeparacionRel['codigo_unidad']),
    precioParametro: texto(f['precio_parametro']),
    precioPactado: monto(f['precio_pactado']),
    precioMoneda: texto(f['precio_moneda']),
    separacionId: viva === undefined || viva === null ? null : texto(viva['id']),
  }
}

/**
 * Las oportunidades de las que se puede nacer un contrato.
 *
 * El filtro por estado se hace en la BASE (`gte`), no aqui: un enum de
 * Postgres se ordena por su posicion, que es el mismo orden de los 10 estados,
 * y asi la lista no depende de que el cliente recuerde cual era el quinto. Lo
 * que si se comprueba al volver es que el estado que llega sea uno conocido.
 *
 * Las que ya tienen contrato vivo no se excluyen aqui: lo impide el indice
 * `unidad_un_contrato_vivo` y se avisa con su mensaje. Un filtro en el cliente
 * que imitara ese indice seria un segundo criterio esperando a discrepar.
 */
export async function cargarOportunidadesContratables(): Promise<Lote<OportunidadContratable>> {
  const { data, error } = await supabase
    .from('oportunidades')
    .select(COLUMNAS_CONTRATABLE)
    .is('archivado_el', null)
    .eq('situacion', 'activa')
    .gte('estado', ESTADO_MINIMO_CONTRATO)
    .order('estado', { ascending: false })

  if (error !== null) throw new Error(mensajeDeError(error.message))

  const lote = leerLote(data, interpretarContratable)
  return {
    ...lote,
    // Por si la base devolviera un estado que este cliente no conoce: no se
    // deja pasar a la lista de «contratables» algo cuyo orden no sabemos leer.
    filas: lote.filas.filter((o) => ordenEstado(o.estado) >= ordenEstado(ESTADO_MINIMO_CONTRATO)),
  }
}

// ---------------------------------------------------------------------------
// Los contratos ya firmados
// ---------------------------------------------------------------------------

export type Contrato = {
  id: string
  codigo: string | null
  personaId: string
  nombreCompleto: string | null
  unidadId: string
  codigoUnidad: string | null
  fechaFirma: string | null
  precioTotal: number | string | null
  precioMoneda: string | null
  modalidadPago: string | null
  inicialMonto: number | string | null
  estadoLegal: string | null
  observaciones: string | null
  creadoEl: string | null
  /** Cuantas cuotas tiene ya generadas. 0 = falta el calendario. */
  cuotas: number
}

const COLUMNAS_CONTRATO =
  'id, codigo, persona_id, unidad_id, fecha_firma, precio_total, precio_moneda, ' +
  'modalidad_pago, inicial_monto, estado_legal, observaciones, creado_el, ' +
  'personas(nombre_completo), unidades(codigo_unidad), cuotas(count)'

function interpretarContrato(fila: unknown): Contrato | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const personaId = texto(f['persona_id'])
  const unidadId = texto(f['unidad_id'])
  if (id === null || personaId === null || unidadId === null) return null

  const persona = relacionada(f['personas'])
  const unidad = relacionada(f['unidades'])

  // PostgREST devuelve el conteo embebido como [{ count: n }].
  const conteo = Array.isArray(f['cuotas']) ? relacionada(f['cuotas'][0]) : null

  return {
    id,
    codigo: texto(f['codigo']),
    personaId,
    nombreCompleto: persona === null ? null : texto(persona['nombre_completo']),
    unidadId,
    codigoUnidad: unidad === null ? null : texto(unidad['codigo_unidad']),
    fechaFirma: texto(f['fecha_firma']),
    precioTotal: monto(f['precio_total']),
    precioMoneda: texto(f['precio_moneda']),
    modalidadPago: texto(f['modalidad_pago']),
    inicialMonto: monto(f['inicial_monto']),
    estadoLegal: texto(f['estado_legal']),
    observaciones: texto(f['observaciones']),
    creadoEl: texto(f['creado_el']),
    cuotas: conteo === null ? 0 : (entero(conteo['count']) ?? 0),
  }
}

export async function cargarContratos(): Promise<Lote<Contrato>> {
  const { data, error } = await supabase
    .from('contratos')
    .select(COLUMNAS_CONTRATO)
    .is('archivado_el', null)
    .order('creado_el', { ascending: false })
    .limit(300)

  if (error !== null) throw new Error(mensajeDeError(error.message))
  return leerLote(data, interpretarContrato)
}

// ---------------------------------------------------------------------------
// Modalidades y estados legales — listas del esquema, no cifras
// ---------------------------------------------------------------------------

/** Comentario de la columna `contratos.modalidad_pago` en 01-schema.sql. */
export const MODALIDADES = [
  { valor: 'contado', etiqueta: 'Contado' },
  { valor: 'financiado_directo', etiqueta: 'Financiado directo' },
  { valor: 'financiera_aliada', etiqueta: 'Financiera aliada' },
] as const

/** Comentario de la columna `contratos.estado_legal` en 01-schema.sql. */
export const ESTADOS_LEGALES = ['Minuta', 'Notaría', 'Registros Públicos', 'Titulado'] as const

// ---------------------------------------------------------------------------
// El calendario de cuotas
// ---------------------------------------------------------------------------

export const PERIODICIDADES = [
  { valor: 'mensual', etiqueta: 'Mensual', dias: 0, meses: 1 },
  { valor: 'quincenal', etiqueta: 'Quincenal (cada 15 días)', dias: 15, meses: 0 },
  { valor: 'semanal', etiqueta: 'Semanal', dias: 7, meses: 0 },
] as const

export type Periodicidad = (typeof PERIODICIDADES)[number]['valor']

export type CuotaProyectada = {
  numero: number
  fechaVencimiento: string
  /** En centimos, para no arrastrar errores de coma flotante al repartir. */
  centimos: number
}

/**
 * Reparte `total` entre `cuantas` cuotas sin perder ni un centimo.
 *
 * Se trabaja en centimos enteros: 1000 / 3 en coma flotante da tres cuotas de
 * 333.33 que suman 999.99, y ese centimo desaparecido acaba siendo una cuota
 * que nunca se puede dar por pagada. Aqui el resto va a la ULTIMA cuota y se
 * ve en la tabla de vista previa antes de guardar.
 *
 * Devuelve la lista vacia si los datos no permiten calcular nada: no se
 * inventa un calendario de una cuota para que algo se vea.
 */
export function repartirCuotas(
  total: number,
  cuantas: number,
  primera: string,
  periodicidad: Periodicidad,
): CuotaProyectada[] {
  if (!Number.isFinite(total) || total <= 0) return []
  if (!Number.isInteger(cuantas) || cuantas <= 0) return []

  const inicio = parseISO(primera)
  if (!isValid(inicio)) return []

  const totalCentimos = Math.round(total * 100)
  const base = Math.floor(totalCentimos / cuantas)
  const resto = totalCentimos - base * cuantas

  const plan = PERIODICIDADES.find((p) => p.valor === periodicidad)
  if (plan === undefined) return []

  const cuotas: CuotaProyectada[] = []
  for (let i = 0; i < cuantas; i += 1) {
    const fecha =
      plan.meses > 0 ? addMonths(inicio, plan.meses * i) : addDays(inicio, plan.dias * i)

    cuotas.push({
      numero: i + 1,
      fechaVencimiento: format(fecha, 'yyyy-MM-dd'),
      // El resto entero va entero a la ultima: repartir un centimo por cuota
      // haria que casi todas fueran distintas y nadie sabria por que.
      centimos: i === cuantas - 1 ? base + resto : base,
    })
  }
  return cuotas
}

/** De centimos a la cifra con dos decimales que espera `numeric(14,2)`. */
export function centimosAMonto(centimos: number): number {
  return Math.round(centimos) / 100
}

export type PlanDeCuotas = {
  cuantas: string
  primeraFecha: string
  periodicidad: Periodicidad
  /** Lo que se reparte. Se propone como precio − inicial, y es editable. */
  montoAFinanciar: string
}

export function planEnBlanco(): PlanDeCuotas {
  return {
    cuantas: '',
    primeraFecha: '',
    periodicidad: 'mensual',
    montoAFinanciar: '',
  }
}

// ---------------------------------------------------------------------------
// Alta del contrato
// ---------------------------------------------------------------------------

export type DatosContrato = {
  oportunidadId: string
  personaId: string
  unidadId: string
  separacionId: string
  codigo: string
  fechaFirma: string
  precioTotal: string
  precioMoneda: Moneda | ''
  modalidadPago: string
  inicialMonto: string
  estadoLegal: string
  observaciones: string
  /** Id del parametro del que se propuso el precio, o '' si se escribio a mano. */
  precioParametro: string
  /** `true` cuando el precio se tecleo porque el parametro no estaba confirmado. */
  precioEscritoAMano: boolean
}

export type CampoContrato = keyof DatosContrato

export function contratoEnBlanco(): DatosContrato {
  return {
    oportunidadId: '',
    personaId: '',
    unidadId: '',
    separacionId: '',
    codigo: '',
    fechaFirma: '',
    precioTotal: '',
    precioMoneda: '',
    modalidadPago: '',
    inicialMonto: '',
    estadoLegal: '',
    observaciones: '',
    precioParametro: '',
    precioEscritoAMano: false,
  }
}

/**
 * La constancia que se guarda en `observaciones` cuando el precio se escribe a
 * mano.
 *
 * Es texto, no una marca invisible: `contratos` no tiene columna para el
 * parametro del precio, asi que este parrafo es todo el rastro que va a quedar
 * de por que ese numero no salio de 00-fuente-de-verdad. Se escribe con la
 * fecha, el nombre de quien lo tecleo y el parametro que estaba sin confirmar.
 */
export function constanciaDePrecioManual(
  quien: string,
  parametroId: string | null,
  semaforo: string | null,
): string {
  const fecha = format(new Date(), 'dd/MM/yyyy HH:mm')
  const deDonde =
    parametroId === null || parametroId === ''
      ? 'sin parámetro de referencia elegido'
      : `el parámetro «${parametroId}» estaba en semáforo ${semaforo ?? 'desconocido'}`
  return (
    `[PRECIO ESCRITO A MANO] ${fecha} · ${quien} · ${deDonde}, ` +
    'así que el precio de este contrato NO proviene de 00-fuente-de-verdad: lo tecleó una ' +
    'persona. Queda pendiente de validar contra la fuente cuando el parámetro se confirme.'
  )
}

export type ResultadoContrato =
  | { ok: true; id: string }
  | { ok: false; motivo: string; campo?: CampoContrato | undefined }

function validar(datos: DatosContrato): { motivo: string; campo: CampoContrato } | null {
  if (datos.oportunidadId === '' || datos.personaId === '') {
    return {
      motivo: 'Elige la oportunidad de la que nace el contrato.',
      campo: 'oportunidadId',
    }
  }

  // `contratos.unidad_id` es NOT NULL: sin unidad no hay contrato que valga.
  if (datos.unidadId === '') {
    return {
      motivo:
        'Esa oportunidad no tiene unidad asignada, y el contrato exige una ' +
        '(contratos.unidad_id es obligatorio). Asigna la unidad antes de contratar.',
      campo: 'unidadId',
    }
  }

  const precio = Number(datos.precioTotal.trim().replace(',', '.'))
  if (datos.precioTotal.trim() === '' || !Number.isFinite(precio) || precio <= 0) {
    return { motivo: 'Escribe el precio total del contrato.', campo: 'precioTotal' }
  }

  // R7: nunca un numero suelto.
  if (datos.precioMoneda === '') {
    return {
      motivo:
        'Elige la moneda del precio. La moneda de control del negocio sigue [PENDIENTE] en ' +
        '00-fuente-de-verdad, así que aquí no se supone ninguna.',
      campo: 'precioMoneda',
    }
  }

  if (datos.inicialMonto.trim() !== '') {
    const inicial = Number(datos.inicialMonto.trim().replace(',', '.'))
    if (!Number.isFinite(inicial) || inicial < 0) {
      return { motivo: 'La inicial no es un número válido.', campo: 'inicialMonto' }
    }
    if (inicial > precio) {
      return {
        motivo: 'La inicial no puede ser mayor que el precio total.',
        campo: 'inicialMonto',
      }
    }
  }

  return null
}

export async function crearContrato(
  datos: DatosContrato,
  creadoPor: string,
): Promise<ResultadoContrato> {
  const fallo = validar(datos)
  if (fallo !== null) return { ok: false, motivo: fallo.motivo, campo: fallo.campo }

  const { data, error } = await supabase
    .from('contratos')
    .insert({
      oportunidad_id: datos.oportunidadId,
      persona_id: datos.personaId,
      unidad_id: datos.unidadId,
      separacion_id: datos.separacionId === '' ? null : datos.separacionId,
      codigo: vacioANulo(datos.codigo),
      fecha_firma: vacioANulo(datos.fechaFirma),
      precio_total: Number(datos.precioTotal.trim().replace(',', '.')),
      precio_moneda: datos.precioMoneda,
      modalidad_pago: vacioANulo(datos.modalidadPago),
      inicial_monto:
        datos.inicialMonto.trim() === ''
          ? null
          : Number(datos.inicialMonto.trim().replace(',', '.')),
      estado_legal: vacioANulo(datos.estadoLegal),
      observaciones: vacioANulo(datos.observaciones),
      creado_por: creadoPor,
    })
    .select('id')

  if (error !== null) return { ok: false, motivo: mensajeDeError(error.message) }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      motivo:
        'La base no guardó nada y tampoco devolvió un error: tu rol no puede crear contratos ' +
        '(política contratos_escribir de RLS reserva esto a dirección y administración).',
    }
  }

  const id = texto((data[0] as Record<string, unknown>)['id'])
  if (id === null) {
    return { ok: false, motivo: 'Se guardó, pero la base devolvió una respuesta ilegible.' }
  }
  return { ok: true, id }
}

// ---------------------------------------------------------------------------
// Generacion del calendario
// ---------------------------------------------------------------------------

export type ResultadoCuotas = { ok: true; generadas: number } | { ok: false; motivo: string }

/**
 * Escribe las filas de `cuotas`.
 *
 * Se insertan TODAS en una sola llamada a proposito: PostgREST manda un solo
 * `insert`, y si una fila falla no se queda medio calendario escrito. Un
 * calendario a medias es peor que ninguno — la cobranza lo leeria como si el
 * socio solo debiera las primeras.
 *
 * La moneda es la del contrato, sin opcion a cambiarla (R7).
 */
export async function generarCuotas(
  contratoId: string,
  cuotas: readonly CuotaProyectada[],
  moneda: Moneda,
  concepto: string,
): Promise<ResultadoCuotas> {
  if (cuotas.length === 0) {
    return { ok: false, motivo: 'No hay ninguna cuota que generar.' }
  }

  const filas = cuotas.map((c) => ({
    contrato_id: contratoId,
    numero: c.numero,
    fecha_vencimiento: c.fechaVencimiento,
    monto: centimosAMonto(c.centimos),
    monto_moneda: moneda,
    concepto: concepto.trim() === '' ? null : concepto.trim(),
  }))

  const { data, error } = await supabase.from('cuotas').insert(filas).select('id')

  if (error !== null) return { ok: false, motivo: mensajeDeError(error.message) }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      motivo:
        'La base no guardó ninguna cuota y tampoco devolvió un error: tu rol no puede escribir ' +
        'cuotas (política cuotas_escribir).',
    }
  }
  return { ok: true, generadas: data.length }
}

/** Las cuotas ya generadas de un contrato, para la ficha y para no duplicarlas. */
export type CuotaGuardada = {
  id: string
  numero: number
  fechaVencimiento: string
  monto: number | string | null
  montoMoneda: string | null
  estado: string
  concepto: string | null
}

export async function cargarCuotas(contratoId: string): Promise<Lote<CuotaGuardada>> {
  const { data, error } = await supabase
    .from('cuotas')
    .select('id, numero, fecha_vencimiento, monto, monto_moneda, estado, concepto')
    .eq('contrato_id', contratoId)
    .order('numero', { ascending: true })

  if (error !== null) throw new Error(mensajeDeError(error.message))

  return leerLote(data, (fila) => {
    if (typeof fila !== 'object' || fila === null) return null
    const f = fila as Record<string, unknown>
    const id = texto(f['id'])
    const numero = entero(f['numero'])
    const fechaVencimiento = texto(f['fecha_vencimiento'])
    const estado = texto(f['estado'])
    if (id === null || numero === null || fechaVencimiento === null || estado === null) return null
    return {
      id,
      numero,
      fechaVencimiento,
      monto: monto(f['monto']),
      montoMoneda: texto(f['monto_moneda']),
      estado,
      concepto: texto(f['concepto']),
    }
  })
}

/** Suma de las cuotas proyectadas, para comprobar contra el monto a financiar. */
export function totalProyectado(cuotas: readonly CuotaProyectada[]): number {
  return centimosAMonto(cuotas.reduce((suma, c) => suma + c.centimos, 0))
}

/** El saldo a financiar propuesto: precio − inicial. Editable por quien lo use. */
export function financiablePropuesto(precioTotal: string, inicial: string): string {
  const precio = aNumero(precioTotal.trim().replace(',', '.'))
  if (precio === null) return ''
  const dado = inicial.trim() === '' ? 0 : aNumero(inicial.trim().replace(',', '.'))
  if (dado === null) return ''
  const resto = Math.round((precio - dado) * 100) / 100
  return resto > 0 ? String(resto) : ''
}

function vacioANulo(valor: string): string | null {
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

function mensajeDeError(mensaje: string): string {
  if (mensaje.includes('Nada se borra')) return mensaje

  if (mensaje.includes('unidad_un_contrato_vivo')) {
    return (
      'Esa unidad ya tiene un contrato vivo. El índice unidad_un_contrato_vivo lo impide: ' +
      'una unidad, un contrato. Si el anterior quedó sin efecto, hay que archivarlo primero.'
    )
  }
  if (mensaje.includes('contratos_codigo_key') || mensaje.includes('duplicate key')) {
    return 'Ese código de contrato ya existe. Los códigos son únicos.'
  }
  if (mensaje.includes('cuotas_contrato_id_numero_key')) {
    return (
      'Ese contrato ya tiene cuotas con esos números. El calendario se genera una sola vez: ' +
      'revisa las cuotas existentes antes de volver a generarlo.'
    )
  }
  if (mensaje.includes('row-level security') || mensaje.includes('violates row-level')) {
    return (
      'Tu rol no puede hacer eso con los contratos o las cuotas. Las políticas ' +
      'contratos_escribir y cuotas_escribir las reservan a dirección y administración.'
    )
  }
  if (mensaje.includes('JWT') || mensaje.includes('sesión activa')) {
    return 'Se cerró tu sesión. Vuelve a entrar al CRM.'
  }
  if (mensaje.includes('Failed to fetch') || mensaje.includes('NetworkError')) {
    return 'No hay conexión con el servidor. No se guardó nada.'
  }
  return mensaje
}
