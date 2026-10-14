#!/bin/sh
# Pronunciation Studio backend entrypoint.
#
# 1) Ensures the persistent data layout exists.
# 2) Downloads the models on first start (idempotent: scripts/download_models.py
#    exits immediately when the cache is already populated -> offline after that).
# 3) Execs the command (uvicorn by default).
set -e

DATA_DIR="${PRON_DATA_DIR:-/data/app}"
HF_HOME_DIR="${HF_HOME:-/data/models/hf}"
mkdir -p "$DATA_DIR/recordings" "$DATA_DIR/references" "$DATA_DIR/progress" \
         "$DATA_DIR/analyses" "$HF_HOME_DIR"

echo "entrypoint: checking models (HF_HOME=$HF_HOME_DIR) ..."
python /app/download_models.py

echo "entrypoint: starting $* (data: $DATA_DIR)"
exec "$@"
