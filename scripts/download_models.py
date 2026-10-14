"""Download the models the app needs (one-time, needs internet).

Respects ``HF_HOME`` (default: ``~/.cache/huggingface``) so it works both on a
desktop and inside the Docker container (where ``HF_HOME=/data/models/hf``).

Usage:
    python scripts/download_models.py
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

WAV2VEC2_REPOS = [
    "facebook/wav2vec2-large-960h",
    "facebook/wav2vec2-lv-60-espeak-cv-ft",
]
PIPER_REPO = "rhasspy/piper-voices"
PIPER_VOICE = "en/en_US/lessac/medium/en_US-lessac-medium"


def _hf_hub_dir() -> Path:
    return Path(os.environ.get("HF_HOME", str(Path.home() / ".cache" / "huggingface"))) / "hub"


def models_present() -> bool:
    """True when both wav2vec2 checkpoints and the Piper voice are on disk."""
    hub = _hf_hub_dir()
    if not hub.exists():
        return False
    have_wav2vec = any("wav2vec2" in d for d in os.listdir(hub))
    have_piper = any(hub.glob("models--rhasspy--piper-voices/**/en_US-lessac-medium.onnx"))
    return have_wav2vec and have_piper


def main() -> None:
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    if models_present():
        print("models already present, skipping download (offline)")
        return

    t0 = time.time()

    def log(m: str) -> None:
        print(f"[{time.time() - t0:6.1f}s] {m}", flush=True)

    from huggingface_hub import snapshot_download, hf_hub_download

    for repo in WAV2VEC2_REPOS:
        p = snapshot_download(repo)
        log(f"downloaded {repo} -> {p}")

    base = _hf_hub_dir()
    base.mkdir(parents=True, exist_ok=True)
    for ext in [".onnx", ".onnx.json"]:
        f = hf_hub_download(PIPER_REPO, f"{PIPER_VOICE}{ext}", cache_dir=str(base))
        log(f"piper {ext} -> {f}")
    log("ALL_MODELS_DONE")


if __name__ == "__main__":
    main()
