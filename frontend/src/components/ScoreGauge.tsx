import { Confidence } from '../api'

/**
 * A simple radial gauge for the calibrated 0-100 score. The colour and label
 * reflect the confidence state — a low-confidence score is visually de-emphasised
 * so it is not mistaken for a strong result.
 */
export default function ScoreGauge({ value, confidence }: { value: number; confidence: Confidence }) {
  const r = 42
  const c = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, value / 100))
  const color =
    confidence === 'unavailable' ? '#a7bac8'
      : value >= 80 ? '#22a06b'
        : value >= 55 ? '#d97706'
          : '#d64545'

  return (
    <div className="relative h-28 w-28 shrink-0" role="img"
      aria-label={`Pronunciation score ${value.toFixed(1)} out of 100, confidence ${confidence}`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#e8edf1" strokeWidth="10" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold" style={{ color }}>{value.toFixed(0)}</span>
        <span className="text-[10px] uppercase tracking-wide text-ink-400">/ 100</span>
      </div>
    </div>
  )
}
