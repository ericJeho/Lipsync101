/** Social export presets and the realtime event names used over WebSocket. */

import type { OutputFormat } from './media.js';

export interface SocialPreset {
  id: string;
  platform: string;
  label: string;
  width: number;
  height: number;
  aspect: string;
  maxSeconds: number;
  format: OutputFormat;
  /** Safe-area insets as a fraction of height — keeps captions off the UI chrome. */
  safeArea: { top: number; bottom: number };
}

export const SOCIAL_PRESETS: SocialPreset[] = [
  {
    id: 'tiktok',
    platform: 'TikTok',
    label: 'TikTok — 9:16',
    width: 1080,
    height: 1920,
    aspect: '9:16',
    maxSeconds: 600,
    format: 'mp4',
    safeArea: { top: 0.08, bottom: 0.18 },
  },
  {
    id: 'reels',
    platform: 'Instagram',
    label: 'Instagram Reels — 9:16',
    width: 1080,
    height: 1920,
    aspect: '9:16',
    maxSeconds: 90,
    format: 'mp4',
    safeArea: { top: 0.09, bottom: 0.2 },
  },
  {
    id: 'shorts',
    platform: 'YouTube',
    label: 'YouTube Shorts — 9:16',
    width: 1080,
    height: 1920,
    aspect: '9:16',
    maxSeconds: 60,
    format: 'mp4',
    safeArea: { top: 0.06, bottom: 0.16 },
  },
  {
    id: 'youtube',
    platform: 'YouTube',
    label: 'YouTube — 16:9',
    width: 1920,
    height: 1080,
    aspect: '16:9',
    maxSeconds: 43200,
    format: 'mp4',
    safeArea: { top: 0.04, bottom: 0.08 },
  },
  {
    id: 'facebook',
    platform: 'Facebook',
    label: 'Facebook Feed — 1:1',
    width: 1080,
    height: 1080,
    aspect: '1:1',
    maxSeconds: 7200,
    format: 'mp4',
    safeArea: { top: 0.05, bottom: 0.1 },
  },
  {
    id: 'x',
    platform: 'X',
    label: 'X — 16:9',
    width: 1280,
    height: 720,
    aspect: '16:9',
    maxSeconds: 140,
    format: 'mp4',
    safeArea: { top: 0.04, bottom: 0.08 },
  },
  {
    id: 'gif',
    platform: 'Anywhere',
    label: 'Looping GIF — 1:1',
    width: 640,
    height: 640,
    aspect: '1:1',
    maxSeconds: 15,
    format: 'gif',
    safeArea: { top: 0.02, bottom: 0.02 },
  },
];

/* ------------------------------------------------------------------ */
/* Realtime channel                                                    */
/* ------------------------------------------------------------------ */

export const WS_EVENTS = {
  /** Client → server: start receiving progress for a job. */
  subscribeJob: 'job:subscribe',
  unsubscribeJob: 'job:unsubscribe',
  /** Server → client. */
  jobProgress: 'job:progress',
  jobCompleted: 'job:completed',
  jobFailed: 'job:failed',
  queueUpdate: 'queue:update',
  creditsUpdate: 'credits:update',
} as const;

export interface QueueSnapshot {
  waiting: number;
  active: number;
  /** Median seconds a job has waited before starting, over the last hour. */
  medianWaitSeconds: number;
  workers: { id: string; gpu: string; utilisation: number; jobId: string | null }[];
}
