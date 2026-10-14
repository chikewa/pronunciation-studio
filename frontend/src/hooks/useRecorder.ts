import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSettings, openMicInput, MicPipeline } from '../lib/audioSettings'

export interface RecorderState {
  permission: 'unknown' | 'granted' | 'denied' | 'unsupported'
  isRecording: boolean
  elapsed: number
  blob: Blob | null
  error: string | null
}

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

/**
 * A self-contained microphone recorder. Uses the MediaRecorder API to capture
 * a real Blob the user can play back and upload. Exposes permission state,
 * elapsed time, the resulting Blob and start/stop/clear controls.
 *
 * The capture chain honours the user's audio input settings (device, manual
 * gain, DSP toggles) — the same pipeline the Settings screen tunes, so what
 * you hear/see there is what gets recorded.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>({
    permission: 'unknown', isRecording: false, elapsed: 0, blob: null, error: null,
  })
  const mediaRef = useRef<MediaRecorder | null>(null)
  const pipelineRef = useRef<MicPipeline | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)

  const teardown = useCallback(() => {
    pipelineRef.current?.close().catch(() => {})
    pipelineRef.current = null
  }, [])

  const clear = useCallback(() => {
    setState((s) => ({ ...s, blob: null, elapsed: 0 }))
  }, [])

  const start = useCallback(async () => {
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setState((s) => ({ ...s, permission: 'unsupported', error: 'This browser does not support microphone recording (getUserMedia is unavailable). Recording needs a secure context (https or localhost) and a modern browser.' }))
      return
    }
    const mime = pickMime()
    if (!mime) {
      setState((s) => ({ ...s, error: 'No supported audio recording format (MediaRecorder) in this browser.' }))
      return
    }
    try {
      // Open the mic through the user's configured chain (device + gain + DSP).
      const settings = loadSettings()
      const pipeline = await openMicInput(settings)
      pipelineRef.current = pipeline

      const stream = pipeline.stream
      setState((s) => ({ ...s, permission: 'granted', error: null }))

      const rec = new MediaRecorder(stream, { mimeType: mime })
      mediaRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime })
        setState((s) => ({ ...s, blob, isRecording: false }))
        teardown()
      }
      rec.start(250)
      startRef.current = Date.now()
      setState((s) => ({ ...s, isRecording: true, elapsed: 0, blob: null }))
      timerRef.current = window.setInterval(() => {
        setState((s) => ({ ...s, elapsed: (Date.now() - startRef.current) / 1000 }))
      }, 200)
    } catch (e: any) {
      const name = e?.name || ''
      const msg =
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'Microphone permission was denied. Allow microphone access in your browser settings and try again.'
          : name === 'NotFoundError' || name === 'DevicesNotFound'
            ? 'No microphone was found. Connect a microphone and reload.'
            : name === 'NotReadableError'
              ? 'The microphone is busy or unavailable (in use by another app).'
              : name === 'OverconstrainedError'
                ? 'The selected microphone is no longer available. Pick another device in Settings (or the default one) and try again.'
              : `Could not start recording: ${e?.message || e}`
      setState((s) => ({ ...s, permission: name.includes('Not') ? s.permission : 'denied', error: msg }))
      teardown()
    }
  }, [teardown])

  const stop = useCallback(() => {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop()
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setState((s) => ({ ...s, isRecording: false }))
  }, [])

  useEffect(() => () => { teardown(); if (timerRef.current) clearInterval(timerRef.current) }, [teardown])

  return { ...state, start, stop, clear }
}
