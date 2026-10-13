import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'

export interface AudioWaveHandle {
  play: () => void
  pause: () => void
  stop: () => void
  playFrom: (t: number) => void
  getTime: () => number
  onEnd: (cb: () => void) => void
  offEnd: (cb: () => void) => void
}

interface Props {
  url: string
  label: string
  color?: string
  progressColor?: string
  height?: number
  compact?: boolean
}

/**
 * Reusable waveform player. Loads a REAL audio URL and renders its actual
 * waveform via WaveSurfer.js (no faked/seeded peaks). Exposes an imperative
 * handle so a parent (e.g. PronunciationComparator) can sequence playback.
 */
const AudioWave = forwardRef<AudioWaveHandle, Props>(({
  url, label, color = '#338fff', progressColor = '#1748a9',
  height = 72, compact = false,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<any>(null)
  const endCbs = useRef<Set<() => void>>(new Set())
  const regionRef = useRef<{ start: number; end: number } | null>(null)
  const repeatRef = useRef(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [rate, setRate] = useState(1)
  const [region, setRegion] = useState<{ start: number; end: number } | null>(null)
  const [repeatRegion, setRepeatRegion] = useState(false)
  regionRef.current = region
  repeatRef.current = repeatRegion

  useImperativeHandle(ref, () => ({
    play: () => { const ws = wsRef.current; if (!ws) return; if (regionRef.current) ws.play(regionRef.current.start); else ws.play() },
    pause: () => wsRef.current?.pause(),
    stop: () => { wsRef.current?.stop(); setCurrent(0) },
    playFrom: (t: number) => { wsRef.current?.play(t) },
    getTime: () => wsRef.current?.getCurrentTime() ?? 0,
    onEnd: (cb: () => void) => { endCbs.current.add(cb) },
    offEnd: (cb: () => void) => { endCbs.current.delete(cb) },
  }), [])

  const create = useCallback(async () => {
    if (!containerRef.current) return
    setError(null); setLoading(true)
    if (wsRef.current) { try { wsRef.current.destroy() } catch { /* */ } wsRef.current = null }

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: color,
      progressColor: progressColor,
      height, barWidth: 2, barGap: 1, barRadius: 2,
      cursorColor: '#1b2530',
      url,
      plugins: [RegionsPlugin.create()],
    })
    wsRef.current = ws

    // The Regions plugin is registered by the `plugins` option; pull it back.
    const regions = (ws.getActivePlugins() as any[]).find((p) => p instanceof RegionsPlugin) as any
    regionsRef.current = regions
    if (regions) {
      // allow the user to click-drag to select a fragment
      regions.enableDragSelection({ color: 'rgba(217,119,6,0.25)', drag: true, resize: true })
    }

    ws.on('ready', () => { setLoading(false); setDuration(ws.getDuration() || 0) })
    ws.on('timeupdate', (t: number) => {
      setCurrent(t)
      const r = regionRef.current
      if (repeatRef.current && r && t >= r.end - 0.02) { ws.play(r.start) }
    })
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => { setPlaying(false); endCbs.current.forEach((cb) => cb()) })
    ws.on('decode', (d: number) => setDuration(d))
    ws.on('error', (e: any) => {
      setError(typeof e === 'string' ? e : 'Could not load audio')
      setLoading(false)
    })

    if (regions) {
      const handle = (r: any) => setRegion({ start: r.start, end: r.end })
      regions.on('region-created', handle)
      regions.on('region-update', handle)
      regions.on('region-updated', handle)
      regions.on('region-removed', () => setRegion(null))
    }
  }, [url, color, progressColor, height])

  useEffect(() => {
    create()
    return () => { try { wsRef.current?.destroy() } catch { /* */ } }
  }, [create])

  const toggle = () => (playing ? wsRef.current?.pause() : (region ? wsRef.current?.play(region.start) : wsRef.current?.play()))
  const stop = () => { wsRef.current?.stop(); setCurrent(0) }
  const playRegion = () => { const r = region; if (r) wsRef.current?.play(r.start) }
  const clearRegion = () => { regionsRef.current?.clearRegions(); setRegion(null); setRepeatRegion(false) }
  const setVol = (v: number) => { setVolume(v); wsRef.current?.setVolume(v) }
  const setRateBtn = (r: number) => { setRate(r); wsRef.current?.setPlaybackRate(r, true) }

  const fmt = (t: number) => {
    if (!isFinite(t) || t < 0) t = 0
    const m = Math.floor(t / 60), s = (t % 60).toFixed(1).padStart(4, '0')
    return `${m}:${s}`
  }

  if (error) {
    return (
      <div className="rounded-lg border border-bad-500/40 bg-bad-100 p-3 text-sm text-bad-700">
        <span className="font-medium">{label}:</span> could not load audio — {error}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</span>
        {loading && <span className="text-xs text-ink-400">loading waveform…</span>}
        {!loading && !compact && region && (
          <span className="text-xs text-warn-700">region {fmt(region.start)}–{fmt(region.end)}</span>
        )}
      </div>

      <div ref={containerRef} className="w-full" />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}
          className="rounded-md bg-ink-900 px-3 py-1 text-xs font-semibold text-white hover:bg-ink-700">
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <button onClick={stop} aria-label="Stop"
          className="rounded-md border border-ink-300 px-3 py-1 text-xs hover:bg-ink-100">■ Stop</button>

        {!compact && region && (
          <>
            <button onClick={playRegion}
              className="rounded-md border border-warn-500/50 bg-warn-100 px-3 py-1 text-xs font-medium text-warn-700">
              ▶ Region
            </button>
            <label className="flex items-center gap-1 text-xs text-ink-600">
              <input type="checkbox" checked={repeatRegion}
                onChange={(e) => setRepeatRegion(e.target.checked)} className="accent-warn-500" />
              repeat
            </label>
            <button onClick={clearRegion} className="rounded-md border border-ink-300 px-2 py-1 text-xs hover:bg-ink-100">
              clear region
            </button>
          </>
        )}
        <span className="ml-auto font-mono text-xs text-ink-500">{fmt(current)} / {fmt(duration)}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-ink-500">
          <span aria-hidden>🔊</span>
          <input type="range" min={0} max={1} step={0.05} value={volume}
            onChange={(e) => setVol(Number(e.target.value))} className="w-24 accent-ink-700" aria-label="Volume" />
        </label>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-ink-400">speed</span>
          {[0.5, 0.75, 1].map((r) => (
            <button key={r} onClick={() => setRateBtn(r)}
              className={`rounded px-2 py-0.5 ${rate === r ? 'bg-ink-900 text-white' : 'border border-ink-300 hover:bg-ink-100'}`}>
              {r === 1 ? '1×' : `${r}×`}
            </button>
          ))}
        </div>
        {rate !== 1 && (
          <span className="rounded bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600">
            study mode — slowed for listening only, not a change to the recording
          </span>
        )}
      </div>

      {!compact && (
        <p className="mt-2 text-[11px] leading-snug text-ink-400">
          Tip: click-drag on the waveform to select a fragment to replay.
        </p>
      )}
    </div>
  )
})

AudioWave.displayName = 'AudioWave'
export default AudioWave
