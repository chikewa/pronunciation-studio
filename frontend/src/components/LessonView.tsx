import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AnalysisResult, Lesson, api, referenceUrl, recordingUrl,
} from '../api'
import Recorder from './Recorder'
import PronunciationComparator from './PronunciationComparator'
import AdvancedPanel from './AdvancedPanel'
import ScoreGauge from './ScoreGauge'
import PhonemeTable from './PhonemeTable'

interface Props {
  lesson: Lesson
  onLessonList: () => void
}

type AnalysisPhase = 'idle' | 'queued' | 'running' | 'done' | 'error'

export default function LessonView({ lesson, onLessonList }: Props) {
  const [exerciseText, setExerciseText] = useState(lesson.exercises[0]?.text ?? lesson.reference_text ?? '')
  const [exerciseIpa, setExerciseIpa] = useState<string | null>(lesson.exercises[0]?.ipa ?? lesson.ipa)

  const [refId, setRefId] = useState<string | null>(null)
  const [refLoading, setRefLoading] = useState(false)
  const [refError, setRefError] = useState<string | null>(null)

  const [recordingId, setRecordingId] = useState<string | null>(null)

  const [phase, setPhase] = useState<AnalysisPhase>('idle')
  const [stage, setStage] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  const pollRef = useRef<number | null>(null)
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])
  useEffect(() => () => stopPolling(), [stopPolling])

  // --- synthesise the reference for the current exercise ------------------
  useEffect(() => {
    let cancelled = false
    setRefLoading(true); setRefError(null); setRefId(null)
    if (!exerciseText) return
    api.synthesize(exerciseText, lesson.variety ?? 'en_US', exerciseIpa ?? undefined)
      .then((ref) => { if (!cancelled) setRefId(ref.id) })
      .catch((e) => { if (!cancelled) setRefError(e.message || 'Could not generate reference audio') })
      .finally(() => { if (!cancelled) setRefLoading(false) })
    return () => { cancelled = true }
  }, [exerciseText, exerciseIpa, lesson.variety])

  const handleRecording = useCallback((id: string) => {
    setRecordingId(id)
    setPhase('idle'); setResult(null); setAnalysisError(null)
  }, [])

  // --- run the analysis and poll the job ----------------------------------
  const runAnalysis = useCallback(async () => {
    if (!recordingId || !exerciseText) return
    setPhase('queued'); setStage('starting…'); setResult(null); setAnalysisError(null)
    try {
      const { job_id } = await api.analyze({
        recording_id: recordingId,
        expected_text: exerciseText,
        ipa: exerciseIpa ?? undefined,
        language: 'en',
        variety: lesson.variety ?? 'en_US',
        lesson_id: lesson.id,
        exercise_id: `${lesson.id}-${exerciseText}`,
        target_phoneme: lesson.exercises.find((e) => e.text === exerciseText)?.target_phoneme ?? null,
        save_recording: true,
      })
      const tick = async () => {
        try {
          const s = await api.analyzeStatus(job_id)
          if (s.stage) setStage(s.stage)
          if (s.status === 'running') setPhase('running')
          if (s.status === 'done') {
            setResult(s.result!); setPhase('done'); stopPolling()
            // mark the lesson as having an attempt
            api.completeLesson(lesson.id).catch(() => { /* non-fatal */ })
          } else if (s.status === 'error') {
            setAnalysisError(s.error || 'Analysis failed'); setPhase('error'); stopPolling()
          }
        } catch (e: any) {
          setAnalysisError(e.message || 'Lost connection to the analysis job'); setPhase('error'); stopPolling()
        }
      }
      await tick()
      pollRef.current = window.setInterval(tick, 2500)
    } catch (e: any) {
      setAnalysisError(e.message || 'Could not start the analysis'); setPhase('error')
    }
  }, [recordingId, exerciseText, exerciseIpa, lesson, stopPolling])

  const busy = phase === 'queued' || phase === 'running'
  const userUrl = recordingId ? recordingUrl(recordingId) : null
  const refUrl = refId ? referenceUrl(refId) : null

  // The lesson "reference" the user should be imitating (its canonical text).
  const canonicalRef = lesson.reference_text

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-600">
            Level {lesson.level} · {lesson.level_name}
          </p>
          <h1 className="text-2xl font-bold text-ink-900">{lesson.title}</h1>
        </div>
        <button onClick={onLessonList}
          className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-100">
          ← All lessons
        </button>
      </div>

      {/* 1. objective */}
      <section className="rounded-lg border border-ink-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink-700">Learning objective</h2>
        <p className="text-sm text-ink-600">{lesson.objective}</p>
      </section>

      {/* 2. text + IPA + 3. articulation */}
      <section className="rounded-lg border border-ink-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-400">Say this</p>
            <p className="text-3xl font-bold text-ink-900">{exerciseText}</p>
            {exerciseIpa && (
              <p className="font-mono text-lg text-accent-700">/{exerciseIpa}/</p>
            )}
          </div>
          {lesson.variety && (
            <span className="rounded bg-ink-100 px-2 py-1 text-xs text-ink-600">
              variety: {lesson.variety}
            </span>
          )}
        </div>
        {lesson.articulation && (
          <div className="mt-3 rounded bg-accent-50 p-3 text-sm text-ink-700">
            <span className="font-semibold">How to say it: </span>{lesson.articulation}
          </div>
        )}
        {lesson.tips.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-500">
            {lesson.tips.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        )}
        {/* exercise picker */}
        {lesson.exercises.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {lesson.exercises.map((ex) => (
              <button key={ex.id}
                onClick={() => { setExerciseText(ex.text); setExerciseIpa(ex.ipa); setRecordingId(null); setResult(null); setPhase('idle') }}
                className={`rounded-full px-3 py-1 text-xs ${ex.text === exerciseText
                  ? 'bg-ink-900 text-white' : 'border border-ink-300 hover:bg-ink-100'}`}>
                {ex.text}{ex.ipa ? `  /${ex.ipa}/` : ''}
              </button>
            ))}
          </div>
        )}
        {lesson.examples.length > 0 && (
          <p className="mt-2 text-xs text-ink-400">Examples: {lesson.examples.join(' · ')}</p>
        )}
      </section>

      {/* 4. reference audio */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-700">Reference pronunciation</h2>
        {refLoading && <p className="text-sm text-ink-400">Generating reference audio (offline, Piper)…</p>}
        {refError && (
          <p className="rounded bg-bad-100 p-3 text-sm text-bad-700">
            {refError} — You can still record and compare against your own reference,
            or check the model status on the Home screen.
          </p>
        )}
        {refUrl && (
          <div className="rounded-lg border border-ink-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Reference · {lesson.variety ?? 'en_US'}
              </span>
              <span className="rounded bg-ink-100 px-2 py-0.5 text-[11px] text-ink-500">
                synthesised (Piper) — a clear model voice, not a native speaker
              </span>
            </div>
            <audio controls src={refUrl} className="w-full" />
            {canonicalRef && canonicalRef !== exerciseText && (
              <p className="mt-2 text-xs text-ink-400">
                Lesson model sentence: “{canonicalRef}”
              </p>
            )}
          </div>
        )}
      </section>

      {/* 5. record */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-700">Your turn</h2>
        <Recorder
          onRecording={handleRecording}
          onClear={() => { setRecordingId(null); setResult(null); setPhase('idle') }}
          disabled={busy}
        />
        {recordingId && (
          <button onClick={runAnalysis} disabled={busy}
            className="mt-3 w-full rounded-md bg-accent-600 px-4 py-3 text-sm font-bold text-white hover:bg-accent-700 disabled:opacity-60">
            {busy
              ? `Analysing… ${stage ?? 'please wait'}`
              : '🎯 Analyse my pronunciation'}
          </button>
        )}
        {busy && stage && (
          <p className="mt-2 text-center text-xs text-ink-400">
            {stage} — this runs fully on your computer and may take a minute on CPU.
          </p>
        )}
      </section>

      {/* 6. comparison */}
      {refUrl && userUrl && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-700">Compare</h2>
          <PronunciationComparator
            referenceUrl={refUrl}
            userUrl={userUrl}
            referenceLabel="Reference"
            userLabel="My pronunciation"
            refSpectrogram={{
              // The reference spectrogram is not computed in the (user) analysis
              // pass; it would require a separate analysis of the reference file.
              data: null,
              maxFreq: null,
              source: null,
            }}
            userSpectrogram={{
              // The analysis result's acoustics are measured on the USER recording.
              data: result?.acoustics?.spectrogram ?? null,
              maxFreq: result?.acoustics?.spectrogram_max_freq_hz ?? 8000,
              source: result?.acoustics?.spectrogram_source ?? null,
            }}
          />
        </section>
      )}

      {/* 7+8. results */}
      {analysisError && (
        <section className="rounded-lg border border-bad-500/40 bg-bad-100 p-4 text-sm text-bad-700">
          <p className="font-semibold">Analysis could not be completed</p>
          <p className="mt-1">{analysisError}</p>
          <p className="mt-2 text-xs">
            This may be a technical problem (model not loaded, very short or noisy
            recording) — it is <b>not</b> a judgement on your pronunciation. Try
            re-recording, or check the Home screen for model status.
          </p>
        </section>
      )}

      {phase === 'done' && result && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-ink-700">Result</h2>

          {/* score or honest unavailability */}
          {result.score != null ? (
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-ink-200 bg-white p-4">
              <ScoreGauge value={result.score} confidence={result.score_confidence} />
              <div className="min-w-[220px] flex-1 text-sm">
                <p className="font-semibold text-ink-800">
                  Score {result.score.toFixed(1)} / 100
                  <span className={`ml-2 rounded px-2 py-0.5 text-xs ${
                    result.score_confidence === 'ok' ? 'bg-good-100 text-good-700'
                      : result.score_confidence === 'low' ? 'bg-warn-100 text-warn-700'
                        : 'bg-ink-100 text-ink-500'}`}>
                    confidence: {result.score_confidence}
                  </span>
                </p>
                {result.score_explanation && (
                  <p className="mt-1 text-xs text-ink-500">{result.score_explanation}</p>
                )}
                {result.transcription && (
                  <p className="mt-2 text-xs text-ink-600">
                    The model heard: <span className="font-mono">{result.transcription}</span>
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-warn-500/40 bg-warn-100 p-4 text-sm text-warn-700">
              <p className="font-semibold">Could not be assessed with enough confidence</p>
              <p className="mt-1">
                {result.limitations[0] || 'The analysis did not produce a reliable score for this recording.'}
              </p>
              <p className="mt-1 text-xs">
                Common causes: the recording is too short, too quiet or noisy, or the
                sentence differed a lot from the reference. You are not penalised —
                re-record and try again.
              </p>
            </div>
          )}

          {/* per-word / per-phoneme detail */}
          {result.phonemes.length > 0 || result.words.length > 0 ? (
            <PhonemeTable words={result.words} phonemes={result.phonemes} />
          ) : (
            <div className="rounded-lg border border-good-500/30 bg-good-100 p-4 text-sm text-good-700">
              No phoneme-level problems were flagged — the recogniser heard the
              expected sounds. (That doesn't guarantee a native accent; see the
              advanced panel for details.)
            </div>
          )}

          {/* recommendations */}
          {result.recommendations.length > 0 && (
            <div className="rounded-lg border border-ink-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold text-ink-700">What to practise</h3>
              <ul className="space-y-2">
                {result.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink-600">
                    <span className="text-accent-600">▸</span><span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* advanced */}
          <AdvancedPanel result={result} />
        </section>
      )}

      {/* 10. continue */}
      <section className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 pt-4">
        <button
          onClick={() => onLessonList()}
          className="rounded-md border border-ink-300 px-4 py-2 text-sm hover:bg-ink-100">
          Back to lessons
        </button>
        <div className="flex gap-2">
          {recordingId && (
            <button onClick={() => setRecordingId(null)}
              className="rounded-md border border-ink-300 px-4 py-2 text-sm hover:bg-ink-100">
              New take
            </button>
          )}
          <button onClick={runAnalysis} disabled={!recordingId || busy}
            className="rounded-md bg-ink-900 px-5 py-2 text-sm font-semibold text-white hover:bg-ink-700 disabled:opacity-50">
            {busy ? 'Analysing…' : 'Repeat & re-analyse'}
          </button>
        </div>
      </section>
    </div>
  )
}
