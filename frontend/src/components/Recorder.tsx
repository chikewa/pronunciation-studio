import { useEffect, useState } from 'react'
import { useRecorder } from '../hooks/useRecorder'
import { AudioMeta, api } from '../api'

interface Props {
  onRecording: (recordingId: string, meta: AudioMeta) => void
  onClear: () => void
  disabled?: boolean
}

/**
 * Microphone recorder UI. Handles permission states, recording indicator with
 * elapsed time, play-back of the last take, re-record, clear, and saving the
 * take to the backend (returns a recording_id used for analysis + progress).
 */
export default function Recorder({ onRecording, onClear, disabled }: Props) {
  const rec = useRecorder()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Keep a preview object URL in sync with the current blob (revoke the old).
  useEffect(() => {
    if (rec.blob) {
      const url = URL.createObjectURL(rec.blob)
      setPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    }
    setPreviewUrl(null)
  }, [rec.blob])

  const handleSave = async () => {
    if (!rec.blob) return
    setSaving(true); setSaveError(null)
    try {
      const res = await api.saveAudio(rec.blob, 'rec.webm')
      onRecording(res.recording_id, res.meta)
    } catch (e: any) {
      setSaveError(`Could not save the recording: ${e.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  const handleClear = () => {
    rec.clear()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    onClear()
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          Record your pronunciation
        </span>
        {rec.isRecording && (
          <span className="flex items-center gap-2 rounded-full bg-bad-100 px-3 py-1 text-xs font-semibold text-bad-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-bad-500" />
            recording · {rec.elapsed.toFixed(1)}s
          </span>
        )}
      </div>

      {rec.error && (
        <p className="mb-3 rounded bg-bad-100 p-2 text-xs text-bad-700">{rec.error}</p>
      )}
      {rec.permission === 'unsupported' && (
        <p className="mb-3 rounded bg-warn-100 p-2 text-xs text-warn-700">
          This browser can't record (no microphone support). Try Chrome, Edge or
          Firefox over https or localhost.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!rec.isRecording ? (
          <button
            onClick={rec.start}
            disabled={disabled}
            className="rounded-md bg-bad-500 px-4 py-2 text-sm font-semibold text-white hover:bg-bad-700 disabled:opacity-50"
          >
            ⏺ {rec.blob ? 'Record again' : 'Start recording'}
          </button>
        ) : (
          <button
            onClick={rec.stop}
            className="rounded-md bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-700"
          >
            ⏹ Stop
          </button>
        )}

        {rec.blob && !rec.isRecording && (
          <>
            <button onClick={handleSave} disabled={saving}
              className="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50">
              {saving ? 'Saving…' : '✓ Save & analyse'}
            </button>
            <button onClick={handleClear}
              className="rounded-md border border-ink-300 px-3 py-2 text-sm hover:bg-ink-100">
              🗑 Discard take
            </button>
          </>
        )}

        {saveError && <span className="text-xs text-bad-700">{saveError}</span>}
      </div>

      {rec.blob && previewUrl && !rec.isRecording && (
        <div className="mt-3">
          <p className="mb-1 text-xs text-ink-500">Your take (play to check, or save to analyse):</p>
          <audio controls src={previewUrl} className="w-full" />
        </div>
      )}
    </div>
  )
}
