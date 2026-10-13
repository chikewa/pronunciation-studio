import { useEffect, useState } from 'react'
import { ProgressSummary, api } from '../api'

interface Props {
  onLessons: () => void
}

/**
 * Progress & evolution view: lessons completed, attempts, saved recordings,
 * streak, weekly goal, the phonemes that need practice, and a score-evolution
 * chart. The chart only mixes scores from the SAME model version (the backend
 * guarantees this), and it says so.
 */
export default function ProgressView({ onLessons }: Props) {
  const [p, setP] = useState<ProgressSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cleared, setCleared] = useState(false)

  const load = () => api.progress().then(setP).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  if (error) return <p className="text-sm text-bad-700">Could not load progress: {error}</p>
  if (!p) return <p className="text-sm text-ink-400">Loading…</p>

  const hist = p.score_history
  const maxScore = 100
  const w = 560, h = 160, pad = 24

  const clearAll = async () => {
    if (!confirm('Delete all analysis history and progress? This cannot be undone.')) return
    await api.clearProgress()
    setCleared(true); load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink-900">My progress</h1>
        <button onClick={onLessons} className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-100">← Lessons</button>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Lessons completed" value={`${p.lessons_completed.length}`} />
        <Stat label="Total attempts" value={`${p.total_attempts}`} />
        <Stat label="Saved recordings" value={`${p.saved_recordings}`} />
        <Stat label="Streak" value={p.streak_days ? `${p.streak_days}d` : '—'} />
      </div>

      {/* weekly goal */}
      {p.weekly_goal && (
        <div className="rounded-lg border border-ink-200 bg-white p-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-semibold text-ink-700">Weekly goal</span>
            <span className="text-ink-500">{p.weekly_goal.attempts_last_7d} / {p.weekly_goal.target_attempts} attempts</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-200">
            <div className="h-full bg-good-500" style={{ width: `${Math.min(100, (p.weekly_goal.attempts_last_7d / p.weekly_goal.target_attempts) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* phonemes to practise */}
      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-700">Sounds to practise</h2>
        {p.phonemes_to_practise.length ? (
          <div className="flex flex-wrap gap-2">
            {p.phonemes_to_practise.map((ph) => (
              <span key={ph} className="rounded-full bg-warn-100 px-3 py-1 font-mono text-sm text-warn-700">/{ph}/</span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-500">
            No recurring weak sounds detected yet — keep working through the levels.
          </p>
        )}
        <p className="mt-2 text-xs text-ink-400">
          A sound appears here only after it has needed practice in at least two
          recent assessable attempts. The Level 6 adaptive lesson targets these.
        </p>
      </div>

      {/* score evolution */}
      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink-700">Score evolution</h2>
        <p className="mb-3 text-xs text-ink-400">
          Only scores from the same model version are plotted (never mixed with a
          different model). {hist.length} data point(s).
        </p>
        {hist.length >= 2 ? (
          <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
            <line x1={pad} y1={h - pad} x2={w} y2={h - pad} stroke="#cfd9e0" />
            <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#cfd9e0" />
            {hist.map((d, i) => {
              const x = pad + (i / (hist.length - 1)) * (w - pad)
              const y = h - pad - ((d.score ?? 0) / maxScore) * (h - 2 * pad)
              return <circle key={i} cx={x} cy={y} r="3" fill="#338fff" />
            })}
            <polyline fill="none" stroke="#338fff" strokeWidth="2"
              points={hist.map((d, i) =>
                `${pad + (i / (hist.length - 1)) * (w - pad)},${h - pad - ((d.score ?? 0) / maxScore) * (h - 2 * pad)}`).join(' ')} />
            <text x={pad} y={pad - 6} fontSize="10" fill="#7792a6">100</text>
            <text x={pad} y={h - pad + 12} fontSize="10" fill="#7792a6">0</text>
          </svg>
        ) : (
          <p className="text-sm text-ink-500">Complete at least two analyses to see your trend.</p>
        )}
      </div>

      {cleared && <p className="rounded bg-good-100 p-2 text-sm text-good-700">History cleared.</p>}
      <div className="flex justify-end">
        <button onClick={clearAll} className="rounded-md border border-bad-500/40 px-3 py-1.5 text-sm text-bad-700 hover:bg-bad-100">
          Delete all history
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      <p className="text-2xl font-bold text-ink-900">{value}</p>
      <p className="text-xs text-ink-500">{label}</p>
    </div>
  )
}
