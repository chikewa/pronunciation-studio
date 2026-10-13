import { useEffect, useState } from 'react'
import { Health, api } from '../api'

interface Props {
  onLessons: () => void
  onProgress: () => void
}

/**
 * Home: model health/status (truthful — loaded vs missing), the privacy
 * statement, and quick-start links. This is where the user checks whether the
 * pronunciation models are installed before trying to analyse.
 */
export default function HomeView({ onLessons, onProgress }: Props) {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warming, setWarming] = useState(false)

  const load = () => api.health().then(setHealth).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const warmup = async () => {
    setWarming(true)
    try { await api.warmup() } finally { setWarming(false); load() }
  }

  if (error) {
    return (
      <div className="rounded-lg border border-bad-500/40 bg-bad-100 p-4 text-sm text-bad-700">
        <p className="font-semibold">Cannot reach the backend</p>
        <p className="mt-1">{error}</p>
        <p className="mt-2 text-xs">
          Start it with: <code className="rounded bg-white/60 px-1">cd backend && ../.venv/bin/python -m uvicorn app.main:app --port 8000</code>
        </p>
      </div>
    )
  }
  if (!health) return <p className="text-sm text-ink-400">Checking status…</p>

  const allReady = health.models.every((m) => m.notes?.startsWith('installed=True'))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Pronunciation Studio</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-600">
          Learn English pronunciation with real, local AI analysis. Record your voice,
          compare it with a reference, and get sound-by-sound feedback — all on your
          computer, with no recordings sent anywhere.
        </p>
      </div>

      {/* quick start */}
      <div className="flex flex-wrap gap-3">
        <button onClick={onLessons}
          className="rounded-md bg-accent-600 px-5 py-3 text-sm font-bold text-white hover:bg-accent-700">
          Start learning →
        </button>
        <button onClick={onProgress}
          className="rounded-md border border-ink-300 px-5 py-3 text-sm font-semibold hover:bg-ink-100">
          My progress
        </button>
      </div>

      {/* model status */}
      <section className="rounded-lg border border-ink-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-700">Models & status</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
            allReady ? 'bg-good-100 text-good-700' : 'bg-warn-100 text-warn-700'}`}>
            {allReady ? 'all models installed' : 'some models missing'}
          </span>
        </div>
        <div className="space-y-2">
          {health.models.map((m) => (
            <div key={m.name} className="flex items-start gap-3 rounded border border-ink-100 p-3">
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                m.notes?.startsWith('installed=True') ? 'bg-good-500' : 'bg-bad-500'}`} />
              <div>
                <p className="text-sm font-medium text-ink-800">{m.name}</p>
                <p className="text-xs text-ink-500">{m.role}</p>
                <p className="mt-0.5 text-[11px] text-ink-400">{m.notes}</p>
              </div>
            </div>
          ))}
        </div>
        {!allReady && (
          <div className="mt-3 rounded bg-warn-100 p-3 text-sm text-warn-700">
            <p className="font-semibold">Set up the models (one-time, needs internet):</p>
            <pre className="mt-1 overflow-x-auto rounded bg-white/60 p-2 text-[11px]">
{`cd pronunciation-studio
sudo apt-get install -y espeak-ng ffmpeg
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/python scripts/download_models.py`}
            </pre>
            <p className="mt-1 text-xs">Then reload this page.</p>
          </div>
        )}
        <button onClick={warmup} disabled={warming}
          className="mt-3 rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-100 disabled:opacity-50">
          {warming ? 'Loading models…' : 'Load models now'}
        </button>
      </section>

      {/* privacy */}
      <section className="rounded-lg border border-ink-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-700">Privacy</h2>
        <ul className="space-y-1.5 text-sm text-ink-600">
          <li>• All processing happens <b>on this machine</b>. Recordings and analyses never leave it.</li>
          <li>• There is no telemetry and no upload of audio or transcripts to any external service.</li>
          <li>• Your data (recordings, history) is stored under <code className="rounded bg-ink-100 px-1 text-xs">{health.data_dir}</code>.</li>
          <li>• You can delete any recording or the entire history from the Progress screen.</li>
          <li>• Reference audio is synthesised locally with Piper (labelled as such) — it is a clear model voice, not a native speaker.</li>
        </ul>
        {health.notes.length > 0 && (
          <div className="mt-3 rounded bg-warn-100 p-2 text-xs text-warn-700">
            {health.notes.map((n, i) => <p key={i}>{n}</p>)}
          </div>
        )}
      </section>

      <p className="text-xs text-ink-400">
        Backend {health.version} · Python {health.python} · {health.offline ? 'running offline' : 'network available'}
      </p>
    </div>
  )
}
