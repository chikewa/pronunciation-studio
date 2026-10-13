// Thin typed client for the Pronunciation Studio backend.
// All calls use relative /api/... URLs; in dev, Vite proxies them to FastAPI.
// In production, set VITE_API_BASE to the backend origin.

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

// ---- Types (mirror backend/app/schemas.py) ----
export type Confidence = 'ok' | 'low' | 'unavailable'
export type PhonemeVerdict =
  | 'probably_correct' | 'needs_practice' | 'omitted'
  | 'substitution_likely' | 'difficult_to_assess' | 'not_available'

export interface AudioMeta {
  ok: boolean
  duration_s: number | null
  sample_rate: number | null
  channels: number | null
  codec: string | null
  format: string | null
  size_bytes: number | null
  peak_amplitude: number | null
  rms: number | null
  clipped: boolean
  too_short: boolean
  too_long: boolean
  silent: boolean
  warnings: string[]
  error: string | null
}

export interface PhonemeEval {
  phoneme: string
  phoneme_ipa: string
  verdict: PhonemeVerdict
  confidence: number | null
  heard: string | null
  word: string | null
  note: string | null
}

export interface WordEval {
  word: string
  ipa: string | null
  heard: string | null
  verdict: PhonemeVerdict
  confidence: number | null
  phonemes: PhonemeEval[]
  note: string | null
}

export interface AcousticFeatures {
  duration_s: number | null
  sample_rate: number | null
  peak: number | null
  rms: number | null
  f0: [number, number][] | null
  f0_source: string | null
  intensity_db: [number, number][] | null
  intensity_source: string | null
  rms_curve: [number, number][] | null
  mfcc: number[][] | null
  spectrogram: number[][] | null
  spectrogram_source: string | null
  spectrogram_max_freq_hz: number | null
  energy_zero_crossings: number | null
  notes: string[]
}

export interface AnalysisResult {
  analysis_id: string
  expected_text: string
  expected_ipa: string | null
  language: string
  variety: string | null
  score: number | null
  score_confidence: Confidence
  score_explanation: string | null
  acoustic_distance: number | null
  phoneme_error_rate: number | null
  word_error_rate: number | null
  transcription: string | null
  transcription_confidence: Confidence
  expected_phones: string[] | null
  heard_phones: string[] | null
  words: WordEval[]
  phonemes: PhonemeEval[]
  acoustics: AcousticFeatures | null
  audio_meta: AudioMeta | null
  model_version: string | null
  model_name: string | null
  device: string | null
  confidence: Confidence
  limitations: string[]
  recommendations: string[]
  duration_ms: number | null
  created_at: string | null
}

export interface ReferenceAudio {
  id: string
  text: string
  ipa: string | null
  variety: string | null
  source: string
  filename: string | null
  url: string
  duration_s: number | null
  sample_rate: number | null
}

export interface Exercise {
  id: string
  type: 'produce' | 'discriminate' | 'repeat'
  text: string
  ipa: string | null
  gloss: string | null
  target_phoneme: string | null
  instruction: string
  min_score: number | null
  contrast: string[] | null
}

export interface Lesson {
  id: string
  level: number
  level_name: string
  title: string
  objective: string
  ipa: string | null
  articulation: string | null
  variety: string | null
  reference_text: string | null
  examples: string[]
  exercises: Exercise[]
  tips: string[]
  order: number
}

export interface LevelInfo { level: number; name: string; count: number; first: string; last: string }

export interface ModelInfo {
  name: string; role: string; version: string | null; loaded: boolean;
  path: string | null; notes: string | null
}

export interface Health {
  status: string; version: string; python: string; models: ModelInfo[];
  data_dir: string; offline: boolean; notes: string[]
}

export interface ProgressSummary {
  lessons_completed: string[]
  total_attempts: number
  saved_recordings: number
  current_level: number
  phonemes_to_practise: string[]
  recommended_exercises: string[]
  streak_days: number | null
  last_activity: string | null
  weekly_goal: { target_attempts: number; attempts_last_7d: number } | null
  score_history: { ts: string; score: number | null; text: string }[]
}

// ---- low-level fetch ----
async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      detail = body.detail || JSON.stringify(body)
    } catch { /* ignore */ }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => http<Health>('/api/health'),
  models: () => http<ModelInfo[]>('/api/models'),
  warmup: () => http<{ loaded: Record<string, boolean> }>('/api/models/warmup', { method: 'POST' }),
  levels: () => http<LevelInfo[]>('/api/levels'),
  lessons: (level?: number) =>
    http<Lesson[]>(`/api/lessons${level ? `?level=${level}` : ''}`),
  lesson: (id: string) => http<Lesson>(`/api/lessons/${id}`),
  completeLesson: (id: string) =>
    http<{ detail: string; lesson_id: string }>(`/api/lessons/${id}/complete`, { method: 'POST' }),

  synthesize: (text: string, variety = 'en_US', ipa?: string) =>
    http<ReferenceAudio>('/api/references/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, variety, ipa }),
    }),

  saveAudio: (blob: Blob, filename = 'rec.webm') => {
    const form = new FormData()
    form.append('file', blob, filename)
    return http<{ recording_id: string; filename: string; meta: AudioMeta }>(
      '/api/audio/save', { method: 'POST', body: form })
  },

  deleteRecording: (id: string) =>
    http<{ detail: string; id: string }>(`/api/recordings/${id}`, { method: 'DELETE' }),

  analyze: (body: {
    recording_id: string
    expected_text: string
    ipa?: string
    language?: string
    variety?: string
    lesson_id?: string
    exercise_id?: string
    target_phoneme?: string | null
    save_recording?: boolean
  }) =>
    http<{ job_id: string; status: string; recording_id: string }>('/api/pronunciation/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  analyzeStatus: (jobId: string) =>
    http<{
      job_id: string; status: 'queued' | 'running' | 'done' | 'error';
      stage: string | null; result?: AnalysisResult; error?: string
    }>(`/api/pronunciation/status/${jobId}`),

  progress: () => http<ProgressSummary>('/api/progress'),
  adaptiveLesson: () =>
    http<{ available: boolean; message?: string; lesson?: Lesson }>('/api/progress/adaptive'),
  clearProgress: () => http<{ detail: string; attempts_removed: number }>('/api/progress', { method: 'DELETE' }),
}

// Audio URL helpers (relative to the backend)
export const recordingUrl = (id: string) => `${API_BASE}/api/recordings/${id}`
export const referenceUrl = (id: string) => `${API_BASE}/api/references/${id}.wav`
