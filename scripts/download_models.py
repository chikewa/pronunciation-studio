import os, time
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
t0 = time.time()
def log(m): print(f"[{time.time()-t0:6.1f}s] {m}", flush=True)

from huggingface_hub import snapshot_download
for repo in ["facebook/wav2vec2-large-960h", "facebook/wav2vec2-lv-60-espeak-cv-ft"]:
    p = snapshot_download(repo)
    log(f"downloaded {repo} -> {p}")

from huggingface_hub import hf_hub_download
# Piper voice en_US-lessac-medium into default HF cache (where OpenPronounce looks)
base = os.path.expanduser("~/.cache/huggingface/hub")
os.makedirs(base, exist_ok=True)
for ext in [".onnx", ".onnx.json"]:
    f = hf_hub_download("rhasspy/piper-voices",
        f"en/en_US/lessac/medium/en_US-lessac-medium{ext}",
        cache_dir=base)
    log(f"piper {ext} -> {f}")
log("ALL_MODELS_DONE")
