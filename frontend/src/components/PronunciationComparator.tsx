import { useCallback, useEffect, useRef, useState } from 'react'
import AudioWave, { AudioWaveHandle } from './AudioWave'
import Spectrogram from './Spectrogram'

interface Props {
  referenceUrl: string
  userUrl: string
  referenceLabel?: string
  userLabel?: string
  /** real spectrogram data of the REFERENCE (from backend acoustics) */
  refSpectrogram?: { data: number[][] | null; maxFreq: number | null; source: string | null; durationS?: number | null }
  /** real spectrogram of the USER recording */
  userSpectrogram?: { data: number[][] | null; maxFreq: number | null; source: string | null; durationS?: number | null }
}

/**
 * PronunciationComparator — the central comparison tool. Two independent
 * waveform panels (reference + learner) built from REAL audio, with:
 *  • independent play/pause/stop/seek/region/repeat on each
 *  • an "alternate" loop (ref → user → ref → user …) that never plays both at once
 *  • an optional overlay of the two waveforms (time-aligned at t=0), clearly
 *    labelled as a study aid and NOT a score
 *  • optional spectrograms (real data from the backend)
 */
export default function PronunciationComparator({
  referenceUrl, userUrl,
  referenceLabel = 'Reference', userLabel = 'My pronunciation',
  refSpectrogram, userSpectrogram,
}: Props) {
  const refPanel = useRef<AudioWaveHandle>(null)
  const userPanel = useRef<AudioWaveHandle>(null)
  const [showOverlay, setShowOverlay] = useState(false)
  const [showSpectrograms, setShowSpectrograms] = useState(false)
  const [overlayWarning, setOverlayWarning] = useState(false)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  // overlay zoom: 1 = both clips visible at once
  const [overlayZoom, setOverlayZoom] = useState(1)
  const [overlayOffset, setOverlayOffset] = useState(0)  // seconds (0..maxDur-view)
  const signalsRef = useRef<{ ref: any; user: any } | null>(null)
  const overlayDragRef = useRef<{ x0: number; off0: number } | null>(null)
  const [overlayDragging, setOverlayDragging] = useState(false)
  const [overlayMaxDur, setOverlayMaxDur] = useState(0)

  // --- alternating playback ------------------------------------------------
  const [altActive, setAltActive] = useState(false)
  const altActiveRef = useRef(false)
  const playingRef = useRef<'ref' | 'user' | null>(null)
  altActiveRef.current = altActive

  const nextStep = useCallback(() => {
    if (!altActiveRef.current) return
    const other = playingRef.current === 'ref' ? userPanel : refPanel
    playingRef.current = playingRef.current === 'ref' ? 'user' : 'ref'
    other.current?.play()
  }, [])

  // wire end handlers once the panels exist
  useEffect(() => {
    const onRefEnd = () => nextStep()
    const onUserEnd = () => nextStep()
    refPanel.current?.onEnd(onRefEnd)
    userPanel.current?.onEnd(onUserEnd)
    return () => {
      refPanel.current?.offEnd(onRefEnd)
      userPanel.current?.offEnd(onUserEnd)
    }
  }, [])

  const startAlternate = () => {
    setAltActive(true); altActiveRef.current = true
    playingRef.current = 'ref'
    refPanel.current?.play()
  }
  const stopAlternate = () => {
    setAltActive(false); altActiveRef.current = false
    playingRef.current = null
    refPanel.current?.stop(); userPanel.current?.stop()
  }

  // --- overlay of the two REAL waveforms -----------------------------------
  // Signals are fetched ONCE (and cached in signalsRef) so zoom/pan re-renders
  // are instant; only the first draw does the audio decode.
  const paintOverlay = useCallback(() => {
    const canvas = overlayRef.current
    const sigs = signalsRef.current
    if (!canvas || !sigs) return
    const { ref: refSig, user: userSig } = sigs
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvas.clientWidth * dpr
    canvas.height = 180 * dpr
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const maxDur = Math.max(refSig.dur, userSig.dur)
    const view = maxDur / overlayZoom          // seconds visible
    const off = Math.max(0, Math.min(overlayOffset, maxDur - view))

    // mid line
    const W = canvas.width, H = canvas.height, mid = H / 2
    ctx.strokeStyle = '#cfd9e0'; ctx.lineWidth = 1 * dpr
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke()

    // clip lines to the visible window
    ctx.save()
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip()

    const drawLine = (sig: { data: Float32Array; sr: number; dur: number }, color: string) => {
      const n = Math.max(200, Math.floor(W / (1 * dpr)))
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const t = off + (i / (n - 1)) * view
        if (t > sig.dur) break
        const idx = Math.min(sig.data.length - 1, Math.floor(t * sig.sr))
        const x = (i / (n - 1)) * W
        const y = mid - sig.data[idx] * mid * 0.9
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = color; ctx.lineWidth = 1.5 * dpr; ctx.stroke()
    }
    drawLine(refSig, '#338fff')   // reference
    drawLine(userSig, '#d97706')  // user
    ctx.restore()

    // time axis for the VISIBLE window
    ctx.fillStyle = '#64748b'
    ctx.font = `${10 * dpr}px ui-monospace, monospace`
    const ticks = 6
    for (let i = 0; i <= ticks; i++) {
      const t = off + (i / ticks) * view
      const x = (i / ticks) * W
      const label = `${t.toFixed(2)}s`
      const lx = i === ticks ? x - ctx.measureText(label).width : x
      ctx.fillText(label, lx, H - 3 * dpr)
    }
  }, [overlayZoom, overlayOffset])

  const drawOverlay = useCallback(async () => {
    if (signalsRef.current) { paintOverlay(); return }
    const [refSig, userSig] = await Promise.all([fetchSignal(referenceUrl), fetchSignal(userUrl)])
    if (!refSig || !userSig) { setOverlayWarning(true); return }
    signalsRef.current = { ref: refSig, user: userSig }
    setOverlayMaxDur(Math.max(refSig.dur, userSig.dur))
    setOverlayWarning(Math.abs(refSig.dur - userSig.dur) / Math.max(refSig.dur, userSig.dur) > 0.15)
    setOverlayOffset(0)
    paintOverlay()
  }, [referenceUrl, userUrl, paintOverlay])

  // a NEW take = new URLs = the cached signals are stale; force a re-decode
  useEffect(() => {
    signalsRef.current = null
    setOverlayZoom(1)
    setOverlayOffset(0)
    setOverlayMaxDur(0)
    setOverlayWarning(false)
  }, [referenceUrl, userUrl])

  useEffect(() => { if (showOverlay) drawOverlay() }, [showOverlay, drawOverlay])
  useEffect(() => { if (showOverlay && signalsRef.current) paintOverlay() }, [overlayZoom, overlayOffset, paintOverlay, showOverlay])

  // overlay zoom / pan
  const overlayView = overlayMaxDur / overlayZoom
  const overlayZoomBy = (factor: number) => {
    const nz = Math.max(1, Math.min(16, overlayZoom * factor))
    // keep the centre of the view stable
    const centre = overlayOffset + overlayView / 2
    const newView = overlayMaxDur / nz
    setOverlayZoom(nz)
    setOverlayOffset(Math.max(0, Math.min(overlayMaxDur - newView, centre - newView / 2)))
  }
  const overlayPanBy = (frac: number) => {
    const maxOff = Math.max(0, overlayMaxDur - overlayView)
    setOverlayOffset((o) => Math.max(0, Math.min(maxOff, o + frac * overlayView)))
  }
  const onOverlayPointerDown = (e: React.PointerEvent) => {
    if (overlayZoom <= 1) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    overlayDragRef.current = { x0: e.clientX, off0: overlayOffset }
    setOverlayDragging(true)
  }
  const onOverlayPointerMove = (e: React.PointerEvent) => {
    const d = overlayDragRef.current
    if (!d || !overlayRef.current) return
    const pxPerSec = overlayRef.current.clientWidth / overlayView
    const maxOff = Math.max(0, overlayMaxDur - overlayView)
    setOverlayOffset(Math.max(0, Math.min(maxOff, d.off0 - (e.clientX - d.x0) / pxPerSec)))
  }
  const onOverlayPointerUp = () => { overlayDragRef.current = null; setOverlayDragging(false) }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showOverlay}
            onChange={(e) => setShowOverlay(e.target.checked)} className="accent-ink-700" />
          <span>Overlay waveforms</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showSpectrograms}
            onChange={(e) => setShowSpectrograms(e.target.checked)} className="accent-ink-700" />
          <span>Spectrograms</span>
        </label>
        <span className="ml-auto">
          {!altActive
            ? <button onClick={startAlternate}
                className="rounded-md bg-accent-600 px-3 py-1 text-sm font-semibold text-white hover:bg-accent-700">
                ⇄ Alternate play
              </button>
            : <button onClick={stopAlternate}
                className="rounded-md bg-bad-500 px-3 py-1 text-sm font-semibold text-white hover:bg-bad-700">
                ■ Stop alternating
              </button>}
        </span>
      </div>

      {showOverlay && (
        <div className="rounded-lg border border-ink-200 bg-white p-3">
          <div className="mb-1 flex flex-wrap items-center gap-4 text-xs">
            <span className="flex items-center gap-1"><i className="h-2 w-4 bg-accent-500" /> reference</span>
            <span className="flex items-center gap-1"><i className="h-2 w-4 bg-warn-500" /> you</span>
            <div className="flex items-center gap-0.5 rounded-md border border-ink-200 p-0.5">
              <button onClick={() => overlayZoomBy(1 / 1.6)} disabled={overlayZoom <= 1}
                aria-label="Zoom out overlay"
                className="rounded px-1.5 py-0.5 text-xs hover:bg-ink-100 disabled:opacity-40" title="Zoom out">
                −
              </button>
              <span className="min-w-[4ch] text-center text-[11px] text-ink-500">{overlayZoom.toFixed(1)}×</span>
              <button onClick={() => overlayZoomBy(1.6)}
                aria-label="Zoom in overlay"
                className="rounded px-1.5 py-0.5 text-xs hover:bg-ink-100" title="Zoom in">
                +
              </button>
              {overlayZoom > 1 && (
                <button onClick={() => { setOverlayZoom(1); setOverlayOffset(0) }}
                  className="rounded px-1.5 py-0.5 text-[11px] text-accent-700 hover:bg-ink-100" title="Reset">
                  fit
                </button>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={() => overlayPanBy(-0.25)} disabled={overlayZoom <= 1 || overlayOffset <= 0}
                className="rounded border border-ink-200 px-1.5 py-0.5 text-xs hover:bg-ink-100 disabled:opacity-40" title="Pan left">
                ←
              </button>
              <button onClick={() => overlayPanBy(0.25)} disabled={overlayZoom <= 1 || overlayOffset >= overlayMaxDur - overlayView - 1e-6}
                className="rounded border border-ink-200 px-1.5 py-0.5 text-xs hover:bg-ink-100 disabled:opacity-40" title="Pan right">
                →
              </button>
            </div>
            <span className="ml-auto text-ink-400">time-aligned at t=0 · drag to pan</span>
          </div>
          <div className="select-none" style={{ touchAction: 'none',
            cursor: overlayZoom > 1 ? (overlayDragging ? 'grabbing' : 'grab') : 'default' }}
            onPointerDown={onOverlayPointerDown} onPointerMove={onOverlayPointerMove}
            onPointerUp={onOverlayPointerUp} onPointerCancel={onOverlayPointerUp}>
            <canvas ref={overlayRef} className="w-full" style={{ height: 180 }} />
          </div>
          {overlayWarning && (
            <p className="mt-2 rounded bg-warn-100 p-2 text-xs text-warn-700">
              These two recordings have different lengths, so the overlay is only
              aligned at the start. It shows rhythm/timing differences — it is a
              study aid, <b>not</b> a pronunciation score, and not proof the sounds match.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <AudioWave ref={refPanel} url={referenceUrl} label={referenceLabel}
          color="#338fff" progressColor="#1748a9" />
        <AudioWave ref={userPanel} url={userUrl} label={userLabel}
          color="#d97706" progressColor="#92500a" />
      </div>

      {showSpectrograms && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Spectrogram
            data={refSpectrogram?.data ?? null}
            maxFreq={refSpectrogram?.maxFreq ?? 8000}
            title={`${referenceLabel} spectrogram`}
            source={refSpectrogram?.source ?? null}
            durationS={refSpectrogram?.durationS ?? null}
            fallbackNote="The reference spectrogram is computed in a separate analysis pass and is not shown here. The waveform and the per-phoneme results below still give you the full comparison."
          />
          <Spectrogram
            data={userSpectrogram?.data ?? null}
            maxFreq={userSpectrogram?.maxFreq ?? 8000}
            title={`${userLabel} spectrogram`}
            source={userSpectrogram?.source ?? null}
            durationS={userSpectrogram?.durationS ?? null}
            fallbackNote="The user spectrogram is returned with the analysis result — run the analysis first to see it here."
          />
        </div>
      )}

      <p className="text-xs leading-snug text-ink-400">
        The reference and your recording may be different lengths, so the same moment in
        time is not guaranteed to be the same sound. Use the per-phoneme results for
        sound-level feedback; use the overlay only to study rhythm and timing.
      </p>
    </div>
  )
}

// decode + downsample a real audio file to a small Float32Array for the overlay
async function fetchSignal(url: string): Promise<{ data: Float32Array; sr: number; dur: number } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    const ac = new Ctx()
    const decoded = await ac.decodeAudioData(buf)
    const ch = decoded.getChannelData(0)
    const sr = decoded.sampleRate
    const target = 4000
    const step = Math.max(1, Math.floor(ch.length / target))
    const out = new Float32Array(Math.ceil(ch.length / step))
    for (let i = 0; i < out.length; i++) out[i] = ch[i * step]
    ac.close()
    return { data: out, sr, dur: decoded.duration }
  } catch {
    return null
  }
}
