"""Pydantic models: the validated request/response contract of the API.

The central object is ``AnalysisResult``. It is deliberately structured so that
*every* metric is either a real measured value or explicitly marked
``not_available`` — the API never fabricates a number.

``confidence`` is a three-way state, not a 0-100 fudge:
  * ``ok``         – enough clean evidence, the metric is meaningful
  * ``low``        – a value is produced but the input was marginal (short,
                     quiet, noisy); treat as indicative only
  * ``unavailable``– could not be computed (model missing, alignment failed,
                     recording too short); the field is present but the value
                     is ``None`` and ``limitations`` explains why
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class Confidence(str, Enum):
    OK = "ok"
    LOW = "low"
    UNAVAILABLE = "unavailable"


# --------------------------------------------------------------------------- #
# Audio validation
# --------------------------------------------------------------------------- #
class AudioMeta(BaseModel):
    """Real properties of a decoded audio file."""
    ok: bool
    duration_s: Optional[float] = None
    sample_rate: Optional[int] = None
    channels: Optional[int] = None
    codec: Optional[str] = None
    format: Optional[str] = None
    size_bytes: Optional[int] = None
    peak_amplitude: Optional[float] = None
    rms: Optional[float] = None
    clipped: bool = False
    too_short: bool = False
    too_long: bool = False
    silent: bool = False
    warnings: list[str] = Field(default_factory=list)
    error: Optional[str] = None


# --------------------------------------------------------------------------- #
# Phoneme / segment evaluation
# --------------------------------------------------------------------------- #
class PhonemeVerdict(str, Enum):
    """What the evidence actually supports for one phoneme. We do NOT assert a
    sound is 'wrong' unless the recognizer has enough confidence."""
    CORRECT = "probably_correct"
    PRACTICE = "needs_practice"
    OMITTED = "omitted"
    SUBSTITUTED = "substitution_likely"
    UNCERTAIN = "difficult_to_assess"
    UNAVAILABLE = "not_available"


class PhonemeEval(BaseModel):
    phoneme: str                                   # expected IPA, e.g. "θ"
    phoneme_ipa: str = ""                          # same, normalised
    verdict: PhonemeVerdict = PhonemeVerdict.UNAVAILABLE
    confidence: float | None = None                # 0..1 from recognizer, or None
    heard: Optional[str] = None                    # what the recognizer heard
    word: Optional[str] = None                     # word it belongs to
    note: Optional[str] = None                     # short, human-readable reason


class WordEval(BaseModel):
    word: str
    ipa: Optional[str] = None
    heard: Optional[str] = None
    verdict: PhonemeVerdict = PhonemeVerdict.UNAVAILABLE
    confidence: float | None = None
    phonemes: list[PhonemeEval] = Field(default_factory=list)
    note: Optional[str] = None


# --------------------------------------------------------------------------- #
# Acoustic features (always real, measured)
# --------------------------------------------------------------------------- #
class AcousticFeatures(BaseModel):
    duration_s: Optional[float] = None
    sample_rate: Optional[int] = None
    peak: Optional[float] = None
    rms: Optional[float] = None
    # f0 contour: list of (time_s, hz) pairs; None when unvoiced/unknown
    f0: Optional[list[list[float]]] = None
    f0_source: Optional[str] = None                # "praat" | "librosa" | None
    intensity_db: Optional[list[list[float]]] = None
    intensity_source: Optional[str] = None
    rms_curve: Optional[list[list[float]]] = None
    mfcc: Optional[list[list[float]]] = None       # [n_mfcc, n_frames]
    spectrogram: Optional[list[list[float]]] = None  # [n_freq_bins, n_frames]
    spectrogram_source: Optional[str] = None        # "praat" | "librosa"
    spectrogram_max_freq_hz: Optional[float] = None
    energy_zero_crossings: Optional[float] = None
    notes: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# The analysis result
# --------------------------------------------------------------------------- #
class AnalysisResult(BaseModel):
    analysis_id: str
    expected_text: str
    expected_ipa: Optional[str] = None
    language: str = "en"
    variety: Optional[str] = None

    # scoring — only present when the calibrated scorer ran
    score: Optional[float] = None                  # 0..100 OpenPronounce
    score_confidence: Confidence = Confidence.UNAVAILABLE
    score_explanation: Optional[str] = None        # what the number measures
    acoustic_distance: Optional[float] = None      # mean per-frame DTW distance
    phoneme_error_rate: Optional[float] = None
    word_error_rate: Optional[float] = None

    # transcription (ASR) — what the word recognizer heard
    transcription: Optional[str] = None
    transcription_confidence: Confidence = Confidence.UNAVAILABLE
    # IPA of what the recogniser heard: per-word IPA in the same order as
    # ``transcription`` (None entries = that token could not be phonemised),
    # plus the joined IPA string for convenient display.
    transcription_words: Optional[list[str]] = None
    transcription_ipa: Optional[list[str | None]] = None

    # phoneme / word level detail
    expected_phones: Optional[list[str]] = None
    heard_phones: Optional[list[str]] = None
    words: list[WordEval] = Field(default_factory=list)
    phonemes: list[PhonemeEval] = Field(default_factory=list)

    # measured acoustics (always real)
    acoustics: Optional[AcousticFeatures] = None
    audio_meta: Optional[AudioMeta] = None

    # bookkeeping / honesty
    model_version: Optional[str] = None
    model_name: Optional[str] = None
    device: Optional[str] = None
    confidence: Confidence = Confidence.OK
    limitations: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    duration_ms: Optional[int] = None              # wall time of the analysis
    created_at: Optional[str] = None


# --------------------------------------------------------------------------- #
# Reference audio / lessons
# --------------------------------------------------------------------------- #
class ReferenceAudio(BaseModel):
    id: str
    text: str
    ipa: Optional[str] = None
    variety: Optional[str] = None
    source: str = "piper"          # "piper" | "file"
    filename: Optional[str] = None
    url: str
    duration_s: Optional[float] = None
    sample_rate: Optional[int] = None


class Exercise(BaseModel):
    id: str
    type: str                        # "produce" | "discriminate" | "repeat"
    text: str
    ipa: Optional[str] = None
    gloss: Optional[str] = None
    target_phoneme: Optional[str] = None
    instruction: str = ""
    min_score: Optional[float] = None
    contrast: Optional[list[str]] = None   # for discrimination pairs


class Lesson(BaseModel):
    id: str
    level: int
    level_name: str
    title: str
    objective: str
    ipa: Optional[str] = None
    articulation: Optional[str] = None     # tongue/lip/jaw description
    variety: Optional[str] = None
    reference_text: Optional[str] = None   # the canonical sentence to read
    examples: list[str] = Field(default_factory=list)
    exercises: list[Exercise] = Field(default_factory=list)
    tips: list[str] = Field(default_factory=list)
    order: int = 0


# --------------------------------------------------------------------------- #
# Progress
# --------------------------------------------------------------------------- #
class ProgressSummary(BaseModel):
    lessons_completed: list[str] = Field(default_factory=list)
    total_attempts: int = 0
    saved_recordings: int = 0
    current_level: int = 1
    phonemes_to_practise: list[str] = Field(default_factory=list)
    recommended_exercises: list[str] = Field(default_factory=list)
    streak_days: Optional[int] = None
    last_activity: Optional[str] = None
    weekly_goal: Optional[dict] = None
    # time series for the evolution chart (comparable metrics only)
    score_history: list[dict] = Field(default_factory=list)


class ModelInfo(BaseModel):
    name: str
    role: str
    version: Optional[str] = None
    loaded: bool
    path: Optional[str] = None
    notes: Optional[str] = None


class Health(BaseModel):
    status: str = "ok"
    version: str
    python: str
    models: list[ModelInfo] = Field(default_factory=list)
    data_dir: str
    offline: bool = True
    notes: list[str] = Field(default_factory=list)


class Message(BaseModel):
    detail: str
    id: Optional[str] = None
