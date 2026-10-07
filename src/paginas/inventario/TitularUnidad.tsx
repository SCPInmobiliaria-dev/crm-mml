import { useEffect, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { AlertTriangle, Loader2, UserMinus, UserPlus } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { Input, claseCampo } from '@/componentes/ui/input'
import { Label } from '@/componentes/ui/label'
import { cn } from '@/lib/utils'
import { formatearTelefono } from '@/lib/telefono'
import {
  TIPOS_DOCUMENTO_PERSONA,
  guardarTitular,
  quitarTitular,
  titularAFormulario,
  titularEnBlanco,
  type CampoTitular,
  type DatosTitular,
  type DetalleUnidad,
  type Unidad,
} from '@/lib/inventario'

/**
 * EL TITULAR DE LA UNIDAD — el dueño del puesto, con sus datos de contacto.
 *
 * El titular es una persona del CRM (`personas`, marcada como socio), la misma
 * que aparece en el resto de pantallas: guardarlo aquí no crea una copia. Todo
 * el trabajo lo hace `fn_guardar_titular_unidad` en la base, en una sola
 * transacción:
 *   · «Editar a este titular» actualiza SUS datos.
 *   · «Poner a otra persona» busca por documento y luego por teléfono; si ya
 *     existía, la vincula SIN pisar sus datos; si no, la crea.
 *   · «Quitar el titular» suelta el vínculo. La persona no se borra (R8).
 *
 * Son datos personales de un tercero (DNI, teléfonos, correo): Ley 29733,
 * dato mínimo necesario. Solo Dirección y Administración llegan a esta pantalla
 * (RLS de `unidades` y `personas`), y nada de esto sale en la web.
 */
export function TitularUnidad({
  unidad,
  detalle,
  alCambiar,
}: {
  unidad: Unidad
  detalle: UseQueryResult<DetalleUnidad>
  /** El titular cambió: el contenedor refresca el inventario al cerrar. */
  alCambiar: () => void
}) {
  const titular = detalle.data?.titular ?? null

  const [modo, setModo] = useState<'editar' | 'otro'>('editar')
  const [datos, setDatos] = useState<DatosTitular>(titularEnBlanco)
  const [prellenado, setPrellenado] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [quitando, setQuitando] = useState(false)
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)
  const [error, setError] = useState<{ motivo: string; campo?: CampoTitular | undefined } | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  // Se rellena UNA vez, cuando llega el detalle. Después manda lo que se escribe.
  useEffect(() => {
    if (prellenado || detalle.data === undefined) return
    setDatos(detalle.data.titular === null ? titularEnBlanco() : titularAFormulario(detalle.data.titular))
    setPrellenado(true)
  }, [detalle.data, prellenado])

  function cambiar<C extends CampoTitular>(campo: C, valor: DatosTitular[C]) {
    setDatos((previo) => ({ ...previo, [campo]: valor }))
  }

  /** Vuelve a leer el detalle y deja el formulario como quedó en la base. */
  async function recargar() {
    const fresco = await detalle.refetch()
    const t = fresco.data?.titular ?? null
    setDatos(t === null ? titularEnBlanco() : titularAFormulario(t))
    setModo('editar')
  }

  async function guardar() {
    if (guardando) return
    setGuardando(true)
    setError(null)
    setHecho(null)
    const editando = modo === 'editar' && titular !== null
    const r = await guardarTitular(unidad.id, editando ? titular.personaId : null, datos)
    setGuardando(false)
    if (!r.ok) return setError({ motivo: r.motivo, campo: r.campo })
    await recargar()
    alCambiar()
    setHecho(
      r.creada
        ? 'Titular creado y vinculado a la unidad.'
        : r.reutilizada
          ? 'Esa persona ya estaba en el CRM: quedó vinculada como titular (sus datos no se tocaron).'
          : 'Datos del titular guardados.',
    )
  }

  async function soltar() {
    if (quitando) return
    setQuitando(true)
    setError(null)
    setHecho(null)
    const r = await quitarTitular(unidad.id)
    setQuitando(false)
    setConfirmarQuitar(false)
    if (!r.ok) return setError({ motivo: r.motivo })
    await recargar()
    alCambiar()
    setHecho('La unidad quedó sin titular. La persona sigue en el CRM.')
  }

  if (detalle.isPending) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-suelo-700">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Cargando el titular…
      </p>
    )
  }
  if (detalle.isError) {
    return (
      <p role="alert" className="rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta">
        No se pudo leer el titular: {detalle.error.message}
      </p>
    )
  }

  const hayTitular = titular !== null
  const editando = modo === 'editar' && hayTitular

  return (
    <div className="space-y-4">
      {hayTitular ? (
        <div className="rounded-md bg-tinta-banda p-3 text-sm">
          <p className="text-xs text-suelo-700">Titular actual</p>
          <p className="font-black text-suelo">{titular.nombreCompleto}</p>
          <p className="text-suelo-700">
            {titular.docTipo !== null && titular.docNumero !== null
              ? `${titular.docTipo} ${titular.docNumero}`
              : 'sin documento'}
            {' · '}
            {titular.telefono === null ? 'sin teléfono' : formatearTelefono(titular.telefono)}
          </p>
        </div>
      ) : (
        <p className="rounded-md bg-tinta-banda p-3 text-sm text-suelo-700">
          Esta unidad no tiene titular (o tu rol no puede ver a la persona). Si es de un socio,
          escribe sus datos abajo.
        </p>
      )}

      {hayTitular && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={editando ? 'default' : 'outline'}
            size="sm"
            className="h-11 sm:h-9"
            onClick={() => {
              setModo('editar')
              setDatos(titularAFormulario(titular))
              setError(null)
            }}
          >
            Editar a este titular
          </Button>
          <Button
            type="button"
            variant={!editando ? 'default' : 'outline'}
            size="sm"
            className="h-11 sm:h-9"
            onClick={() => {
              setModo('otro')
              setDatos(titularEnBlanco())
              setError(null)
            }}
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Poner a otra persona
          </Button>
        </div>
      )}

      {hayTitular && !editando && (
        <p className="text-xs leading-snug text-suelo-700">
          Escribe los datos de la otra persona. Si su documento o su teléfono ya están en el CRM, se
          usa esa persona (sus datos no se pisan); si no, se crea.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Campo
            id="tit-nombre"
            etiqueta="Nombre completo"
            obligatorio
            valor={datos.nombre}
            alCambiar={(v) => cambiar('nombre', v)}
            error={error?.campo === 'nombre'}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tit-doc-tipo">Tipo de documento</Label>
          <select
            id="tit-doc-tipo"
            value={datos.docTipo}
            onChange={(e) => cambiar('docTipo', e.target.value)}
            className={cn(claseCampo, error?.campo === 'docTipo' && 'border-alerta')}
          >
            <option value="">— sin documento —</option>
            {TIPOS_DOCUMENTO_PERSONA.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <Campo
          id="tit-doc-numero"
          etiqueta="Número de documento"
          valor={datos.docNumero}
          alCambiar={(v) => cambiar('docNumero', v)}
          error={error?.campo === 'docNumero'}
        />
        <Campo
          id="tit-telefono"
          etiqueta="Teléfono"
          valor={datos.telefono}
          alCambiar={(v) => cambiar('telefono', v)}
          error={error?.campo === 'telefono'}
          modo="tel"
          ayuda="Se guarda con código de país (+51 si no lo pones)."
        />
        <Campo
          id="tit-telefono2"
          etiqueta="Teléfono alterno"
          valor={datos.telefonoAlterno}
          alCambiar={(v) => cambiar('telefonoAlterno', v)}
          error={error?.campo === 'telefonoAlterno'}
          modo="tel"
        />
        <div className="sm:col-span-2">
          <Campo
            id="tit-email"
            etiqueta="Correo"
            valor={datos.email}
            alCambiar={(v) => cambiar('email', v)}
            error={error?.campo === 'email'}
            modo="email"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="tit-notas">Notas sobre el titular</Label>
          <textarea
            id="tit-notas"
            value={datos.notas}
            onChange={(e) => cambiar('notas', e.target.value)}
            rows={2}
            placeholder="Ej.: el puesto está a nombre de su madre"
            className={cn(claseCampo, 'h-auto py-2')}
          />
        </div>
      </div>

      <p className="text-xs leading-snug text-suelo-500">
        Datos personales de un tercero (Ley 29733): pide solo lo necesario. Un titular nuevo queda
        sin consentimiento registrado y con la fuente «inventario maestro». Nada de esto aparece en
        la web.
      </p>

      {error !== null && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error.motivo}
        </p>
      )}
      {hecho !== null && (
        <p role="status" className="text-sm font-bold text-suelo">
          {hecho}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" onClick={() => void guardar()} disabled={guardando || quitando}>
          {guardando ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              Guardando…
            </>
          ) : editando ? (
            'Guardar los datos del titular'
          ) : (
            'Guardar como titular'
          )}
        </Button>

        {hayTitular &&
          (confirmarQuitar ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold text-suelo">¿Quitar a {titular.nombreCompleto}?</span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-11 sm:h-9"
                onClick={() => void soltar()}
                disabled={quitando}
              >
                {quitando ? <Loader2 className="animate-spin" aria-hidden="true" /> : 'Sí, quitar'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 sm:h-9"
                onClick={() => setConfirmarQuitar(false)}
              >
                No
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => setConfirmarQuitar(true)}
              disabled={guardando}
            >
              <UserMinus className="h-4 w-4" aria-hidden="true" />
              Quitar el titular
            </Button>
          ))}
      </div>
    </div>
  )
}

function Campo({
  id,
  etiqueta,
  valor,
  alCambiar,
  error = false,
  obligatorio = false,
  ayuda,
  modo,
}: {
  id: string
  etiqueta: string
  valor: string
  alCambiar: (valor: string) => void
  error?: boolean
  obligatorio?: boolean
  ayuda?: string
  modo?: 'tel' | 'email'
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {etiqueta}
        {obligatorio && <span className="text-alerta"> · obligatorio</span>}
      </Label>
      <Input
        id={id}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        autoComplete="off"
        {...(modo === 'tel' ? { type: 'tel', inputMode: 'tel' as const } : {})}
        {...(modo === 'email' ? { type: 'email', inputMode: 'email' as const } : {})}
        aria-invalid={error}
        className={cn(error && 'border-alerta')}
      />
      {ayuda !== undefined && <p className="text-xs text-suelo-500">{ayuda}</p>}
    </div>
  )
}
