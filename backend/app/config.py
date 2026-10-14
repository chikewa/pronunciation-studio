"""Application configuration.

All runtime behaviour that should be tunable without editing code lives here.
Reads from environment variables with sane local-first defaults.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# Project root (backend/ is the CWD when uvicorn runs from backend/)
BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    # --- Storage -----------------------------------------------------------
    # All user data (recordings, progress, generated references) lives under
    # DATA_DIR. Keeping it in one tree makes it easy to inspect, back up and
    # delete. It is git-ignored by default.
    data_dir: Path = field(default_factory=lambda: Path(
        os.environ.get("PRON_DATA_DIR", str(PROJECT_ROOT / "data"))
    ))

    @property
    def recordings_dir(self) -> Path:
        return self.data_dir / "recordings"

    @property
    def references_dir(self) -> Path:
        return self.data_dir / "references"

    @property
    def progress_dir(self) -> Path:
        return self.data_dir / "progress"

    @property
    def analyses_dir(self) -> Path:
        return self.data_dir / "analyses"

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.recordings_dir, self.references_dir,
                  self.progress_dir, self.analyses_dir):
            d.mkdir(parents=True, exist_ok=True)

    # --- Audio limits ------------------------------------------------------
    max_upload_bytes: int = int(os.environ.get("PRON_MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))
    min_duration_s: float = float(os.environ.get("PRON_MIN_DURATION_S", "0.3"))
    max_duration_s: float = float(os.environ.get("PRON_MAX_DURATION_S", "60.0"))
    analysis_sample_rate: int = 16000  # what OpenPronounce / wav2vec2 expect
    analysis_channels: int = 1         # mono for analysis

    # saturation / silence thresholds (RMS-based heuristics)
    saturation_peak_threshold: float = 0.985
    silence_rms_threshold: float = 0.01  # ~ -40 dBFS
    low_rms_warn: float = 0.003          # ~ -50 dBFS, "too quiet to assess"

    # silence trimming on user recordings (leading/trailing only)
    trim_silence: bool = field(default_factory=lambda: _env_bool(
        "PRON_TRIM_SILENCE", True))
    trim_pad_s: float = 0.08             # keep this much silence at each edge

    # --- Models ------------------------------------------------------------
    # OpenPronounce model cache. Defaults to the standard HF cache so a prior
    # `scripts/download_models.py` run is reused without re-downloading.
    hf_home: str = field(default_factory=lambda: os.environ.get(
        "HF_HOME", str(Path.home() / ".cache" / "huggingface")))
    # Reference TTS backend used by OpenPronounce for the acoustic term.
    # "piper" = fully offline (default here). "gtts" needs network.
    tts_backend: str = field(default_factory=lambda: os.environ.get(
        "OPENPRONOUNCE_TTS", "piper"))
    tts_voice: str = field(default_factory=lambda: os.environ.get(
        "OPENPRONOUNCE_TTS_VOICE", "en_US-lessac-medium"))
    device: str = field(default_factory=lambda: os.environ.get(
        "OPENPRONOUNCE_DEVICE", "cpu"))

    # --- Server ------------------------------------------------------------
    cors_origins: list[str] = field(default_factory=lambda: [
        o.strip() for o in os.environ.get(
            "PRON_CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
        ).split(",") if o.strip()
    ])

    def __post_init__(self) -> None:
        self.ensure_dirs()


settings = Settings()
