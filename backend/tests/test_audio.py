"""audio_service tests: validation and quality heuristics on REAL audio files.

These run without any AI models — they exercise decoding + signal heuristics.
"""
import pytest
from app import audio_service


def test_valid_tone(client, tone_wav):
    r = client.post("/api/audio/validate",
                    files={"file": ("tone.wav", open(tone_wav, "rb"), "audio/wav")})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["duration_s"] == pytest.approx(1.0, abs=0.05)
    assert body["sample_rate"] == 16000
    assert body["channels"] == 1
    assert body["clipped"] is False
    assert body["too_short"] is False
    assert body["silent"] is False


def test_corrupt_file_rejected(client, corrupt_wav):
    r = client.post("/api/audio/validate",
                    files={"file": ("fake.webm", open(corrupt_wav, "rb"), "audio/webm")})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["error"]


def test_silent_flagged(client, silent_wav):
    r = client.post("/api/audio/validate",
                    files={"file": ("silent.wav", open(silent_wav, "rb"), "audio/wav")})
    body = r.json()
    assert body["silent"] is True
    # silent audio is not assessable -> flagged, not silently passed
    assert body["ok"] is False
    assert any("silent" in w.lower() or "quiet" in w.lower() for w in body["warnings"])


def test_too_short(client, short_wav):
    r = client.post("/api/audio/validate",
                    files={"file": ("short.wav", open(short_wav, "rb"), "audio/wav")})
    body = r.json()
    assert body["too_short"] is True
    assert body["ok"] is False


def test_longer_still_ok(client, long_wav):
    r = client.post("/api/audio/validate",
                    files={"file": ("long.wav", open(long_wav, "rb"), "audio/wav")})
    body = r.json()
    assert body["ok"] is True
    assert body["duration_s"] == pytest.approx(10.0, abs=0.1)


def test_stereo_decodes(client, stereo_wav):
    r = client.post("/api/audio/validate",
                    files={"file": ("stereo.wav", open(stereo_wav, "rb"), "audio/wav")})
    body = r.json()
    assert body["ok"] is True
    assert body["channels"] == 2


def test_22k_sample_rate(client, sr22k_wav):
    r = client.post("/api/audio/validate",
                    files={"file": ("sr22k.wav", open(sr22k_wav, "rb"), "audio/wav")})
    body = r.json()
    assert body["ok"] is True
    assert body["sample_rate"] == 22050


def test_empty_body_rejected(client):
    r = client.post("/api/audio/validate", files={"file": ("empty.wav", b"", "audio/wav")})
    assert r.status_code in (200, 400, 422)
    if r.status_code == 200:
        assert r.json()["ok"] is False


def test_decode_returns_mono_normalized(stereo_wav):
    """audio_service must normalise stereo → mono for downstream analysis."""
    import numpy as np
    from pathlib import Path
    from app.audio_service import decode
    audio, sr = decode(Path(stereo_wav))
    assert audio.ndim == 1                      # mono
    assert sr > 0
    assert np.max(np.abs(audio)) <= 1.0 + 1e-6  # float in [-1, 1]


def test_validate_audio_reports_stereo(stereo_wav):
    from pathlib import Path
    from app.audio_service import validate_audio
    meta = validate_audio(Path(stereo_wav))
    assert meta.ok is True
    assert meta.channels == 2


def test_trim_silence_removes_edges(tmp_path):
    """Silence at both ends of a tone must be cut; the middle stays."""
    import numpy as np
    import soundfile as sf
    from app.audio_service import trim_silence, working_copy, save_recording

    sr = 16000
    tone = 0.5 * np.sin(2 * np.pi * 440 * np.arange(sr) / sr)  # 1 s tone
    silence = np.zeros(int(0.5 * sr))                          # 0.5 s each side
    wav = np.concatenate([silence, tone, silence])             # 2 s total
    assert len(wav) == 2 * sr

    trimmed, dur, removed = trim_silence(wav, sr)
    # pad 0.08 s is kept at each edge -> 1.0 + 2*0.08 = 1.16 s, 0.84 s removed
    assert dur == pytest.approx(1.16, abs=0.02)
    assert removed == pytest.approx(0.84, abs=0.02)
    # the tone itself survived: peak in the middle region is intact
    mid = trimmed[len(trimmed) // 2 - sr // 8:len(trimmed) // 2 + sr // 8]
    assert np.max(np.abs(mid)) > 0.4

    # a fully silent clip must NOT be trimmed (safety rule)
    s, d, r = trim_silence(np.zeros(sr), sr)
    assert r == 0.0 and d == 1.0

    # a clip shorter than min_keep_s after trimming keeps the original
    short = np.concatenate([np.zeros(4 * sr), tone[: int(0.2 * sr)]])
    s2, d2, r2 = trim_silence(short, sr)
    assert r2 == 0.0  # 0.2 s result < 0.3 s min -> original kept

    # working_copy applies the trim to the analysis file only
    rid, p = save_recording(_wav_bytes(wav), ".wav")
    dst = working_copy(rid)
    assert dst is not None
    out, _ = sf.read(str(dst))
    assert len(out) / sr == pytest.approx(1.16, abs=0.05)


def _wav_bytes(wav: "np.ndarray") -> bytes:
    import io
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, wav, 16000, subtype="PCM_16", format="WAV")
    return buf.getvalue()

