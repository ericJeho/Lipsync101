import { z } from 'zod';
import { LIPSYNC_ENGINES, QUALITY_PRESETS } from './models.js';
import { OUTPUT_FORMATS } from './media.js';

export const JOB_STATUSES = [
  'queued',
  'analyzing',
  'rendering',
  'enhancing',
  'encoding',
  'completed',
  'failed',
  'cancelled',
  'paused',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_JOB_STATUSES: JobStatus[] = ['completed', 'failed', 'cancelled'];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/** Ordered pipeline stages, used to derive an overall progress bar. */
export const PIPELINE_STAGES = [
  { status: 'analyzing', label: 'Analysing audio', weight: 0.1 },
  { status: 'rendering', label: 'Synthesising lip motion', weight: 0.6 },
  { status: 'enhancing', label: 'Enhancing faces', weight: 0.2 },
  { status: 'encoding', label: 'Encoding output', weight: 0.1 },
] as const;

export const ENHANCEMENTS = [
  'faceRestore',
  'denoise',
  'skinSmooth',
  'upscale',
  'colorCorrect',
  'relight',
  'stabilize',
] as const;
export type Enhancement = (typeof ENHANCEMENTS)[number];

export const ENHANCEMENT_LABELS: Record<Enhancement, { name: string; detail: string }> = {
  faceRestore: {
    name: 'AI face restoration',
    detail: 'GFPGAN pass over the mouth region to recover detail lost in synthesis.',
  },
  denoise: {
    name: 'Noise reduction',
    detail: 'Temporal denoise that keeps grain structure without smearing motion.',
  },
  skinSmooth: {
    name: 'Skin enhancement',
    detail: 'Frequency-separated smoothing — pores stay, blotches go.',
  },
  upscale: {
    name: 'HD upscaling',
    detail: 'Real-ESRGAN 2× upscale, capped at your plan resolution.',
  },
  colorCorrect: {
    name: 'Colour correction',
    detail: 'Matches the rendered mouth region back to the source grade.',
  },
  relight: {
    name: 'Lighting enhancement',
    detail: 'Relights the face to match the scene key so composites do not read flat.',
  },
  stabilize: {
    name: 'Motion stabilisation',
    detail: 'Subtle warp stabiliser applied after sync so the mouth stays locked.',
  },
};

/**
 * Expression controls. Every value is 0..100 in the UI; the AI service maps
 * them into engine-native ranges. 50 means "leave the source alone".
 */
export interface ExpressionControls {
  mouthIntensity: number;
  smile: number;
  eyeBlink: number;
  expressionStrength: number;
  headMovement: number;
  emotionIntensity: number;
}

export const DEFAULT_EXPRESSION: ExpressionControls = {
  mouthIntensity: 70,
  smile: 50,
  eyeBlink: 50,
  expressionStrength: 55,
  headMovement: 50,
  emotionIntensity: 50,
};

export const EXPRESSION_CONTROL_META: {
  key: keyof ExpressionControls;
  label: string;
  hint: string;
}[] = [
  {
    key: 'mouthIntensity',
    label: 'Mouth intensity',
    hint: 'How far the jaw opens on loud phonemes. Push it for singing, pull it back for whispered VO.',
  },
  {
    key: 'smile',
    label: 'Smile',
    hint: 'Biases the mouth corners upward across the whole clip.',
  },
  {
    key: 'eyeBlink',
    label: 'Eye blinking',
    hint: 'Blink frequency. 50 keeps the source blinks; higher inserts natural extra blinks.',
  },
  {
    key: 'expressionStrength',
    label: 'Expression strength',
    hint: 'Overall amount of facial motion outside the mouth region.',
  },
  {
    key: 'headMovement',
    label: 'Head movement',
    hint: 'Only applies to engines that synthesise pose. 50 preserves the original head motion.',
  },
  {
    key: 'emotionIntensity',
    label: 'Emotion intensity',
    hint: 'Scales the detected emotion before it drives the expression basis.',
  },
];

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'ny', name: 'Chichewa', native: 'Chichewa' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];
export const LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code) as LanguageCode[];

export function languageName(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

export function isRtl(code: string): boolean {
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return Boolean(lang && 'rtl' in lang && lang.rtl);
}

/* ------------------------------------------------------------------ */
/* Voice analysis                                                      */
/* ------------------------------------------------------------------ */

export const EMOTIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'excited',
  'calm',
  'fearful',
] as const;
export type Emotion = (typeof EMOTIONS)[number];

export interface Confidence<T> {
  value: T;
  /** 0..1 */
  confidence: number;
}

export interface VoiceAnalysis {
  language: Confidence<string>;
  emotion: Confidence<Emotion>;
  gender: Confidence<'male' | 'female' | 'unknown'>;
  /** Beats per minute, present for musical audio. */
  tempo: Confidence<number> | null;
  /** Words per minute. */
  speakingRate: Confidence<number>;
  /** True when the track reads as music rather than speech. */
  isMusic: boolean;
  /** Beat onset times in seconds — drives the karaoke grid. */
  beats: number[];
  durationSeconds: number;
  /** Peak-normalised waveform buckets for the timeline, 0..1. */
  waveform: number[];
}

/* ------------------------------------------------------------------ */
/* Subtitles                                                           */
/* ------------------------------------------------------------------ */

export interface SubtitleWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
  /** Per-word timings, used to drive karaoke highlighting. */
  words?: SubtitleWord[];
  speaker?: string;
}

export interface SubtitleTrack {
  language: string;
  /** True when this track was machine-translated from the source language. */
  translated: boolean;
  cues: SubtitleCue[];
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export type TimelineTrackKind = 'video' | 'audio' | 'subtitle';

export interface TimelineClip {
  id: string;
  assetId: string | null;
  label: string;
  /** Position on the timeline, in seconds. */
  start: number;
  duration: number;
  /** Offset into the source asset where this clip begins. */
  sourceIn: number;
  muted?: boolean;
  gain?: number;
}

export interface TimelineTrack {
  id: string;
  kind: TimelineTrackKind;
  label: string;
  locked?: boolean;
  clips: TimelineClip[];
}

export interface TimelineState {
  durationSeconds: number;
  tracks: TimelineTrack[];
}

/* ------------------------------------------------------------------ */
/* Job payloads                                                        */
/* ------------------------------------------------------------------ */

export const expressionSchema = z.object({
  mouthIntensity: z.number().min(0).max(100),
  smile: z.number().min(0).max(100),
  eyeBlink: z.number().min(0).max(100),
  expressionStrength: z.number().min(0).max(100),
  headMovement: z.number().min(0).max(100),
  emotionIntensity: z.number().min(0).max(100),
});

export const createJobSchema = z.object({
  projectId: z.string().uuid(),
  videoAssetId: z.string().uuid(),
  audioAssetId: z.string().uuid(),
  engine: z.enum(LIPSYNC_ENGINES).optional(),
  preset: z.enum(QUALITY_PRESETS).default('balanced'),
  outputFormat: z.enum(OUTPUT_FORMATS).default('mp4'),
  outputHeight: z.union([z.literal(720), z.literal(1080), z.literal(2160)]).default(1080),
  enhancements: z.array(z.enum(ENHANCEMENTS)).max(ENHANCEMENTS.length).default([]),
  expression: expressionSchema.default(DEFAULT_EXPRESSION),
  /** Treat the audio as sung rather than spoken. */
  musicMode: z.boolean().default(false),
  karaokeTiming: z.boolean().default(false),
  subtitles: z
    .object({
      enabled: z.boolean().default(false),
      burnIn: z.boolean().default(false),
      languages: z.array(z.string().min(2).max(8)).max(10).default([]),
    })
    .default({ enabled: false, burnIn: false, languages: [] }),
  /** Translate speech to this language and re-sync to the translated audio. */
  translateTo: z.string().min(2).max(8).nullable().default(null),
  voiceCloneId: z.string().uuid().nullable().default(null),
  timeline: z.unknown().optional(),
  notifyByEmail: z.boolean().default(true),
});

export type CreateJobInput = z.input<typeof createJobSchema>;
export type CreateJobPayload = z.output<typeof createJobSchema>;

export interface JobProgress {
  jobId: string;
  status: JobStatus;
  /** 0..100 across the whole pipeline. */
  progress: number;
  stage: string;
  etaSeconds: number | null;
  queuePosition: number | null;
  gpuUtilisation: number | null;
  message?: string;
  updatedAt: string;
}

export interface RenderJob {
  id: string;
  projectId: string;
  userId: string;
  status: JobStatus;
  progress: number;
  stage: string;
  engine: string;
  preset: string;
  outputFormat: string;
  outputHeight: number;
  enhancements: Enhancement[];
  expression: ExpressionControls;
  musicMode: boolean;
  karaokeTiming: boolean;
  translateTo: string | null;
  creditsCharged: number;
  etaSeconds: number | null;
  queuePosition: number | null;
  error: string | null;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  analysis: VoiceAnalysis | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
