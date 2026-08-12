import type {
  MediaProbe,
  SubtitleTrack,
  VoiceAnalysis,
  ExpressionControls,
} from '@lipsync/shared';
import { env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Thin typed client over the Python inference service.
 *
 * Every call is bounded by a timeout: a hung GPU worker must surface as a
 * failed job with a clear message, not as an Express request that never
 * resolves and eventually exhausts the connection pool.
 */

export interface RenderRequest {
  jobId: string;
  videoUrl: string;
  audioUrl: string;
  engine: string;
  preset: string;
  outputFormat: string;
  outputHeight: number;
  enhancements: string[];
  expression: ExpressionControls;
  musicMode: boolean;
  karaokeTiming: boolean;
  translateTo: string | null;
  subtitleLanguages: string[];
  burnInSubtitles: boolean;
  watermark: boolean;
  /** Where the worker POSTs progress updates. */
  callbackUrl: string;
}

export interface RenderResponse {
  jobId: string;
  outputKey: string;
  thumbnailKey: string | null;
  durationSeconds: number;
  analysis: VoiceAnalysis | null;
  subtitles: SubtitleTrack[];
}

export interface ModerationResponse {
  signals: { category: string; score: number; detail?: string }[];
}

async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 30_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${env.AI_SERVICE_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.AI_SERVICE_TOKEN}`,
        ...rest.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.error({ path, status: response.status, body }, 'AI service call failed');
      throw new ApiError(
        response.status === 400 ? 422 : 503,
        'ai_service_error',
        response.status === 400
          ? 'The inference service rejected that input.'
          : 'The rendering service is unavailable right now. Your credits were not charged.',
        body.slice(0, 500),
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw ApiError.serviceUnavailable('The rendering service timed out.');
    }
    logger.error({ err: error, path }, 'AI service transport error');
    throw ApiError.serviceUnavailable();
  } finally {
    clearTimeout(timer);
  }
}

export const aiClient = {
  /** Container-level health, used by /health and the admin dashboard. */
  async health(): Promise<{ status: string; gpu: boolean; engines: string[] }> {
    return request('/health', { method: 'GET', timeoutMs: 5_000 });
  },

  /** ffprobe plus a face-detection sweep. */
  async probe(mediaUrl: string): Promise<MediaProbe> {
    return request('/v1/probe', {
      method: 'POST',
      body: JSON.stringify({ url: mediaUrl }),
      timeoutMs: 60_000,
    });
  },

  async analyseVoice(audioUrl: string): Promise<VoiceAnalysis> {
    return request('/v1/analyze', {
      method: 'POST',
      body: JSON.stringify({ url: audioUrl }),
      timeoutMs: 120_000,
    });
  },

  async transcribe(
    audioUrl: string,
    options: { language?: string; translateTo?: string[]; karaoke?: boolean } = {},
  ): Promise<SubtitleTrack[]> {
    return request('/v1/transcribe', {
      method: 'POST',
      body: JSON.stringify({ url: audioUrl, ...options }),
      timeoutMs: 300_000,
    });
  },

  async extractAudio(videoUrl: string): Promise<{ key: string; durationSeconds: number }> {
    return request('/v1/extract-audio', {
      method: 'POST',
      body: JSON.stringify({ url: videoUrl }),
      timeoutMs: 180_000,
    });
  },

  /** Fetches audio from a third-party URL, subject to the service's allowlist. */
  async importFromUrl(
    url: string,
  ): Promise<{ key: string; title: string; durationSeconds: number }> {
    return request('/v1/import-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
      timeoutMs: 300_000,
    });
  },

  /** The long one. Rendering is driven by the worker, not an HTTP request. */
  async render(payload: RenderRequest): Promise<RenderResponse> {
    return request('/v1/render', {
      method: 'POST',
      body: JSON.stringify(payload),
      // Hard ceiling well above the longest plausible render so a wedged
      // worker eventually fails the job rather than holding it forever.
      timeoutMs: 45 * 60_000,
    });
  },

  async moderate(mediaUrl: string, kind: 'video' | 'audio'): Promise<ModerationResponse> {
    return request('/v1/moderate', {
      method: 'POST',
      body: JSON.stringify({ url: mediaUrl, kind }),
      timeoutMs: 120_000,
    });
  },

  async cloneVoice(
    sampleUrls: string[],
    name: string,
  ): Promise<{ modelKey: string; status: string }> {
    return request('/v1/voice-clone', {
      method: 'POST',
      body: JSON.stringify({ samples: sampleUrls, name }),
      timeoutMs: 600_000,
    });
  },

  async cancel(jobId: string): Promise<void> {
    await request(`/v1/render/${jobId}/cancel`, { method: 'POST', timeoutMs: 10_000 });
  },
};
