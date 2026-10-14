# Pronunciation Studio

A local, privacy-first web app to **learn and improve English pronunciation**
with real AI analysis. Record your voice, compare it against a reference, get
sound-by-sound (IPA) feedback, and track your progress over time — **everything
runs on your computer; your recordings never leave it.**

> **Honesty principle:** every number shown as an evaluation comes from an
> analysis that was actually executed. Where the system is unsure, or a model
> is not installed, it says so explicitly — it does not invent a score.

---

## What it does

| Area | What you get |
|------|--------------|
| Curriculum | 5 progressive levels (sounds, vowels, consonants, words, phrases) + a level-6 adaptive set built from your weak phonemes |
| Reference audio | Real, offline synthesised audio (Piper), labelled as a model voice — never presented as a native speaker |
| Recording | Browser mic recorder with permission handling, timer, play-back, re-record, discard, save |
| Comparator | `PronunciationComparator` — two real WaveSurfer waveforms, independent play/pause/seek, region select + repeat, alternate playback (ref → you → ref → you), a clearly-labelled waveform overlay, and real spectrograms |
| Acoustic analysis | Real, measured features via **librosa** (F0, MFCC, Mel spectrogram, RMS) and **Praat** (`praat-parselmouth`: intensity, spectrogram) — each labelled by source |
| Pronunciation scoring | **OpenPronounce** (Wav2Vec2 + DTW), a calibrated 0–100 score + phoneme error rate + word error rate, with per-word / per-phoneme verdicts and confidence states |
| IPA | General American IPA shown for every sound, with articulation description and examples |
| Progress | Lessons completed, attempts, saved recordings, streak, weekly goal, weak-phoneme list, and a score-evolution chart (only same-model scores are mixed) |

---

## Architecture

```
pronunciation-studio/
├── docker-compose.yml             # one-command deploy (backend + frontend)
├── Dockerfile                     # backend image (python 3.11, CPU torch)
├── Dockerfile.frontend            # frontend image (node build + nginx)
├── docker/nginx.conf              # SPA + /api proxy (single origin)
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app + endpoints
│   │   ├── config.py                # settings (env-driven)
│   │   ├── schemas.py               # Pydantic request/response contract
│   │   ├── audio_service.py         # validation, decode, quality heuristics
│   │   ├── acoustic_analysis.py     # librosa + Praat feature extraction
│   │   ├── pronunciation_evaluator.py # OpenPronounce -> honest schema + feedback
│   │   ├── reference_audio_service.py # Piper TTS (cached, labelled)
│   │   ├── lesson_service.py        # the 6-level curriculum
│   │   ├── progress_service.py      # history, weak phonemes, adaptive lesson
│   │   └── model_manager.py         # single-load + truthful model status
│   ├── tests/                       # pytest suite (fast + model-gated)
│   └── requirements.txt
├── frontend/                        # React 18 + Vite + TS + Tailwind + WaveSurfer
│   └── src/
│       ├── components/              # AudioWave, PronunciationComparator,
│       │                            # Spectrogram, AdvancedPanel, ScoreGauge,
│       │                            # PhonemeTable, Recorder, LessonView, ...
│       ├── hooks/useRecorder.ts     # MediaRecorder + Web Audio
│       └── api.ts                   # typed client
├── scripts/
│   ├── download_models.py         # one-time model download (respects HF_HOME)
│   ├── entrypoint.sh              # container entrypoint (model bootstrap)
│   └── publish_github.sh          # helper used to publish this repo
├── data/                            # your data (git-ignored)
└── .env.example
```

**Backend responsibilities are split by concern** (audio, acoustics,
evaluation, references, lessons, progress, models). Long analyses run in a
worker thread with a pollable job so the UI never blocks.

---

## Prerequisites

- **Python 3.10–3.12** (tested on 3.11)
- **Node 18+** and npm
- **System packages:** `espeak-ng` (phonemiser used by the phoneme pipeline) and
  `ffmpeg` (robust audio decoding):
  ```bash
  sudo apt-get install -y espeak-ng ffmpeg      # Debian/Ubuntu
  ```
- ~3 GB disk for the models. A normal desktop CPU is enough (no GPU required).

---

## Installation

```bash
# 1) clone + enter
git clone https://github.com/chikewa/pronunciation-studio.git
cd pronunciation-studio

# 2) Python venv + dependencies (CPU build of torch)
python3 -m venv .venv
./.venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu \
    --extra-index-url https://pypi.org/simple torch
./.venv/bin/pip install -r backend/requirements.txt

# 3) download the models (one-time, needs internet)
./.venv/bin/python scripts/download_models.py

# 4) frontend dependencies
cd frontend && npm install && cd ..
```

### Models & their licences

| Model | Purpose | Size | Licence |
|-------|---------|------|---------|
| `facebook/wav2vec2-large-960h` | pronunciation scoring (acoustic) | ~1.2 GB | CC-BY-4.0 |
| `facebook/wav2vec2-lv-60-espeak-cv-ft` | phoneme transcription for OpenPronounce | ~1.2 GB | CC-BY-4.0 |
| Piper `en_US-lessac-medium` | reference speech synthesis | ~60 MB | MIT |

Model code: **OpenPronounce** (MIT), **Piper** (MIT), **praat-parselmouth**
(Praat — free for non-commercial use), **librosa/scipy/numpy** (BSD).

> **Important note on Praat:** the real Praat bindings are the PyPI package
> **`praat-parselmouth`**. The PyPI name `parselmouth` is *squatted by an
> unrelated ad-serving library* and must **not** be installed — it shadows the
> real C core. `requirements.txt` pins `praat-parselmouth` only.

---

## Running

### Option A — Docker (recommended, one command)

```bash
git clone https://github.com/chikewa/pronunciation-studio.git
cd pronunciation-studio
docker compose up -d --build
```

- **First start** downloads ~2.5 GB of models into the `hf_models` volume
  (needs internet that one time). The backend reports `starting` until the
  download + model check finish; watch with `docker compose logs -f backend`.
- From then on the stack runs **fully offline**.
- **UI:** http://localhost:8085 (nginx serves the built frontend and proxies
  `/api` to the backend, so everything is on one origin — no CORS issues).
- **API (direct):** http://127.0.0.1:8000/api/health
- **Your data** lives in named volumes: `hf_models` (model cache) and
  `app_data` (recordings, progress, generated references). Delete both
  volumes to reset: `docker compose down -v`.
- The backend port is bound to `127.0.0.1` only by default — keep it that way
  unless you put the stack behind your own TLS proxy (mic input additionally
  requires HTTPS or `localhost`).
- **GPU (optional):** install the NVIDIA Container Toolkit, uncomment the
  `deploy` block in `docker-compose.yml`, and switch the image to a CUDA torch
  build with `OPENPRONOUNCE_DEVICE=cuda`.

### Option B — local Python / Node

**Backend** (terminal 1):
```bash
cd backend
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**Frontend** (terminal 2):
```bash
cd frontend
npm run dev        # http://localhost:5173  (proxies /api to :8000)
```

Open http://localhost:5173. The **Home** screen shows the live model status —
if a model is missing it tells you exactly how to install it.

**Production frontend build:**
```bash
cd frontend && npm run build    # outputs frontend/dist
```

### Environment
Copy `.env.example` to `.env` and adjust if you want non-default paths, limits,
or a GPU (`OPENPRONOUNCE_DEVICE=cuda`). All values are optional.

---

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | service + model status |
| GET | `/api/models` | model list + load state |
| POST | `/api/models/warmup` | preload models now |
| GET | `/api/levels` | level summary |
| GET | `/api/lessons`, `/api/lessons/{id}` | curriculum |
| POST | `/api/lessons/{id}/complete` | mark done |
| POST | `/api/references/synthesize` | generate reference audio (Piper) |
| GET | `/api/references/{id}.wav` | fetch reference audio |
| POST | `/api/audio/validate` | validate an uploaded file |
| POST | `/api/audio/save` | persist a recording → `recording_id` |
| GET / DELETE | `/api/recordings/{id}` | fetch / delete a recording |
| POST | `/api/pronunciation/analyze` | start a background analysis job |
| GET | `/api/pronunciation/status/{job_id}` | poll the job |
| POST | `/api/pronunciation/analyze-sync` | synchronous analysis |
| GET | `/api/progress` | progress summary |
| GET | `/api/progress/adaptive` | personalised level-6 lesson |
| DELETE | `/api/progress` | delete all history |

The analysis response is a structured schema (score, transcription, per-word /
per-phoneme verdicts, real acoustics, confidence, **limitations**,
recommendations, model name/version). Any metric that could not be computed is
returned as `null` / absent — never filled with a made-up value.

---

## The score (and what it is *not*)

The headline score is **OpenPronounce's calibrated 0–100**:
`0.4×(1 − phoneme error rate) + 0.3×(1 − word error rate) + 0.3×acoustic
similarity`. It is calibrated on expert-rated speech. It is a **relative
closeness to a native reading of that exact sentence**, **not** a probability
that your pronunciation is "correct", and **not** an accent judgement.

Each phoneme is shown with an honest verdict: *probably correct · needs
practice · substitution likely · possibly omitted · hard to assess · not
assessed*. A sound is never labelled "wrong" unless the evidence supports it,
and low-quality audio (too short / quiet / noisy) yields
**"could not be assessed with enough confidence"** rather than a penalty.

---

## Testing

```bash
cd backend
../.venv/bin/python -m pytest -q
```
- **Fast suite** (audio validation, lessons, progress, API contract) runs with
  no models — 26 tests.
- **Model-gated suite** (real OpenPronounce end-to-end) auto-skips if
  torch/wav2vec2 are absent, and runs real CPU inference when present.
- The suite uses an isolated temp data dir, so it never touches your real
  recordings or progress.

Frontend: `cd frontend && npm run build` (type-check + production build).

---

## Privacy

- All processing is **local**. No recording or transcript is sent anywhere; there
  is no telemetry.
- Your data lives under `data/` (recordings, progress, generated references),
  all git-ignored. You can delete any recording or the whole history from the UI.
- Uploads are validated (size, format, decodability) and stored under generated
  names.
- Reference audio is **synthesised with Piper and labelled as such**.

---

## Hardware

| Use case | Minimum | Comfortable |
|----------|---------|-------------|
| Analysis (CPU) | 4-core, 8 GB RAM | 8-core, 16 GB RAM |
| First model download | ~3 GB disk, internet | — |
| GPU (optional) | — | any CUDA GPU + CUDA torch build |

CPU inference of one short sentence typically takes a few seconds to ~a minute
depending on the machine; the UI shows the stage and never blocks.

---

## Feature status (honest)

**Done & verified**
- Backend: all endpoints, real audio validation, real acoustic features
  (librosa F0/MFCC/spectrogram/RMS + Praat intensity/spectrogram), real
  OpenPronounce scoring, Piper references, lessons, progress, adaptive lesson.
- Frontend: recorder, WaveSurfer waveforms (real signals), comparator with
  alternate playback + region repeat + overlay, spectrograms, score gauge,
  phoneme table, advanced panel, progress + evolution chart, responsive layout.
- Tests: 26 fast + 5 model-gated, all passing.

**Partially implemented**
- Per-phoneme detail only populates when OpenPronounce flags a word; a clean
  reading correctly shows "no problems flagged" (the rich table is sparse on
  good recordings by design).
- The **reference** spectrogram is not computed in the (user) analysis pass;
  the UI says so rather than faking it. The **user** spectrogram is real.

**Known limitations**
- **Formant (F1/F2) extraction is not implemented** — the `praat-parselmouth`
  build has no `to_formant`. Vowel analysis relies on MFCC + spectrogram instead.
- OpenPronounce scores a *sentence*; single isolated phoneme scoring is not
  directly supported.
- Praat 0.4.7 low-level API: only intensity + spectrogram are used; F0 comes
  from librosa (pyin).
- The 0.4.7 build's remote-Praat adapter contains Python-2 syntax (irrelevant
  here — we never use remote Praat).

**Pending / future**
- Montreal Forced Aligner for word/phoneme time alignment (not wired in).
- Whisper/WhisperX for independent transcription cross-check (not wired in).
- A reference-audio spectrogram pass; a GPU path; more varieties of English.

---

## Troubleshooting

- **"Models not installed"** on Home → run `scripts/download_models.py`.
- **`parselmouth` import errors** → you likely installed the squatted `parselmouth`
  package; `pip uninstall parselmouth` and ensure `praat-parselmouth` is used.
- **Mic not recording** → the browser requires `https` or `localhost`; grant
  permission and check the device in the recorder panel.
- **Slow analysis** → expected on CPU; the job runs in the background.

## Licence
App code: **MIT** (see `LICENSE`). Third-party models/libraries keep their own
licences (see table above).
