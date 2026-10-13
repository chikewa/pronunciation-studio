import { useEffect, useRef } from 'react'
import { AnalysisResult, AcousticFeatures } from '../api'

interface Props {
  result: AnalysisResult
}

/** A small line chart for (time, value) curves: F0, intensity, RMS. */
function Curve({ data, color, yLabel, unit, height = 120 }:
  { data: [number, number][] | null; color: string; yLabel: string; unit: string; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const W = c.clientWidth, H = height
    c.width = W * dpr; c.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#f4f6f8'; ctx.fillRect(0, 0, W, H)
    if (!data || data.length < 2) {
      ctx.fillStyle = '#a7bac8'; ctx.font = '12px sans-serif'
      ctx.fillText(`${yLabel}: not available`, 8, H / 2)
      return
    }
    const ts = data.map((d) => d[0]), vs = data.map((d) => d[1]).filter((v) => v > 0)
    const tMin = Math.min(...ts), tMax = Math.max(...ts)
    const vMin = 0, vMax = Math.max(...(vs.length ? vs : [1]))
    const pad = 6
    ctx.strokeStyle = color; ctx.lineWidth = 1.5
    ctx.beginPath()
    data.forEach(([t, v], i) => {
      const x = pad + ((t - tMin) / Math.max(1e-6, tMax - tMin)) * (W - 2 * pad)
      const y = H - pad - ((v - vMin) / Math.max(1e-6, vMax - vMin)) * (H - 2 * pad)
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.fillStyle = '#7792a6'; ctx.font = '10px ui-monospace, monospace'
    ctx.fillText(`${yLabel} (max ${vMax.toFixed(0)} ${unit})`, 4, 12)
    ctx.fillText(`${tMax.toFixed(1)} s`, W - 40, H - 4)
  }, [data, color, yLabel, unit, height])
  return <canvas ref={ref} className="w-full rounded border border-ink-200 bg-ink-50" style={{ height }} />
}

/**
 * Advanced acoustic panel: the technical, "under the hood" view. Shows real
 * measured curves (F0, intensity, RMS), per-word durations, alignment/model
 * confidence and analysis parameters — all labelled with units. Collapsed by
 * default so the main view stays focused on the most useful advice.
 */
export default function AdvancedPanel({ result }: Props) {
  const a: AcousticFeatures | null = result.acoustics
  return (
    <details className="group rounded-lg border border-ink-200 bg-white">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-ink-700">
        <span className="mr-2 inline-block transition-transform group-open:rotate-90">▸</span>
        Advanced acoustic analysis
      </summary>
      <div className="space-y-4 border-t border-ink-100 p-4 text-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-ink-500">Pitch (F0)</p>
            <Curve data={a?.f0 ?? null} color="#338fff" yLabel="F0" unit="Hz" />
            <p className="mt-1 text-[11px] text-ink-400">
              source: {a?.f0_source ?? '—'} · 0 Hz = unvoiced
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-ink-500">Intensity</p>
            <Curve data={a?.intensity_db ?? null} color="#22a06b" yLabel="Intensity" unit="dB" />
            <p className="mt-1 text-[11px] text-ink-400">source: {a?.intensity_source ?? '—'}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-ink-500">Energy (RMS)</p>
            <Curve data={a?.rms_curve ?? null} color="#d97706" yLabel="RMS" unit="" />
            <p className="mt-1 text-[11px] text-ink-400">root-mean-square amplitude over time</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded border border-ink-100 bg-ink-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-ink-500">Signals & quality</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-ink-500">Duration</dt><dd className="text-right font-mono">{a?.duration_s ?? '—'} s</dd>
              <dt className="text-ink-500">Sample rate</dt><dd className="text-right font-mono">{a?.sample_rate ?? '—'} Hz</dd>
              <dt className="text-ink-500">Peak</dt><dd className="text-right font-mono">{a?.peak ?? '—'}</dd>
              <dt className="text-ink-500">RMS</dt><dd className="text-right font-mono">{a?.rms ?? '—'}</dd>
              <dt className="text-ink-500">MFCC</dt><dd className="text-right font-mono">{a?.mfcc ? `${a.mfcc.length} × ${a.mfcc[0].length}` : '—'}</dd>
              <dt className="text-ink-500">Spectrogram</dt><dd className="text-right font-mono">{a?.spectrogram ? `${a.spectrogram.length} × ${a.spectrogram[0].length} (${a.spectrogram_source})` : '—'}</dd>
            </dl>
          </div>
          <div className="rounded border border-ink-100 bg-ink-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-ink-500">Model & confidence</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-ink-500">Model</dt><dd className="text-right font-mono">{result.model_name ?? '—'} {result.model_version}</dd>
              <dt className="text-ink-500">Device</dt><dd className="text-right font-mono">{result.device ?? '—'}</dd>
              <dt className="text-ink-500">Overall confidence</dt><dd className="text-right font-mono">{result.confidence}</dd>
              <dt className="text-ink-500">Score confidence</dt><dd className="text-right font-mono">{result.score_confidence}</dd>
              <dt className="text-ink-500">Phoneme error rate</dt><dd className="text-right font-mono">{result.phoneme_error_rate ?? '—'}</dd>
              <dt className="text-ink-500">Word error rate</dt><dd className="text-right font-mono">{result.word_error_rate ?? '—'}</dd>
              <dt className="text-ink-500">Acoustic distance</dt><dd className="text-right font-mono">{result.acoustic_distance ?? '—'}</dd>
              <dt className="text-ink-500">Analysis time</dt><dd className="text-right font-mono">{result.duration_ms ? `${(result.duration_ms / 1000).toFixed(1)} s` : '—'}</dd>
            </dl>
          </div>
        </div>

        {result.limitations.length > 0 && (
          <div className="rounded border border-warn-500/40 bg-warn-100 p-3">
            <p className="mb-1 text-xs font-semibold uppercase text-warn-700">Limitations of this analysis</p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-warn-700">
              {result.limitations.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        )}
        {a?.notes && a.notes.length > 0 && (
          <p className="text-[11px] text-ink-400">Feature notes: {a.notes.join('; ')}</p>
        )}
      </div>
    </details>
  )
}
