import { useEffect, useState } from 'react'
import { Lesson, LevelInfo, ProgressSummary, api } from '../api'

interface Props {
  onOpen: (lesson: Lesson) => void
  onProgress: () => void
  onHome: () => void
}

/**
 * Lesson browser: grouped by level, with completion status from the progress
 * service. The level-6 adaptive lesson is shown at the top when the learner has
 * weak phonemes to work on.
 */
export default function LessonList({ onOpen, onProgress, onHome }: Props) {
  const [levels, setLevels] = useState<LevelInfo[] | null>(null)
  const [lessons, setLessons] = useState<Lesson[] | null>(null)
  const [progress, setProgress] = useState<ProgressSummary | null>(null)
  const [adaptive, setAdaptive] = useState<{ available: boolean; lesson?: Lesson; message?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.levels(), api.lessons(), api.progress(), api.adaptiveLesson()])
      .then(([lv, ls, pg, ad]) => {
        setLevels(lv); setLessons(ls); setProgress(pg); setAdaptive(ad)
      })
      .catch((e) => setError(e.message))
  }, [])

  if (error) {
    return <div className="rounded-lg border border-bad-500/40 bg-bad-100 p-4 text-sm text-bad-700">
      Could not load lessons: {error}. Is the backend running?
    </div>
  }
  if (!lessons || !levels || !progress) {
    return <p className="text-sm text-ink-400">Loading lessons…</p>
  }

  const completed = new Set(progress.lessons_completed)
  const total = lessons.length
  const done = lessons.filter((l) => completed.has(l.id)).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Lessons</h1>
          <p className="text-sm text-ink-500">{done} of {total} completed · current level {progress.current_level}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onHome} className="rounded-md border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-100">Home</button>
          <button onClick={onProgress} className="rounded-md bg-ink-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-ink-700">My progress</button>
        </div>
      </div>

      {/* overall progress bar */}
      <div className="h-2 overflow-hidden rounded-full bg-ink-200">
        <div className="h-full bg-accent-500 transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>

      {/* adaptive lesson card */}
      {adaptive?.available && adaptive.lesson && (
        <button onClick={() => onOpen(adaptive.lesson!)}
          className="w-full rounded-lg border-2 border-dashed border-accent-400 bg-accent-50 p-4 text-left hover:bg-accent-100/50">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-600">Level 6 · Adaptive</p>
          <p className="text-lg font-bold text-ink-900">{adaptive.lesson.title}</p>
          <p className="mt-1 text-sm text-ink-600">{adaptive.lesson.objective}</p>
          <p className="mt-2 text-sm font-semibold text-accent-700">Start personalised practice →</p>
        </button>
      )}
      {adaptive && !adaptive.available && (
        <p className="rounded-lg bg-ink-100 p-3 text-sm text-ink-500">{adaptive.message}</p>
      )}

      {/* levels */}
      {levels.map((lv) => (
        <section key={lv.level}>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-500">
            Level {lv.level} · {lv.name}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {lessons.filter((l) => l.level === lv.level).map((l) => {
              const isDone = completed.has(l.id)
              return (
                <button key={l.id} onClick={() => onOpen(l)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 bg-white p-3 text-left hover:border-accent-400 hover:shadow-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink-800">{l.title}</p>
                    <p className="truncate text-xs text-ink-400">{l.ipa ? `/${l.ipa}/` : l.objective.slice(0, 60)}…</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    isDone ? 'bg-good-100 text-good-700' : 'bg-ink-100 text-ink-500'}`}>
                    {isDone ? '✓ done' : l.exercises.length + ' ex.'}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
