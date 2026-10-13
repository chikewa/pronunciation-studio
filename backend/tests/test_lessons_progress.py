"""Lesson + progress + API-contract tests (no AI models required)."""
import json
import pytest


# ---- lessons ---------------------------------------------------------------

def test_lessons_list_shape(client):
    r = client.get("/api/lessons")
    assert r.status_code == 200
    lessons = r.json()
    assert len(lessons) >= 10
    for l in lessons:
        assert set(["id", "level", "title", "objective", "exercises", "ipa"]).issubset(l)
        assert l["level"] in (1, 2, 3, 4, 5)
        assert isinstance(l["exercises"], list) and l["exercises"]


def test_lesson_detail_404(client):
    r = client.get("/api/lessons/does-not-exist")
    assert r.status_code == 404


def test_lesson_detail_ok(client):
    first = client.get("/api/lessons").json()[0]
    r = client.get(f"/api/lessons/{first['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == first["id"]


def test_levels_listing(client):
    r = client.get("/api/levels")
    assert r.status_code == 200
    levels = r.json()
    assert {lv["level"] for lv in levels} == {1, 2, 3, 4, 5}


def test_lesson_complete_marks_progress(client):
    first = client.get("/api/lessons").json()[0]
    r = client.post(f"/api/lessons/{first['id']}/complete")
    assert r.status_code == 200
    prog = client.get("/api/progress").json()
    assert first["id"] in prog["lessons_completed"]


def test_exercises_have_instructions(client):
    lessons = client.get("/api/lessons").json()
    # every produce exercise must carry a non-empty instruction
    for l in lessons:
        for ex in l["exercises"]:
            if ex["type"] == "produce":
                assert ex["instruction"].strip()


def test_ipa_present_for_sound_lessons(client):
    # level 2 (vowels) and 3 (consonants) must carry IPA
    for lv in (2, 3):
        ls = client.get(f"/api/lessons?level={lv}").json()
        assert ls, f"no level-{lv} lessons"
        assert all(l["ipa"] for l in ls)


# ---- progress --------------------------------------------------------------

def test_progress_shape(client):
    r = client.get("/api/progress")
    assert r.status_code == 200
    p = r.json()
    for k in ["lessons_completed", "total_attempts", "saved_recordings",
              "phonemes_to_practise", "score_history", "weekly_goal"]:
        assert k in p


def test_adaptive_unavailable_without_history(client):
    r = client.get("/api/progress/adaptive")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False
    assert body.get("message")


def test_clear_progress(client):
    client.post(f"/api/lessons/{client.get('/api/lessons').json()[0]['id']}/complete")
    r = client.delete("/api/progress")
    assert r.status_code == 200
    assert client.get("/api/progress").json()["lessons_completed"] == []


# ---- API contract / health -------------------------------------------------

def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    h = r.json()
    assert h["status"] == "ok"
    assert isinstance(h["models"], list)
    assert h["data_dir"]


def test_models_listing(client):
    r = client.get("/api/models")
    assert r.status_code == 200
    models = r.json()
    names = {m["name"] for m in models}
    # the two wav2vec2 checkpoints + piper should always be reported
    assert any("wav2vec2" in n or "w2v" in n.lower() for n in names)


def test_analysis_result_schema_fields(client):
    """A (model-gated) analysis result must expose every contract field.

    We assert on the schema definition rather than a live run so the contract
    is checked even when torch is unavailable.
    """
    from app.schemas import AnalysisResult
    fields = set(AnalysisResult.model_fields.keys())
    required = {
        "analysis_id", "expected_text", "score", "score_confidence",
        "transcription", "phonemes", "words", "acoustics", "confidence",
        "limitations", "recommendations", "model_version", "model_name",
    }
    assert required.issubset(fields)


def test_404_recording(client):
    r = client.get("/api/recordings/nope")
    assert r.status_code == 404


def test_analyze_missing_recording(client):
    r = client.post("/api/pronunciation/analyze", json={
        "recording_id": "nope", "expected_text": "hello"})
    assert r.status_code == 404


def test_response_is_valid_json(client):
    r = client.get("/api/health")
    json.loads(r.text)  # must parse
