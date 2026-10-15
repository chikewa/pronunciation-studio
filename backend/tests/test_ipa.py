"""Unit tests for the transcription→IPA helpers used by the
"The model heard" panel.

These need espeak-ng + phonemizer (both are hard dependencies of the image:
the Dockerfile installs espeak-ng and requirements.lock pins phonemizer), but
NOT torch/the wav2vec2 checkpoints — so they are NOT model-gated. They skip
cleanly on machines without espeak-ng.
"""
import shutil

import pytest

from app.pronunciation_evaluator import text_to_ipa, transcription_with_ipa

needs_espeak = pytest.mark.skipif(not shutil.which("espeak-ng"), reason="espeak-ng not installed")


@needs_espeak
def test_single_word_real_ipa():
    words, ipas = transcription_with_ipa("cat")
    assert words == ["cat"]
    assert len(ipas) == 1
    assert ipas[0] is not None
    # 'cat' must contain the flat-a vowel and a stop; espeak-en gives k æ t
    assert "æ" in ipas[0] and "k" in ipas[0] and "t" in ipas[0]


@needs_espeak
def test_multiple_words_aligned():
    words, ipas = transcription_with_ipa("cat dog")
    assert words == ["cat", "dog"]
    assert len(ipas) == 2
    assert all(ipa is not None for ipa in ipas)
    # the two words must be phonemised DIFFERENTLY (real, not copied output)
    assert ipas[0] != ipas[1]
    assert "æ" in ipas[0]
    assert "ɔ" in ipas[1] or "ɑ" in ipas[1] or "ʊ" in ipas[1]


@needs_espeak
def test_letter_tokens_get_letter_name_ipa():
    """The user's case: 'The model heard: C C' → each recognised letter token
    must carry the IPA of the sound detected (the letter's spoken name in
    espeak's dictionary)."""
    words, ipas = transcription_with_ipa("c c")
    assert words == ["c", "c"]
    assert len(ipas) == 2
    # 'c' is spoken as 'cee' → iː must be present
    assert all(ipa is not None and "iː" in ipa for ipa in ipas)


@needs_espeak
def test_text_to_ipa_joins_slashes():
    ipa = text_to_ipa("hello world")
    assert ipa is not None
    # one slashed group per word, separated by spaces
    groups = ipa.split(" /")
    assert len(groups) == 2
    assert ipa.startswith("/") and ipa.endswith("/")
    assert "h" in ipa  # hello starts with h


@needs_espeak
def test_empty_and_gibberish_never_raise():
    assert text_to_ipa("") is None
    assert text_to_ipa("   ") is None
    assert text_to_ipa("!!! ???") is None
    words, ipas = transcription_with_ipa("")
    assert words == [] and ipas == []
    # gibberish: must not raise; either None entries or (rare) a real name
    w2, i2 = transcription_with_ipa("zzqq xx")
    assert len(w2) == len(i2) == 2


def test_schema_fields_exist():
    """The analysis contract carries the new per-word IPA fields (nullable)."""
    from app.schemas import AnalysisResult
    r = AnalysisResult(analysis_id="x", expected_text="hi")
    assert r.transcription_words is None
    assert r.transcription_ipa is None
    r2 = AnalysisResult(analysis_id="x", expected_text="hi",
                        transcription="hi",
                        transcription_words=["hi"],
                        transcription_ipa=["h aɪ"])
    assert r2.transcription_words == ["hi"]
    assert r2.transcription_ipa == ["h aɪ"]
