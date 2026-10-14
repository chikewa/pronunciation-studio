# syntax=docker/dockerfile:1
# Pronunciation Studio — backend (FastAPI + OpenPronounce + Praat + librosa + Piper)
#
# The image does NOT bake the ~2.5 GB of models: the entrypoint downloads them
# on first start into the persistent `hf_models` volume (offline afterwards).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/data/models/hf \
    OPENPRONOUNCE_TTS=piper \
    OPENPRONOUNCE_TTS_VOICE=en_US-lessac-medium \
    OPENPRONOUNCE_DEVICE=cpu

# ffmpeg = robust audio decoding; espeak-ng = phonemisation pipeline.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg espeak-ng curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the exact verified dependency graph. requirements.lock.txt is
# generated from a venv where the whole test suite passes, so this is the same
# set of versions that is known to work (avoids pip re-resolving a conflicting
# graph: huggingface-hub wants click>=8.4.2 while gTTS wants click<8.2 — both
# pins coexist in the lock and are installed verbatim with --no-deps).
COPY backend/requirements.lock.txt .
RUN pip install --no-deps \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.lock.txt

COPY backend/app ./app
COPY backend/tests ./tests
COPY scripts/download_models.py ./download_models.py
COPY scripts/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Non-root runtime user; /data is the persistent data root (models + app data).
RUN useradd -m -u 10001 appuser \
    && mkdir -p /data/models /data/app \
    && chown -R appuser:appuser /data /app
USER appuser

EXPOSE 8000
# Long start-period: the first start downloads ~2.5 GB of models.
HEALTHCHECK --interval=15s --timeout=5s --start-period=900s --retries=24 \
    CMD curl -sf http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
