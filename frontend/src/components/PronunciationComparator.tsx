import { useCallback, useEffect, useRef, useState } from 'react'
import AudioWave, { AudioWaveHandle } from './AudioWave'
import Spectrogram from './Spectrogram'

interface Props {
  referenceUrl: string
  userUrl: string
  referenceLabel?: string
  userLabel?: string
  /** real spectrogram data of the REFERENCE (from backend acoustics) */
  refSpectrogram?: { data: number[][] | null; maxFreq: number | null; source: string | null }
  /** real spectrogram of the USER recording */
  userSpectrogram?: { data: number[][] | null; maxFreq: number | null; source: string | null }
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
  const drawOverlay = useCallback(async () => {
    const canvas = overlayRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvas.clientWidth * dpr
    canvas.height = 180 * dpr
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const [refSig, userSig] = await Promise.all([fetchSignal(referenceUrl), fetchSignal(userUrl)])
    if (!refSig || !userSig) { setOverlayWarning(true); return }
    const maxDur = Math.max(refSig.dur, userSig.dur)
    setOverlayWarning(Math.abs(refSig.dur - userSig.dur) / maxDur > 0.15)

    const W = canvas.width, H = canvas.height, mid = H / 2
    ctx.strokeStyle = '#cfd9e0'; ctx.lineWidth = 1 * dpr
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke()

    const drawLine = (sig: { data: Float32Array; sr: number }, color: string) => {
      const n = 600
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1)) * maxDur
        const idx = Math.min(sig.data.length - 1, Math.floor(t * sig.sr))
        const x = (i / (n - 1)) * W
        const y = mid - sig.data[idx] * mid * 0.9
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = color; ctx.lineWidth = 1.5 * dpr; ctx.stroke()
    }
    drawLine(refSig, '#338fff')   // reference
    drawLine(userSig, '#d97706')  // user
  }, [referenceUrl, userUrl])

  useEffect(() => { if (showOverlay) drawOverlay() }, [showOverlay, drawOverlay])

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
          <div className="mb-1 flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1"><i className="h-2 w-4 bg-accent-500" /> reference</span>
            <span className="flex items-center gap-1"><i className="h-2 w-4 bg-warn-500" /> you</span>
            <span className="ml-auto text-ink-400">time-aligned at t=0</span>
          </div>
          <canvas ref={overlayRef} className="w-full" style={{ height: 180 }} />
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
            fallbackNote="The reference spectrogram is computed in a separate analysis pass and is not shown here. The waveform and the per-phoneme results below still give you the full comparison."
          />
          <Spectrogram
            data={userSpectrogram?.data ?? null}
            maxFreq={userSpectrogram?.maxFreq ?? 8000}
            title={`${userLabel} spectrogram`}
            source={userSpectrogram?.source ?? null}
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
