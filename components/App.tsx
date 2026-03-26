'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, apiUrl } from '../lib/api'
import { MAX_PLANT_PHOTOS } from '../lib/constants'
import type { CareTask, Diagnosis, DashboardData, Plant, PlantPhoto, ProgressSnapshot, User } from '../lib/types'

type Tab = 'home' | 'tasks' | 'progress' | 'settings'
type Language = 'es' | 'en' | 'pt'

const LANGUAGE_LABELS: Record<Language, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
}

/**
 * Windows y algunos navegadores reportan `application/octet-stream` o tipo vacío
 * aunque el archivo sea JPG/PNG; priorizamos extensión cuando el MIME no es image/*.
 */
const IMAGE_NAME_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|tif|tiff)$/i
function isLikelyImageFile(f: File): boolean {
  if (f.type.startsWith('image/')) return true
  if (IMAGE_NAME_EXT.test(f.name)) return true
  return false
}

/** JPEG / PNG / GIF / WebP / BMP / TIFF / ISO BMFF (AVIF, HEIC…) por firma; útil sin extensión o con MIME incorrecto. */
function sniffImageMagicBytesFromBuffer(buf: Uint8Array): boolean {
  if (buf.length < 12) return false
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true
  // BMP
  if (buf[0] === 0x42 && buf[1] === 0x4d) return true
  // RIFF WebP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true
  }
  // TIFF little-endian
  if (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) return true
  // TIFF big-endian
  if (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a) return true
  // ISO Base Media (AVIF, HEIC, MP4 image brands…) — ftyp @ offset 4
  if (buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return true
  return false
}

async function sniffImageMagicBytes(file: File): Promise<boolean> {
  try {
    const slice = file.slice(0, 16)
    const buf = new Uint8Array(await slice.arrayBuffer())
    return sniffImageMagicBytesFromBuffer(buf)
  } catch {
    return false
  }
}

async function canAcceptAsImageFile(f: File): Promise<boolean> {
  if (isLikelyImageFile(f)) return true
  return sniffImageMagicBytes(f)
}

// Resize to max 1024px on longest side, JPEG 80% — enough for Gemini plant ID
function resizeImage(file: File, maxPx = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'))
    reader.onload = (e) => {
      const img = new Image()
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'))
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = String(e.target?.result)
    }
    reader.readAsDataURL(file)
  })
}

function formatResizeOrImageError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('No se pudo cargar') || msg.includes('No se pudo leer')) {
    return 'No se pudo procesar la imagen en el navegador (formato poco compatible). Exportá la foto como JPG o PNG e intentá de nuevo. HEIC/AVIF a veces no se pueden redimensionar en este navegador.'
  }
  return msg
}

/* ─── Garden background ───────────────────────────────────────────────────── */

const GARDEN_POSITIONS: [number, number][] = [
  [15, 20], [85, 15], [50, 45],
  [10, 78], [90, 80], [45, 88],
]

type RGB = [number, number, number]

function parseRgb(colorRgb: string | null): RGB | null {
  if (!colorRgb) return null
  const parts = colorRgb.split(',').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return null
  return parts as RGB
}

function extractDominantColor(imageUrl: string): Promise<RGB> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const size = 40
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, size, size)
      const data = ctx.getImageData(0, 0, size, size).data
      let r = 0, g = 0, b = 0, count = 0
      for (let i = 0; i < data.length; i += 4) {
        const br = (data[i] + data[i + 1] + data[i + 2]) / 3
        if (br > 25 && br < 230) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++
        }
      }
      resolve(count > 0
        ? [Math.round(r / count), Math.round(g / count), Math.round(b / count)]
        : [62, 207, 110])
    }
    img.onerror = () => resolve([62, 207, 110])
    img.src = imageUrl
  })
}

function buildGardenBackground(colors: RGB[]): string {
  if (colors.length === 0) {
    return [
      'radial-gradient(ellipse 60% 55% at 25% 35%, rgba(62,207,110,0.10) 0%, transparent 70%)',
      'radial-gradient(ellipse 45% 45% at 78% 68%, rgba(46,184,91,0.07) 0%, transparent 65%)',
      'radial-gradient(ellipse 35% 40% at 55% 85%, rgba(30,79,53,0.12) 0%, transparent 60%)',
    ].join(', ')
  }
  return colors.slice(0, 6).map(([r, g, b], i) => {
    const [x, y] = GARDEN_POSITIONS[i % GARDEN_POSITIONS.length]
    return `radial-gradient(ellipse 55% 50% at ${x}% ${y}%, rgba(${r},${g},${b},0.16) 0%, transparent 65%)`
  }).join(', ')
}

/* ─── Primitives ─────────────────────────────────────────────────────────── */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted">
      {children}
    </span>
  )
}

function Input({
  value, onChange, placeholder, type = 'text',
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <input
      type={type}
      className="w-full rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-sm text-text placeholder:text-dim focus:border-primary focus:bg-surface-raised focus:outline-none"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  )
}

function Textarea({
  value, onChange, placeholder, rows = 3,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number
}) {
  return (
    <textarea
      rows={rows}
      className="w-full resize-none rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-sm text-text placeholder:text-dim focus:border-primary focus:bg-surface-raised focus:outline-none"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  )
}

function Select({
  value, onChange, options,
}: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <select
      className="w-full rounded-xl border border-border bg-surface-alt px-3.5 py-2.5 text-sm text-text focus:border-primary focus:outline-none"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function Btn({
  children, onClick, type = 'button', variant = 'primary', size = 'md', disabled = false, className = '',
}: {
  children: React.ReactNode; onClick?: () => void; type?: 'button' | 'submit'
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md'
  disabled?: boolean; className?: string
}) {
  const base = 'inline-flex items-center justify-center font-semibold rounded-xl tracking-wide transition active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none cursor-pointer'
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm' }
  const variants = {
    primary: 'bg-primary text-primary-text hover:bg-primary-dk',
    secondary: 'bg-secondary text-secondary-text border border-border-bright hover:bg-surface-raised',
    danger: 'bg-danger text-white hover:bg-danger-dk',
    ghost: 'text-muted hover:text-strong hover:bg-surface-alt',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

function Card({ children, accent = false, className = '' }: { children: React.ReactNode; accent?: boolean; className?: string }) {
  return (
    <div className={`relative rounded-2xl border bg-surface ${accent ? 'border-border-bright' : 'border-border'} overflow-hidden shadow-[0_6px_24px_rgba(0,0,0,0.4)] ${className}`}>
      {accent && <div className="absolute left-0 top-0 h-full w-[3px] rounded-l-2xl bg-primary opacity-80" />}
      <div className={accent ? 'pl-5 pr-5 py-5' : 'p-5'}>{children}</div>
    </div>
  )
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <h2 className="text-[17px] font-bold tracking-wide text-strong">{children}</h2>
      <div className="h-[2px] w-7 rounded-full bg-primary opacity-70" />
    </div>
  )
}

function Badge({ children, color = 'muted' }: { children: React.ReactNode; color?: 'primary' | 'warning' | 'danger' | 'muted' }) {
  const colors = {
    primary: 'border-primary text-primary', warning: 'border-warning text-warning',
    danger: 'border-danger text-danger', muted: 'border-border text-muted',
  }
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${colors[color]}`}>
      {children}
    </span>
  )
}

/** Carga la foto vía proxy con JWT (R2 no expone GET público al endpoint S3). */
function PlantProxiedPhoto({
  imageProxyPath,
  authToken,
}: {
  imageProxyPath: string
  authToken: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let blobUrl: string | null = null
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(apiUrl(imageProxyPath), {
          headers: { Authorization: `Bearer ${authToken}` },
        })
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        blobUrl = URL.createObjectURL(blob)
        if (!cancelled) setSrc(blobUrl)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [imageProxyPath, authToken])

  if (failed) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-border bg-surface-alt px-2 text-center text-xs text-danger">
        No se pudo cargar la foto
      </div>
    )
  }
  if (!src) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-border bg-surface-alt text-xs text-dim">
        <span className="animate-pulse">Cargando…</span>
      </div>
    )
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden rounded-xl border border-border bg-surface-alt focus:outline-none focus:ring-2 focus:ring-primary/50">
      <img
        src={src}
        alt=""
        className="h-32 w-full object-cover transition group-hover:opacity-90"
        decoding="async"
      />
    </a>
  )
}

function PlantPhotoThumb({
  src,
  onRemove,
  showIaBadge,
}: {
  src: string
  onRemove: () => void
  showIaBadge: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <div className="relative h-28 overflow-hidden rounded-xl border border-border bg-surface-alt">
      {failed ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-[11px] leading-tight text-danger">
          <span aria-hidden>⚠️</span>
          <span>No se pudo mostrar la vista previa.</span>
        </div>
      ) : (
        <>
          <img
            src={src}
            alt=""
            className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-alt text-xs text-dim">
              <span className="animate-pulse">Cargando…</span>
            </div>
          )}
        </>
      )}
      <button
        type="button"
        className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-lg bg-bg/80 text-sm text-danger hover:bg-danger/20"
        onClick={onRemove}
        aria-label="Quitar foto">
        ✕
      </button>
      {showIaBadge && (
        <span className="absolute bottom-1 left-1 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-bold text-primary-text">
          IA
        </span>
      )}
    </div>
  )
}

function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <span className="text-3xl">{emoji}</span>
      <p className="text-sm text-muted">{text}</p>
    </div>
  )
}

/* ─── Plant Detail Page ──────────────────────────────────────────────────── */

const CATEGORY_ICON: Record<string, string> = {
  watering: '💧',
  inspection: '🔍',
  fertilizing: '🌿',
  recovery: '🚑',
  other: '📋',
}

const SEVERITY_COLOR = {
  low: 'primary' as const,
  medium: 'warning' as const,
  high: 'danger' as const,
}

const SEVERITY_LABEL = { low: 'Leve', medium: 'Moderado', high: 'Grave' }

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })
}

function PlantDetailPage({
  data, authToken, onBack, onDeletePlant, onTaskDone, onTaskSkip, busy,
}: {
  data: { plant: Plant; tasks: CareTask[]; diagnoses: Diagnosis[]; photos: PlantPhoto[] }
  authToken: string
  onBack: () => void
  onDeletePlant: () => void
  onTaskDone: (taskId: string) => Promise<void>
  onTaskSkip: (taskId: string) => Promise<void>
  busy: boolean
}) {
  const { plant, tasks, diagnoses, photos } = data
  const rgb = parseRgb(plant.colorRgb)
  const accentColor = rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : '#3ECF6E'
  const accentSoft = rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.15)` : 'rgba(62,207,110,0.15)'

  const pending = tasks.filter((t) => t.status === 'pending').sort(
    (a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()
  )
  const done = tasks.filter((t) => t.status !== 'pending')
  const lastDiagnosis = diagnoses[0] ?? null

  const lightLabel = { low: 'Luz baja', medium: 'Luz media', high: 'Luz alta' }[plant.lightLevel]

  return (
    <div className="flex flex-col gap-6">
      {/* Back + delete */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted hover:text-strong transition cursor-pointer w-fit">
          <span className="text-base">←</span> Volver al jardín
        </button>
        <Btn type="button" variant="danger" size="sm" disabled={busy} onClick={onDeletePlant}>
          Eliminar planta
        </Btn>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border"
        style={{ background: `linear-gradient(135deg, ${accentSoft} 0%, rgba(0,0,0,0) 60%)` }}>
        <div className="absolute top-0 right-0 h-40 w-40 rounded-full opacity-10 blur-3xl"
          style={{ background: accentColor, transform: 'translate(30%, -30%)' }} />
        <div className="relative p-6 flex items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-4xl border border-border"
            style={{ backgroundColor: accentSoft }}>
            🪴
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold text-hero leading-tight">{plant.name}</h2>
            <p className="mt-0.5 text-sm italic text-muted">{plant.speciesGuess}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface/60 px-2.5 py-1 text-xs text-muted">
                📍 {plant.location}
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface/60 px-2.5 py-1 text-xs text-muted">
                ☀️ {lightLabel}
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface/60 px-2.5 py-1 text-xs text-muted">
                📅 {new Date(plant.createdAt).toLocaleDateString('es-AR')}
              </span>
            </div>
          </div>
          {lastDiagnosis && (
            <div className="shrink-0">
              <Badge color={SEVERITY_COLOR[lastDiagnosis.severity]}>
                {SEVERITY_LABEL[lastDiagnosis.severity]}
              </Badge>
            </div>
          )}
        </div>
      </div>

      {photos.length > 0 && (
        <Card>
          <CardTitle>Fotos</CardTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((p) => (
              <div key={p.id} className="flex flex-col gap-1">
                <PlantProxiedPhoto imageProxyPath={p.imageProxyPath} authToken={authToken} />
                <p className="text-center text-[11px] leading-snug text-dim">
                  <span className="text-muted">Fotografía: </span>
                  {formatDateTime(p.capturedAt)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* LEFT: steps + done tasks */}
        <div className="flex flex-col gap-4">
          {/* Pending steps */}
          <Card>
            <CardTitle>Pasos a seguir</CardTitle>
            {pending.length ? (
              <div className="flex flex-col gap-3">
                {pending.map((task, i) => (
                  <div key={task.id} className="flex gap-4">
                    {/* Step number */}
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold"
                        style={{ background: accentSoft, color: accentColor, border: `1.5px solid ${accentColor}` }}>
                        {i + 1}
                      </div>
                      {i < pending.length - 1 && (
                        <div className="w-px flex-1 bg-border" style={{ minHeight: 16 }} />
                      )}
                    </div>
                    {/* Task card */}
                    <div className="flex-1 pb-3">
                      <div className="rounded-xl border border-border bg-surface-alt p-4 hover:border-border-bright transition">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="text-base">{CATEGORY_ICON[task.category]}</span>
                              <p className="font-semibold text-strong">{task.title}</p>
                              {task.priority >= 4 && <Badge color="danger">Urgente</Badge>}
                              {task.priority === 3 && <Badge color="warning">Media</Badge>}
                            </div>
                            <p className="text-sm leading-relaxed text-muted">{task.details}</p>
                            <p className="mt-2 text-xs text-dim">
                              Programada: {new Date(task.scheduledFor).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Btn size="sm" disabled={busy} onClick={() => onTaskDone(task.id)}>✓ Hecha</Btn>
                          <Btn size="sm" variant="secondary" disabled={busy} onClick={() => onTaskSkip(task.id)}>Omitir</Btn>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState emoji="✅" text="No hay tareas pendientes. ¡Todo al día!" />
            )}
          </Card>

          {/* Done / skipped */}
          {done.length > 0 && (
            <Card>
              <CardTitle>Historial</CardTitle>
              <div className="flex flex-col gap-2">
                {done.map((task) => (
                  <div key={task.id} className="flex items-start gap-3 rounded-xl border border-border bg-surface-alt/50 p-3 opacity-60">
                    <span className={`mt-0.5 text-sm font-bold ${task.status === 'done' ? 'text-primary' : 'text-dim'}`}>
                      {task.status === 'done' ? '✓' : '–'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{CATEGORY_ICON[task.category]}</span>
                        <p className="text-sm font-medium text-strong">{task.title}</p>
                        <Badge color="muted">{task.status === 'done' ? 'hecha' : 'omitida'}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-dim">
                        {new Date(task.scheduledFor).toLocaleDateString('es-AR', { dateStyle: 'medium' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* RIGHT: diagnosis */}
        <div className="flex flex-col gap-4">
          {lastDiagnosis ? (
            <Card>
              <CardTitle>Último diagnóstico</CardTitle>
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge color={SEVERITY_COLOR[lastDiagnosis.severity]}>
                    {SEVERITY_LABEL[lastDiagnosis.severity]}
                  </Badge>
                  <span className="text-xs text-dim">
                    {Math.round(lastDiagnosis.confidence * 100)}% confianza
                  </span>
                </div>
                <p className="text-xs text-muted">
                  <span className="font-semibold text-strong">Fecha del informe: </span>
                  {formatDateTime(lastDiagnosis.createdAt)}
                </p>

                <p className="text-sm leading-relaxed text-text">{lastDiagnosis.summary}</p>

                {lastDiagnosis.detectedIssues.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-muted">Problemas detectados</p>
                    <ul className="flex flex-col gap-1.5">
                      {lastDiagnosis.detectedIssues.map((issue, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-text">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                          {issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {lastDiagnosis.recommendations.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-muted">Recomendaciones</p>
                    <ul className="flex flex-col gap-2">
                      {lastDiagnosis.recommendations.map((rec, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted">
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: accentColor }} />
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <CardTitle>Diagnóstico</CardTitle>
              <EmptyState emoji="🔬" text="Sin diagnóstico aún. Subí una foto para analizarla con IA." />
            </Card>
          )}

          {diagnoses.length > 1 && (
            <div className="rounded-xl border border-border bg-surface-alt/60 p-4">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-muted">Informes anteriores</p>
              <ul className="flex flex-col gap-2.5">
                {diagnoses.slice(1).map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2.5 last:border-0 last:pb-0">
                    <span className="text-xs text-dim">{formatDateTime(d.createdAt)}</span>
                    <Badge color={SEVERITY_COLOR[d.severity]}>{SEVERITY_LABEL[d.severity]}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Garden background layer ────────────────────────────────────────────── */

function GardenBg({ background }: { background: string }) {
  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ background, transition: 'background 4s ease', zIndex: 0 }}
    />
  )
}

/* ─── Login ──────────────────────────────────────────────────────────────── */

function LoginScreen({
  onLogin,
  onRegister,
  gardenBackground,
  passwordResetToken,
  onClearPasswordResetToken,
}: {
  onLogin: (email: string, password: string) => Promise<void>
  onRegister: (email: string, name: string, password: string) => Promise<void>
  gardenBackground: string
  passwordResetToken: string | null
  onClearPasswordResetToken: () => void
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    if (passwordResetToken) {
      setMode('reset')
      setError(null)
      setInfo(null)
    }
  }, [passwordResetToken])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      setBusy(true)
      setError(null)
      setInfo(null)
      if (mode === 'login') {
        await onLogin(email, password)
      } else {
        await onRegister(email, name, password)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleForgotSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      setError('Ingresá tu email.')
      return
    }
    try {
      setBusy(true)
      setError(null)
      setInfo(null)
      await api.forgotPassword(email.trim())
      setInfo(
        'Si el email está registrado, recibirás instrucciones para restablecer la contraseña.',
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleResetSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!passwordResetToken) return
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }
    try {
      setBusy(true)
      setError(null)
      setInfo(null)
      await api.resetPassword(passwordResetToken, password)
      onClearPasswordResetToken()
      setPassword('')
      setConfirmPassword('')
      setMode('login')
      setInfo('Contraseña actualizada. Ingresá con tu email y la nueva contraseña.')
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const showAuthToggle = mode !== 'forgot' && mode !== 'reset'

  return (
    <div className="relative min-h-screen bg-bg">
      <GardenBg background={gardenBackground} />
      <main className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex flex-col gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border-bright bg-accent-soft text-4xl shadow-[0_0_32px_rgba(62,207,110,0.15)]">
              🍃
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Midori</p>
              <h1 className="font-display text-5xl font-bold leading-[1.1] tracking-tight text-hero">
                Tu jardín<br />con IA
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Subí una foto y la IA diagnostica el estado de tu planta al instante.
              </p>
            </div>
          </div>
          <Card>
            {showAuthToggle && (
              <div className="mb-4 flex rounded-xl border border-border bg-surface-alt p-1">
                <button type="button" onClick={() => { setMode('login'); setError(null); setInfo(null) }}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition cursor-pointer ${mode === 'login' ? 'bg-surface text-strong shadow-sm' : 'text-muted hover:text-strong'}`}>
                  Ingresar
                </button>
                <button type="button" onClick={() => { setMode('register'); setError(null); setInfo(null) }}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition cursor-pointer ${mode === 'register' ? 'bg-surface text-strong shadow-sm' : 'text-muted hover:text-strong'}`}>
                  Registrarse
                </button>
              </div>
            )}

            {mode === 'reset' && passwordResetToken ? (
              <form className="flex flex-col gap-4" onSubmit={handleResetSubmit}>
                <p className="text-sm text-muted">Elegí una nueva contraseña para tu cuenta.</p>
                <Field label="Nueva contraseña">
                  <Input value={password} onChange={setPassword} placeholder="••••••••" type="password" />
                </Field>
                <Field label="Repetir contraseña">
                  <Input value={confirmPassword} onChange={setConfirmPassword} placeholder="••••••••" type="password" />
                </Field>
                <Btn type="submit" disabled={busy} className="mt-1 w-full py-3 text-base font-bold">
                  {busy ? '...' : 'Guardar contraseña'}
                </Btn>
                <button type="button"
                  className="text-xs text-dim hover:text-muted transition cursor-pointer text-center"
                  onClick={() => { onClearPasswordResetToken(); setMode('login'); setError(null); setInfo(null); setPassword(''); setConfirmPassword('') }}>
                  Volver a ingresar
                </button>
                {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
                {info && <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{info}</p>}
              </form>
            ) : mode === 'forgot' ? (
              <form className="flex flex-col gap-4" onSubmit={handleForgotSubmit}>
                <p className="text-sm text-muted">Te enviamos un enlace a tu correo para restablecer la contraseña.</p>
                <Field label="Email">
                  <Input value={email} onChange={setEmail} placeholder="tu@email.com" type="email" />
                </Field>
                <Btn type="submit" disabled={busy} className="mt-1 w-full py-3 text-base font-bold">
                  {busy ? '...' : 'Enviar instrucciones'}
                </Btn>
                <button type="button"
                  className="text-xs text-dim hover:text-muted transition cursor-pointer text-center"
                  onClick={() => { setMode('login'); setError(null); setInfo(null) }}>
                  Volver a ingresar
                </button>
                {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
                {info && <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{info}</p>}
              </form>
            ) : (
              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                <Field label="Email">
                  <Input value={email} onChange={setEmail} placeholder="tu@email.com" type="email" />
                </Field>
                {mode === 'register' && (
                  <Field label="Nombre">
                    <Input value={name} onChange={setName} placeholder="Tu nombre" />
                  </Field>
                )}
                <Field label="Contraseña">
                  <Input value={password} onChange={setPassword} placeholder="••••••••" type="password" />
                </Field>
                {mode === 'login' && (
                  <button type="button"
                    className="-mt-1 text-left text-xs text-primary hover:underline cursor-pointer"
                    onClick={() => { setMode('forgot'); setError(null); setInfo(null) }}>
                    ¿Olvidaste tu contraseña?
                  </button>
                )}
                <Btn type="submit" disabled={busy} className="mt-1 w-full py-3 text-base font-bold">
                  {busy ? '...' : mode === 'login' ? 'Ingresar' : 'Crear cuenta'}
                </Btn>
                {process.env.NODE_ENV === 'development' && (
                  <button type="button"
                    onClick={async () => {
                      setBusy(true)
                      setError(null)
                      try {
                        await onLogin('demo@midori.app', 'demo1234')
                      } catch {
                        try {
                          await onRegister('demo@midori.app', 'Demo User', 'demo1234')
                        } catch (err) {
                          setError(String(err))
                        }
                      } finally {
                        setBusy(false)
                      }
                    }}
                    className="text-xs text-dim hover:text-muted transition cursor-pointer text-center w-full">
                    Usar credenciales de test
                  </button>
                )}
                {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
              </form>
            )}
          </Card>
        </div>
      </main>
    </div>
  )
}

/* ─── Main App ───────────────────────────────────────────────────────────── */

export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  /** Sin leer localStorage en el inicializador: en SSR no existe `window` / `localStorage`. */
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [tasksToday, setTasksToday] = useState<CareTask[]>([])
  const [progress, setProgress] = useState<ProgressSnapshot[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [language, setLanguage] = useState<Language>('es')

  const [plantName, setPlantName] = useState('')
  const [speciesGuess, setSpeciesGuess] = useState('')
  const [location, setLocation] = useState('')
  const [lightLevel, setLightLevel] = useState<'low' | 'medium' | 'high'>('medium')
  /** Hasta MAX_PLANT_PHOTOS imágenes; la primera dispara diagnóstico IA. */
  const [photoEntries, setPhotoEntries] = useState<Array<{ file: File; preview: string }>>([])
  const photoEntriesRef = useRef(photoEntries)
  photoEntriesRef.current = photoEntries
  const [photoPickerLoading, setPhotoPickerLoading] = useState(false)
  const [photoPickerError, setPhotoPickerError] = useState<string | null>(null)
  const [context, setContext] = useState('')
  const [note, setNote] = useState('')
  const [diagnosisResult, setDiagnosisResult] = useState('')
  const [selectedPlant, setSelectedPlant] = useState<{
    plant: Plant
    tasks: CareTask[]
    diagnoses: Diagnosis[]
    photos: PlantPhoto[]
  } | null>(null)
  const [loadingPlant, setLoadingPlant] = useState(false)
  const [passwordResetToken, setPasswordResetToken] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token')
    if (t) setPasswordResetToken(t)
  }, [])

  const clearPasswordResetToken = () => {
    setPasswordResetToken(null)
    if (typeof window !== 'undefined') {
      const path = window.location.pathname
      window.history.replaceState({}, '', path)
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('midori_token')
    if (token) setAuthToken(token)
    try {
      const raw = localStorage.getItem('midori_user')
      if (raw) setUser(JSON.parse(raw) as User)
    } catch {
      setUser(null)
    }
    const lang = localStorage.getItem('midori_lang')
    if (lang === 'es' || lang === 'en' || lang === 'pt') setLanguage(lang)
  }, [])

  // Garden background derived from plants' colorRgb — no extra requests
  const gardenBackground = useMemo(() => {
    const colors = (dashboard?.plants ?? [])
      .map((p) => parseRgb(p.colorRgb))
      .filter(Boolean) as RGB[]
    return buildGardenBackground(colors)
  }, [dashboard?.plants])

  const refreshData = async (token = authToken) => {
    if (!token) return
    const [dashboardData, todayTasks, progressData] = await Promise.all([
      api.getDashboard(token),
      api.getTasksToday(token),
      api.getProgress(token),
    ])
    setDashboard(dashboardData)
    setTasksToday(todayTasks)
    setProgress(progressData)
  }

  useEffect(() => {
    if (!authToken) return
    refreshData().catch((err) => setError(String(err)))
  }, [authToken])

  const handleLogin = async (email: string, password: string) => {
    const result = await api.login(email, password)
    localStorage.setItem('midori_token', result.token)
    localStorage.setItem('midori_user', JSON.stringify(result.user))
    setAuthToken(result.token)
    setUser(result.user)
  }

  const handleRegister = async (email: string, name: string, password: string) => {
    const result = await api.register(email, name, password)
    localStorage.setItem('midori_token', result.token)
    localStorage.setItem('midori_user', JSON.stringify(result.user))
    setAuthToken(result.token)
    setUser(result.user)
  }

  const appendPhotoFiles = (files: FileList | null) => {
    if (!files?.length) return
    /** Copiar ya: tras `onChange`, `e.target.value = ''` vacía el FileList antes del microtask. */
    const list = Array.from(files)
    setPhotoPickerLoading(true)
    setPhotoPickerError(null)

    queueMicrotask(() => {
      void (async () => {
        try {
        const prev = photoEntriesRef.current
        const space = Math.max(0, MAX_PLANT_PHOTOS - prev.length)
        const rejected: string[] = []
        const additions: Array<{ file: File; preview: string }> = []

        if (space === 0) {
          setPhotoPickerError(`Ya tenés el máximo de ${MAX_PLANT_PHOTOS} fotos. Quitá alguna para agregar más.`)
          setPhotoPickerLoading(false)
          return
        }

        for (const f of list) {
          if (additions.length >= space) break
          const ok = await canAcceptAsImageFile(f)
          if (!ok) {
            rejected.push(f.name || 'archivo sin nombre')
            continue
          }
          try {
            additions.push({ file: f, preview: URL.createObjectURL(f) })
          } catch {
            rejected.push(f.name || 'archivo sin nombre')
          }
        }

        if (additions.length > 0) {
          setPhotoEntries([...prev, ...additions])
        }

        if (rejected.length > 0) {
          setPhotoPickerError(
            `No se reconocieron como imagen (${rejected.length}): ${rejected.join(', ')}. Usá JPG, PNG o WebP.`,
          )
        } else if (additions.length === 0 && list.length > 0) {
          setPhotoPickerError('No se pudo preparar ninguna imagen. Probá con otros archivos o otro navegador.')
        }

        setPhotoPickerLoading(false)
        } catch {
          setPhotoPickerError('Error inesperado al procesar las fotos. Probá de nuevo.')
          setPhotoPickerLoading(false)
        }
      })()
    })
  }

  const removePhotoAt = (index: number) => {
    setPhotoEntries((prev) => {
      const next = [...prev]
      const [removed] = next.splice(index, 1)
      if (removed) URL.revokeObjectURL(removed.preview)
      return next
    })
  }

  const clearPhotoEntries = () => {
    setPhotoPickerError(null)
    setPhotoEntries((prev) => {
      prev.forEach((e) => URL.revokeObjectURL(e.preview))
      return []
    })
  }

  const handleCreatePlant = async (e: FormEvent) => {
    e.preventDefault()
    if (!authToken) return
    if (!plantName.trim()) { setError('El nombre de la planta es obligatorio.'); return }
    let created: Plant | null = null
    try {
      setBusy(true)
      setError(null)
      setDiagnosisResult('')

      created = await api.createPlant(authToken, {
        name: plantName.trim(),
        speciesGuess: speciesGuess.trim() || 'Especie no identificada',
        location: location.trim() || 'Sin ubicación',
        lightLevel,
      })

      if (photoEntries.length > 0) {
        try {
          const firstPreview = photoEntries[0].preview
          extractDominantColor(firstPreview).then((rgb) =>
            api.updatePlantColor(authToken!, created!.id, rgb.join(',')).catch(() => {})
          )

          const imageUrl = await resizeImage(photoEntries[0].file)
          const diagnosis = await api.diagnosePlant(authToken, created.id, {
            imageUrl,
            context: context.trim() || 'Foto inicial de alta de planta para diagnóstico visual.',
            note: note.trim() || undefined,
            language,
          })
          setDiagnosisResult(
            `${diagnosis.diagnosis.summary}\n\nTareas generadas: ${diagnosis.generatedTasks.length}`,
          )

          const extraCtx = context.trim() || 'Foto adicional de la planta.'
          for (let i = 1; i < photoEntries.length; i++) {
            const dataUrl = await resizeImage(photoEntries[i].file)
            await api.uploadPlantPhoto(authToken, created.id, {
              imageUrl: dataUrl,
              context: extraCtx,
              note: note.trim() || undefined,
            })
          }
        } catch (photoErr) {
          const detail = formatResizeOrImageError(photoErr)
          setError(
            `La planta "${created.name}" ya está guardada, pero falló el procesamiento de fotos o el diagnóstico: ${detail}`,
          )
          setPlantName('')
          setSpeciesGuess('')
          setLocation('')
          setLightLevel('medium')
          clearPhotoEntries()
          setContext('')
          setNote('')
          await refreshData(authToken)
          setTab('home')
          return
        }
      }

      setPlantName('')
      setSpeciesGuess('')
      setLocation('')
      setLightLevel('medium')
      clearPhotoEntries()
      setContext('')
      setNote('')
      await refreshData(authToken)
      setTab('home')
    } catch (err) {
      if (created) {
        setError(
          `La planta "${created.name}" se guardó, pero hubo un error después: ${String(err)}`,
        )
      } else {
        setError(String(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleSelectPlant = async (plantId: string) => {
    if (!authToken) return
    try {
      setLoadingPlant(true)
      const data = await api.getPlant(authToken, plantId)
      setSelectedPlant(data)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoadingPlant(false)
    }
  }

  const handleTaskStatus = async (taskId: string, status: CareTask['status']) => {
    if (!authToken) return
    try {
      setBusy(true)
      await api.updateTaskStatus(authToken, taskId, status)
      await refreshData(authToken)
      // Refresh plant detail if open
      if (selectedPlant) {
        const data = await api.getPlant(authToken, selectedPlant.plant.id)
        setSelectedPlant(data)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleDeletePlant = async () => {
    if (!authToken || !selectedPlant) return
    try {
      setBusy(true)
      setError(null)
      await api.deletePlant(authToken, selectedPlant.plant.id)
      await refreshData(authToken)
      setSelectedPlant(null)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const confirmDeletePlant = () => {
    if (
      !window.confirm(
        '¿Eliminar esta planta? Se borrarán diagnósticos y tareas asociados. Esta acción no se puede deshacer.',
      )
    ) {
      return
    }
    void handleDeletePlant()
  }

  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])

  const overdueTasks = useMemo(
    () => tasksToday.filter((t) => t.status === 'pending' && new Date(t.scheduledFor) < todayStart),
    [tasksToday, todayStart],
  )

  const todayPendingTasks = useMemo(
    () => tasksToday.filter((t) => new Date(t.scheduledFor) >= todayStart),
    [tasksToday, todayStart],
  )

  const headerStats = useMemo(() => [
    { label: 'Plantas', value: dashboard?.plants.length ?? 0 },
    { label: 'Tareas hoy', value: todayPendingTasks.length },
    { label: overdueTasks.length > 0 ? 'Vencidas' : 'Alertas', value: overdueTasks.length > 0 ? overdueTasks.length : dashboard?.criticalAlerts.length ?? 0, overdue: overdueTasks.length > 0 },
  ], [dashboard?.plants.length, todayPendingTasks.length, overdueTasks.length, dashboard?.criticalAlerts.length])

  if (!authToken) {
    return (
      <LoginScreen
        onLogin={handleLogin}
        onRegister={handleRegister}
        gardenBackground={gardenBackground}
        passwordResetToken={passwordResetToken}
        onClearPasswordResetToken={clearPasswordResetToken}
      />
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'home', label: 'Inicio' },
    { key: 'tasks', label: 'Tareas' },
    { key: 'progress', label: 'Progreso' },
    { key: 'settings', label: 'Ajustes' },
  ]

  return (
    <div className="relative min-h-screen bg-bg">
      <GardenBg background={gardenBackground} />

      <div className="relative" style={{ zIndex: 1 }}>
        {/* Header */}
        <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur-sm">
          <div className="mx-auto w-[80%] max-w-[80%] px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-bright bg-accent-soft text-lg">🍃</div>
                <div>
                  <h1 className="font-display text-xl font-bold leading-none text-hero">Midori</h1>
                  <p className="mt-0.5 text-xs text-muted">Hola, {user?.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden gap-2 sm:flex">
                  {headerStats.map((s) => (
                    <div key={s.label} className={`rounded-lg border px-3 py-1.5 text-center ${s.overdue ? 'border-danger/40 bg-danger/10' : 'border-border bg-surface-alt'}`}>
                      <p className={`text-base font-bold leading-none ${s.overdue ? 'text-danger' : 'text-strong'}`}>{s.value}</p>
                      <p className={`mt-0.5 text-[10px] ${s.overdue ? 'text-danger/70' : 'text-muted'}`}>{s.label}</p>
                    </div>
                  ))}
                </div>
                <Btn variant="ghost" size="sm" onClick={() => { localStorage.removeItem('midori_token'); localStorage.removeItem('midori_user'); setAuthToken(null); setUser(null); setDashboard(null) }}>
                  Salir
                </Btn>
              </div>
            </div>
            <nav className="mt-4 flex gap-1 border-t border-border pt-1">
              {tabs.map((t) => (
                <button key={t.key} onClick={() => { setTab(t.key); setSelectedPlant(null) }}
                  className={`relative px-4 py-2 text-sm font-semibold tracking-wide transition cursor-pointer ${tab === t.key && !selectedPlant ? 'text-primary' : 'text-muted hover:text-strong'}`}>
                  <span className="flex items-center gap-1.5">
                    {t.label}
                    {t.key === 'tasks' && overdueTasks.length > 0 && (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                        {overdueTasks.length}
                      </span>
                    )}
                  </span>
                  {tab === t.key && !selectedPlant && <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-primary" />}
                </button>
              ))}
            </nav>
          </div>
        </header>

        {/* Content */}
        <main className="mx-auto w-[80%] max-w-[80%] px-4 py-6">
          {error && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-3 text-danger/60 hover:text-danger cursor-pointer">✕</button>
            </div>
          )}

          {/* ── PLANT DETAIL PAGE ── */}
          {loadingPlant && (
            <div className="flex items-center justify-center py-24">
              <p className="text-sm text-muted">Cargando planta...</p>
            </div>
          )}
          {selectedPlant && !loadingPlant && (
            <PlantDetailPage
              data={selectedPlant}
              authToken={authToken!}
              onBack={() => setSelectedPlant(null)}
              onDeletePlant={confirmDeletePlant}
              onTaskDone={(id) => handleTaskStatus(id, 'done')}
              onTaskSkip={(id) => handleTaskStatus(id, 'skipped')}
              busy={busy}
            />
          )}

          {/* ── HOME ── */}
          {!selectedPlant && !loadingPlant && tab === 'home' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardTitle>Agregar planta</CardTitle>
                <form className="flex flex-col gap-4" onSubmit={handleCreatePlant}>
                  <Field label="Nombre *">
                    <Input value={plantName} onChange={setPlantName} placeholder="Ej: Mi monstera" />
                  </Field>
                  <Field label="Especie estimada">
                    <Input value={speciesGuess} onChange={setSpeciesGuess} placeholder="Ej: Monstera deliciosa" />
                  </Field>
                  <Field label="Ubicación">
                    <Input value={location} onChange={setLocation} placeholder="Living, balcón, jardín..." />
                  </Field>
                  <Field label="Nivel de luz">
                    <Select value={lightLevel} onChange={(v) => setLightLevel(v as 'low' | 'medium' | 'high')}
                      options={[{ value: 'low', label: 'Baja' }, { value: 'medium', label: 'Media' }, { value: 'high', label: 'Alta' }]} />
                  </Field>
                  <Field label={`Fotos (máx. ${MAX_PLANT_PHOTOS})`}>
                    <p className="text-xs text-muted -mt-1 mb-2">La primera se usa para el diagnóstico IA; el resto se guarda en la galería.</p>
                    <div className="relative grid grid-cols-2 gap-2">
                      <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface-alt px-3 py-2.5 text-sm text-secondary-text transition hover:border-border-bright hover:bg-surface-raised ${photoPickerLoading || photoEntries.length >= MAX_PLANT_PHOTOS ? 'pointer-events-none opacity-50' : ''}`}>
                        <span>📷</span> Sacar foto
                        <input type="file" accept="image/*,.heic,.heif" capture="environment" className="hidden"
                          disabled={photoPickerLoading || photoEntries.length >= MAX_PLANT_PHOTOS}
                          onChange={(e) => { appendPhotoFiles(e.target.files); e.target.value = '' }} />
                      </label>
                      <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface-alt px-3 py-2.5 text-sm text-secondary-text transition hover:border-border-bright hover:bg-surface-raised ${photoPickerLoading || photoEntries.length >= MAX_PLANT_PHOTOS ? 'pointer-events-none opacity-50' : ''}`}>
                        <span>🖼️</span> Galería
                        <input type="file" accept="image/*,.heic,.heif" multiple className="hidden"
                          disabled={photoPickerLoading || photoEntries.length >= MAX_PLANT_PHOTOS}
                          onChange={(e) => { appendPhotoFiles(e.target.files); e.target.value = '' }} />
                      </label>
                      {photoPickerLoading && (
                        <div className="absolute inset-0 z-[1] flex items-center justify-center rounded-xl bg-bg/60 backdrop-blur-[2px]">
                          <span className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-strong shadow-lg">
                            Procesando fotos…
                          </span>
                        </div>
                      )}
                    </div>
                    {photoPickerError && (
                      <div className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-danger/35 bg-danger/10 px-3 py-2 text-xs text-danger">
                        <span className="min-w-0 flex-1 leading-snug">{photoPickerError}</span>
                        <button type="button" onClick={() => setPhotoPickerError(null)} className="shrink-0 text-danger/70 hover:text-danger" aria-label="Cerrar">
                          ✕
                        </button>
                      </div>
                    )}
                    {photoEntries.length > 0 ? (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {photoEntries.map((entry, idx) => (
                          <PlantPhotoThumb
                            key={`${entry.preview}-${idx}`}
                            src={entry.preview}
                            onRemove={() => removePhotoAt(idx)}
                            showIaBadge={idx === 0}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 flex h-24 items-center justify-center rounded-xl border border-dashed border-border bg-surface-alt text-sm text-dim">
                        Opcional — hasta {MAX_PLANT_PHOTOS} fotos
                      </div>
                    )}
                    {photoEntries.length > 0 && (
                      <p className="mt-1 text-xs text-dim">{photoEntries.length}/{MAX_PLANT_PHOTOS} seleccionadas</p>
                    )}
                  </Field>
                  <Field label="Contexto para la IA">
                    <Textarea value={context} onChange={setContext} placeholder="Ej: Hojas amarillas, riego cada 3 días..." />
                  </Field>
                  <Field label="Nota">
                    <Textarea value={note} onChange={setNote} placeholder="Nota opcional" rows={2} />
                  </Field>
                  <Btn type="submit" disabled={busy} className="w-full py-3 font-bold">
                    {busy ? 'Guardando...' : 'Guardar planta'}
                  </Btn>
                </form>
                {diagnosisResult && (
                  <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-primary">Diagnóstico IA</p>
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed text-text">{diagnosisResult}</pre>
                  </div>
                )}
              </Card>

              <Card>
                <CardTitle>Mi jardín</CardTitle>
                {dashboard?.plants.length ? (
                  <div className="flex flex-col gap-2">
                    {dashboard.plants.map((plant) => {
                      const rgb = parseRgb(plant.colorRgb)
                      return (
                        <button key={plant.id} type="button"
                          onClick={() => handleSelectPlant(plant.id)}
                          className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface-alt p-3 hover:border-border-bright hover:bg-surface-raised transition text-left cursor-pointer">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl"
                            style={{ backgroundColor: rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.25)` : undefined }}>
                            🪴
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-strong">{plant.name}</p>
                            <p className="truncate text-xs italic text-muted">{plant.speciesGuess}</p>
                            <p className="text-xs text-dim">{plant.location}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge color="muted">{plant.lightLevel}</Badge>
                            <span className="text-muted text-sm">›</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <EmptyState emoji="🌱" text="Tu jardín está vacío. Agregá tu primera planta." />
                )}
                {dashboard?.criticalAlerts.length ? (
                  <div className="mt-4 rounded-xl border border-warning/30 bg-warning/5 p-4">
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-warning">Alertas críticas</p>
                    <ul className="flex flex-col gap-1.5">
                      {dashboard.criticalAlerts.map((alert) => (
                        <li key={alert} className="flex items-start gap-2 text-sm text-warning">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                          {alert}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Card>
            </div>
          )}

          {/* ── TASKS ── */}
          {!selectedPlant && !loadingPlant && tab === 'tasks' && (
            <div className="flex flex-col gap-4">
              {/* Overdue */}
              {overdueTasks.length > 0 && (
                <div className="rounded-2xl border border-danger/40 bg-danger/5 overflow-hidden shadow-[0_6px_24px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-2 border-b border-danger/20 bg-danger/10 px-5 py-3">
                    <span className="h-2 w-2 rounded-full bg-danger animate-pulse" />
                    <p className="text-sm font-bold text-danger">Tareas pendientes — {overdueTasks.length} sin completar</p>
                  </div>
                  <div className="flex flex-col gap-3 p-5">
                    {overdueTasks.map((task) => (
                      <div key={task.id} className="rounded-xl border border-danger/30 bg-surface-alt p-4">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <p className="font-semibold text-strong">{task.title}</p>
                          <Badge color="danger">Vencida</Badge>
                        </div>
                        <p className="text-sm leading-relaxed text-muted">{task.details}</p>
                        <p className="mt-1.5 text-xs text-danger/70">
                          Programada: {new Date(task.scheduledFor).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}
                        </p>
                        <div className="mt-3 flex gap-2">
                          <Btn size="sm" onClick={() => handleTaskStatus(task.id, 'done')} disabled={busy}>✓ Hecha</Btn>
                          <Btn size="sm" variant="secondary" onClick={() => handleTaskStatus(task.id, 'skipped')} disabled={busy}>Omitir</Btn>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Today */}
              <Card>
                <CardTitle>Agenda de hoy</CardTitle>
                {todayPendingTasks.length ? (
                  <div className="flex flex-col gap-3">
                    {todayPendingTasks.map((task) => {
                      const priorityColor = task.priority >= 4 ? 'danger' : task.priority >= 3 ? 'warning' : 'muted'
                      return (
                        <div key={task.id} className="rounded-xl border border-border bg-surface-alt p-4">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <p className="font-semibold text-strong">{task.title}</p>
                            <Badge color={priorityColor as 'danger' | 'warning' | 'muted'}>
                              {task.priority >= 4 ? 'alta' : task.priority >= 3 ? 'media' : 'baja'}
                            </Badge>
                          </div>
                          <p className="text-sm leading-relaxed text-muted">{task.details}</p>
                          <p className="mt-2 text-xs text-dim">
                            {new Date(task.scheduledFor).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}
                          </p>
                          <div className="mt-3 flex gap-2">
                            <Btn size="sm" onClick={() => handleTaskStatus(task.id, 'done')} disabled={busy}>✓ Hecha</Btn>
                            <Btn size="sm" variant="secondary" onClick={() => handleTaskStatus(task.id, 'skipped')} disabled={busy}>Omitir</Btn>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <EmptyState emoji="✅" text="No hay tareas para hoy." />
                )}
              </Card>
            </div>
          )}

          {/* ── PROGRESS ── */}
          {!selectedPlant && !loadingPlant && tab === 'progress' && (
            <div className="flex flex-col gap-4">
              <Card>
                <CardTitle>Progreso semanal</CardTitle>
                {progress.length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {progress.map((item) => {
                      const pct = item.adherenceRate
                      const textColor = pct >= 75 ? 'text-primary' : pct >= 40 ? 'text-warning' : 'text-danger'
                      const plant = dashboard?.plants.find((p) => p.id === item.plantId)
                      const rgb = parseRgb(plant?.colorRgb ?? null)
                      return (
                        <div key={item.plantId} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-alt p-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg text-lg"
                              style={{ backgroundColor: rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.25)` : undefined }}>
                              🪴
                            </div>
                            <p className="font-semibold text-strong">
                              {plant?.name ?? `Planta ${item.plantId.slice(0, 6)}…`}
                            </p>
                          </div>
                          <div>
                            <div className="mb-1 flex items-baseline justify-between">
                              <p className="text-xs text-muted">Adherencia</p>
                              <p className={`text-base font-bold ${textColor}`}>{pct}%</p>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
                              <div className="h-full rounded-full transition-all"
                                style={{
                                  width: `${pct}%`,
                                  backgroundColor: rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : '#3ECF6E',
                                }} />
                            </div>
                          </div>
                          <div className="flex gap-4 text-sm">
                            <div>
                              <p className="text-xs text-dim">Tareas (7d)</p>
                              <p className="font-semibold text-strong">{item.tasksDoneLast7Days}/{item.tasksTotalLast7Days}</p>
                            </div>
                            <div>
                              <p className="text-xs text-dim">Tendencia</p>
                              <p className="font-semibold text-strong capitalize">{item.trend}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <EmptyState emoji="📊" text="Aún no hay datos de progreso." />
                )}
              </Card>
            </div>
          )}
          {/* ── SETTINGS ── */}
          {!selectedPlant && !loadingPlant && tab === 'settings' && (
            <div className="flex flex-col gap-4 max-w-md">
              <Card>
                <CardTitle>Ajustes</CardTitle>
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-3">
                    <Label>Idioma del diagnóstico IA</Label>
                    <p className="text-xs text-muted -mt-1">El resumen, problemas detectados y recomendaciones se generarán en el idioma seleccionado.</p>
                    <div className="flex flex-col gap-2">
                      {(Object.entries(LANGUAGE_LABELS) as [Language, string][]).map(([code, label]) => (
                        <button key={code} type="button"
                          onClick={() => { setLanguage(code); localStorage.setItem('midori_lang', code) }}
                          className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition cursor-pointer text-left ${
                            language === code
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-surface-alt text-text hover:border-border-bright'
                          }`}>
                          <span className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${language === code ? 'border-primary' : 'border-border'}`}>
                            {language === code && <span className="h-2 w-2 rounded-full bg-primary" />}
                          </span>
                          {label}
                          {code === 'es' && <span className="ml-auto text-xs text-dim">Por defecto</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-border pt-4 flex flex-col gap-2">
                    <Label>Cuenta</Label>
                    <p className="text-sm text-muted">{user?.email}</p>
                    <Btn variant="secondary" size="sm" className="w-fit mt-1"
                      onClick={() => { localStorage.removeItem('midori_token'); localStorage.removeItem('midori_user'); setAuthToken(null); setUser(null); setDashboard(null) }}>
                      Cerrar sesión
                    </Btn>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
