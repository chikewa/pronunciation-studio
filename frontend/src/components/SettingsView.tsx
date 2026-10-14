import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AudioInputSettings, DEFAULT_SETTINGS, MAX_GAIN, MIN_GAIN,
  gainToDb, loadSettings, openMicInput, saveSettings, MicPipeline,
} from '../lib/audioSettings'

interface Props {
  /** go back to the lesson list after leaving settings */
  onLessons: () => void
}

interface Device { deviceId: string; label: string }

/**
 * Microphone input settings: device picker, manual gain with live preview,
 * and the browser DSP toggles. Changes are applied live while the preview
 * is running and can be persisted for all future recordings.
 */
export default function SettingsView({ onLessons }: Props) {
  const [saved, setSaved] = useState<AudioInputSettings>(() => loadSettings())
  const [draft, setDraft] = useState<AudioInputSettings>(saved)
  const [devices, setDevices] = useState<Device[]>([])
  const devicesRef = useRef<Device[]>([])
  devicesRef.current = devices
  const [savedFlash, setSavedFlash] = useState(false)

  // --- live preview ---------------------------------------------------------
  const [previewOn, setPreviewOn] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [monitor, setMonitor] = useState(false)
  const [level, setLevel] = useState(0)
  const [deviceInfo, setDeviceInfo] = useState<string | null>(null)
  const pipelineRef = useRef<MicPipeline | null>(null)
  const rafRef = useRef<number | null>(null)
  const genRef = useRef(0)  // generation counter: stale async ops abort

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const mic = all.filter((d) => d.kind === 'audioinput')
      setDevices(mic.map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId ? d.deviceId.slice(0, 6) : ''}` })))
    } catch { /* enumeration not allowed until permission */ }
  }, [])

  useEffect(() => {
    refreshDevices()
    const onDev = () => refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', onDev)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onDev)
  }, [refreshDevices])

  // Open/close the preview pipeline. Re-opens automatically when the
  // capture-relevant settings change while the preview is running.
  useEffect(() => {
    if (!previewOn) {
      genRef.current++  // invalidate any in-flight open
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      pipelineRef.current?.close().catch(() => {})
      pipelineRef.current = null
      setLevel(0)
      setDeviceInfo(null)
      return
    }
    let cancelled = false
    const gen = ++genRef.current
    ;(async () => {
      setPreviewError(null)
      const p = await openMicInput(draft, { metering: true })
      if (cancelled || gen !== genRef.current) { p.close().catch(() => {}); return }
      pipelineRef.current = p
      const id = p.activeDeviceId
      const name = devicesRef.current.find((d) => d.deviceId === id)?.label || (id ? `id ${id.slice(0, 8)}` : 'default microphone')
      setDeviceInfo(id ? name : 'default microphone (browser choice)')
      setMonitor((m) => { p.setMonitor(m); return m })
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      const loop = () => {
        setLevel(pipelineRef.current?.level() ?? 0)
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    })().catch((e: any) => {
      if (gen !== genRef.current) return
      const name = e?.name || ''
      setPreviewError(
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'Microphone permission was denied. Allow microphone access in your browser and retry.'
          : name === 'NotFoundError' ? 'No microphone found. Connect one and retry.'
          : name === 'NotReadableError' ? 'The microphone is busy or in use by another app.'
          : name === 'OverconstrainedError' ? 'The selected microphone is no longer available — pick another device.'
          : `Could not open the microphone: ${e?.message || e}`)
    })
    return () => {
      cancelled = true
      genRef.current++
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      pipelineRef.current?.close().catch(() => {})
      pipelineRef.current = null
    }
  // gain is applied live via setGain — it must NOT be in this dependency list
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOn, draft.deviceId, draft.echoCancellation, draft.noiseSuppression, draft.autoGainControl])

  // --- actions --------------------------------------------------------------
  const set = <K extends keyof AudioInputSettings>(k: K, v: AudioInputSettings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const applyGainLive = (g: number) => {
    set('gain', g)
    pipelineRef.current?.setGain(g)  // instant, no pipeline restart
  }

  const handleSave = () => {
    saveSettings(draft)
    setSaved(draft)
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 2000)
  }
  const handleReset = () => { setDraft({ ...DEFAULT_SETTINGS }) }
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  const levelDb = level > 0 ? 20 * Math.log10(level) : -100
  const meterPct = Math.min(100, Math.max(0, ((levelDb + 50) / 50) * 100))  // -50..0 dB → 0..100%
  const peakColor = levelDb > -6 ? 'bg-bad-500' : levelDb > -18 ? 'bg-warn-500' : 'bg-good-500'

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audio input settings</h1>
          <p className="mt-1 text-sm text-ink-500">
            Tune how the microphone is captured. Every recording uses these settings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && !savedFlash && (
            <span className="rounded-full bg-warn-100 px-3 py-1 text-xs font-semibold text-warn-700">
              unsaved changes
            </span>
          )}
          {savedFlash && (
            <span className="rounded-full bg-good-100 px-3 py-1 text-xs font-semibold text-good-700">
              ✓ saved
            </span>
          )}
          <button onClick={handleSave} disabled={!dirty}
            className="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50">
            💾 Save settings
          </button>
        </div>
      </div>

      {/* --- live preview ---------------------------------------------------- */}
      <div className="mb-4 rounded-lg border border-ink-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Live preview</span>
            {previewOn && (
              <span className="flex items-center gap-2 rounded-full bg-good-100 px-3 py-1 text-xs font-semibold text-good-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-good-500" /> listening
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {previewOn && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-600">
                <input type="checkbox" checked={monitor} onChange={(e) => {
                  const on = e.target.checked; setMonitor(on); pipelineRef.current?.setMonitor(on)
                }} className="h-4 w-4 rounded border-ink-300" />
                monitor (hear myself)
              </label>
            )}
            <button onClick={() => setPreviewOn((v) => !v)}
              className={previewOn
                ? 'rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-100'
                : 'rounded-md bg-ink-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-ink-700'}>
              {previewOn ? '⏹ Stop preview' : '▶ Start live preview'}
            </button>
          </div>
        </div>

        {previewError && (
          <p className="mt-3 rounded bg-bad-100 p-2 text-xs text-bad-700">{previewError}</p>
        )}

        {previewOn && !previewError && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-ink-500">
              <span>{deviceInfo}</span>
              <span className="font-mono">
                {levelDb < -95 ? '-∞' : levelDb.toFixed(1)} dBFS
                {levelDb > -6 && <span className="ml-1 font-semibold text-bad-700">· hot (clip risk)</span>}
                {levelDb <= -18 && levelDb > -95 && <span className="ml-1 text-warn-700">· a bit low</span>}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-ink-100">
              <div className={`h-full ${peakColor} transition-[width] duration-75`} style={{ width: `${meterPct}%` }} />
            </div>
            <p className="mt-2 text-xs text-ink-400">
              Speak normally and aim for the green zone. Use the gain below if the meter
              barely moves (too low) or pegs red (too loud).
            </p>
          </div>
        )}
        {!previewOn && !previewError && (
          <p className="mt-2 text-xs text-ink-400">
            Open your microphone and watch the level while you adjust the gain — changes
            apply instantly, no need to restart.
          </p>
        )}
      </div>

      {/* --- input device ----------------------------------------------------- */}
      <div className="mb-4 rounded-lg border border-ink-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Input device</span>
          <button onClick={refreshDevices} className="rounded-md border border-ink-300 px-2.5 py-1 text-xs hover:bg-ink-100">
            ↻ Rescan
          </button>
        </div>
        {devices.length === 0 ? (
          <p className="text-xs text-ink-400">
            No microphones listed yet — start the live preview (or allow microphone access)
            and rescan.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <DeviceChip
              active={draft.deviceId === null}
              label="Browser default"
              onClick={() => set('deviceId', null)}
            />
            {devices.map((d) => (
              <DeviceChip key={d.deviceId || 'unknown'} active={draft.deviceId === d.deviceId}
                label={d.label} onClick={() => set('deviceId', d.deviceId || null)} />
            ))}
          </div>
        )}
      </div>

      {/* --- gain ------------------------------------------------------------- */}
      <div className="mb-4 rounded-lg border border-ink-200 bg-white p-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Input gain</span>
          <span className="font-mono text-sm text-ink-700">
            ×{draft.gain.toFixed(2)} <span className="text-ink-400">({gainToDb(draft.gain)})</span>
          </span>
        </div>
        <p className="mb-3 text-xs text-ink-400">
          Boosts quiet microphones or backs off hot ones. ×1.0 is the raw level from the mic.
        </p>
        <input
          type="range" min={MIN_GAIN} max={MAX_GAIN} step={0.05} value={draft.gain}
          onChange={(e) => applyGainLive(Number(e.target.value))}
          aria-label="Input gain"
          className="w-full accent-accent-600"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {[0.5, 1, 1.5, 2, 3].map((g) => (
            <button key={g} onClick={() => applyGainLive(g)}
              className={`rounded-md px-2.5 py-1 text-xs ${draft.gain === g
                ? 'bg-ink-900 text-white' : 'border border-ink-300 text-ink-600 hover:bg-ink-100'}`}>
              ×{g}
            </button>
          ))}
          <span className="flex-1" />
          <button onClick={() => applyGainLive(1)}
            className="rounded-md border border-ink-300 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-100">
            reset ×1.0
          </button>
        </div>
        {draft.autoGainControl && (
          <p className="mt-3 rounded bg-warn-100 p-2 text-xs text-warn-700">
            Note: browser auto-gain is ON, so it fights manual gain a little. Turn it off
            below for full control.
          </p>
        )}
      </div>

      {/* --- DSP toggles -------------------------------------------------------- */}
      <div className="mb-4 rounded-lg border border-ink-200 bg-white p-4">
        <span className="mb-3 block text-xs font-semibold uppercase tracking-wide text-ink-500">
          Browser processing (DSP)
        </span>
        <div className="space-y-3">
          <Toggle
            checked={draft.echoCancellation}
            onChange={(v) => set('echoCancellation', v)}
            label="Echo cancellation"
            hint="Removes sound leaking from your speakers back into the mic. Keep ON unless you use headphones."
          />
          <Toggle
            checked={draft.noiseSuppression}
            onChange={(v) => set('noiseSuppression', v)}
            label="Noise suppression"
            hint="Reduces constant background noise (fans, AC, traffic). Turn OFF if it muffles soft consonants."
          />
          <Toggle
            checked={draft.autoGainControl}
            onChange={(v) => set('autoGainControl', v)}
            label="Automatic gain (AGC)"
            hint="The browser adjusts the level for you. Turn OFF to use the manual gain slider above with full control."
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button onClick={handleReset}
          className="rounded-md border border-ink-300 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-100">
          ↺ Reset to defaults
        </button>
        <button onClick={onLessons}
          className="rounded-md bg-accent-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-700">
          Back to lessons →
        </button>
      </div>
    </div>
  )
}

function DeviceChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium ${active
        ? 'border-ink-900 bg-ink-900 text-white'
        : 'border-ink-300 text-ink-600 hover:bg-ink-100'}`}>
      {active ? '✓ ' : ''}{label}
    </button>
  )
}

function Toggle({ checked, onChange, label, hint }:
  { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-ink-300 accent-ink-900" />
      <span>
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        <span className="block text-xs text-ink-400">{hint}</span>
      </span>
    </label>
  )
}
