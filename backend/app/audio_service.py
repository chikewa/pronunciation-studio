"""audio_service: validation and preparation of user recordings.

Responsibilities:
  * verify the uploaded file is real, decodable audio (not a renamed text file)
  * report true properties (duration, sample rate, channels, codec, size)
  * compute signal-quality heuristics: peak, RMS, clipping, silence, length
  * produce a normalised 16 kHz mono working copy WITHOUT touching the original
    (the original is always preserved; the working copy is only for models)

Nothing here touches the network. Everything runs locally.
"""
from __future__ import annotations

import shutil
import struct
import subprocess
import uuid
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from .config import settings
from .schemas import AudioMeta

# Common magic bytes we accept as "this really is an audio container".
_MAGIC = {
    b"RIFF": "wav", b"OggS": "ogg/opus/vorbis", b"ID3": "mp3", b"\xff\xfb": "mp3",
    b"\xff\xf3": "mp3", b"\xff\xf2": "mp3", b"fLaC": "flac", b"\x1aE\xdf\xa3": "webm",
    b"#!FLAC": "flac",
}


def _magic_format(raw: bytes) -> str | None:
    head = raw[:4]
    for m, fmt in _MAGIC.items():
        if head.startswith(m):
            return fmt
    if len(raw) >= 2 and raw[0] == 0xFF and (raw[1] & 0xE6) == 0xE2:
        return "mp3"
    return None


def _probe_ffmpeg(path: Path) -> dict | None:
    """Best-effort codec/container via ffprobe. Returns None if unavailable."""
    if shutil.which("ffprobe") is None:
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format=format_name,duration,size:stream=codec_name,channels,sample_rate",
             "-of", "json", str(path)],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout
        import json
        d = json.loads(out)
        fmt = (d.get("format") or {})
        st = (d.get("streams") or [{}])[0]
        return {
            "codec": st.get("codec_name"),
            "channels": int(st["channels"]) if st.get("channels") else None,
            "sample_rate": int(st["sample_rate"]) if st.get("sample_rate") else None,
            "format": fmt.get("format_name"),
            "duration": float(fmt["duration"]) if fmt.get("duration") else None,
            "size": int(fmt["size"]) if fmt.get("size") else None,
        }
    except Exception:
        return None


def decode(path: Path, sr: int = settings.analysis_sample_rate) -> tuple[np.ndarray, int]:
    """Load any audio file to mono float32 at ``sr``. Raises RuntimeError on failure.

    Tries libsndfile (via librosa) first, then ffmpeg, so browser webm/opus and
    m4a recordings all work.
    """
    try:
        wav, native_sr = librosa.load(str(path), sr=sr, mono=True)
        return wav, native_sr
    except Exception:
        pass
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("could not decode audio (libsndfile failed, ffmpeg not installed)")
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le",
         "-acodec", "pcm_f32le", "-ac", "1", "-ar", str(sr), "-"],
        capture_output=True, check=False, timeout=120,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace").strip()[:300])
    return np.frombuffer(r.stdout, dtype=np.float32).copy(), sr


def _quality(wav: np.ndarray, sr: int) -> dict:
    """Signal-quality heuristics on a mono waveform. All thresholds are in
    config so they can be tuned. These are *diagnostic* flags, never scores."""
    peak = float(np.max(np.abs(wav))) if wav.size else 0.0
    rms = float(np.sqrt(np.mean(wav ** 2))) if wav.size else 0.0
    n = wav.size
    dur = n / sr if sr else 0.0

    # fraction of samples within 0.5% of full scale -> clipping risk
    clipped_frac = float(np.mean(np.abs(wav) >= settings.saturation_peak_threshold)) if wav.size else 0.0

    # fraction of frames that are essentially silent (50 ms frames)
    frame = max(1, int(0.05 * sr))
    if n >= frame:
        frames = wav[: n // frame * frame].reshape(-1, frame)
        frame_rms = np.sqrt(np.mean(frames ** 2, axis=1))
        silent_frac = float(np.mean(frame_rms < settings.silence_rms_threshold))
    else:
        silent_frac = 1.0

    return {
        "duration_s": dur,
        "peak": peak,
        "rms": rms,
        "clipped": clipped_frac > 0.005,
        "clipped_frac": round(clipped_frac, 4),
        "silent_frac": round(silent_frac, 3),
    }


def validate_audio(path: Path, *, expect_min: bool = True) -> AudioMeta:
    """Return a full AudioMeta for a file on disk. Never raises on bad audio —
    it reports ``ok=False`` with a human-readable error instead, so the UI can
    show a friendly message and ask the user to re-record.
    """
    meta = AudioMeta(ok=False, size_bytes=path.stat().st_size if path.exists() else None)
    if not path.exists():
        meta.error = "file not found"
        return meta

    raw = path.read_bytes()[:8]
    fmt_hint = _magic_format(raw)
    if fmt_hint is None:
        meta.error = "file does not look like a known audio container"
        meta.format = fmt_hint
        return meta

    probe = _probe_ffmpeg(path)
    if probe:
        meta.codec = probe.get("codec")
        meta.format = probe.get("format")
        meta.sample_rate = probe.get("sample_rate")
        meta.channels = probe.get("channels")
        if probe.get("duration"):
            meta.duration_s = probe["duration"]

    try:
        wav, _analysis_sr = decode(path)
    except Exception as e:  # noqa: BLE001 - we report, we don't raise
        meta.error = f"could not decode audio: {e}"
        return meta

    # Keep the NATIVE sample rate reported to the user (from the probe) rather
    # than the analysis rate we resampled to. `decode` returns the resampled
    # rate, which would misrepresent the source file.
    if meta.sample_rate is None:
        meta.sample_rate = _analysis_sr
    meta.ok = True
    meta.duration_s = round(len(wav) / settings.analysis_sample_rate, 3)

    q = _quality(wav, settings.analysis_sample_rate)
    meta.peak_amplitude = round(q["peak"], 5)
    meta.rms = round(q["rms"], 5)
    meta.clipped = q["clipped"]

    warns: list[str] = []
    if q["clipped"]:
        warns.append("recording is clipping (too loud) — the peaks are cut off; "
                     "move back from the microphone and record again")
    if q["rms"] < settings.low_rms_warn:
        warns.append("recording is very quiet — the analysis may not be reliable")
    if q["silent_frac"] > 0.8:
        warns.append("most of the recording is silent")
        meta.silent = True
    if expect_min:
        if meta.duration_s < settings.min_duration_s:
            meta.too_short = True
            warns.append(f"recording is shorter than the minimum "
                         f"({settings.min_duration_s:.1f}s)")
        if meta.duration_s > settings.max_duration_s:
            meta.too_long = True
            warns.append(f"recording is longer than the maximum "
                         f"({settings.max_duration_s:.0f}s) — only the first part "
                         f"will be analysed")
    meta.warnings = warns
    meta.ok = not (meta.too_short or meta.silent)
    return meta


def save_recording(raw: bytes, suffix: str = ".webm") -> tuple[str, Path]:
    """Persist an upload under a safe, generated name. Returns (recording_id, path).

    The id is a uuid4 — we never trust the client's filename. The file is stored
    verbatim (original preserved); a working copy is made on demand.
    """
    rid = uuid.uuid4().hex[:16]
    settings.recordings_dir.mkdir(parents=True, exist_ok=True)
    path = settings.recordings_dir / f"{rid}{suffix}"
    path.write_bytes(raw)
    return rid, path


def trim_silence(wav: np.ndarray, sr: int,
                 threshold: float | None = None,
                 pad_s: float | None = None,
                 min_keep_s: float = 0.3) -> tuple[np.ndarray, float, float]:
    """Cut leading/trailing silence from a mono waveform (RMS based).

    Returns (trimmed_wav, trimmed_s, removed_s). The threshold defaults to
    ``settings.silence_rms_threshold`` (~ -40 dBFS) and a small pad
    (``settings.trim_pad_s``) is kept at each edge so the result does not
    start/end on a hard click.

    Safety rules:
      * never trims into the middle of the signal — only the edges
      * if the trimmed result would be shorter than ``min_keep_s`` the
        ORIGINAL is returned untouched (removing 0.0 s), so a fully silent or
        very short clip can never be destroyed by the trim
    """
    thr = settings.silence_rms_threshold if threshold is None else threshold
    pad = settings.trim_pad_s if pad_s is None else pad_s
    n = wav.size
    dur = n / sr if sr else 0.0
    if n == 0:
        return wav, 0.0, 0.0
    pad_n = int(pad * sr)
    frame = max(1, int(0.01 * sr))  # 10 ms frames — fine enough for edges
    if n < frame:
        return wav, dur, 0.0
    usable = n // frame * frame
    frames = wav[:usable].reshape(-1, frame)
    frame_rms = np.sqrt(np.mean(frames ** 2, axis=1))
    voiced = np.flatnonzero(frame_rms >= thr)
    if voiced.size == 0:
        return wav, dur, 0.0  # all silent — never trim a silent clip to nothing
    start = max(0, int(voiced[0]) * frame - pad_n)
    end = min(n, int(voiced[-1] + 1) * frame + pad_n)
    trimmed = wav[start:end]
    if len(trimmed) < min_keep_s * sr:
        return wav, dur, 0.0  # too little left — keep the original
    removed = (start / sr) + ((n - end) / sr)
    return trimmed, len(trimmed) / sr, removed


def working_copy(recording_id: str, suffix: str = ".wav") -> Path | None:
    """Create a normalised 16 kHz mono wav working copy for a saved recording.

    The original is left untouched. Leading/trailing silence is trimmed from
    the working copy only (config: trim_silence). Returns the path, or None
    if missing.
    """
    src = _find_recording(recording_id)
    if src is None:
        return None
    try:
        wav, _ = decode(src)
    except Exception:
        return None
    if settings.trim_silence:
        wav, _, _ = trim_silence(wav, settings.analysis_sample_rate)
    dst = settings.recordings_dir / f"{recording_id}_analysis{suffix}"
    sf.write(str(dst), wav, settings.analysis_sample_rate, subtype="PCM_16")
    return dst


def _find_recording(recording_id: str) -> Path | None:
    if not recording_id or "/" in recording_id or ".." in recording_id:
        return None
    for p in settings.recordings_dir.glob(f"{recording_id}.*"):
        if "_analysis" not in p.name:
            return p
    return None


def delete_recording(recording_id: str) -> bool:
    """Delete a saved recording and its working copies. Returns True if removed."""
    removed = False
    for p in settings.recordings_dir.glob(f"{recording_id}*"):
        p.unlink(missing_ok=True)
        removed = True
    return removed
