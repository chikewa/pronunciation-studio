import { PhonemeEval, PhonemeVerdict, WordEval } from '../api'

// How each honest verdict state is presented. We never present a sound as
// definitively "wrong" unless the verdict actually supports that.
const VERDICT_META: Record<PhonemeVerdict, { label: string; cls: string; dot: string }> = {
  probably_correct: { label: 'probably correct', cls: 'bg-good-100 text-good-700', dot: 'bg-good-500' },
  needs_practice: { label: 'needs practice', cls: 'bg-warn-100 text-warn-700', dot: 'bg-warn-500' },
  substitution_likely: { label: 'substitution likely', cls: 'bg-bad-100 text-bad-700', dot: 'bg-bad-500' },
  omitted: { label: 'possibly omitted', cls: 'bg-bad-100 text-bad-700', dot: 'bg-bad-500' },
  difficult_to_assess: { label: 'hard to assess', cls: 'bg-ink-100 text-ink-500', dot: 'bg-ink-300' },
  not_available: { label: 'not assessed', cls: 'bg-ink-100 text-ink-400', dot: 'bg-ink-200' },
}

function PhonemeChip({ p }: { p: PhonemeEval }) {
  const meta = VERDICT_META[p.verdict]
  return (
    <div className="flex flex-col gap-1 rounded-md border border-ink-100 bg-ink-50 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-base text-ink-800">/{p.phoneme}/</span>
        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
          <i className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </div>
      {p.heard && p.heard !== p.phoneme && (
        <p className="text-[11px] text-ink-500">
          heard <span className="font-mono">/{p.heard}/</span>
          {p.confidence != null && <> · {Math.round(p.confidence * 100)}%</>}
        </p>
      )}
      {p.note && <p className="text-[11px] leading-snug text-ink-400">{p.note}</p>}
    </div>
  )
}

/**
 * Shows the per-word and per-phoneme evaluations. Only rendered when there is
 * actual phoneme-level evidence; each item carries its honest verdict state.
 */
export default function PhonemeTable({ words, phonemes }: { words: WordEval[]; phonemes: PhonemeEval[] }) {
  const flaggedWords = words.filter((w) => w.verdict !== 'probably_correct' && w.verdict !== 'not_available')

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-ink-700">
        Sound-by-sound
        <span className="ml-2 text-xs font-normal text-ink-400">
          {phonemes.length} sound(s) examined
        </span>
      </h3>

      {phonemes.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {phonemes.map((p, i) => <PhonemeChip key={i} p={p} />)}
        </div>
      )}

      {flaggedWords.length > 0 && (
        <div className="rounded-lg border border-ink-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-ink-500">Words to re-listen to</p>
          <ul className="space-y-1.5">
            {flaggedWords.map((w, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-ink-800">{w.word}</span>
                {w.ipa && <span className="font-mono text-xs text-ink-500">/{w.ipa}/</span>}
                {w.heard && (
                  <span className="text-xs text-ink-500">
                    → heard <span className="font-mono text-bad-700">{w.heard}</span>
                  </span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${VERDICT_META[w.verdict].cls}`}>
                  {VERDICT_META[w.verdict].label}
                </span>
                {w.note && <span className="w-full text-[11px] text-ink-400 sm:w-auto">{w.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
