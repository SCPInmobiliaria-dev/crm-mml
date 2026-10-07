import { supabase } from '@/lib/supabase'
import { subirComprobante } from '@/lib/comprobantes'
import { booleano, entero, leerLote, monto, texto, type Lote } from '@/lib/lectura'
import type { Moneda } from '@/lib/dinero'

/**
 * Separaciones — el S/500, y las dos reglas mas delicadas del negocio.
 *
 * ===========================================================================
 * LOS DOS RELOJES SON DOS CAMPOS. AQUI NO SE TOCAN.                    (R4)
 * ===========================================================================
 * En todo este archivo no existe ninguna funcion que calcule un plazo a partir
 * del otro, ni una que devuelva «los dias que faltan» sin decir de cual de los
 * dos. Son cosas distintas:
 *
 *   RELOJ 1 · derecho de devolucion — se cuenta desde el DEPOSITO EFECTIVO y
 *     lo calcula LA BASE, en `fn_calcular_limite_devolucion`, leyendo
 *     `parametros('plazo_devolucion_separacion_dias')`. La interfaz no lo
 *     calcula ni lo propone: manda la fecha de deposito y lee lo que la base
 *     escribio.
 *   RELOJ 2 · vigencia del precio post-evento — es un campo independiente que
 *     rellena la persona. No se deriva de nada.
 *
 * Mezclarlos no es un detalle de presentacion: es un problema legal
 * (01-schema.sql, comentarios de las dos columnas; Acta 03-O02 y DEC-018).
 *
 * La UNICA concesion es `relojMasCercano`, que se usa SOLO para ordenar la
 * bandeja y nunca para mostrar un numero. Esta comentada abajo.
 *
 * ===========================================================================
 * SOLO DIRECCION VERIFICA, Y EL MENSAJE DE LA BASE SE MUESTRA TAL CUAL  (R2)
 * ===========================================================================
 * `fn_verificacion_solo_direccion` lanza una excepcion citando el Acta 03-O02.
 * Ese texto NO se reescribe aqui: se muestra literal. Es la unica forma de que
 * quien lo lea sepa de donde sale la regla, y no de un capricho del programa.
 *
 * ===========================================================================
 * NINGUNA CIFRA DE NEGOCIO VIVE AQUI
 * ===========================================================================
 * Ni el monto de la separacion, ni los dias de ninguno de los dos relojes. Los
 * ids de los parametros que hay que leer estan declarados abajo como
 * constantes de texto — son nombres de filas, no valores.
 */

// ---------------------------------------------------------------------------
// Los parametros que esta pantalla necesita
// ---------------------------------------------------------------------------

/**
 * Ids de `parametros` que usa la pantalla. Son NOMBRES DE FILA, no cifras:
 * lo que valen se lee de la base en tiempo de ejecucion, y hoy casi todos
 * estan en 🔴 rojo a proposito (04-seed-parametros.sql).
 */
export const PARAMETRO = {
  monto: 'separacion_monto',
  plazoDevolucion: 'plazo_devolucion_separacion_dias',
  banco: 'banco_receptor',
  razonSocial: 'razon_social',
  ruc: 'ruc',
  naturalezaJuridica: 'naturaleza_juridica_producto',
} as const

/** Los que hacen falta para dibujar el formulario. */
export const PARAMETROS_DEL_FORMULARIO = [
  PARAMETRO.monto,
  PARAMETRO.plazoDevolucion,
  PARAMETRO.banco,
] as const

/** Los que hacen falta para emitir la constancia. */
export const PARAMETROS_DE_LA_CONSTANCIA = [
  PARAMETRO.razonSocial,
  PARAMETRO.ruc,
  PARAMETRO.naturalezaJuridica,
] as const

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

/** Enum `estado_separacion` de 01-schema.sql (seccion 0). */
export const ESTADOS_SEPARACION = [
  { valor: 'pendiente_verificacion', etiqueta: 'Pendiente de verificación' },
  { valor: 'verificada', etiqueta: 'Verificada' },
  { valor: 'devuelta', etiqueta: 'Devuelta' },
  { valor: 'aplicada_a_contrato', etiqueta: 'Aplicada a contrato' },
  { valor: 'vencida', etiqueta: 'Vencida' },
] as const

export function etiquetaEstadoSeparacion(estado: string): string {
  return ESTADOS_SEPARACION.find((e) => e.valor === estado)?.etiqueta ?? estado
}

// ---------------------------------------------------------------------------
// La fila de la bandeja — `v_separaciones_vigilancia`
// ---------------------------------------------------------------------------

/**
 * Una separacion vigilada, con SUS DOS RELOJES POR SEPARADO (R4).
 *
 * No hay un `diasParaVencer` unico, porque no existe tal cosa.
 */
export type SeparacionVigilada = {
  id: string
  personaId: string | null
  oportunidadId: string | null
  nombreCompleto: string
  codigoUnidad: string | null
  /** Se conserva como llega (R7: siempre junto a su moneda, nunca suelto). */
  monto: number | string | null
  montoMoneda: string | null
  estado: string
  fechaDepositoEfectivo: string | null
  /** RELOJ 1 · derecho de devolucion. Lo calcula la base. */
  fechaLimiteDevolucion: string | null
  diasParaFinDevolucion: number | null
  /** RELOJ 2 · vigencia del precio. Independiente del anterior. */
  fechaLimitePrecio: string | null
  diasParaFinPrecio: number | null
  verificadaEl: string | null
  esperaVerificacion: boolean
  puedeEmitirConstancia: boolean | null
}

export const COLUMNAS_SEPARACION =
  'id, persona_id, oportunidad_id, nombre_completo, codigo_unidad, monto, monto_moneda, ' +
  'estado, fecha_deposito_efectivo, fecha_limite_devolucion, dias_para_fin_devolucion, ' +
  'fecha_limite_precio, dias_para_fin_precio, verificada_el, espera_verificacion_de_walter, ' +
  'puede_emitir_constancia'

export function interpretarSeparacion(fila: unknown): SeparacionVigilada | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const nombreCompleto = texto(f['nombre_completo'])
  const estado = texto(f['estado'])
  if (id === null || nombreCompleto === null || estado === null) return null

  return {
    id,
    personaId: texto(f['persona_id']),
    oportunidadId: texto(f['oportunidad_id']),
    nombreCompleto,
    codigoUnidad: texto(f['codigo_unidad']),
    monto: monto(f['monto']),
    montoMoneda: texto(f['monto_moneda']),
    estado,
    fechaDepositoEfectivo: texto(f['fecha_deposito_efectivo']),
    fechaLimiteDevolucion: texto(f['fecha_limite_devolucion']),
    diasParaFinDevolucion: entero(f['dias_para_fin_devolucion']),
    fechaLimitePrecio: texto(f['fecha_limite_precio']),
    diasParaFinPrecio: entero(f['dias_para_fin_precio']),
    verificadaEl: texto(f['verificada_el']),
    esperaVerificacion: f['espera_verificacion_de_walter'] === true,
    puedeEmitirConstancia: booleano(f['puede_emitir_constancia']),
  }
}

/**
 * SOLO PARA ORDENAR. Nunca para mostrar.
 *
 * La bandeja se pide «ordenada por el reloj que vence antes». Eso obliga a
 * comparar los dos numeros una vez, para decidir que fila va arriba. Lo que NO
 * se hace en ningun sitio es enseñar este resultado: en pantalla los dos
 * relojes salen siempre por separado y con su nombre, porque la fila puede
 * estar arriba por el reloj 1 y ser el 2 el que no corre prisa.
 *
 * Una separacion sin ninguno de los dos plazos se va al final: no es que no
 * corra prisa, es que no se sabe — y eso ya se avisa en la propia fila.
 */
export function relojMasCercano(s: SeparacionVigilada): number {
  const candidatos = [s.diasParaFinDevolucion, s.diasParaFinPrecio].filter(
    (d): d is number => d !== null,
  )
  return candidatos.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...candidatos)
}

/**
 * La bandeja: todo lo que `v_separaciones_vigilancia` considera vivo, o sea
 * las separaciones en `pendiente_verificacion` y `verificada`. Las devueltas,
 * vencidas y aplicadas a contrato NO estan ahi por definicion de la vista; la
 * pantalla lo dice para que nadie lea esta lista como «todas».
 */
export async function cargarBandeja(): Promise<Lote<SeparacionVigilada>> {
  const { data, error } = await supabase
    .from('v_separaciones_vigilancia')
    .select(COLUMNAS_SEPARACION)
    .limit(200)

  if (error !== null) throw new Error(mensajeDeError(error.message))

  const lote = leerLote(data, interpretarSeparacion)
  return {
    ...lote,
    filas: [...lote.filas].sort((a, b) => relojMasCercano(a) - relojMasCercano(b)),
  }
}

/**
 * La misma fila de la bandeja, pero de UNA separacion.
 *
 * La ficha la necesita por los dias restantes: `dias_para_fin_devolucion` y
 * `dias_para_fin_precio` los resta la vista contra `current_date`, y se leen de
 * ahi en vez de recalcularlos en el navegador. Asi el numero que ve Walter en
 * la bandeja y el que ve al abrir la ficha son el mismo, y no dependen del
 * reloj del equipo ni de su zona horaria.
 *
 * Devuelve `null` cuando la separacion existe pero la vista ya no la vigila:
 * `v_separaciones_vigilancia` solo trae `pendiente_verificacion` y
 * `verificada`. Una devuelta o vencida no tiene relojes que contar, y la ficha
 * lo dice en vez de enseñar un cero.
 */
export async function cargarVigilancia(id: string): Promise<SeparacionVigilada | null> {
  const { data, error } = await supabase
    .from('v_separaciones_vigilancia')
    .select(COLUMNAS_SEPARACION)
    .eq('id', id)
    .maybeSingle()

  if (error !== null) throw new Error(mensajeDeError(error.message))
  if (data === null) return null
  return interpretarSeparacion(data)
}

// ---------------------------------------------------------------------------
// La ficha completa — se lee de la tabla, no de la vista
// ---------------------------------------------------------------------------

/**
 * `v_separaciones_vigilancia` no trae el banco, el numero de operacion ni el
 * comprobante: no le hacen falta a la pantalla Hoy, que es para quien se
 * escribio. La ficha si los necesita —Walter tiene que VER el voucher antes de
 * verificar— asi que se leen de la tabla. Politica: `sep_leer`, que deja leer
 * a los cinco roles.
 */
export type SeparacionCompleta = {
  id: string
  oportunidadId: string
  personaId: string
  nombreCompleto: string | null
  telefono: string | null
  docTipo: string | null
  docNumero: string | null
  unidadId: string | null
  codigoUnidad: string | null
  monto: number | string | null
  montoMoneda: string | null
  banco: string | null
  nroOperacion: string | null
  comprobanteRuta: string | null
  fechaDepositoEfectivo: string | null
  /** RELOJ 1 · lo escribio la base. */
  fechaLimiteDevolucion: string | null
  /** RELOJ 2 · lo escribio la persona. */
  fechaLimitePrecio: string | null
  plazoParametro: string | null
  estado: string
  verificadaPor: string | null
  verificadaEl: string | null
  docClienteRegistrado: boolean
  notas: string | null
  creadoEl: string | null
  /** Quién la registró (perfiles.id): un comercial solo puede anular las suyas sin verificar. */
  creadoPor: string | null
  /** Responsable de la oportunidad: también cuenta como «suya» (fn_cerrar_separacion). */
  responsableId: string | null
  /** Anulada = archivada (sql/17). Una separación archivada ya no está viva. */
  archivadoEl: string | null
}

const COLUMNAS_COMPLETA =
  'id, oportunidad_id, persona_id, unidad_id, monto, monto_moneda, banco, nro_operacion, ' +
  'comprobante_url, fecha_deposito_efectivo, fecha_limite_devolucion, fecha_limite_precio, ' +
  'plazo_parametro, estado, verificada_por, verificada_el, doc_cliente_registrado, notas, ' +
  'creado_el, creado_por, archivado_el, personas(nombre_completo, telefono_e164, doc_tipo, doc_numero), ' +
  'unidades(codigo_unidad), oportunidades(responsable_id)'

function relacionada(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null
}

function interpretarCompleta(fila: unknown): SeparacionCompleta | null {
  if (typeof fila !== 'object' || fila === null) return null
  const f = fila as Record<string, unknown>

  const id = texto(f['id'])
  const oportunidadId = texto(f['oportunidad_id'])
  const personaId = texto(f['persona_id'])
  const estado = texto(f['estado'])
  if (id === null || oportunidadId === null || personaId === null || estado === null) return null

  const persona = relacionada(f['personas'])
  const unidad = relacionada(f['unidades'])
  const oportunidad = relacionada(f['oportunidades'])

  return {
    id,
    oportunidadId,
    personaId,
    nombreCompleto: persona === null ? null : texto(persona['nombre_completo']),
    telefono: persona === null ? null : texto(persona['telefono_e164']),
    docTipo: persona === null ? null : texto(persona['doc_tipo']),
    docNumero: persona === null ? null : texto(persona['doc_numero']),
    unidadId: texto(f['unidad_id']),
    codigoUnidad: unidad === null ? null : texto(unidad['codigo_unidad']),
    monto: monto(f['monto']),
    montoMoneda: texto(f['monto_moneda']),
    banco: texto(f['banco']),
    nroOperacion: texto(f['nro_operacion']),
    comprobanteRuta: texto(f['comprobante_url']),
    fechaDepositoEfectivo: texto(f['fecha_deposito_efectivo']),
    fechaLimiteDevolucion: texto(f['fecha_limite_devolucion']),
    fechaLimitePrecio: texto(f['fecha_limite_precio']),
    plazoParametro: texto(f['plazo_parametro']),
    estado,
    verificadaPor: texto(f['verificada_por']),
    verificadaEl: texto(f['verificada_el']),
    docClienteRegistrado: f['doc_cliente_registrado'] === true,
    notas: texto(f['notas']),
    creadoEl: texto(f['creado_el']),
    creadoPor: texto(f['creado_por']),
    responsableId: oportunidad === null ? null : texto(oportunidad['responsable_id']),
    archivadoEl: texto(f['archivado_el']),
  }
}

export async function cargarSeparacion(id: string): Promise<SeparacionCompleta | null> {
  const { data, error } = await supabase
    .from('separaciones')
    .select(COLUMNAS_COMPLETA)
    .eq('id', id)
    .maybeSingle()

  if (error !== null) throw new Error(mensajeDeError(error.message))
  if (data === null) return null

  const leida = interpretarCompleta(data)
  if (leida === null) {
    throw new Error(
      'La base devolvió una separación con una forma que este cliente no reconoce. ' +
        'No se muestra: en una pantalla que toca dinero, media ficha es peor que ninguna.',
    )
  }
  return leida
}

// ---------------------------------------------------------------------------
// R3 · ¿se puede emitir la constancia?
// ---------------------------------------------------------------------------

/**
 * Le pregunta a la FUNCION de la base, no a una copia de su logica.
 *
 * `puede_emitir_constancia` es falso mientras Walter no verifique (Acta 03-O02:
 * no se emite recibo antes de su verificacion) y exige ademas que el documento
 * del cliente este registrado. Si la llamada falla, se devuelve `false`: en una
 * regla que decide si se imprime un recibo, la duda se resuelve NO imprimiendo.
 */
export async function puedeEmitirConstancia(separacionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('puede_emitir_constancia', {
    p_separacion_id: separacionId,
  })

  if (error !== null) return false
  return data === true
}

// ---------------------------------------------------------------------------
// R2 · verificar
// ---------------------------------------------------------------------------

export type ResultadoAccion = { ok: true } | { ok: false; motivo: string }

/**
 * Marca la separacion como verificada.
 *
 * `verificada_por` NO se manda: lo pone el disparador con `auth.uid()`. Que lo
 * escribiera el cliente permitiria verificar «en nombre de» otra persona, que
 * es justo lo que R2 impide.
 *
 * EL MENSAJE DE ERROR SE DEVUELVE TAL CUAL. Si quien lo intenta no es
 * direccion, `fn_verificacion_solo_direccion` lanza una excepcion que cita el
 * Acta 03-O02, y ese texto es mas util que cualquier cosa que pudieramos
 * escribir aqui: dice la regla y de donde sale.
 */
export async function verificarSeparacion(id: string): Promise<ResultadoAccion> {
  const { data, error } = await supabase
    .from('separaciones')
    .update({ verificada_el: new Date().toISOString(), estado: 'verificada' })
    .eq('id', id)
    .select('id, verificada_el, verificada_por')

  if (error !== null) {
    return { ok: false, motivo: mensajeDeError(error.message) }
  }

  // Con RLS, un update que no encaja en la politica devuelve 200 y cero filas,
  // sin error. Sin esta comprobacion la pantalla diria «verificada» sobre una
  // separacion que sigue sin verificar — en R2, la peor mentira posible.
  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      motivo:
        'La base no aplicó la verificación y tampoco devolvió un error: tu rol no puede editar ' +
        'esta separación (políticas sep_editar_* de RLS). Solo Dirección verifica (R2).',
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Cerrar una separación (sql/17 · fn_cerrar_separacion)
// ---------------------------------------------------------------------------

/**
 * Las tres formas de cerrar una separación viva. Antes de sql/17 ninguna se
 * podía hacer desde el CRM: la separación se quedaba «viva» para siempre y,
 * con el estado de la unidad siguiendo a la separación, la unidad también.
 *
 * CUÁNDO vence una separación no lo decide el CRM: «qué pasa al día 8» no
 * tiene regla escrita (00-fuente-de-verdad\separacion-vigente.md §3.3, decide
 * Walter). Por eso «vencida» la marca una persona, con su motivo.
 */
export const ACCIONES_CIERRE = [
  {
    valor: 'devolver',
    etiqueta: 'Devolver',
    explicacion: 'Se le devolvió el dinero al cliente. Queda «devuelta» con la fecha.',
  },
  {
    valor: 'vencer',
    etiqueta: 'Marcar vencida',
    explicacion: 'Pasó el plazo sin contrato y se decidió darla por vencida.',
  },
  {
    valor: 'anular',
    etiqueta: 'Anular (prueba o error)',
    explicacion: 'No fue una separación real: se archiva con el motivo. Nada se borra.',
  },
] as const

export type AccionCierre = (typeof ACCIONES_CIERRE)[number]['valor']

/** Quién puede cada acción — COPIA de fn_cerrar_separacion (sql/17); quien decide es la base. */
export function accionesPermitidas(
  rol: string | null,
  s: { verificada: boolean; esPropia: boolean },
): AccionCierre[] {
  if (rol === 'direccion' || rol === 'administracion') return ['devolver', 'vencer', 'anular']
  if (rol === 'comercial' && !s.verificada && s.esPropia) return ['anular']
  return []
}

function motivoDeRpc(mensaje: string): string {
  const m = mensaje.toLowerCase()
  if (m.includes('could not find the function') || m.includes('schema cache')) {
    return 'Falta aplicar sql/17-inventario-maestro.sql en Supabase: sin él no se puede cerrar una separación desde el CRM.'
  }
  return mensajeDeError(mensaje)
}

/** Devuelve, vence o anula una separación viva. La unidad vuelve sola a su estado anterior (sql/17). */
export async function cerrarSeparacion(
  id: string,
  accion: AccionCierre,
  motivo: string,
  /** Solo para «devolver»: 'aaaa-mm-dd'. Vacío = hoy (hora de Lima, lo pone la base). */
  fecha: string,
): Promise<ResultadoAccion> {
  if (motivo.trim() === '') {
    return { ok: false, motivo: 'Escribe por qué se cierra: queda registrado.' }
  }
  const { data, error } = await supabase.rpc('fn_cerrar_separacion', {
    p_separacion_id: id,
    p_accion: accion,
    p_motivo: motivo.trim(),
    p_fecha: accion === 'devolver' && fecha.trim() !== '' ? fecha.trim() : null,
  })
  if (error !== null) return { ok: false, motivo: motivoDeRpc(error.message) }
  const r = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
  if (r === null || r['ok'] !== true) {
    return { ok: false, motivo: 'La base respondió algo que no se pudo leer (fn_cerrar_separacion).' }
  }
  return { ok: true }
}

/**
 * Marca «documento del cliente registrado» después de crear la separación (R3
 * lo exige para la constancia). La base solo lo acepta si la ficha de la
 * persona ya tiene su documento.
 */
export async function registrarDocCliente(id: string): Promise<ResultadoAccion> {
  const { data, error } = await supabase.rpc('fn_registrar_doc_cliente', { p_separacion_id: id })
  if (error !== null) return { ok: false, motivo: motivoDeRpc(error.message) }
  const r = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
  if (r === null || r['ok'] !== true) {
    return { ok: false, motivo: 'La base respondió algo que no se pudo leer (fn_registrar_doc_cliente).' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Storage · el comprobante
// ---------------------------------------------------------------------------

/**
 * Vive en src/lib/comprobantes.ts desde que Cobranza necesito subir el
 * comprobante de un pago al MISMO bucket con las MISMAS politicas. Se reexporta
 * aqui para no romper a quien ya lo importaba de este archivo, y para que siga
 * habiendo una sola forma de nombrar un archivo y de pedir una URL firmada.
 */
export { BUCKET_COMPROBANTES, urlFirmadaComprobante } from '@/lib/comprobantes'
export { subirComprobante }

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

export type DatosSeparacion = {
  /** Id de la OPORTUNIDAD. `separaciones.oportunidad_id` es NOT NULL. */
  oportunidadId: string
  /** Se deriva de la oportunidad elegida; no se pide dos veces. */
  personaId: string
  /** Vacio = sin unidad todavia. El esquema lo permite. */
  unidadId: string
  monto: string
  montoMoneda: Moneda | ''
  banco: string
  nroOperacion: string
  /** RELOJ 1 · arranca la cuenta de la base. Vacio = todavia no hay deposito. */
  fechaDepositoEfectivo: string
  /** RELOJ 2 · independiente. Lo escribe la persona. */
  fechaLimitePrecio: string
  docClienteRegistrado: boolean
  notas: string
}

export type CampoSeparacion = keyof DatosSeparacion

export type ResultadoAlta =
  | { ok: true; id: string }
  | { ok: false; motivo: string; campo?: CampoSeparacion | undefined }

export function separacionEnBlanco(): DatosSeparacion {
  return {
    oportunidadId: '',
    personaId: '',
    unidadId: '',
    monto: '',
    // R7 y `moneda_de_control` en 🔴: no se elige una moneda por defecto. Un
    // monto con la moneda equivocada es peor que un formulario incompleto.
    montoMoneda: '',
    banco: '',
    nroOperacion: '',
    fechaDepositoEfectivo: '',
    fechaLimitePrecio: '',
    docClienteRegistrado: false,
    notas: '',
  }
}

function validar(datos: DatosSeparacion): { motivo: string; campo: CampoSeparacion } | null {
  if (datos.oportunidadId === '' || datos.personaId === '') {
    return {
      motivo: 'Elige la persona y su oportunidad: una separación siempre va atada a una.',
      campo: 'oportunidadId',
    }
  }

  const importe = Number(datos.monto.trim().replace(',', '.'))
  if (datos.monto.trim() === '' || !Number.isFinite(importe) || importe <= 0) {
    return {
      motivo: 'Escribe el monto que se depositó de verdad. Tiene que ser mayor que cero.',
      campo: 'monto',
    }
  }

  // R7: todo campo de dinero lleva su moneda al lado. Nunca un numero suelto.
  if (datos.montoMoneda === '') {
    return {
      motivo:
        'Elige la moneda. Un monto sin moneda no es un dato: la moneda de control del negocio ' +
        'sigue [PENDIENTE] en 00-fuente-de-verdad, así que aquí no se supone ninguna.',
      campo: 'montoMoneda',
    }
  }

  return null
}

/**
 * Registra la separacion.
 *
 * Lo que NO se manda, y es lo importante:
 *  · `verificada_el` / `verificada_por` — la politica `sep_crear` exige que
 *    sean nulos: nadie nace verificado.
 *  · `fecha_limite_devolucion` — la escribe el disparador. Mandarla desde aqui
 *    seria calcular el reloj 1 en el cliente, que es exactamente lo que R4
 *    prohibe.
 *  · `plazo_parametro` — se deja el valor por defecto de la tabla, que ya
 *    apunta a `plazo_devolucion_separacion_dias`.
 *
 * Si `fecha_deposito_efectivo` viene con fecha y ese parametro no tiene valor
 * cargado, la base RECHAZA la insercion con un mensaje que dice exactamente
 * que parametro falta. Ese mensaje se devuelve tal cual.
 */
export async function crearSeparacion(
  datos: DatosSeparacion,
  archivo: File | null,
  creadoPor: string,
): Promise<ResultadoAlta> {
  const fallo = validar(datos)
  if (fallo !== null) return { ok: false, motivo: fallo.motivo, campo: fallo.campo }

  // El comprobante se sube ANTES del insert. Si el insert fallara despues, el
  // archivo queda huerfano en el bucket — el lado correcto del error: un
  // archivo de mas no rompe nada, una separacion sin su comprobante si.
  let ruta: string | null = null
  if (archivo !== null) {
    const subida = await subirComprobante(archivo)
    if (!subida.ok) return { ok: false, motivo: subida.motivo }
    ruta = subida.ruta
  }

  const { data, error } = await supabase
    .from('separaciones')
    .insert({
      oportunidad_id: datos.oportunidadId,
      persona_id: datos.personaId,
      unidad_id: datos.unidadId === '' ? null : datos.unidadId,
      monto: Number(datos.monto.trim().replace(',', '.')),
      monto_moneda: datos.montoMoneda,
      banco: vacioANulo(datos.banco),
      nro_operacion: vacioANulo(datos.nroOperacion),
      comprobante_url: ruta,
      fecha_deposito_efectivo: vacioANulo(datos.fechaDepositoEfectivo),
      fecha_limite_precio: vacioANulo(datos.fechaLimitePrecio),
      doc_cliente_registrado: datos.docClienteRegistrado,
      notas: vacioANulo(datos.notas),
      creado_por: creadoPor,
    })
    .select('id')

  if (error !== null) return { ok: false, motivo: mensajeDeError(error.message) }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      ok: false,
      motivo:
        'La base no guardó nada y tampoco devolvió un error: tu rol no puede registrar ' +
        'separaciones (política sep_crear de RLS).',
    }
  }

  const id = texto((data[0] as Record<string, unknown>)['id'])
  if (id === null) {
    return {
      ok: false,
      motivo: 'Se guardó, pero la base devolvió una respuesta que este cliente no reconoce.',
    }
  }

  return { ok: true, id }
}

function vacioANulo(valor: string): string | null {
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

/**
 * Traduce SOLO lo que sin traducir seria incomprensible.
 *
 * Los dos mensajes que de verdad importan en esta pantalla —el del Acta 03-O02
 * y el del plazo sin cargar— salen de la base ya escritos para una persona, y
 * pasan de largo sin tocarse. Reescribirlos seria perder la cita de la regla.
 */
function mensajeDeError(mensaje: string): string {
  // 1 · Los que ya vienen bien escritos desde la base: tal cual.
  if (mensaje.includes('Acta 03-O02')) return mensaje
  if (mensaje.includes('No se puede calcular el plazo')) return mensaje
  if (mensaje.includes('Nada se borra')) return mensaje

  // 2 · Los opacos.
  if (mensaje.includes('unidad_una_separacion_viva')) {
    return (
      'Esa unidad ya tiene una separación viva (pendiente de verificar o verificada). ' +
      'Regla R1: una unidad, una sola separación a la vez.'
    )
  }
  if (mensaje.includes('verificada_exige_ambos')) {
    return 'La base exige que la verificación tenga a la vez quién y cuándo. No se guardó nada.'
  }
  if (mensaje.includes('estado_verificada_exige_verificacion')) {
    return 'No se puede marcar como «verificada» una separación sin fecha de verificación (R3).'
  }
  if (mensaje.includes('v_separaciones_vigilancia')) {
    return (
      'Falta ejecutar 02-codigo\\sql\\07-vistas-hoy.sql en Supabase: la vista de vigilancia ' +
      'no está actualizada.'
    )
  }
  if (mensaje.includes('row-level security') || mensaje.includes('violates row-level')) {
    return 'Tu rol no puede hacer eso con las separaciones (políticas sep_* de RLS). Habla con Walter.'
  }
  if (mensaje.includes('JWT') || mensaje.includes('sesión activa')) {
    return 'Se cerró tu sesión. Vuelve a entrar al CRM.'
  }
  if (mensaje.includes('Failed to fetch') || mensaje.includes('NetworkError')) {
    return 'No hay conexión con el servidor. No se guardó nada.'
  }

  // 3 · Lo desconocido, crudo: un mensaje feo y cierto antes que uno bonito
  //     que oculte lo que de verdad pasó.
  return mensaje
}
