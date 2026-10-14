/**
 * Audio input settings: microphone selection, manual gain, and the browser
 * DSP toggles (echo cancellation / noise suppression / AGC).
 *
 * Settings live in localStorage so every future recording keeps using the
 * capture chain the user tuned in the Settings screen. `openMicInput` builds
 * the actual pipeline: getUserMedia -> (Web Audio GainNode + Analyser) ->
 * MediaStream, which both the Settings live meter and the recorder consume.
 */

export interface AudioInputSettings {
  /** null = browser default device */
  deviceId: string | null
  /** manual input gain, linear: 0.1 – 4 (1 = unchanged) */
  gain: number
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

export const MIN_GAIN = 0.1
export const MAX_GAIN = 4

export const DEFAULT_SETTINGS: AudioInputSettings = {
  deviceId: null,
  gain: 1,
  echoCancellation: true,
  noiseSuppression: true,
  // OFF by default (as before Settings existed): the browser AGC would fight
  // the manual gain slider and make levels inconsistent between recordings.
  autoGainControl: false,
}

const KEY = 'pronunciation-studio.audio-settings.v1'

export function clampGain(g: number): number {
  if (!Number.isFinite(g)) return 1
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, g))
}

export function gainToDb(g: number): string {
  const db = 20 * Math.log10(clampGain(g))
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`
}

export function loadSettings(): AudioInputSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const p = JSON.parse(raw)
    return {
      deviceId: typeof p.deviceId === 'string' && p.deviceId ? p.deviceId : null,
      gain: clampGain(Number(p.gain)),
      echoCancellation: p.echoCancellation !== false,
      noiseSuppression: p.noiseSuppression !== false,
      autoGainControl: p.autoGainControl !== false,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: AudioInputSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch { /* storage unavailable (private mode) */ }
}

/** A live microphone input with manual gain, level metering and monitoring. */
export interface MicPipeline {
  /** the (gained) stream — feed this to MediaRecorder or an <audio> element */
  stream: MediaStream
  /** deviceId of the track actually in use (may be '' if unknown) */
  activeDeviceId: string | null
  /** set manual gain live (fast glide, no clicks) */
  setGain: (g: number) => void
  /** current smoothed RMS level, 0..1 */
  level: () => number
  /** route audio to the speakers (hear yourself) while the mic is open */
  setMonitor: (on: boolean) => void
  close: () => Promise<void>
}

/**
 * Open the microphone per the given settings. The Web Audio graph applies the
 * manual gain and exposes the level; if Web Audio is unavailable the raw
 * stream is returned so recording still works (without gain/level).
 *
 * `opts.metering` forces the Web Audio graph even at gain ×1.0 so a live
 * level meter is available (the Settings preview). Recording without
 * metering keeps the zero-overhead fast path at the default gain.
 */
export async function openMicInput(s: AudioInputSettings, opts?: { metering?: boolean }): Promise<MicPipeline> {
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    throw new Error('unsupported')
  }
  const audio: any = {
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: s.autoGainControl,
    channelCount: 1,
  }
  if (s.deviceId) audio.deviceId = { exact: s.deviceId }
  const raw = await navigator.mediaDevices.getUserMedia({ audio })

  // Fast path: plain stream, no gain (gain === 1), no metering requested.
  if (s.gain === 1 && !opts?.metering) {
    const track = raw.getAudioTracks()[0]
    return {
      stream: raw,
      activeDeviceId: track ? (track.getSettings?.().deviceId ?? null) : null,
      setGain: () => {},
      level: () => 0,
      setMonitor: () => {},
      close: async () => { raw.getTracks().forEach((t) => t.stop()) },
    }
  }

  // Gained path: Web Audio graph with live level + monitor.
  const Ctor: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext
  const ctx = new Ctor()
  await ctx.resume()
  const src = ctx.createMediaStreamSource(raw)
  const gainNode = ctx.createGain()
  gainNode.gain.value = clampGain(s.gain)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  const dest = ctx.createMediaStreamDestination()
  src.connect(gainNode)
  gainNode.connect(analyser)
  gainNode.connect(dest)

  const timeData = new Float32Array(analyser.fftSize)
  let smooth = 0
  let monitorOn = false
  let closed = false
  const track = raw.getAudioTracks()[0]

  return {
    stream: dest.stream,
    activeDeviceId: track ? (track.getSettings?.().deviceId ?? null) : null,
    setGain: (g) => {
      if (closed) return
      gainNode.gain.setTargetAtTime(clampGain(g), ctx.currentTime, 0.03)
    },
    level: () => {
      analyser.getFloatTimeDomainData(timeData)
      let sum = 0
      for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i]
      const rms = Math.sqrt(sum / timeData.length)
      // fast attack, slower release → stable needle
      smooth = rms > smooth ? rms * 0.6 + smooth * 0.4 : rms * 0.2 + smooth * 0.8
      return smooth
    },
    setMonitor: (on) => {
      if (closed || on === monitorOn) return
      monitorOn = on
      try {
        if (on) gainNode.connect(ctx.destination)
        else gainNode.disconnect(ctx.destination)
      } catch { /* graph already torn down */ }
    },
    close: async () => {
      if (closed) return
      closed = true
      try { gainNode.disconnect(); src.disconnect(); analyser.disconnect(); dest.disconnect() } catch { /* */ }
      try { await ctx.close() } catch { /* */ }
      raw.getTracks().forEach((t) => t.stop())
    },
  }
}
