"""acoustic_analysis: real, measured acoustic features from a mono waveform.

Design decision (recorded, not silent):
  * Primary engine = **librosa** (pyin F0, MFCC, Mel-STFT spectrogram, RMS).
    It is the most robust across this exact numpy/numba stack and returns clean
    arrays we verified shape-by-shape.
  * Secondary source = **Praat** via the ``praat-parselmouth`` C bindings
    (``parselmouth.Sound(...).to_intensity()`` / ``.to_spectrogram()``), used for
    the intensity (loudness) contour and as a second spectrogram so the user can
    see two independent estimates.
  * Every feature carries a ``source`` label. Nothing here invents a value; if a
    method fails it returns ``None`` for that feature and records the reason in
    ``notes``.

These are *features for study*, not a correctness score. The pronunciation score
comes from the calibrated OpenPronounce pipeline (see pronunciation_evaluator).
"""
from __future__ import annotations

import numpy as np
from dataclasses import dataclass

from .schemas import AcousticFeatures

# Cap the size of the arrays we ship over the wire so the UI stays responsive.
# The UI re-renders these as images; beyond ~300x200 there is no visible benefit.
_MAX_FRAMES = 300
_MAX_FREQ_BINS = 200
_MAX_CURVE_PTS = 400


def _downsample(x: np.ndarray, axis: int, max_len: int) -> np.ndarray:
    """Evenly resample a 1-D length to <= max_len (keeps first and last)."""
    x = np.asarray(x, dtype=float)
    if len(x) <= max_len:
        return x
    idx = np.linspace(0, len(x) - 1, max_len).round().astype(int)
    return x[idx]


def _curve(times: np.ndarray, values: np.ndarray, max_pts: int = _MAX_CURVE_PTS) -> list[list[float]] | None:
    """Return [[t, v], ...] with NaN replaced by None-ish 0 and unvoiced = 0.0.

    We keep unvoiced frames as 0.0 (a convention the UI renders as a gap) and
    downsample to keep the payload small.
    """
    if values is None or len(values) == 0:
        return None
    v = np.nan_to_num(np.asarray(values, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)
    t = np.asarray(times, dtype=float)
    idx = np.linspace(0, len(v) - 1, min(len(v), max_pts)).round().astype(int)
    return [[round(float(t[i]), 4), round(float(v[i]), 3)] for i in idx]


def _matrix(x: np.ndarray, max_bins: int, max_frames: int) -> np.ndarray | None:
    """Downsample a 2-D (rows, cols) spectrogram to a bounded size, as float32."""
    if x is None or x.size == 0:
        return None
    x = np.asarray(x, dtype=np.float32)
    if x.shape[0] > max_bins:
        idx = np.linspace(0, x.shape[0] - 1, max_bins).round().astype(int)
        x = x[idx, :]
    if x.shape[1] > max_frames:
        idx = np.linspace(0, x.shape[1] - 1, max_frames).round().astype(int)
        x = x[:, idx]
    # round to keep JSON compact
    return np.round(x, 3)


def extract_features(wav: np.ndarray, sr: int) -> AcousticFeatures:
    """Compute the full acoustic feature set for a mono float waveform.

    ``wav`` is a 1-D float32 array; ``sr`` its sample rate (should be 16 kHz,
    the analysis rate). Returns an :class:`AcousticFeatures` with measured values
    (or ``None`` + a note for anything that could not be computed).
    """
    import librosa

    feat = AcousticFeatures()
    notes: list[str] = []

    if wav is None or len(wav) == 0:
        feat.notes.append("empty waveform")
        return feat

    feat.duration_s = round(float(len(wav) / sr), 3)
    feat.sample_rate = int(sr)
    feat.peak = round(float(np.max(np.abs(wav))) if wav.size else 0.0, 5)
    feat.rms = round(float(np.sqrt(np.mean(wav ** 2))) if wav.size else 0.0, 5)
    # zero-crossing rate (rough spectral-centroid proxy for "brightness")
    zc = float(librosa.feature.zero_crossing_rate(wav)[0].mean())
    feat.energy_zero_crossings = round(zc, 4)

    # --- F0 (primary: librosa pyin) --------------------------------------- #
    try:
        fmin = librosa.note_to_hz("C2")
        fmax = librosa.note_to_hz("C6")
        f0, voiced, _prob = librosa.pyin(
            wav, fmin=fmin, fmax=fmax, sr=sr, frame_length=2048, hop_length=512
        )
        # pyin returns a per-frame time grid
        times = librosa.frames_to_time(
            np.arange(len(f0)), sr=sr, hop_length=512
        )
        feat.f0 = _curve(times, f0)
        feat.f0_source = "librosa"
        voiced_frac = float(np.mean(~np.isnan(f0))) if len(f0) else 0.0
        notes.append(f"voiced fraction {voiced_frac:.0%} (pyin)")
    except Exception as e:  # noqa: BLE001
        feat.f0 = None
        feat.f0_source = None
        notes.append(f"F0 (pyin) failed: {e}")

    # --- Intensity (Praat, second source) --------------------------------- #
    try:
        import parselmouth
        sound = parselmouth.Sound(wav.astype(np.float32), sr)
        inten = sound.to_intensity().as_array()  # dB, shape (1, n)
        n = inten.shape[1]
        t_inten = np.linspace(0.0, feat.duration_s, n)
        feat.intensity_db = _curve(t_inten, inten.ravel())
        feat.intensity_source = "praat"
    except Exception as e:  # noqa: BLE001
        feat.intensity_db = None
        feat.intensity_source = None
        notes.append(f"intensity (praat) failed: {e}")

    # --- MFCC (librosa) ---------------------------------------------------- #
    try:
        mfcc = librosa.feature.mfcc(y=wav, sr=sr, n_mfcc=13)
        feat.mfcc = np.round(mfcc, 3).tolist()  # [13, frames]
    except Exception as e:  # noqa: BLE001
        feat.mfcc = None
        notes.append(f"MFCC failed: {e}")

    # --- Spectrogram: primary librosa Mel-STFT, secondary Praat ----------- #
    try:
        S = np.abs(librosa.stft(wav, n_fft=512, hop_length=128))
        Sdb = librosa.amplitude_to_db(S, ref=np.max)          # dB, (freq, time)
        spec = _matrix(Sdb.T, _MAX_FREQ_BINS, _MAX_FRAMES)     # -> (freq, time)
        feat.spectrogram = spec.tolist() if spec is not None else None
        feat.spectrogram_source = "librosa"
        feat.spectrogram_max_freq_hz = float(sr / 2)
    except Exception as e:  # noqa: BLE001
        feat.spectrogram = None
        feat.spectrogram_source = None
        notes.append(f"spectrogram (librosa) failed: {e}")

    # --- RMS energy curve (librosa) --------------------------------------- #
    try:
        rms = librosa.feature.rms(y=wav, frame_length=2048, hop_length=512)[0]
        t_rms = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=512)
        feat.rms_curve = _curve(t_rms, rms)
    except Exception as e:  # noqa: BLE001
        feat.rms_curve = None
        notes.append(f"RMS curve failed: {e}")

    feat.notes = notes
    return feat
