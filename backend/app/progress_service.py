"""progress_service: history, weak-phoneme tracking, adaptive recommendations.

Storage is plain JSON under data/progress so it is trivially inspectable,
back-up-able and deletable. We deliberately do NOT compare scores produced by
different model versions: the summary records the model version per analysis and
the score_history only mixes entries that share the same model_version.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .config import settings
from .schemas import AnalysisResult, ProgressSummary
from .lesson_service import adaptive_lesson

_HISTORY_FILE = None  # set lazily


def _history_file() -> Path:
    return settings.progress_dir / "history.json"


def _load_history() -> list[dict]:
    p = _history_file()
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text())
    except Exception:  # noqa: BLE001
        return []


def _save_history(entries: list[dict]) -> None:
    settings.progress_dir.mkdir(parents=True, exist_ok=True)
    _history_file().write_text(json.dumps(entries, ensure_ascii=False, indent=1))


def _record(
    *,
    lesson_id: str,
    exercise_id: str,
    expected_text: str,
    ipa: str | None,
    target_phoneme: str | None,
    result: AnalysisResult,
    recording_id: str | None,
    saved: bool = False,
) -> dict:
    """Append one analysis to the history. Returns the stored entry."""
    entries = _load_history()
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "lesson_id": lesson_id,
        "exercise_id": exercise_id,
        "expected_text": expected_text,
        "ipa": ipa,
        "target_phoneme": target_phoneme,
        "recording_id": recording_id,
        "saved": saved,
        "score": result.score,
        "score_confidence": result.score_confidence,
        "phoneme_error_rate": result.phoneme_error_rate,
        "word_error_rate": result.word_error_rate,
        "transcription": result.transcription,
        "model_version": result.model_version,
        "model_name": result.model_name,
        "confidence": result.confidence,
        # the phonemes that needed work in this attempt
        "weak_phonemes": [
            p.phoneme for p in result.phonemes
            if p.verdict.value in ("needs_practice", "substitution_likely", "omitted")
        ],
        "limitations": result.limitations,
    }
    entries.append(entry)
    # keep the store bounded (last 2000 attempts) so it never grows unbounded
    _save_history(entries[-2000:])
    return entry


def mark_lesson_completed(lesson_id: str) -> None:
    """Record a lesson as completed in a dedicated set (survives even when the
    lesson was completed without any analysis attempt being recorded)."""
    p = _completed_file()
    done: set[str] = set()
    if p.exists():
        try:
            done = set(json.loads(p.read_text()))
        except Exception:  # noqa: BLE001
            done = set()
    done.add(lesson_id)
    settings.progress_dir.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(sorted(done), ensure_ascii=False))


def _completed_file() -> Path:
    return settings.progress_dir / "completed_lessons.json"


def get_completed_lessons() -> list[str]:
    p = _completed_file()
    if not p.exists():
        return []
    try:
        return sorted(json.loads(p.read_text()))
    except Exception:  # noqa: BLE001
        return []


def get_summary() -> ProgressSummary:
    entries = _load_history()
    completed = get_completed_lessons()
    saved = sum(1 for e in entries if e.get("saved"))
    total = len(entries)

    # weak phonemes: frequency across the last 50 attempts, only counting
    # entries that were actually assessable (not unavailable)
    recent = [e for e in entries if e.get("confidence") in ("ok", "low")][-50:]
    freq: dict[str, int] = {}
    for e in recent:
        for ph in e.get("weak_phonemes", []):
            freq[ph] = freq.get(ph, 0) + 1
    weak = [ph for ph, c in sorted(freq.items(), key=lambda kv: -kv[1]) if c >= 2]

    # score history for the evolution chart — grouped by model version so we
    # never plot scores from different models as if comparable
    version = entries[-1].get("model_version") if entries else None
    score_history = [
        {"ts": e["ts"], "score": e["score"], "text": e["expected_text"]}
        for e in entries
        if e.get("score") is not None and e.get("model_version") == version
    ][-60:]

    # current level: highest level with at least one completed lesson, else 1
    from .lesson_service import get_lesson
    max_level = 1
    for lid in completed:
        l = get_lesson(lid)
        if l and l.level >= max_level:
            max_level = l.level

    # streak: consecutive days with at least one attempt (last 30 days)
    days = {e["ts"][:10] for e in entries if e.get("ts")}
    streak = 0
    d = datetime.now(timezone.utc).date()
    if days and d.isoformat() not in days:
        d = d.replace(day=d.day - 1) if d.day > 1 else d
    for _ in range(30):
        if d.isoformat() in days:
            streak += 1
            d = d.replace(day=d.day - 1) if d.day > 1 else d.replace(day=1, month=max(1, d.month - 1))
        else:
            break

    last = entries[-1]["ts"] if entries else None
    return ProgressSummary(
        lessons_completed=completed,
        total_attempts=total,
        saved_recordings=saved,
        current_level=max_level,
        phonemes_to_practise=weak,
        recommended_exercises=[f"l6-{ph}" for ph in weak[:3]],
        streak_days=streak if streak else None,
        last_activity=last,
        weekly_goal={
            "target_attempts": 30,
            "attempts_last_7d": _attempts_last_n_days(entries, 7),
        },
        score_history=score_history,
    )


def _attempts_last_n_days(entries: list[dict], n: int) -> int:
    if not entries:
        return 0
    cutoff = (datetime.now(timezone.utc).timestamp() - n * 86400)
    from datetime import datetime as _dt
    count = 0
    for e in entries:
        try:
            ts = _dt.fromisoformat(e["ts"]).timestamp()
            if ts >= cutoff:
                count += 1
        except Exception:  # noqa: BLE001
            continue
    return count


def get_adaptive_lesson() -> dict | None:
    """The personalised level-6 lesson based on current weak phonemes."""
    summary = get_summary()
    lesson = adaptive_lesson(summary.phonemes_to_practise)
    if lesson is None:
        return None
    return lesson.model_dump()


def delete_all_history() -> int:
    entries = _load_history()
    n = len(entries)
    _save_history([])
    cf = _completed_file()
    if cf.exists():
        cf.unlink()
    return n


def clear_saved_flag(recording_id: str) -> None:
    entries = _load_history()
    for e in entries:
        if e.get("recording_id") == recording_id:
            e["saved"] = False
    _save_history(entries)
