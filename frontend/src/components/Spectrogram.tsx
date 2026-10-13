import { useEffect, useRef } from 'react'

interface Props {
  /** spectrogram magnitude/dB matrix, rows = frequency bins (low→high), cols = time */
  data: number[][] | null
  /** highest frequency represented (Hz) */
  maxFreq?: number
  title: string
  source?: string | null
  /** shown when data is null */
  fallbackNote?: string
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
 */
export default function Spectrogram({ data, maxFreq = 8000, title, source, fallbackNote }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const W = canvas.clientWidth, H = 220
    canvas.width = W * dpr; canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#1b2530'
    ctx.fillRect(0, 0, W, H)

    if (!data || !data.length) return

    const rows = data.length        // frequency bins
    const cols = data[0].length     // time frames
    let min = Infinity, max = -Infinity
    for (const row of data) for (const v of row) { if (v < min) min = v; if (v > max) max = v }
    const span = Math.max(1, max - min)
    // map: bottom row (index rows-1) = lowest freq
    const cellW = W / cols
    const cellH = H / rows
    for (let r = 0; r < rows; r++) {
      const y = H - (r + 1) * cellH   // flip so low freq is at bottom
      for (let c = 0; c < cols; c++) {
        const t = (data[r][c] - min) / span
        const [cr, cg, cb] = colormap(t)
        ctx.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`
        ctx.fillRect(c * cellW, y, Math.ceil(cellW), Math.ceil(cellH))
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
    // time axis
    ctx.fillText('0s', 4, H - 3)
    const dur = cols ? (cols * 512) / 16000 : 0  // hop 512 @16k (backend default)
    ctx.fillText(`${dur.toFixed(1)}s`, W - 28, H - 3)
  }, [data, maxFreq])

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</span>
        {source && <span className="text-[11px] text-ink-400">source: {source}</span>}
      </div>
      {data ? (
        <>
          <canvas ref={canvasRef} className="w-full rounded" style={{ height: 220 }} />
          <p className="mt-1 text-[11px] text-ink-400">
            Y: frequency (Hz) · X: time (s) · darker = quieter, brighter = louder.
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
