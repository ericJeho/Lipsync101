/** Accepted media formats and the limits enforced on both sides of the wire. */

export const VIDEO_INPUT_FORMATS = ['mp4', 'mov', 'avi', 'mkv', 'webm'] as const;
export type VideoInputFormat = (typeof VIDEO_INPUT_FORMATS)[number];

export const AUDIO_INPUT_FORMATS = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'] as const;
export type AudioInputFormat = (typeof AUDIO_INPUT_FORMATS)[number];

export const OUTPUT_FORMATS = ['mp4', 'mov', 'gif'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const VIDEO_MIME_TYPES: Record<VideoInputFormat, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
};

export const AUDIO_MIME_TYPES: Record<AudioInputFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
};

/** `accept` attribute value for the video drop zone. */
export const VIDEO_ACCEPT = [
  ...Object.values(VIDEO_MIME_TYPES),
  ...VIDEO_INPUT_FORMATS.map((f) => `.${f}`),
].join(',');

/** `accept` attribute value for the audio drop zone. */
export const AUDIO_ACCEPT = [
  ...Object.values(AUDIO_MIME_TYPES),
  ...AUDIO_INPUT_FORMATS.map((f) => `.${f}`),
].join(',');

export const MAX_UPLOAD_BYTES = {
  video: 4 * 1024 * 1024 * 1024,
  audio: 512 * 1024 * 1024,
} as const;

export type AssetKind = 'video' | 'audio' | 'image' | 'subtitle' | 'render';

export interface MediaProbe {
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
  bitrate?: number;
  /** Number of distinct faces the detector found in a sampled sweep. */
  faceCount?: number;
  /** True when a face is present in at least 80% of sampled frames. */
  faceTrackStable?: boolean;
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

export function isVideoFormat(filename: string): boolean {
  return (VIDEO_INPUT_FORMATS as readonly string[]).includes(extensionOf(filename));
}

export function isAudioFormat(filename: string): boolean {
  return (AUDIO_INPUT_FORMATS as readonly string[]).includes(extensionOf(filename));
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

/** `mm:ss` for anything under an hour, `h:mm:ss` beyond it. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** `hh:mm:ss,mmm` — the SRT cue format. */
export function formatSrtTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return (
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:` +
    `${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
  );
}
