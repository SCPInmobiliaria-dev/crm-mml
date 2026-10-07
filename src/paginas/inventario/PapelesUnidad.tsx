import { useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Camera, ExternalLink, Loader2, Upload } from 'lucide-react'
import { Button } from '@/componentes/ui/button'
import { claseCampo } from '@/componentes/ui/input'
import { fechaCorta } from '@/lib/fechas'
import {
  TIPOS_PAPEL_UNIDAD,
  archivarDocumento,
  cargarDocumentosDeUnidad,
  etiquetaTipoDocumento,
  subirDocumento,
  urlFirmadaDocumento,
  type Documento,
  type TipoPapelUnidad,
} from '@/lib/documentos'
import type { Unidad } from '@/lib/inventario'

/**
 * PAPELES Y TRÁMITES DE UNA UNIDAD — el inventario maestro.
 *
 * Aquí se adjunta lo que respalda a la unidad: la minuta, la escritura, el
 * trámite en notaría o en Registros Públicos, la carta poder, el plano de la
 * unidad, el DNI del titular. Cuelgan de la UNIDAD (no de una persona ni de una
 * oportunidad): una unidad puede tener papeles aunque todavía no se sepa quién
 * es su titular.
 *
 * Solo lo ven y lo suben Dirección y Administración. No es un detalle de la
 * pantalla: lo impone la política `doc_leer` / `doc_crear` de `documentos`
 * (sql/17) y la del bucket privado `documentos`. Comercial ni siquiera recibe
 * la lista.
 *
 * Misma mecánica que los documentos de una persona (SeccionDocumentos): primero
 * la fila, después el archivo; nada se borra, se ARCHIVA con motivo (R8).
 */
export function PapelesUnidad({
  unidad,
  alCambiar,
}: {
  unidad: Unidad
  /** Algo cambió (se subió o se archivó un papel): el contenedor refresca el inventario al cerrar. */
  alCambiar: () => void
}) {
  const cliente = useQueryClient()
  const idTipo = useId()
  const idNota = useId()
  const idMotivo = useId()
  const inputArchivo = useRef<HTMLInputElement | null>(null)
  const inputCamara = useRef<HTMLInputElement | null>(null)

  const [tipo, setTipo] = useState<TipoPapelUnidad | ''>('')
  const [nota, setNota] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [archivando, setArchivando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [abriendo, setAbriendo] = useState<string | null>(null)

  const clave = ['inventario', 'papeles', unidad.id] as const
  const papeles = useQuery({ queryKey: clave, queryFn: () => cargarDocumentosDeUnidad(unidad.id) })
  const docs = papeles.data ?? []

  function esTipoPapel(v: string): v is TipoPapelUnidad {
    return TIPOS_PAPEL_UNIDAD.some((t) => t.valor === v)
  }

  async function abrir(d: Documento) {
    setAbriendo(d.id)
    setError(null)
    const url = await urlFirmadaDocumento(d.ruta)
    setAbriendo(null)
    if (url === null) {
      return setError('No se pudo abrir el archivo. Puede que ya no exista o que no tengas acceso.')
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function alElegirArchivo(archivo: File | undefined) {
    if (archivo === undefined) return
    if (tipo === '') return setError('Elige primero qué papel es.')
    setSubiendo(true)
    setError(null)
    setHecho(null)
    const r = await subirDocumento({
      archivo,
      personaId: null,
      unidadId: unidad.id,
      oportunidadId: null,
      tipo,
      sentido: 'recibido',
      nota,
    })
    setSubiendo(false)
    if (inputArchivo.current !== null) inputArchivo.current.value = ''
    if (inputCamara.current !== null) inputCamara.current.value = ''
    if (!r.ok) return setError(r.motivo)
    setHecho(`Subido: ${etiquetaTipoDocumento(r.datos.tipo)} · ${r.datos.nombreArchivo}`)
    setNota('')
    setTipo('')
    void cliente.invalidateQueries({ queryKey: clave })
    alCambiar()
  }

  async function archivar(d: Documento) {
    const r = await archivarDocumento(d.id, motivo)
    if (!r.ok) return setError(r.motivo)
    setArchivando(null)
    setMotivo('')
    setError(null)
    setHecho(`Archivado: ${etiquetaTipoDocumento(d.tipo)} · ${d.nombreArchivo}`)
    void cliente.invalidateQueries({ queryKey: clave })
    alCambiar()
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-snug text-suelo-700">
        Papeles de la unidad <strong>{unidad.codigoUnidad}</strong>: minuta, escritura, trámites,
        carta poder, plano, DNI del titular. Solo Dirección y Administración los ven. Datos
        personales de un tercero (Ley 29733): sube solo lo necesario.
      </p>

      {papeles.isPending && <p className="text-sm text-suelo-700">Cargando los papeles…</p>}
      {papeles.isError && (
        <p role="alert" className="text-sm font-bold text-alerta">
          No se pudieron leer los papeles. {papeles.error.message}
        </p>
      )}
      {papeles.isSuccess && docs.length === 0 && (
        <p className="text-sm text-suelo-700">Todavía no hay papeles de esta unidad.</p>
      )}

      {docs.length > 0 && (
        <ul className="divide-y divide-input">
          {docs.map((d) => (
            <li key={d.id} className="space-y-2 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <p className="font-bold text-suelo">{etiquetaTipoDocumento(d.tipo)}</p>
                  <p className="truncate text-suelo-700" title={d.nombreArchivo}>
                    {d.nombreArchivo}
                  </p>
                  <p className="text-suelo-700">
                    {fechaCorta(d.creadoEl)}
                    {d.nota !== null && ` · ${d.nota}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-9"
                    disabled={abriendo !== null}
                    onClick={() => void abrir(d)}
                  >
                    {abriendo === d.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    )}
                    Ver
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 sm:h-9 sm:w-9"
                    aria-label={`Archivar ${etiquetaTipoDocumento(d.tipo)}`}
                    onClick={() => {
                      setArchivando(archivando === d.id ? null : d.id)
                      setMotivo('')
                    }}
                  >
                    <Archive className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {archivando === d.id && (
                <div className="space-y-2">
                  <label htmlFor={idMotivo} className="text-sm font-bold text-suelo">
                    ¿Por qué se archiva? (queda registrado, no se borra)
                  </label>
                  <input
                    id={idMotivo}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ej.: foto borrosa, se subió la versión firmada"
                    className={claseCampo}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      className="h-11 sm:h-10"
                      onClick={() => void archivar(d)}
                    >
                      Archivar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 sm:h-10"
                      onClick={() => setArchivando(null)}
                    >
                      Volver
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 border-t border-input pt-3">
        <p className="text-sm font-bold text-suelo">Adjuntar un papel</p>
        <div>
          <label htmlFor={idTipo} className="text-sm font-bold text-suelo">
            ¿Qué es?
          </label>
          <select
            id={idTipo}
            value={tipo}
            onChange={(e) => setTipo(esTipoPapel(e.target.value) ? e.target.value : '')}
            className={claseCampo}
          >
            <option value="">Elige…</option>
            {TIPOS_PAPEL_UNIDAD.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={idNota} className="text-sm font-bold text-suelo">
            Nota (opcional)
          </label>
          <input
            id={idNota}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={500}
            placeholder="Ej.: falta la firma del cónyuge"
            className={claseCampo}
          />
        </div>
        {/* Dos entradas: la cámara directa y el archivo (un PDF no sale de la cámara). */}
        <input
          ref={inputCamara}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void alElegirArchivo(e.target.files?.[0])}
        />
        <input
          ref={inputArchivo}
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void alElegirArchivo(e.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-10"
            disabled={subiendo || tipo === ''}
            onClick={() => inputCamara.current?.click()}
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            Tomar foto
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-10"
            disabled={subiendo || tipo === ''}
            onClick={() => inputArchivo.current?.click()}
          >
            {subiendo ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4" aria-hidden="true" />
            )}
            Elegir archivo
          </Button>
        </div>
        {tipo === '' && (
          <p className="text-sm text-suelo-700">Elige qué papel es para poder subirlo.</p>
        )}
        <p className="text-xs text-suelo-500">Imágenes (JPG, PNG, WEBP, HEIC) o PDF, hasta 10 MB.</p>
      </div>

      {error !== null && (
        <p role="alert" className="rounded-md bg-alerta-suave p-3 text-sm font-bold text-alerta">
          {error}
        </p>
      )}
      {hecho !== null && (
        <p role="status" className="text-sm font-bold text-suelo">
          {hecho}
        </p>
      )}
    </div>
  )
}
