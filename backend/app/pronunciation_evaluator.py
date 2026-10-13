"""pronunciation_evaluator: turns OpenPronounce's real output into an honest,
pedagogically-structured result.

Rules enforced here (these are the "do not fabricate" guarantees):
  * a score is reported only when the calibrated scorer actually ran;
  * each phoneme gets a *verdict* from a fixed set of states — we never call a
    sound "wrong" when the recognizer confidence is low;
  * low / missing input quality downgrades confidence to ``low`` or
    ``unavailable`` and is explained in ``limitations``;
  * recommendations are generated from the *specific* phonemes that were
    actually flagged, not from a generic template.
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Any

from .audio_service import validate_audio, working_copy, _find_recording
from .acoustic_analysis import extract_features
from .config import settings
from .model_manager import warmup, _op_version
from .schemas import (
    AnalysisResult, AcousticFeatures, AudioMeta, Confidence, PhonemeEval,
    PhonemeVerdict, WordEval,
)
from . import audio_service

# --------------------------------------------------------------------------- #
# Pedagogical knowledge: how to explain each common English phoneme.
# This is static, expert-authored content (not a model output) and is only
# *attached* when the analysis actually flags that phoneme.
# --------------------------------------------------------------------------- #
PHONEME_ADVICE: dict[str, dict[str, str]] = {
    "θ": {
        "name": "voiceless 'th' (think)",
        "tip": "Put the tip of the tongue lightly between the teeth and blow air. "
               "The vocal cords do not vibrate. It is NOT /s/ and NOT /t/.",
        "drill": "Alternate 'think / sink' and 'three / tree'.",
    },
    "ð": {
        "name": "voiced 'th' (this)",
        "tip": "Same tongue position as /θ/ but let the vocal cords vibrate. "
               "You should feel a buzz. It is NOT /z/ and NOT /d/.",
        "drill": "Alternate 'this / zis' and 'they / day'.",
    },
    "ɪ": {
        "name": "short 'i' (ship)",
        "tip": "Lax and central — shorter and more relaxed than /iː/. Mouth half-open, "
               "tongue mid. Don't over-aim it.",
        "drill": "Minimal pair 'ship / sheep' — the difference is length + tenseness.",
    },
    "iː": {
        "name": "long 'ee' (sheep)",
        "tip": "Tense and long. Smile slightly, tongue high and forward. Hold it a beat "
               "longer than /ɪ/.",
        "drill": "Minimal pair 'sheep / ship', 'see / sit'.",
    },
    "ʊ": {
        "name": "short 'oo' (book)",
        "tip": "Lax and central, shorter than /uː/. Less lip rounding than /uː/.",
        "drill": "Minimal pair 'book / boot'.",
    },
    "uː": {
        "name": "long 'oo' (boot)",
        "tip": "Tense and long, lips rounded and pushed forward. Hold it longer than /ʊ/.",
        "drill": "Minimal pair 'boot / book'.",
    },
    "æ": {
        "name": "flat 'a' (cat)",
        "tip": "Mouth open wide and low, tongue low-front. It is NOT the Spanish /a/ "
               "and NOT /ʌ/.",
        "drill": "Minimal pair 'cat / cut'.",
    },
    "ʌ": {
        "name": "short 'u' (cup)",
        "tip": "Central and short, tongue mid. Less jaw drop than /æ/. NOT a long 'oo'.",
        "drill": "Minimal pair 'cup / cap' and 'full / fall'.",
    },
    "ɑː": {
        "name": "open 'a' (father)",
        "tip": "Jaw dropped low, tongue back and low, open mouth. It is a long vowel.",
        "drill": "Compare 'father / butter'.",
    },
    "ɒ": {
        "name": "short 'o' (hot)",
        "tip": "Rounded, mid-low, short. NOT a long 'o'.",
        "drill": "Minimal pair 'hot / hope'.",
    },
    "ɔː": {
        "name": "long 'o' (hope)",
        "tip": "Rounded and long. Lips form an 'o'. Hold it longer than /ɒ/.",
        "drill": "Minimal pair 'hope / hot'.",
    },
    "ə": {
        "name": "schwa (the)",
        "tip": "The laziest vowel — short, central, unstressed. Never fully open the "
               "mouth for it. It appears in most unstressed syllables.",
        "drill": "Say 'photograph / photographer / photography' — notice the schwa shift.",
    },
    "ɜː": {
        "name": "long 'er' (bird)",
        "tip": "Central, long. Tongue mid, mouth relaxed. Often followed by /r/ in RP.",
        "drill": "Compare 'bird / but'.",
    },
    "ʃ": {
        "name": "sh (she)",
        "tip": "Lips slightly rounded and pushed forward, tongue raised mid. "
               "It is NOT /tʃ/ (which is 'ch').",
        "drill": "Minimal pair 'she / che'.",
    },
    "tʃ": {
        "name": "ch (cheese)",
        "tip": "Start like /t/, then move into /ʃ/. Tongue touches the alveolar ridge "
               "then releases into a 'sh'. It is NOT /ʃ/ alone.",
        "drill": "Minimal pair 'cheese / sees'.",
    },
    "v": {
        "name": "v (very)",
        "tip": "Upper teeth on the lower lip, air flowing, vocal cords vibrating. "
               "It is NOT /b/ (where both lips close).",
        "drill": "Minimal pair 'very / berry'.",
    },
    "b": {
        "name": "b (boy)",
        "tip": "Close both lips, build a little pressure, then release with vocal "
               "vibration. No air escape like /v/.",
        "drill": "Minimal pair 'boy / voy'.",
    },
    "r": {
        "name": "English 'r' (red)",
        "tip": "Tongue curls back but does NOT touch the roof of the mouth (no trill, "
               "no tap). It is an approximant, not a consonant closure.",
        "drill": "Say 'red / dad / lad' — the r is the only one where the tongue never lands.",
    },
    "ɹ": {
        "name": "English 'r' (red)",
        "tip": "Tongue curls back but does NOT touch the roof of the mouth (no trill, "
               "no tap). It is an approximant, not a consonant closure.",
        "drill": "Say 'red / dad / lad' — the r is the only one where the tongue never lands.",
    },
    "w": {
        "name": "w (wet)",
        "tip": "Round the lips tightly, then glide into the vowel. It is NOT /v/.",
        "drill": "Minimal pair 'wet / vet'.",
    },
    "h": {
        "name": "h (hat)",
        "tip": "A gentle breath — vocal cords still. Some accents drop it in function "
               "words; in careful speech keep it.",
        "drill": "Say 'hat / at' clearly.",
    },
    "l": {
        "name": "l (light)",
        "tip": "Tongue tip touches the alveolar ridge. 'Clear l' at the start, 'dark l' "
               "at the end of a word (tongue further back).",
        "drill": "Compare 'light / right' and 'feel / fill'.",
    },
    "n": {
        "name": "n (no)",
        "tip": "Tongue tip to the alveolar ridge, air through the nose. "
               "It is NOT the French 'gn' and NOT /ɲ/.",
        "drill": "Minimal pair 'no / yo' (as in 'yell').",
    },
}


def _verdict_from_error(phone: dict, confidence: float) -> tuple[PhonemeVerdict, str | None]:
    """Map one OpenPronounce per-phoneme error entry to a verdict + reason.

    We are conservative: a substitution is only *likely* if the recognizer's
    confidence is high; otherwise it is 'needs_practice' or 'uncertain'.
    """
    heard = phone.get("heard")
    expected = phone.get("expected")
    conf = float(confidence or 0.0)

    if heard is None:
        # sound expected but not clearly heard
        if conf >= 0.6:
            return PhonemeVerdict.OMITTED, "expected sound not clearly present in the audio"
        return PhonemeVerdict.UNCERTAIN, "sound may be missing, but confidence is low"

    if heard == expected:
        return PhonemeVerdict.CORRECT, "expected sound detected"

    # it's a substitution of some kind
    if conf >= 0.6:
        return PhonemeVerdict.SUBSTITUTED, f"expected {expected}, heard {heard} (confidence {conf:.0%})"
    if conf >= 0.35:
        return PhonemeVerdict.PRACTICE, f"expected {expected}, heard something close ({heard}) — confidence {conf:.0%}"
    return PhonemeVerdict.UNCERTAIN, f"possible confusion between {expected} and {heard} (low confidence {conf:.0%})"


def _input_quality_confidence(meta: AudioMeta) -> tuple[Confidence, list[str]]:
    """Downgrade overall confidence based on measurable input problems."""
    problems: list[str] = []
    if meta.too_short:
        problems.append("recording is too short for reliable phoneme-level analysis")
        return Confidence.UNAVAILABLE, problems
    if meta.silent:
        problems.append("recording is essentially silent — nothing to analyse")
        return Confidence.UNAVAILABLE, problems
    conf = Confidence.OK
    if meta.clipped:
        problems.append("recording is clipping — peaks are cut off, which can distort "
                        "the analysis of high-energy sounds")
        conf = Confidence.LOW
    if (meta.rms or 1.0) < settings.low_rms_warn:
        problems.append("recording is very quiet — the recogniser may miss low-energy sounds")
        conf = Confidence.LOW
    if any("quiet" in w or "loud" in w for w in meta.warnings):
        conf = Confidence.LOW if conf == Confidence.OK else conf
    return conf, problems


def _recommendations(phonemes: list[PhonemeEval], words: list[WordEval]) -> list[str]:
    """Build actionable, specific recommendations from the flagged phonemes only."""
    recs: list[str] = []
    seen: set[str] = set()
    for p in phonemes:
        if p.verdict in (PhonemeVerdict.CORRECT, PhonemeVerdict.UNAVAILABLE, PhonemeVerdict.UNCERTAIN):
            continue
        key = p.phoneme
        if key in seen:
            continue
        seen.add(key)
        advice = PHONEME_ADVICE.get(key)
        if advice:
            recs.append(f"Practise /{key}/ ({advice['name']}): {advice['tip']} Drill: {advice['drill']}")
        else:
            heard = f", heard /{p.heard}/" if p.heard else ""
            recs.append(f"Practise /{key}/{heard} — listen to the reference and "
                        f"repeat it slowly, focusing on this single sound.")
        if len(recs) >= 4:
            break
    # word-level: if a whole word was misrecognised, point it out
    for w in words:
        if w.verdict in (PhonemeVerdict.OMITTED, PhonemeVerdict.SUBSTITUTED) and w.heard:
            recs.append(f"The word '{w.word}' was heard as '{w.heard}' — re-record it "
                        f"clearly and check each sound.")
    if not recs:
        recs.append("No specific phoneme problems detected at the phoneme level. "
                    "Keep practising the target contrast at a natural pace.")
    return recs


def analyze(
    audio_path,
    expected_text: str,
    *,
    ipa: str | None = None,
    language: str = "en",
    variety: str | None = None,
) -> AnalysisResult:
    """Run the full, real analysis pipeline and return an honest AnalysisResult.

    Never raises on a *bad recording* — it returns a result with confidence
    ``unavailable`` and a clear explanation. Raises only on programmer errors.
    """
    import openpronounce
    from openpronounce import compare_audio_with_text, load_audio

    analysis_id = uuid.uuid4().hex[:16]
    t0 = time.perf_counter()
    limitations: list[str] = []
    recommendations: list[str] = []
    confidence = Confidence.OK

    result = AnalysisResult(
        analysis_id=analysis_id,
        expected_text=expected_text,
        expected_ipa=ipa,
        language=language,
        variety=variety,
        model_version=_op_version(),
        model_name="OpenPronounce (wav2vec2 word+phoneme, DTW acoustic term)",
        device=settings.device,
        created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )

    # --- 1) validate the recording (real, before any inference) ----------- #
    meta = validate_audio(audio_path)
    result.audio_meta = meta
    q_conf, q_problems = _input_quality_confidence(meta)
    confidence = _worst_confidence(confidence, q_conf)
    limitations.extend(q_problems)

    if not meta.ok:
        result.confidence = Confidence.UNAVAILABLE
        result.limitations.append(
            "The recording could not be analysed: " + (meta.error or "; ".join(meta.warnings))
        )
        result.recommendations = [
            "Re-record in a quiet room, at a comfortable volume, and make sure you "
            "pause a beat before and after the sentence."
        ]
        result.duration_ms = int((time.perf_counter() - t0) * 1000)
        return result

    # --- 2) load models once, then run the real scorer -------------------- #
    try:
        warmup()
    except Exception as e:  # noqa: BLE001
        limitations.append(f"model warm-up failed: {e}")

    # normalise to the 16 kHz working copy (original untouched)
    work = working_copy_from_path(audio_path)
    if work is None:
        result.confidence = Confidence.UNAVAILABLE
        result.limitations.append("could not create a 16 kHz working copy of the recording")
        result.duration_ms = int((time.perf_counter() - t0) * 1000)
        return result

    try:
        wav = load_audio(str(work))
    except Exception as e:  # noqa: BLE001
        result.confidence = Confidence.UNAVAILABLE
        result.limitations.append(f"could not decode the recording: {e}")
        result.duration_ms = int((time.perf_counter() - t0) * 1000)
        return result

    # --- 3) the real OpenPronounce comparison ---------------------------- #
    try:
        raw = compare_audio_with_text(wav, expected_text, lang=language)
    except Exception as e:  # noqa: BLE001
        result.confidence = Confidence.UNAVAILABLE
        result.limitations.append(
            f"the pronunciation model failed on this recording: {e}. "
            "This can happen with very short, very noisy, or heavily accented audio."
        )
        # still return the measured acoustics (those worked or are independent)
        result.acoustics = extract_features(wav, 16000)
        result.duration_ms = int((time.perf_counter() - t0) * 1000)
        return result

    # --- 4) map the real output into the honest schema -------------------- #
    score = raw.get("score")
    if isinstance(score, (int, float)):
        result.score = round(float(score), 1)
        result.score_confidence = confidence if confidence != Confidence.UNAVAILABLE else Confidence.LOW
        result.score_explanation = (
            "OpenPronounce calibrated score (0-100): 0.4×(1−phoneme error rate) + "
            "0.3×(1−word error rate) + 0.3×acoustic similarity. Higher = closer to a "
            "native reading of this exact sentence. Calibrated on expert-rated speech, "
            "not a probability of correctness."
        )
    result.acoustic_distance = raw.get("acoustic_distance")
    diff = raw.get("differences", {}) or {}
    result.phoneme_error_rate = diff.get("phoneme_error_rate")
    result.word_error_rate = diff.get("word_error_rate")
    result.transcription = raw.get("transcribe")
    if result.transcription:
        result.transcription_confidence = confidence if confidence != Confidence.UNAVAILABLE else Confidence.LOW

    # OpenPronounce may return these as a flat list or as a per-word list of
    # lists. Normalise to a flat list[str] to keep the schema stable.
    def _flat(x):
        out: list[str] = []
        if not isinstance(x, list):
            return out
        for item in x:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, (list, tuple)):
                out.extend(str(p) for p in item)
        return out or None

    result.expected_phones = _flat(diff.get("expected_phones"))
    heard_phones = diff.get("heard_phones")
    heard_conf = diff.get("heard_phones_confidence")
    result.heard_phones = _flat(heard_phones)

    # --- 5) per-word and per-phoneme verdicts (only where there is evidence)
    word_reports = diff.get("errors", []) or []
    for wr in word_reports:
        word = WordEval(
            word=wr.get("word", ""),
            ipa=wr.get("expected"),
            heard=wr.get("actual"),
            confidence=wr.get("confidence"),
        )
        phones: list[PhonemeEval] = []
        for ph in wr.get("phones", []) or []:
            verdict, note = _verdict_from_error(ph, wr.get("confidence", 0.5))
            phones.append(PhonemeEval(
                phoneme=ph.get("expected", ""),
                phoneme_ipa=ph.get("expected", ""),
                verdict=verdict,
                confidence=ph.get("confidence") if ph.get("confidence") is not None else wr.get("confidence"),
                heard=ph.get("heard"),
                word=wr.get("word"),
                note=note,
            ))
        # derive the word verdict from its worst phoneme
        worst = _worst_phoneme_verdict(phones)
        word.verdict = worst
        word.note = (
            f"{len(phones)} sound(s) in this word were flagged"
            if phones else "no per-sound detail available for this word"
        )
        result.words.append(word)
        result.phonemes.extend(phones)

    # --- 6) measured acoustics (always real, independent of the model) ---- #
    try:
        result.acoustics = extract_features(wav, 16000)
    except Exception as e:  # noqa: BLE001
        limitations.append(f"acoustic feature extraction failed: {e}")

    # --- 7) recommendations from the *actual* flagged sounds -------------- #
    result.recommendations = _recommendations(result.phonemes, result.words)

    # --- 8) final confidence + limitations -------------------------------- #
    if result.phoneme_error_rate is not None and result.phoneme_error_rate > 0.5:
        limitations.append(
            "the phoneme error rate is high, which can mean the sentence was "
            "substantially different from the reference (a different reading, an "
            "accent difference, or a real mispronunciation) — interpret the score "
            "together with the per-phoneme detail, not the number alone."
        )
    if not word_reports:
        limitations.append(
            "no phoneme-level errors were flagged. This means the recogniser heard "
            "the expected sounds; it does not guarantee a 'native' accent, and short "
            "words can occasionally be missed by the recogniser itself."
        )
    result.confidence = confidence
    result.limitations = limitations
    result.duration_ms = int((time.perf_counter() - t0) * 1000)
    return result


def _worst_confidence(a: Confidence, b: Confidence) -> Confidence:
    order = {Confidence.OK: 0, Confidence.LOW: 1, Confidence.UNAVAILABLE: 2}
    return a if order[a] >= order[b] else b


def _worst_phoneme_verdict(phones: list[PhonemeEval]) -> PhonemeVerdict:
    if not phones:
        return PhonemeVerdict.UNAVAILABLE
    order = [
        PhonemeVerdict.SUBSTITUTED, PhonemeVerdict.OMITTED, PhonemeVerdict.PRACTICE,
        PhonemeVerdict.UNCERTAIN, PhonemeVerdict.CORRECT, PhonemeVerdict.UNAVAILABLE,
    ]
    present = {p.verdict for p in phones}
    for v in order:
        if v in present and v is not PhonemeVerdict.CORRECT:
            return v
    return PhonemeVerdict.CORRECT


def working_copy_from_path(path) -> Any | None:
    """16 kHz mono working copy for an arbitrary path (not just a saved id)."""
    import soundfile as sf
    from .audio_service import decode
    try:
        wav, _ = decode(path)
        import tempfile, os
        fd, tmp = tempfile.mkstemp(suffix=".wav", prefix="pronwork-")
        os.close(fd)
        sf.write(tmp, wav, 16000, subtype="PCM_16")
        return tmp
    except Exception:  # noqa: BLE001
        return None
