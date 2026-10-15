"""Model-gated tests: real end-to-end pronunciation analysis.

These only run when torch + a wav2vec2 checkpoint are present (see
conftest.requires_models). They exercise the actual OpenPronounce + acoustic
pipeline and assert that the *contract* and *honesty rules* hold — e.g. that a
score, when present, is a real number and that low-quality audio yields an
honest 'unavailable' rather than a fabricated score.
"""
import pytest
from conftest import requires_models


def _save(client, path, name="tone.wav"):
    r = client.post("/api/audio/save", files={"file": (name, open(path, "rb"), "audio/wav")})
    assert r.status_code == 200
    return r.json()["recording_id"]


@requires_models
def test_analyze_sync_real_score(client, tone_wav):
    """A clean tone analysed against a short text returns a real result."""
    rid = _save(client, tone_wav)
    r = client.post("/api/pronunciation/analyze-sync", json={
        "recording_id": rid, "expected_text": "hello"})
    assert r.status_code == 200
    body = r.json()
    # contract fields
    for k in ["analysis_id", "score_confidence", "transcription", "phonemes",
              "acoustics", "confidence", "limitations", "recommendations",
              "model_name", "transcription_words", "transcription_ipa"]:
        assert k in body
    # a real score, if present, is a number in [0,100]
    if body["score"] is not None:
        assert 0.0 <= body["score"] <= 100.0
    # acoustics must be real when present
    if body["acoustics"] is not None:
        assert body["acoustics"]["duration_s"] is not None
        assert body["acoustics"]["sample_rate"] is not None
    # the per-word IPA of the heard transcription, when present, must be
    # aligned word-by-word (same length as transcription_words)
    if body["transcription_words"]:
        assert body["transcription_ipa"] is not None
        assert len(body["transcription_ipa"]) == len(body["transcription_words"])


@requires_models
def test_analyze_silent_honest_unavailable(client, silent_wav):
    """Silent input must NOT get a confident score (honesty rule)."""
    rid = _save(client, silent_wav, "silent.wav")
    r = client.post("/api/pronunciation/analyze-sync", json={
        "recording_id": rid, "expected_text": "hello"})
    assert r.status_code == 200
    body = r.json()
    # Either no score at all, or explicitly flagged as low/unavailable confidence.
    assert body["score"] is None or body["score_confidence"] in ("low", "unavailable")


@requires_models
def test_analyze_background_job_flow(client, tone_wav):
    """The async job flow: submit → poll → done, with a real result."""
    rid = _save(client, tone_wav)
    r = client.post("/api/pronunciation/analyze", json={
        "recording_id": rid, "expected_text": "hello", "save_recording": True})
    assert r.status_code == 200
    job = r.json()
    assert job["status"] in ("queued", "running")
    # poll to completion (CPU inference can take a while)
    import time
    for _ in range(120):
        time.sleep(1)
        s = client.get(f"/api/pronunciation/status/{job['job_id']}").json()
        if s["status"] in ("done", "error"):
            break
    assert s["status"] == "done"
    assert s["result"]["analysis_id"]
    # the saved recording should now be retrievable
    assert client.get(f"/api/recordings/{rid}").status_code == 200


@requires_models
def test_delete_recording(client, tone_wav):
    rid = _save(client, tone_wav)
    assert client.get(f"/api/recordings/{rid}").status_code == 200
    r = client.delete(f"/api/recordings/{rid}")
    assert r.status_code == 200
    assert client.get(f"/api/recordings/{rid}").status_code == 404


@requires_models
def test_reference_synthesis_and_fetch(client):
    r = client.post("/api/references/synthesize", json={"text": "think sink", "variety": "en_US"})
    assert r.status_code == 200
    ref = r.json()
    assert ref["id"] and ref["source"] == "piper"
    # the wav must be retrievable and non-empty
    wav = client.get(f"/api/references/{ref['id']}.wav")
    assert wav.status_code == 200
    assert len(wav.content) > 1000
