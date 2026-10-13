"""reference_audio_service: authentic reference audio for lessons and words.

Policy (per the spec):
  * Reference audio is synthesised locally with **Piper** (a real TTS model,
    fully offline once the voice is on disk) and stored on disk.
  * It is *labelled* as synthesised (``source="piper"``) — never presented as a
    human native speaker.
  * If a lesson needs a human recording, it must be supplied as a file
    (``source="file"``); we never fake one.
  * Everything is cached by (text, variety) so repeated playback is instant and
    we never re-synthesise needlessly.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import soundfile as sf
import numpy as np

from .config import settings
from .schemas import ReferenceAudio

# Piper voices per variety. en_US is fully offline; en_GB uses a different Piper
# voice. We only ship the ones we actually downloaded so we never claim a
# variety we can't produce.
_VARIETY_VOICE = {
    "en_US": "en_US-lessac-medium",
    "en_GB": "en_GB-alan-medium",   # only if the user has downloaded it
}
_DEFAULT_VARIETY = "en_US"


def _synthesize(text: str, variety: str) -> tuple[np.ndarray, int]:
    """Synthesise with Piper. Raises if the voice isn't available offline."""
    from openpronounce import tts as op_tts

    voice = _VARIETY_VOICE.get(variety, "en_US-lessac-medium")
    # Force the piper backend regardless of the global default so reference
    # audio is *always* offline (the global default might be gtts/network).
    wav, sr = op_tts.synthesize(text, "en", "piper", voice)
    return wav, sr


def get_reference(text: str, variety: str = _DEFAULT_VARIETY,
                  ipa: str | None = None) -> ReferenceAudio:
    """Return a ReferenceAudio for ``text``. Synthesises on first use, caches
    afterwards. Falls back to the US voice if the requested variety's voice is
    not present, and records that in the returned object so the UI can show it.
    """
    key = hashlib.sha1(f"{text}::{variety}".encode()).hexdigest()[:16]
    settings.references_dir.mkdir(parents=True, exist_ok=True)
    cached = settings.references_dir / f"ref_{key}.wav"

    effective_variety = variety
    if not cached.exists():
        try:
            wav, sr = _synthesize(text, variety)
        except Exception:
            # the requested variety's voice isn't on disk — fall back to US
            if variety != _DEFAULT_VARIETY:
                effective_variety = _DEFAULT_VARIETY
                wav, sr = _synthesize(text, _DEFAULT_VARIETY)
            else:
                raise
        sf.write(str(cached), wav, sr, subtype="PCM_16")
        dur = round(len(wav) / sr, 3)
    else:
        wav, sr = sf.read(str(cached), dtype="float32")
        dur = round(len(wav) / sr, 3)

    rid = f"ref_{key}"
    return ReferenceAudio(
        id=rid,
        text=text,
        ipa=ipa,
        variety=effective_variety,
        source="piper",
        filename=cached.name,
        url=f"/api/references/{rid}.wav",
        duration_s=dur,
        sample_rate=int(sr),
    )


def reference_path(ref_id: str) -> Path | None:
    """Resolve a reference id to its file (validated: no path traversal)."""
    if not ref_id or "/" in ref_id or ".." in ref_id or not ref_id.startswith("ref_"):
        return None
    p = settings.references_dir / f"{ref_id}.wav"
    return p if p.exists() else None


def reference_meta(ref_id: str) -> ReferenceAudio | None:
    p = reference_path(ref_id)
    if p is None:
        return None
    wav, sr = sf.read(str(p), dtype="float32")
    return ReferenceAudio(
        id=ref_id,
        text=ref_id,
        variety="unknown",
        source="piper",
        filename=p.name,
        url=f"/api/references/{ref_id}.wav",
        duration_s=round(len(wav) / sr, 3),
        sample_rate=int(sr),
    )
