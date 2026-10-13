import { useCallback, useEffect, useRef, useState } from 'react'

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
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>({
    permission: 'unknown', isRecording: false, elapsed: 0, blob: null, error: null,
  })
  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      })
      streamRef.current = stream
      setState((s) => ({ ...s, permission: 'granted', error: null }))

      const rec = new MediaRecorder(stream, { mimeType: mime })
      mediaRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime })
        setState((s) => ({ ...s, blob, isRecording: false }))
        stopStream()
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
              : `Could not start recording: ${e?.message || e}`
      setState((s) => ({ ...s, permission: name.includes('Not') ? s.permission : 'denied', error: msg }))
      stopStream()
    }
  }, [stopStream])

  const stop = useCallback(() => {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop()
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setState((s) => ({ ...s, isRecording: false }))
  }, [])

  useEffect(() => () => { stopStream(); if (timerRef.current) clearInterval(timerRef.current) }, [stopStream])

  return { ...state, start, stop, clear }
}
