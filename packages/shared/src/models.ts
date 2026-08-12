/**
 * Catalogue of lip-sync engines exposed by the Python AI service.
 *
 * The `id` values are the contract between the web UI, the API and the
 * Python worker — `services/ai/app/engines/registry.py` keys its adapters
 * off exactly these strings.
 */

export const LIPSYNC_ENGINES = [
  'wav2lip',
  'musetalk',
  'sadtalker',
  'videoretalking',
  'synctalk',
  'liveportrait',
] as const;

export type LipsyncEngine = (typeof LIPSYNC_ENGINES)[number];

/** User-facing speed/quality tradeoff. Maps onto engine defaults. */
export const QUALITY_PRESETS = ['fast', 'balanced', 'highest'] as const;
export type QualityPreset = (typeof QUALITY_PRESETS)[number];

export interface EngineCapabilities {
  /** Sings as well as speaks — required for music lip-sync jobs. */
  music: boolean;
  /** Animates head pose rather than only the mouth region. */
  headMotion: boolean;
  /** Generates blinks instead of passing through source frames. */
  eyeBlink: boolean;
  /** Can drive a still image (not just a video) as the source. */
  stillImage: boolean;
  /** Suitable for near-real-time / streaming use. */
  realtime: boolean;
  /** Highest source resolution the engine handles well, in pixels of height. */
  maxHeight: number;
}

export interface EngineDescriptor {
  id: LipsyncEngine;
  name: string;
  /** One-line pitch shown on the engine picker card. */
  tagline: string;
  description: string;
  capabilities: EngineCapabilities;
  /** Relative cost multiplier applied to the base per-second credit rate. */
  creditMultiplier: number;
  /** Rough seconds of GPU time per second of output at 1080p, A10G-class card. */
  secondsPerOutputSecond: number;
  /** Presets this engine is the default pick for. */
  defaultFor: QualityPreset[];
  licence: string;
  paperUrl?: string;
}

export const ENGINE_CATALOGUE: Record<LipsyncEngine, EngineDescriptor> = {
  wav2lip: {
    id: 'wav2lip',
    name: 'Wav2Lip',
    tagline: 'Fastest turnaround, rock-solid sync',
    description:
      'The classic expert-discriminator model. Mouth accuracy is excellent and it runs several times faster than any alternative, at the cost of a softer mouth region that benefits from face restoration.',
    capabilities: {
      music: true,
      headMotion: false,
      eyeBlink: false,
      stillImage: false,
      realtime: true,
      maxHeight: 1080,
    },
    creditMultiplier: 1,
    secondsPerOutputSecond: 0.35,
    defaultFor: ['fast'],
    licence: 'Research / non-commercial (see docs/LICENSING.md)',
    paperUrl: 'https://arxiv.org/abs/2008.10010',
  },
  musetalk: {
    id: 'musetalk',
    name: 'MuseTalk',
    tagline: 'Real-time inpainting at 30fps+',
    description:
      'Latent-space mouth inpainting that keeps the original frame almost untouched outside the mouth region. The best default for talking-head footage where identity preservation matters.',
    capabilities: {
      music: true,
      headMotion: false,
      eyeBlink: false,
      stillImage: false,
      realtime: true,
      maxHeight: 1440,
    },
    creditMultiplier: 1.2,
    secondsPerOutputSecond: 0.5,
    defaultFor: ['balanced'],
    licence: 'MIT',
  },
  sadtalker: {
    id: 'sadtalker',
    name: 'SadTalker',
    tagline: 'Full head motion from a single photo',
    description:
      'Generates 3D-aware head pose, blinks and expression from one still image. Use it when you have a portrait rather than footage, or when you want invented head movement.',
    capabilities: {
      music: false,
      headMotion: true,
      eyeBlink: true,
      stillImage: true,
      realtime: false,
      maxHeight: 1080,
    },
    creditMultiplier: 2.4,
    secondsPerOutputSecond: 2.8,
    defaultFor: [],
    licence: 'Apache-2.0',
  },
  videoretalking: {
    id: 'videoretalking',
    name: 'VideoReTalking',
    tagline: 'Expression-aware editing for real footage',
    description:
      'A three-stage pipeline — expression neutralisation, audio-driven sync, then identity-aware enhancement. Slower, but the most natural result on high-resolution talking-head video.',
    capabilities: {
      music: true,
      headMotion: false,
      eyeBlink: true,
      stillImage: false,
      realtime: false,
      maxHeight: 2160,
    },
    creditMultiplier: 2.8,
    secondsPerOutputSecond: 3.4,
    defaultFor: ['highest'],
    licence: 'Apache-2.0',
  },
  synctalk: {
    id: 'synctalk',
    name: 'SyncTalk',
    tagline: 'NeRF-grade identity consistency',
    description:
      'NeRF-based synthesis with a per-subject head model. Requires a short enrolment clip of the speaker but delivers the most consistent identity across long renders.',
    capabilities: {
      music: false,
      headMotion: true,
      eyeBlink: true,
      stillImage: false,
      realtime: false,
      maxHeight: 2160,
    },
    creditMultiplier: 3.5,
    secondsPerOutputSecond: 4.2,
    defaultFor: [],
    licence: 'Research / non-commercial (see docs/LICENSING.md)',
  },
  liveportrait: {
    id: 'liveportrait',
    name: 'LivePortrait',
    tagline: 'Stitching-based control over every feature',
    description:
      'Implicit keypoint retargeting with explicit handles for eyes, mouth and head. Pairs well with the expression sliders because each control maps to a real retargeting parameter.',
    capabilities: {
      music: true,
      headMotion: true,
      eyeBlink: true,
      stillImage: true,
      realtime: true,
      maxHeight: 1440,
    },
    creditMultiplier: 1.8,
    secondsPerOutputSecond: 1.1,
    defaultFor: [],
    licence: 'MIT',
  },
};

export const ENGINE_LIST: EngineDescriptor[] = LIPSYNC_ENGINES.map(
  (id) => ENGINE_CATALOGUE[id],
);

/** The engine we pick when the user only chose a speed/quality preset. */
export function engineForPreset(preset: QualityPreset): LipsyncEngine {
  const match = ENGINE_LIST.find((e) => e.defaultFor.includes(preset));
  return match?.id ?? 'musetalk';
}

/**
 * Estimated wall-clock render seconds, before queue wait.
 *
 * Resolution scales roughly with pixel count, so we normalise against 1080p
 * and add a flat pipeline overhead for extract/encode/mux.
 */
export function estimateRenderSeconds(
  engine: LipsyncEngine,
  durationSeconds: number,
  outputHeight: number,
  enhancementCount = 0,
): number {
  const descriptor = ENGINE_CATALOGUE[engine];
  const resolutionFactor = (outputHeight * outputHeight) / (1080 * 1080);
  const base = descriptor.secondsPerOutputSecond * durationSeconds * resolutionFactor;
  const enhancement = enhancementCount * 0.18 * durationSeconds * resolutionFactor;
  const overhead = 6 + durationSeconds * 0.05;
  return Math.ceil(base + enhancement + overhead);
}
