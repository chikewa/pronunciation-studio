/**
 * Client-side silence trimming for user recordings.
 *
 * When the user records, the take almost always starts with a beat of silence
 * (thinking time) and ends with one (reaction time after the word). Decoding
 * the take, finding the first/last frame above an RMS threshold and re-encoding
 * a compact WAV keeps the whole pipeline (preview, waveforms, overlay,
 * analysis) tight — no dead air around the actual speech.
 *
 * Mirrors the backend `audio_service.trim_silence` safety rules:
 *   - only leading/trailing silence is cut, never the middle
 *   - a small pad is kept at each edge (no hard click)
 *   - if the result would be too short, or the clip is fully silent, the
 *     ORIGINAL blob is returned untouched
 */

const FRAME = 0.01               // 10 ms frames for edge detection
const THRESHOLD = 0.01           // ~ -40 dBFS RMS, matches the backend
const PAD_S = 0.08               // keep 80 ms of silence at each edge
const MIN_KEEP_S = 0.3           // never produce a clip shorter than this
const MAX_TAKE_S = 120           // refuse to process absurdly long takes

export interface TrimResult {
  blob: Blob
  trimmed: boolean
  originalDurationS: number
  trimmedDurationS: number
}

export async function trimSilence(blob: Blob): Promise<TrimResult> {
  const Ctx = window.AudioContext || (window as any).webkitAudioContext
  const ac: AudioContext = new Ctx()
  try {
    const buf = await blob.arrayBuffer()
    const decoded = await ac.decodeAudioData(buf)
    const ch = decoded.getChannelData(0)
    const sr = decoded.sampleRate
    const originalDurationS = decoded.duration

    // Downmix to mono float at the native rate (ch is already mono channel 0).
    const n = ch.length
    const frameN = Math.max(1, Math.round(FRAME * sr))
    const usable = Math.floor(n / frameN) * frameN

    let removed = 0
    let out: Float32Array | null = null

    if (n >= frameN && n <= MAX_TAKE_S * sr) {
      let firstVoiced = -1
      let lastVoiced = -1
      for (let i = 0; i < usable; i += frameN) {
        let sum = 0
        for (let j = i; j < i + frameN; j++) sum += ch[j] * ch[j]
        const rms = Math.sqrt(sum / frameN)
        if (rms >= THRESHOLD) {
          if (firstVoiced === -1) firstVoiced = i
          lastVoiced = i + frameN
        }
      }
      if (firstVoiced !== -1) {
        const padN = Math.round(PAD_S * sr)
        const start = Math.max(0, firstVoiced - padN)
        const end = Math.min(n, lastVoiced + padN)
        if ((end - start) / sr >= MIN_KEEP_S) {
          out = ch.slice(start, end)
          removed = originalDurationS - (end - start) / sr
        }
      }
    }

    if (!out) {
      // Nothing to cut (all silence, too short, or too long to touch).
      // Re-encode so we always hand back a clean WAV the backend prefers.
      out = ch
      removed = 0
    }

    const wav = encodeWav(out, sr)
    const result: TrimResult = {
      blob: new Blob([wav], { type: 'audio/wav' }),
      trimmed: removed > 0.05,
      originalDurationS,
      trimmedDurationS: out.length / sr,
    }
    return result
  } finally {
    ac.close().catch(() => {})
  }
}

/** Encode a mono Float32Array as a 16-bit PCM WAV (little-endian). */
function encodeWav(data: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2
  const blockAlign = bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = data.length * bytesPerSample
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)            // fmt chunk size
  view.setUint16(20, 1, true)             // PCM
  view.setUint16(22, 1, true)             // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)            // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  let off = 44
  for (let i = 0; i < data.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, data[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}
