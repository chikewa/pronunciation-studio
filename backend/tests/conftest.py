"""Shared pytest fixtures for the backend test suite.

Runs against the real FastAPI app via TestClient. Model-dependent tests are
marked so they can be skipped when torch / the wav2vec2 checkpoints are absent,
keeping the fast suite runnable anywhere.
"""
from __future__ import annotations

import os
import struct
import sys
import wave

import numpy as np
import pytest

# Make the backend package importable regardless of where pytest is invoked.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture(autouse=True)
def _isolated_data(tmp_path, monkeypatch):
    """Point the app at a throwaway data dir for every test, so the test suite
    never reads or writes the user's real recordings/progress. The config is a
    module-level singleton, so we mutate it in place and restore after."""
    from app.config import settings
    from pathlib import Path
    old = settings.data_dir
    settings.data_dir = Path(str(tmp_path / "data"))
    settings.ensure_dirs()
    yield
    settings.data_dir = old


from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402


def _write_wav(path: str, sr: int = 16000, seconds: float = 1.0,
               channels: int = 1, freq: float = 440.0, amplitude: float = 0.3,
               silence: bool = False) -> str:
    """Write a real, decodable WAV file (sine tone by default)."""
    n = int(sr * seconds)
    t = np.arange(n) / sr
    if silence:
        sig = np.zeros(n)
    else:
        sig = (amplitude * np.sin(2 * np.pi * freq * t)
               + 0.2 * amplitude * np.sin(2 * np.pi * freq * 2 * t))
    if channels == 2:
        sig = np.stack([sig, sig * 0.8], axis=1)
    with wave.open(path, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(sr)
        for i in range(n):
            if channels == 1:
                w.writeframesraw(struct.pack("<h", int(np.clip(sig[i], -1, 1) * 32767)))
            else:
                w.writeframesraw(struct.pack("<hh",
                                             int(np.clip(sig[i, 0], -1, 1) * 32767),
                                             int(np.clip(sig[i, 1], -1, 1) * 32767)))
    return path


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def tone_wav(tmp_path) -> str:
    """A short, real 1 s 440 Hz tone (valid audio)."""
    return _write_wav(str(tmp_path / "tone.wav"), seconds=1.0)


@pytest.fixture
def long_wav(tmp_path) -> str:
    """A 10 s tone (longer, still valid)."""
    return _write_wav(str(tmp_path / "long.wav"), seconds=10.0)


@pytest.fixture
def short_wav(tmp_path) -> str:
    """A very short 0.05 s blip (below the minimum duration)."""
    return _write_wav(str(tmp_path / "short.wav"), seconds=0.05)


@pytest.fixture
def silent_wav(tmp_path) -> str:
    """Digital silence (should be flagged as too quiet / silent)."""
    return _write_wav(str(tmp_path / "silent.wav"), seconds=1.0, silence=True)


@pytest.fixture
def stereo_wav(tmp_path) -> str:
    return _write_wav(str(tmp_path / "stereo.wav"), seconds=1.0, channels=2)


@pytest.fixture
def sr22k_wav(tmp_path) -> str:
    return _write_wav(str(tmp_path / "sr22k.wav"), seconds=1.0, sr=22050)


@pytest.fixture
def corrupt_wav(tmp_path) -> str:
    """A .webm-named file that is not audio (text)."""
    p = str(tmp_path / "fake.webm")
    with open(p, "w") as f:
        f.write("this is definitely not audio data\n" * 20)
    return p


def has_models() -> bool:
    """True when torch is importable AND a wav2vec2 checkpoint is on disk."""
    try:
        import torch  # noqa: F401
    except Exception:
        return False
    try:
        from pathlib import Path
        hub = Path.home() / ".cache" / "huggingface" / "hub"
        if hub.exists():
            return any("wav2vec2" in d for d in os.listdir(hub))
        from huggingface_hub import scan_cache_dir
        info = scan_cache_dir()
        for r in info.repos:
            if "wav2vec2" in getattr(r, "repo_id", ""):
                return True
    except Exception:
        return False
    return False


requires_models = pytest.mark.skipif(not has_models(), reason="torch/wav2vec2 not available")
