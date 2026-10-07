import { supabase, supabaseConfigurado } from '@/lib/supabase'

/**
 * El inventario del CRM, al día sin recargar.
 *
 * sql/16 hace que la base avise por Realtime —canal público «inventario-publico»,
 * evento «cambio»— cada vez que cambia algo que mueve la disponibilidad: una
 * unidad, una separación, la asignación de una oportunidad, el corte. Es el
 * mismo aviso que usa la web de planos; el CRM lo escucha para que lo que otra
 * persona acaba de separar se vea en Inventario en pocos segundos.
 *
 * El aviso NO lleva datos (solo el nombre de la tabla): sirve para decir «vuelve
 * a leer», nunca para leer. Quien lee es la consulta de siempre, con su RLS.
 *
 * Es una mejora, no una dependencia: si el proyecto no tiene `realtime.send` o
 * el canal no se puede abrir, no pasa nada visible; la pantalla se sigue
 * refrescando al volver a la pestaña y tras cada escritura propia.
 */

export const CANAL_INVENTARIO = 'inventario-publico'
export const EVENTO_INVENTARIO = 'cambio'

/** Una escritura puede disparar varios avisos seguidos: se juntan en una sola relectura. */
const ESPERA_MS = 800

/** Empieza a escuchar. Devuelve la función que deja de escuchar (para el efecto de React). */
export function escucharCambiosInventario(alCambiar: () => void): () => void {
  if (!supabaseConfigurado) return () => undefined

  let temporizador: ReturnType<typeof setTimeout> | null = null
  const canal = supabase
    .channel(CANAL_INVENTARIO)
    .on('broadcast', { event: EVENTO_INVENTARIO }, () => {
      if (temporizador !== null) clearTimeout(temporizador)
      temporizador = setTimeout(() => {
        temporizador = null
        alCambiar()
      }, ESPERA_MS)
    })
    .subscribe()

  return () => {
    if (temporizador !== null) clearTimeout(temporizador)
    void supabase.removeChannel(canal)
  }
}
