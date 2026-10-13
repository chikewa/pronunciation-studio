"""model_manager: single load of heavy models, and a truthful status report.

Heavy objects (the two Wav2Vec2 checkpoints inside OpenPronounce, the Piper TTS
voice, the Praat core) are loaded *once* and reused. ``status()`` reports, for
each model, whether it is installed and loadable — never a fake "ready".
"""
from __future__ import annotations

import importlib
import os
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path

from .config import settings
from .schemas import ModelInfo

_LOCK = threading.Lock()
_STATE: dict[str, bool] = {}


def _try_import(module: str) -> tuple[bool, str | None]:
    try:
        importlib.import_module(module)
        return True, None
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def _hf_model_present(repo: str) -> tuple[bool, str | None]:
    """Check whether a HuggingFace repo's weights exist in the local cache."""
    cache = Path(settings.hf_home) / "hub" / f"models--{repo.replace('/', '--')}"
    if not cache.exists():
        return False, "not in local cache"
    # look for the big weight blobs (safetensors or bin) anywhere under blobs/
    blobs = list(cache.glob("blobs/*"))
    big = [b for b in blobs if b.stat().st_size > 50_000_000]
    if not big:
        return False, "metadata present but weights missing"
    return True, f"{len(big)} weight file(s), {sum(b.stat().st_size for b in big)/1e6:.0f} MB"


def warmup() -> dict[str, bool]:
    """Load the models once, in the background-friendly way. Returns per-model
    booleans. Safe to call repeatedly (idempotent)."""
    results: dict[str, bool] = {}
    with _LOCK:
        # 1) OpenPronounce (pulls both Wav2Vec2 checkpoints on first use)
        try:
            import openpronounce  # noqa: F401
            from openpronounce import speech as _op_speech
            # Force-load the word model (CTC) — this is the expensive one.
            _op_speech._load_models("facebook/wav2vec2-large-960h")
            results["openpronounce"] = True
        except Exception as e:  # noqa: BLE001
            results["openpronounce"] = False
            print(f"[model_manager] openpronounce load failed: {e}", file=sys.stderr)

        # 2) Piper TTS
        try:
            from openpronounce import tts as _tts
            backend, voice = _tts.resolve("en", backend=settings.tts_backend, voice=settings.tts_voice)
            if backend == "piper":
                model_path, config_path = _tts._piper_voice_files(voice)
                import piper
                _tts._piper_voices[voice] = piper.PiperVoice.load(model_path, config_path)
            results["piper"] = True
        except Exception as e:  # noqa: BLE001
            results["piper"] = False
            print(f"[model_manager] piper load failed: {e}", file=sys.stderr)

        # 3) Praat core (for the secondary acoustic source)
        try:
            import parselmouth  # noqa: F401
            results["praat"] = True
        except Exception as e:  # noqa: BLE001
            results["praat"] = False
            print(f"[model_manager] parselmouth load failed: {e}", file=sys.stderr)

        # 4) librosa (primary acoustic engine)
        try:
            import librosa  # noqa: F401
            results["librosa"] = True
        except Exception:  # noqa: BLE001
            results["librosa"] = False

        _STATE.update(results)
    return results


def status() -> list[ModelInfo]:
    """Truthful per-model status. A model is 'loaded' only if warmup() already
    succeeded in this process; otherwise it is reported as available-but-unloaded
    (it will load on first use) or missing (with the reason)."""
    infos: list[ModelInfo] = []

    op_ok, op_err = _try_import("openpronounce")
    op_w, op_winfo = _hf_model_present("facebook/wav2vec2-large-960h")
    op_p, op_pinfo = _hf_model_present("facebook/wav2vec2-lv-60-espeak-cv-ft")
    weights_ok = op_w and op_p
    infos.append(ModelInfo(
        name="OpenPronounce (wav2vec2 word + phoneme recognizers)",
        role="pronunciation scoring + phoneme recognition",
        version=_op_version(),
        loaded=_STATE.get("openpronounce", False),
        path=settings.hf_home,
        notes=(
            f"installed={op_ok}; word weights: {op_winfo}; phoneme weights: {op_pinfo}; "
            f"loads on first analysis (CPU ~10s, then cached in-process)"
            if op_ok else f"NOT installed: {op_err}"
        ),
    ))

    piper_ok, piper_err = _try_import("piper")
    piper_voice_ok, piper_voice_info = _hf_model_present("rhasspy/piper-voices")
    infos.append(ModelInfo(
        name="Piper TTS (en_US-lessac-medium)",
        role="offline reference audio synthesis",
        version=None,
        loaded=_STATE.get("piper", False),
        path=str(Path(settings.hf_home) / "hub" / "models--rhasspy--piper-voices"),
        notes=(
            f"installed={piper_ok}; voice: {piper_voice_info}"
            if piper_ok else f"NOT installed: {piper_err}"
        ),
    ))

    pm_ok, pm_err = _try_import("parselmouth")
    infos.append(ModelInfo(
        name="Praat (praat-parselmouth C bindings)",
        role="secondary acoustic source (intensity, spectrogram)",
        version=getattr(__import__("parselmouth"), "VERSION", None) if pm_ok else None,
        loaded=pm_ok,
        notes="always available once imported (no weights)" if pm_ok else f"NOT installed: {pm_err}",
    ))

    lb_ok, lb_err = _try_import("librosa")
    infos.append(ModelInfo(
        name="librosa",
        role="primary acoustic analysis (F0, MFCC, spectrogram)",
        version=_librosa_version(),
        loaded=lb_ok,
        notes="always available once imported (no weights)" if lb_ok else f"NOT installed: {lb_err}",
    ))

    return infos


def _op_version() -> str | None:
    try:
        import openpronounce
        return openpronounce.__version__
    except Exception:  # noqa: BLE001
        return None


def _librosa_version() -> str | None:
    try:
        import librosa
        return librosa.__version__
    except Exception:  # noqa: BLE001
        return None


def is_ready() -> bool:
    """True if the minimal set needed for a full analysis is present."""
    st = status()
    return all(
        (m.notes.startswith("installed=True")) for m in st if m.role.startswith("pronunciation")
    ) and _STATE.get("librosa", False)
