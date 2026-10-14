import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  /** spectrogram magnitude/dB matrix, rows = frequency bins (low→high), cols = time */
  data: number[][] | null
  /** highest frequency represented (Hz) */
  maxFreq?: number
  title: string
  source?: string | null
  /** shown when data is null */
  fallbackNote?: string
  /** real duration of the source audio in seconds — used to label the time
   *  axis honestly (the matrix itself may be a downsampled version). */
  durationS?: number | null
}

const COLORMAP: [number, number, number][] = [
  [27, 37, 48],     // ink-950 (quiet)
  [25, 63, 133],    // accent-900
  [27, 110, 245],   // accent-600
  [89, 176, 255],   // accent-400
  [255, 214, 90],   // warm
  [255, 255, 255],  // loud
]

function colormap(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (COLORMAP.length - 1)
  const i = Math.floor(x), f = x - i
  const a = COLORMAP[i], b = COLORMAP[Math.min(i + 1, COLORMAP.length - 1)]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/**
 * Renders a REAL spectrogram (frequency on Y, time on X) on a <canvas> with a
 * legible frequency scale and a time scale. Data is dB (negative values); we
 * normalise to [min, min+60 dB] for contrast.
 *
 * Zoom & pan: the buttons change how many columns are shown (zoom) and where
 * the window starts (pan). Dragging on the canvas pans horizontally. The
 * window is clamped to the data, so you can never scroll past the clip.
 */
export default function Spectrogram({ data, maxFreq = 8000, title, source, fallbackNote, durationS }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)      // 1 = whole clip visible
  const [pan, setPan] = useState(0)        // first visible column (fraction 0..1)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x0: number; pan0: number } | null>(null)

  const rows = data ? data.length : 0
  const cols = data ? data[0]?.length ?? 0 : 0
  const dur = durationS && isFinite(durationS) && durationS > 0
    ? durationS
    : cols ? (cols * 512) / 16000 : 0  // hop 512 @16k (backend default)

  const visibleCols = Math.max(1, Math.round(cols / zoom))
  const maxPan = Math.max(0, cols - visibleCols)
  const panClamped = Math.max(0, Math.min(pan, maxPan))
  const col0 = Math.round(panClamped)
  const col1 = Math.min(cols, col0 + visibleCols)
  const t0 = dur * (col0 / Math.max(1, cols))
  const t1 = dur * (col1 / Math.max(1, cols))

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const W = canvas.clientWidth, H = 220
    canvas.width = W * dpr; canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#1b2530'
    ctx.fillRect(0, 0, W, H)

    if (!data || rows === 0 || cols === 0) return

    let min = Infinity, max = -Infinity
    for (const row of data) for (const v of row) { if (v < min) min = v; if (v > max) max = v }
    const span = Math.max(1, max - min)

    const cellW = W / visibleCols
    const cellH = H / rows
    for (let r = 0; r < rows; r++) {
      const y = H - (r + 1) * cellH   // flip so low freq is at bottom
      for (let c = col0; c < col1; c++) {
        const t = (data[r][c] - min) / span
        const [cr, cg, cb] = colormap(t)
        ctx.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`
        ctx.fillRect((c - col0) * cellW, y, Math.ceil(cellW), Math.ceil(cellH))
      }
    }

    // frequency gridlines + labels
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.font = '10px ui-monospace, monospace'
    const steps = 4
    for (let i = 0; i <= steps; i++) {
      const y = H - (i / steps) * H
      const freq = Math.round((i / steps) * maxFreq)
      ctx.fillText(`${freq} Hz`, 4, y - 2)
    }

    // time axis — labelled with the REAL visible window [t0, t1]
    const tickCount = 5
    for (let i = 0; i <= tickCount; i++) {
      const x = (i / tickCount) * W
      const t = t0 + (i / tickCount) * (t1 - t0)
      const label = `${t.toFixed(2)}s`
      const lx = i === tickCount ? W - ctx.measureText(label).width : (i === 0 ? 4 : x - 8)
      ctx.fillText(label, lx, H - 3)
      if (i > 0) {
        ctx.fillRect(x - 0.5, H - 8, 1, 4)
      }
    }
  }, [data, rows, cols, maxFreq, visibleCols, col0, col1, t0, t1])

  useEffect(() => { draw() }, [draw])

  // keep the window valid when the data changes (new recording)
  useEffect(() => { setZoom(1); setPan(0) }, [data])

  const zoomBy = (factor: number) => {
    const nz = Math.max(1, Math.min(32, zoom * factor))
    // keep the centre of the view roughly stable while zooming
    const frac = cols > 1 ? (pan + Math.round(cols / zoom) / 2) / cols : 0
    setPan(Math.max(0, Math.min(cols - Math.round(cols / nz),
      Math.round(frac * cols - (cols / nz) / 2))))
    setZoom(nz)
  }
  const panBy = (frac: number) => {
    setPan((p) => Math.max(0, Math.min(maxPan, p + frac * cols)))
  }

  // drag to pan
  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1 || !cols) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { x0: e.clientX, pan0: pan }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || !wrapRef.current) return
    const dx = e.clientX - d.x0
    const frac = dx / wrapRef.current.clientWidth
    setPan(Math.max(0, Math.min(maxPan, d.pan0 - frac * cols)))
  }
  const endDrag = () => { dragRef.current = null; setDragging(false) }

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</span>
        {source && <span className="text-[11px] text-ink-400">source: {source}</span>}
      </div>
      {data ? (
        <>
          <div ref={wrapRef}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={endDrag} onPointerCancel={endDrag}
            className="relative select-none"
            style={{ cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default', touchAction: 'none' }}>
            <canvas ref={canvasRef} className="w-full rounded" style={{ height: 220 }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-md border border-ink-200 p-0.5">
              <button onClick={() => zoomBy(1 / 1.6)} disabled={zoom <= 1}
                aria-label={`Zoom out ${title}`}
                className="rounded px-1.5 py-0.5 text-xs hover:bg-ink-100 disabled:opacity-40" title="Zoom out">
                −
              </button>
              <span className="min-w-[4ch] text-center text-[11px] text-ink-500">{zoom.toFixed(1)}×</span>
              <button onClick={() => zoomBy(1.6)}
                aria-label={`Zoom in ${title}`}
                className="rounded px-1.5 py-0.5 text-xs hover:bg-ink-100" title="Zoom in">
                +
              </button>
              {zoom > 1 && (
                <button onClick={() => { setZoom(1); setPan(0) }}
                  className="rounded px-1.5 py-0.5 text-[11px] text-accent-700 hover:bg-ink-100" title="Reset">
                  fit
                </button>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={() => panBy(-0.15)} disabled={panClamped <= 0}
                className="rounded border border-ink-200 px-1.5 py-0.5 text-xs hover:bg-ink-100 disabled:opacity-40" title="Pan left">
                ←
              </button>
              <button onClick={() => panBy(0.15)} disabled={panClamped >= maxPan}
                className="rounded border border-ink-200 px-1.5 py-0.5 text-xs hover:bg-ink-100 disabled:opacity-40" title="Pan right">
                →
              </button>
            </div>
            <span className="ml-auto font-mono text-[11px] text-ink-500">
              {t0.toFixed(2)}–{t1.toFixed(2)}s / {dur.toFixed(2)}s
            </span>
          </div>
          <p className="mt-1 text-[11px] text-ink-400">
            Y: frequency (Hz) · X: time (s) · darker = quieter, brighter = louder.
            Zoom in to inspect formant structure; drag or use ←/→ to pan.
            Similar-looking spectrograms do <b>not</b> by themselves mean correct pronunciation.
          </p>
        </>
      ) : (
        <div className="flex h-[220px] items-center justify-center rounded bg-ink-50 p-4 text-center text-sm text-ink-400">
          {fallbackNote || 'No spectrogram data available.'}
        </div>
      )}
    </div>
  )
}
