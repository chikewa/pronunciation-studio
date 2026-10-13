"""FastAPI application for the Pronunciation Studio backend.

Endpoints are grouped by responsibility and mirror the service modules. The
long-running pronunciation analysis runs in a worker thread and is polled via a
job id, so a slow CPU inference never blocks the event loop or the UI.

Privacy: everything runs locally. There is no telemetry and no upload of audio
to any external service. All user data lives under ``settings.data_dir``.
"""
from __future__ import annotations

import asyncio
import os
import threading
import time
import uuid
from pathlib import Path

from fastapi import (FastAPI, File, HTTPException, UploadFile)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import platform

from . import progress_service
from .config import settings
from .lesson_service import get_lessons, get_lesson, levels
from .model_manager import status as model_status, warmup
from .audio_service import (validate_audio, save_recording, delete_recording,
                            _find_recording)
from .reference_audio_service import get_reference, reference_path
from .pronunciation_evaluator import analyze as run_analysis
from .schemas import (AnalysisResult, Health, Lesson, ModelInfo,
                      ProgressSummary, ReferenceAudio)

app = FastAPI(
    title="Pronunciation Studio API",
    version="1.0.0",
    description="Local, verifiable English pronunciation learning. "
                "All analysis runs on this machine.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------------------------------- #
# Background analysis jobs
# --------------------------------------------------------------------------- #
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()


class AnalyzeRequest(BaseModel):
    expected_text: str
    ipa: str | None = None
    language: str = "en"
    variety: str | None = "en_US"
    recording_id: str | None = None   # if given, analyse a saved recording
    lesson_id: str | None = None
    exercise_id: str | None = None
    target_phoneme: str | None = None
    save_recording: bool = False      # keep the recording for progress tracking


def _run_job(job_id: str, req: AnalyzeRequest) -> None:
    with _JOBS_LOCK:
        _JOBS[job_id]["status"] = "running"
        _JOBS[job_id]["stage"] = "loading models & decoding audio"
    try:
        with _JOBS_LOCK:
            audio_path = Path(_JOBS[job_id]["path"])
        _JOBS[job_id]["stage"] = "running the pronunciation model (CPU, may take a minute)"
        result = run_analysis(
            audio_path, req.expected_text,
            ipa=req.ipa, language=req.language, variety=req.variety,
        )
        # record into progress (only if we have a lesson/exercise context or a saved rec)
        if req.lesson_id or req.recording_id or req.save_recording:
            progress_service._record(
                lesson_id=req.lesson_id or "",
                exercise_id=req.exercise_id or "",
                expected_text=req.expected_text,
                ipa=req.ipa,
                target_phoneme=req.target_phoneme,
                result=result,
                recording_id=req.recording_id,
                saved=req.save_recording,
            )
        with _JOBS_LOCK:
            _JOBS[job_id]["status"] = "done"
            _JOBS[job_id]["stage"] = None
            _JOBS[job_id]["result"] = result
    except Exception as e:  # noqa: BLE001
        with _JOBS_LOCK:
            _JOBS[job_id]["status"] = "error"
            _JOBS[job_id]["stage"] = None
            _JOBS[job_id]["error"] = f"{type(e).__name__}: {e}"


# --------------------------------------------------------------------------- #
# Health & models
# --------------------------------------------------------------------------- #
@app.get("/api/health", response_model=Health)
def health() -> Health:
    models = model_status()
    notes = []
    if not all(m.notes.startswith("installed=True") for m in models
               if m.role.startswith("pronunciation")):
        notes.append("pronunciation models not fully installed — "
                     "run scripts/download_models.py")
    return Health(
        status="ok",
        version="1.0.0",
        python=platform.python_version(),
        models=models,
        data_dir=str(settings.data_dir),
        offline=settings.tts_backend == "piper",
        notes=notes,
    )


@app.get("/api/models", response_model=list[ModelInfo])
def models() -> list[ModelInfo]:
    return model_status()


@app.post("/api/models/warmup")
def models_warmup() -> dict:
    """Explicitly load the models now (instead of on first analysis)."""
    return {"loaded": warmup()}


# --------------------------------------------------------------------------- #
# Lessons
# --------------------------------------------------------------------------- #
@app.get("/api/levels")
def levels_endpoint() -> list[dict]:
    return levels()


@app.get("/api/lessons", response_model=list[Lesson])
def lessons(level: int | None = None) -> list[Lesson]:
    ls = get_lessons()
    if level is not None:
        ls = [l for l in ls if l.level == level]
    return ls


@app.get("/api/lessons/{lesson_id}", response_model=Lesson)
def lesson(lesson_id: str) -> Lesson:
    l = get_lesson(lesson_id)
    if l is None:
        raise HTTPException(404, f"lesson {lesson_id} not found")
    return l


@app.post("/api/lessons/{lesson_id}/complete")
def complete_lesson(lesson_id: str) -> dict:
    if get_lesson(lesson_id) is None:
        raise HTTPException(404, f"lesson {lesson_id} not found")
    progress_service.mark_lesson_completed(lesson_id)
    return {"detail": "marked complete", "lesson_id": lesson_id}


# --------------------------------------------------------------------------- #
# Reference audio (synthesised, labelled)
# --------------------------------------------------------------------------- #
class SynthRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=400)
    variety: str = "en_US"
    ipa: str | None = None


@app.post("/api/references/synthesize", response_model=ReferenceAudio)
def synthesize(req: SynthRequest) -> ReferenceAudio:
    try:
        return get_reference(req.text, req.variety, req.ipa)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            503,
            f"could not synthesise reference audio: {e}. "
            "Make sure the Piper voice is downloaded (scripts/download_models.py) "
            "and OPENPRONOUNCE_TTS=piper.",
        )


@app.get("/api/references/{ref_id}.wav")
def reference_file(ref_id: str) -> FileResponse:
    p = reference_path(ref_id)
    if p is None:
        raise HTTPException(404, f"reference {ref_id} not found")
    return FileResponse(p, media_type="audio/wav", filename=p.name)


# --------------------------------------------------------------------------- #
# Audio: validate, save, retrieve, delete
# --------------------------------------------------------------------------- #
@app.post("/api/audio/validate")
async def audio_validate(file: UploadFile = File(...)) -> dict:
    tmp = Path(f"/tmp/pronval_{uuid.uuid4().hex}")
    try:
        tmp.write_bytes(await file.read())
        meta = validate_audio(tmp)
        return meta.model_dump()
    finally:
        tmp.unlink(missing_ok=True)


@app.post("/api/audio/save")
async def audio_save(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    if len(raw) > settings.max_upload_bytes:
        raise HTTPException(413, "file too large")
    suffix = Path(file.filename or "rec.webm").suffix or ".webm"
    if suffix.lower() not in {".webm", ".wav", ".m4a", ".mp3", ".ogg", ".opus", ".flac"}:
        suffix = ".webm"
    rid, path = save_recording(raw, suffix)
    meta = validate_audio(path)
    return {"recording_id": rid, "filename": path.name, "meta": meta.model_dump()}


@app.get("/api/recordings/{recording_id}")
def recording(recording_id: str) -> FileResponse:
    p = _find_recording(recording_id)
    if p is None:
        raise HTTPException(404, f"recording {recording_id} not found")
    return FileResponse(p, media_type="audio/webm", filename=p.name)


@app.delete("/api/recordings/{recording_id}")
def recording_delete(recording_id: str) -> dict:
    if not delete_recording(recording_id):
        raise HTTPException(404, f"recording {recording_id} not found")
    progress_service.clear_saved_flag(recording_id)
    return {"detail": "deleted", "id": recording_id}


# --------------------------------------------------------------------------- #
# Pronunciation analysis (background job)
#
# Contract: the client first uploads the recording via POST /api/audio/save and
# gets back a recording_id, then calls POST /api/pronunciation/analyze with that
# id plus the expected text. This keeps the analysis request a plain JSON body
# (no awkward multipart+form mixing) and lets the same recording be re-analysed.
# --------------------------------------------------------------------------- #
@app.post("/api/pronunciation/analyze")
async def pronunciation_analyze(req: AnalyzeRequest) -> dict:
    if not req.recording_id:
        raise HTTPException(400, "recording_id is required — upload the recording "
                                 "first via POST /api/audio/save")
    p = _find_recording(req.recording_id)
    if p is None:
        raise HTTPException(404, f"recording {req.recording_id} not found")

    job_id = uuid.uuid4().hex[:16]
    with _JOBS_LOCK:
        _JOBS[job_id] = {"status": "queued", "stage": "queued", "result": None,
                         "error": None, "path": str(p)}
    t = threading.Thread(target=_run_job, args=(job_id, req), daemon=True)
    t.start()
    return {"job_id": job_id, "status": "queued", "recording_id": req.recording_id}


@app.get("/api/pronunciation/status/{job_id}")
def pronunciation_status(job_id: str) -> dict:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, f"job {job_id} not found")
    out = {"job_id": job_id, "status": job["status"], "stage": job["stage"]}
    if job["status"] == "done" and isinstance(job["result"], AnalysisResult):
        out["result"] = job["result"].model_dump()
    if job["status"] == "error":
        out["error"] = job["error"]
    return out


@app.post("/api/pronunciation/analyze-sync", response_model=AnalysisResult)
async def pronunciation_analyze_sync(req: AnalyzeRequest) -> AnalysisResult:
    """Synchronous variant (smaller audio, or for tests). Same pipeline as the
    background endpoint: requires a recording_id from a prior /api/audio/save."""
    if not req.recording_id:
        raise HTTPException(400, "recording_id is required")
    p = _find_recording(req.recording_id)
    if p is None:
        raise HTTPException(404, f"recording {req.recording_id} not found")
    result = run_analysis(p, req.expected_text, ipa=req.ipa,
                          language=req.language, variety=req.variety)
    if req.lesson_id or req.recording_id or req.save_recording:
        progress_service._record(
            lesson_id=req.lesson_id or "", exercise_id=req.exercise_id or "",
            expected_text=req.expected_text, ipa=req.ipa,
            target_phoneme=req.target_phoneme, result=result,
            recording_id=req.recording_id, saved=req.save_recording,
        )
    return result


# --------------------------------------------------------------------------- #
# Progress
# --------------------------------------------------------------------------- #
@app.get("/api/progress", response_model=ProgressSummary)
def progress() -> ProgressSummary:
    return progress_service.get_summary()


@app.get("/api/progress/adaptive")
def progress_adaptive() -> dict:
    lesson = progress_service.get_adaptive_lesson()
    if lesson is None:
        return {"available": False,
                "message": "No weak phonemes detected yet — keep practising the "
                           "earlier levels and this will populate."}
    return {"available": True, "lesson": lesson}


@app.delete("/api/progress")
def progress_clear() -> dict:
    n = progress_service.delete_all_history()
    return {"detail": f"cleared {n} attempts", "attempts_removed": n}


# --------------------------------------------------------------------------- #
# Startup
# --------------------------------------------------------------------------- #
@app.on_event("startup")
def _startup() -> None:
    settings.ensure_dirs()
    # warm models in the background so the first analysis is faster; do NOT
    # block startup on it (CPU load can take ~10s).
    threading.Thread(target=lambda: warmup(), daemon=True).start()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)
