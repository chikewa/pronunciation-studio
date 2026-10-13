import os, time, json
os.environ["OPENPRONOUNCE_TTS"] = "piper"
os.environ["OPENPRONOUNCE_DEVICE"] = "cpu"
t0 = time.time()
def log(m): print(f"[{time.time()-t0:6.1f}s] {m}", flush=True)

log("importing openpronounce")
from openpronounce import load_audio, compare_audio_with_text, text2speech

log("synthesizing reference with Piper (offline)")
ref_path = text2speech("Hello, how are you today", lang="en")
log(f"reference wav -> {ref_path}")

log("loading reference audio")
wav = load_audio(ref_path)
log(f"reference waveform: len={len(wav)} sr=16000")

log("running compare_audio_with_text (CPU inference, ~1-3 min)")
result = compare_audio_with_text(wav, "Hello, how are you today", lang="en")

log("RESULT (real, executed):")
print(json.dumps({
    "score": result["score"],
    "acoustic_distance": result["acoustic_distance"],
    "transcribe": result.get("transcribe"),
    "phoneme_error_rate": result["differences"].get("phoneme_error_rate"),
    "word_error_rate": result["differences"].get("word_error_rate"),
    "n_errors": len(result["differences"].get("errors", [])),
    "prosody_f0_points": len(result["prosody"]["f0"]),
    "prosody_energy_points": len(result["prosody"]["energy"]),
}, indent=2), flush=True)
log("PIPELINE_OK")
