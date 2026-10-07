import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Archive, Loader2 } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card'
import { Input, claseCampo } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { cn } from '@/lib/utils'
import { useSesion } from '@/auth/ContextoSesion'
import {
  ACCIONES_CIERRE,
  accionesPermitidas,
  cerrarSeparacion,
  registrarDocCliente,
  type AccionCierre,
  type SeparacionCompleta,
} from '@/lib/separaciones'

/** Lo que cambia al cerrar o completar una separación: su ficha, sus listas, Hoy y el inventario. */
function refrescarTodo(cliente: ReturnType<typeof useQueryClient>) {
  void cliente.invalidateQueries({ queryKey: ['separaciones'] })
  void cliente.invalidateQueries({ queryKey: ['hoy'] })
  void cliente.invalidateQueries({ queryKey: ['inventario'] })
  void cliente.invalidateQueries({ queryKey: ['contratos'] })
}

/** ¿Sigue viva? Mismo criterio que la base: pendiente o verificada, y sin archivar. */
export function estaViva(s: SeparacionCompleta): boolean {
  return s.archivadoEl === null && (s.estado === 'pendiente_verificacion' || s.estado === 'verificada')
}

/**
 * CERRAR UNA SEPARACIÓN — devolver, marcar vencida o anular (sql/17).
 *
 * Hasta el 07/10/2026 esto solo se podía hacer por SQL: la pantalla creaba y
 * verificaba, y nada más. Una separación de prueba o mal cargada se quedaba
 * viva para siempre, con su unidad bloqueada.
 *
 * QUIÉN PUEDE QUÉ lo decide `fn_cerrar_separacion` en la base (🔵 propuesta a
 * ratificar por Walter): Dirección y Administración, las tres acciones; un
 * comercial, solo ANULAR una separación suya que todavía no está verificada.
 * Aquí solo se copia esa regla para no ofrecer un botón que la base va a
 * rechazar; si discreparan, manda la base y su mensaje se muestra tal cual.
 *
 * Al cerrarla, la unidad vuelve sola a su estado anterior (sql/17) y la web se
 * entera por el aviso del inventario.
 */
export function CerrarSeparacion({ separacion }: { separacion: SeparacionCompleta }) {
  const { rol, perfil } = useSesion()
  const cliente = useQueryClient()
  const idMotivo = useId()
  const idFecha = useId()

  const [accion, setAccion] = useState<AccionCierre | null>(null)
  const [motivo, setMotivo] = useState('')
  const [fecha, setFecha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  if (!estaViva(separacion)) return null

  const esPropia =
    perfil !== null && (separacion.creadoPor === perfil.id || separacion.responsableId === perfil.id)
  const permitidas = accionesPermitidas(rol, { verificada: separacion.verificadaEl !== null, esPropia })
  if (permitidas.length === 0) return null

  const elegida = ACCIONES_CIERRE.find((a) => a.valor === accion) ?? null

  async function confirmar() {
    if (accion === null || enviando) return
    setEnviando(true)
    setFallo(null)
    const r = await cerrarSeparacion(separacion.id, accion, motivo, fecha)
    setEnviando(false)
    if (!r.ok) return setFallo(r.motivo)
    setAccion(null)
    setMotivo('')
    setFecha('')
    refrescarTodo(cliente)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-black">
          <Archive className="h-5 w-5" aria-hidden="true" />
          Cerrar esta separación
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-snug text-suelo-700">
          Un reloj vencido no la cierra sola: qué pasa «al día 8» si no se firma contrato todavía no
          tiene regla escrita (decide Walter). Al cerrarla, la unidad vuelve a su estado anterior.
        </p>

        <div className="flex flex-wrap gap-2">
          {ACCIONES_CIERRE.filter((a) => permitidas.includes(a.valor)).map((a) => (
            <Button
              key={a.valor}
              type="button"
              variant={accion === a.valor ? 'default' : 'outline'}
              className="h-11 sm:h-10"
              onClick={() => {
                setAccion(accion === a.valor ? null : a.valor)
                setFallo(null)
              }}
              aria-pressed={accion === a.valor}
            >
              {a.etiqueta}
            </Button>
          ))}
        </div>

        {elegida !== null && (
          <div className="space-y-3 rounded-md border border-input p-3">
            <p className="text-sm text-suelo-700">{elegida.explicacion}</p>
            {accion === 'devolver' && (
              <div className="space-y-2">
                <Label htmlFor={idFecha}>Fecha de la devolución (vacía = hoy)</Label>
                <Input
                  id={idFecha}
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor={idMotivo}>¿Por qué? (queda registrado)</Label>
              <textarea
                id={idMotivo}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder={
                  accion === 'anular'
                    ? 'Ej.: separación de prueba, no fue real'
                    : accion === 'devolver'
                      ? 'Ej.: el cliente desistió dentro del plazo'
                      : 'Ej.: pasó el plazo y no firmó'
                }
                className={cn(claseCampo, 'h-auto py-2')}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                className="h-11 sm:h-10"
                disabled={enviando || motivo.trim() === ''}
                onClick={() => void confirmar()}
              >
                {enviando ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Confirmar: {elegida.etiqueta.toLowerCase()}
              </Button>
              <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={() => setAccion(null)}>
                Volver
              </Button>
            </div>
          </div>
        )}

        {fallo !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {fallo}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * El documento del cliente (R3) se podía marcar SOLO al crear la separación:
 * si se olvidó, la constancia quedaba bloqueada para siempre. La base lo
 * acepta ahora en cualquier momento, si la ficha de la persona ya tiene su
 * documento (fn_registrar_doc_cliente, sql/17).
 */
export function RegistrarDocumentoCliente({ separacion }: { separacion: SeparacionCompleta }) {
  const { rol } = useSesion()
  const cliente = useQueryClient()
  const [enviando, setEnviando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  if (separacion.docClienteRegistrado || !estaViva(separacion)) return null
  if (rol !== 'direccion' && rol !== 'comercial' && rol !== 'administracion') return null

  async function registrar() {
    setEnviando(true)
    setFallo(null)
    const r = await registrarDocCliente(separacion.id)
    setEnviando(false)
    if (!r.ok) return setFallo(r.motivo)
    refrescarTodo(cliente)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs leading-snug text-suelo-700">
        {separacion.docNumero === null
          ? 'La ficha del cliente todavía no tiene su documento: regístralo en su ficha y vuelve aquí.'
          : 'La ficha del cliente ya tiene su documento. Si se olvidó marcarlo al crear la separación, márcalo ahora.'}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 sm:h-9"
        disabled={enviando || separacion.docNumero === null}
        onClick={() => void registrar()}
      >
        {enviando ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Marcar documento del cliente registrado
      </Button>
      {fallo !== null && (
        <p role="alert" className="text-xs font-bold text-alerta">
          {fallo}
        </p>
      )}
    </div>
  )
}
