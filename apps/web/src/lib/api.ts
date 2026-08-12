'use client';

import type {
  AuthSession,
  CreateJobInput,
  PublicUser,
  SubtitleTrack,
  VoiceAnalysis,
} from '@lipsync/shared';

/**
 * Browser API client.
 *
 * Access tokens are short-lived and held in memory only — never localStorage,
 * where any injected script could read them. The long-lived refresh token is an
 * httpOnly cookie the JavaScript here cannot touch, and a 401 triggers one
 * silent refresh before the original request is retried.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/v1`
  : '/api';

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  /** Field-keyed messages from a 422, for inline form errors. */
  get fieldErrors(): Record<string, string> {
    return this.code === 'validation_failed' && this.details
      ? (this.details as Record<string, string>)
      : {};
  }

  get isPlanLimit(): boolean {
    return this.code === 'plan_limit';
  }
}

async function refreshSession(): Promise<boolean> {
  // Several requests can 401 at once; they must share one refresh rather than
  // each rotating the token and invalidating the others.
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      });
      if (!response.ok) return false;
      const body = (await response.json()) as AuthSession;
      accessToken = body.tokens.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set internally to stop a refresh loop. */
  _retried?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, _retried, headers, ...rest } = options;

  const response = await fetch(`${BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 401 && !_retried && path !== '/auth/refresh') {
    if (await refreshSession()) {
      return apiFetch<T>(path, { ...options, _retried: true });
    }
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const error = (payload.error ?? {}) as {
      code?: string;
      message?: string;
      details?: unknown;
    };
    throw new ApiClientError(
      response.status,
      error.code ?? 'unknown',
      error.message ?? 'Something went wrong. Try again.',
      error.details,
    );
  }

  return payload as T;
}

/* ------------------------------------------------------------------ */
/* Typed endpoints                                                     */
/* ------------------------------------------------------------------ */

export const api = {
  auth: {
    register: (body: { email: string; password: string; name?: string; acceptedTerms: true }) =>
      apiFetch<AuthSession>('/auth/register', { method: 'POST', body }),
    login: (body: { email: string; password: string; totp?: string }) =>
      apiFetch<AuthSession | { twoFactorRequired: true }>('/auth/login', {
        method: 'POST',
        body,
      }),
    logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
    me: () => apiFetch<{ user: PublicUser }>('/auth/me'),
    providers: () =>
      apiFetch<{ providers: { id: string; configured: boolean }[] }>('/auth/providers'),
    forgotPassword: (email: string) =>
      apiFetch<{ sent: boolean; message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: { email },
      }),
    resetPassword: (token: string, password: string) =>
      apiFetch<{ reset: boolean }>('/auth/reset-password', {
        method: 'POST',
        body: { token, password },
      }),
    setup2fa: () =>
      apiFetch<{ secret: string; otpauth: string; qrDataUrl: string }>('/auth/2fa/setup', {
        method: 'POST',
      }),
    enable2fa: (token: string) =>
      apiFetch<{ enabled: boolean; recoveryCodes: string[] }>('/auth/2fa/enable', {
        method: 'POST',
        body: { token },
      }),
  },

  catalogue: () => apiFetch<CatalogueResponse>('/catalogue'),

  dashboard: {
    summary: () => apiFetch<DashboardSummary>('/dashboard'),
    downloads: () => apiFetch<{ downloads: JobSummary[] }>('/dashboard/downloads'),
    notifications: () =>
      apiFetch<{ notifications: NotificationItem[]; unread: number }>(
        '/dashboard/notifications',
      ),
    markAllRead: () =>
      apiFetch<{ updated: number }>('/dashboard/notifications/read-all', { method: 'POST' }),
  },

  projects: {
    list: (params: { take?: number; favorite?: boolean } = {}) => {
      const query = new URLSearchParams();
      if (params.take) query.set('take', String(params.take));
      if (params.favorite !== undefined) query.set('favorite', String(params.favorite));
      return apiFetch<{ projects: ProjectSummary[]; total: number }>(
        `/projects?${query.toString()}`,
      );
    },
    create: (body: { name: string; description?: string }) =>
      apiFetch<{ project: ProjectSummary }>('/projects', { method: 'POST', body }),
    get: (id: string) => apiFetch<{ project: ProjectSummary }>(`/projects/${id}`),
    update: (id: string, body: Record<string, unknown>) =>
      apiFetch<{ project: ProjectSummary }>(`/projects/${id}`, { method: 'PATCH', body }),
    remove: (id: string) => apiFetch<void>(`/projects/${id}`, { method: 'DELETE' }),
  },

  assets: {
    /** Reserves an upload slot and returns the presigned target. */
    createUpload: (body: {
      filename: string;
      contentType: string;
      sizeBytes: number;
      kind: 'video' | 'audio' | 'image';
      projectId?: string;
    }) =>
      apiFetch<{ asset: AssetSummary; upload: PresignedUpload }>('/assets/uploads', {
        method: 'POST',
        body,
      }),
    complete: (id: string) =>
      apiFetch<{ asset: AssetSummary }>(`/assets/${id}/complete`, { method: 'POST' }),
    analyze: (id: string) =>
      apiFetch<{ analysis: VoiceAnalysis; cached: boolean }>(`/assets/${id}/analyze`, {
        method: 'POST',
      }),
    extractAudio: (id: string) =>
      apiFetch<{ asset: AssetSummary }>(`/assets/${id}/extract-audio`, { method: 'POST' }),
    importUrl: (url: string, projectId?: string) =>
      apiFetch<{ asset: AssetSummary }>('/assets/import-url', {
        method: 'POST',
        body: { url, projectId },
      }),
    remove: (id: string) => apiFetch<void>(`/assets/${id}`, { method: 'DELETE' }),
  },

  jobs: {
    create: (body: CreateJobInput) =>
      apiFetch<{ job: JobSummary; quote: RenderQuote }>('/jobs', { method: 'POST', body }),
    quote: (body: {
      audioAssetId: string;
      preset?: string;
      engine?: string;
      outputHeight?: number;
      enhancementCount?: number;
    }) =>
      apiFetch<{ quote: RenderQuote; balance: number }>('/jobs/quote', {
        method: 'POST',
        body,
      }),
    list: (params: { take?: number; status?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.take) query.set('take', String(params.take));
      if (params.status) query.set('status', params.status);
      return apiFetch<{ jobs: JobSummary[]; total: number }>(`/jobs?${query.toString()}`);
    },
    get: (id: string) => apiFetch<{ job: JobSummary }>(`/jobs/${id}`),
    cancel: (id: string) =>
      apiFetch<{ job: JobSummary; creditsRefunded: number }>(`/jobs/${id}/cancel`, {
        method: 'POST',
      }),
    retry: (id: string) => apiFetch<{ job: JobSummary }>(`/jobs/${id}/retry`, { method: 'POST' }),
    download: (id: string) => apiFetch<{ url: string }>(`/jobs/${id}/download`),
    batch: (name: string, jobs: CreateJobInput[]) =>
      apiFetch<{ batch: { id: string }; jobs: JobSummary[]; failed: unknown[] }>('/jobs/batch', {
        method: 'POST',
        body: { name, jobs },
      }),
    pauseBatch: (id: string) =>
      apiFetch<{ paused: boolean }>(`/jobs/batch/${id}/pause`, { method: 'POST' }),
    resumeBatch: (id: string) =>
      apiFetch<{ resumed: boolean }>(`/jobs/batch/${id}/resume`, { method: 'POST' }),
  },

  subtitles: {
    generate: (jobId: string, body: { languages: string[]; karaoke?: boolean }) =>
      apiFetch<{ tracks: SubtitleTrack[] }>(`/subtitles/jobs/${jobId}/generate`, {
        method: 'POST',
        body,
      }),
    get: (jobId: string) => apiFetch<{ tracks: SubtitleTrack[] }>(`/subtitles/jobs/${jobId}`),
    save: (jobId: string, track: SubtitleTrack) =>
      apiFetch<{ tracks: SubtitleTrack[] }>(`/subtitles/jobs/${jobId}`, {
        method: 'PUT',
        body: track,
      }),
  },

  billing: {
    plans: (country?: string) =>
      apiFetch<{ plans: unknown[]; paymentMethods: unknown[] }>(
        `/billing/plans${country ? `?country=${country}` : ''}`,
      ),
    subscription: () => apiFetch<SubscriptionSummary>('/billing/subscription'),
    checkout: (body: {
      plan: string;
      interval: 'monthly' | 'yearly';
      provider: string;
      phoneNumber?: string;
    }) => apiFetch<CheckoutResponse>('/billing/checkout', { method: 'POST', body }),
  },

  admin: {
    overview: () => apiFetch<AdminOverview>('/admin/overview'),
    users: (params: { take?: number; search?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.take) query.set('take', String(params.take));
      if (params.search) query.set('search', params.search);
      return apiFetch<{ users: AdminUser[]; total: number }>(`/admin/users?${query}`);
    },
    jobs: () => apiFetch<{ jobs: JobSummary[]; queue: QueueCounts }>('/admin/jobs'),
    moderation: () => apiFetch<{ flags: ModerationFlagRow[] }>('/admin/moderation'),
    review: (id: string, decision: 'uphold' | 'overturn', note?: string) =>
      apiFetch<{ flag: ModerationFlagRow }>(`/admin/moderation/${id}/review`, {
        method: 'POST',
        body: { decision, note },
      }),
  },
};

/**
 * Uploads bytes to the presigned target, reporting progress.
 *
 * XHR rather than fetch: fetch still has no upload progress event, and a
 * multi-gigabyte video with no progress bar feels broken.
 */
export function uploadToStorage(
  upload: PresignedUpload,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(upload.method, upload.url, true);

    for (const [key, value] of Object.entries(upload.headers)) {
      request.setRequestHeader(key, value);
    }
    // The local-disk driver proxies through the API, which requires auth; a
    // cloud presigned URL carries its own signature and ignores this.
    if (accessToken && upload.url.includes('/v1/uploads/local')) {
      request.setRequestHeader('authorization', `Bearer ${accessToken}`);
    }

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${request.status}`));
      }
    });

    request.addEventListener('error', () => reject(new Error('Upload failed. Check your connection.')));
    request.addEventListener('abort', () => reject(new Error('Upload cancelled.')));

    request.send(file);
  });
}

/* ------------------------------------------------------------------ */
/* Response shapes                                                     */
/* ------------------------------------------------------------------ */

export interface PresignedUpload {
  url: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  storageKey: string;
  expiresInSeconds: number;
}

export interface AssetSummary {
  id: string;
  kind: 'video' | 'audio' | 'image' | 'render' | 'subtitle';
  status: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  probe?: { durationSeconds?: number; width?: number; height?: number; fps?: number } | null;
  analysis?: VoiceAnalysis | null;
  createdAt: string;
}

export interface JobSummary {
  id: string;
  projectId: string;
  status: string;
  progress: number;
  stage: string;
  engine: string;
  preset: string;
  outputFormat: string;
  outputHeight: number;
  enhancements: string[];
  creditsCharged: number;
  etaSeconds: number | null;
  queuePosition?: number | null;
  error: string | null;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  analysis?: VoiceAnalysis | null;
  createdAt: string;
  completedAt: string | null;
  project?: { id: string; name: string };
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  favorite: boolean;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { jobs: number; assets: number };
  jobs?: JobSummary[];
}

export interface RenderQuote {
  engine: string;
  outputHeight: number;
  credits: number;
  estimatedSeconds: number;
  watermark: boolean;
  priority: number;
}

export interface CatalogueResponse {
  app: string;
  engines: EngineCard[];
  enhancements: Record<string, { name: string; detail: string }>;
  expressionControls: { key: string; label: string; hint: string }[];
  languages: { code: string; name: string; native: string }[];
  socialPresets: SocialPresetCard[];
}

export interface EngineCard {
  id: string;
  name: string;
  tagline: string;
  description: string;
  creditMultiplier: number;
  secondsPerOutputSecond: number;
  licence: string;
  capabilities: {
    music: boolean;
    headMotion: boolean;
    eyeBlink: boolean;
    stillImage: boolean;
    realtime: boolean;
    maxHeight: number;
  };
}

export interface SocialPresetCard {
  id: string;
  platform: string;
  label: string;
  width: number;
  height: number;
  aspect: string;
  maxSeconds: number;
  format: string;
}

export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface DashboardSummary {
  user: { id: string; name: string | null; email: string; plan: string; credits: number };
  storage: { usedBytes: number; limitBytes: number };
  usage: { secondsUsed: number; secondsIncluded: number | null; resetsAt: string };
  counts: {
    projects: number;
    renders: number;
    completed: number;
    failed: number;
    inFlight: number;
  };
  recentJobs: JobSummary[];
  favorites: ProjectSummary[];
  queue: QueueCounts;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface SubscriptionSummary {
  subscription: { plan: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean } | null;
  plan: { id: string; name: string; monthlyUsd: number };
  usage: {
    credits: number;
    secondsUsed: number;
    secondsIncluded: number | null;
    resetsAt: string;
  };
}

export interface CheckoutResponse {
  mode: 'redirect' | 'handset_approval';
  checkoutUrl?: string;
  message?: string;
  payment: { id: string; status: string };
}

export interface AdminOverview {
  users: { total: number; newThisMonth: number; byPlan: Record<string, number> };
  jobs: { last24h: number; byStatus: Record<string, number> };
  revenue: { last30DaysMinor: number; currency: string };
  moderation: { pendingFlags: number };
  storage: { totalBytes: number };
  queue: QueueCounts;
  aiService: { status: string; gpu: boolean; engines: string[] };
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  role: string;
  credits: number;
  storageUsedBytes: number;
  suspendedAt: string | null;
  createdAt: string;
  _count: { jobs: number; projects: number };
}

export interface ModerationFlagRow {
  id: string;
  action: string;
  signals: { category: string; score: number; detail?: string }[];
  createdAt: string;
  reviewedAt: string | null;
  asset?: { id: string; filename: string; kind: string } | null;
  job?: { id: string; status: string } | null;
}
