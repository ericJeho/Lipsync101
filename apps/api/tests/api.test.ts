import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

/**
 * The suite runs without Postgres, so the handful of routes that read the
 * database get a stub. Only the lookups these tests exercise are stubbed —
 * anything else would throw and make an accidental query obvious.
 */
vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  },
  serialiseBigInts: <T,>(value: T) => value,
  disconnectPrisma: vi.fn(),
}));

import { createApp } from '../src/app.js';
import { exceedsDepth } from '../src/routes/graphql.js';
import { toSrt, toVtt, toKaraokeVtt } from '../src/routes/subtitles.js';
import { buildStorageKey } from '../src/lib/storage.js';
import { ApiError } from '../src/lib/errors.js';
import type { SubtitleTrack } from '@lipsync/shared';

const app = createApp();

describe('public endpoints', () => {
  it('serves liveness without touching any dependency', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('exposes the engine and language catalogue unauthenticated', async () => {
    const response = await request(app).get('/v1/catalogue');
    expect(response.status).toBe(200);
    expect(response.body.engines).toHaveLength(6);
    expect(response.body.languages).toHaveLength(10);
    expect(response.body.socialPresets.map((p: { id: string }) => p.id)).toContain('tiktok');
  });

  it('lists plans with their limits', async () => {
    const response = await request(app).get('/v1/billing/plans');
    expect(response.status).toBe(200);
    expect(response.body.plans.map((p: { id: string }) => p.id)).toEqual([
      'free',
      'pro',
      'studio',
    ]);
  });

  it('filters payment methods by country', async () => {
    const response = await request(app).get('/v1/billing/plans?country=MW');
    const providers = response.body.paymentMethods.map(
      (m: { provider: string }) => m.provider,
    );
    expect(providers).toContain('airtel_money');
    expect(providers).not.toContain('mtn_momo');
  });
});

describe('authentication guard', () => {
  it('rejects an unauthenticated request to a protected route', async () => {
    const response = await request(app).get('/v1/projects');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it('rejects a malformed bearer token', async () => {
    const response = await request(app)
      .get('/v1/dashboard')
      .set('authorization', 'Bearer not-a-real-jwt');
    expect(response.status).toBe(401);
  });

  it('returns a structured 404 for unknown routes', async () => {
    const response = await request(app).get('/v1/nope');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });
});

describe('request validation', () => {
  it('reports per-field errors on a bad registration', async () => {
    const response = await request(app)
      .post('/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short', acceptedTerms: false });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_failed');
    expect(Object.keys(response.body.error.details)).toEqual(
      expect.arrayContaining(['email', 'password', 'acceptedTerms']),
    );
  });

  it('does not disclose whether an address is registered', async () => {
    const response = await request(app)
      .post('/v1/auth/forgot-password')
      .send({ email: 'definitely-not-a-user@example.com' });

    expect(response.status).toBe(200);
    expect(response.body.sent).toBe(true);
    expect(response.body.message).toMatch(/if that address has an account/i);
  });
});

describe('graphql query depth guard', () => {
  it('permits an ordinary nested query', () => {
    expect(exceedsDepth('{ me { id email } }')).toBe(false);
    expect(exceedsDepth('{ projects { id jobs { id project { id } } } }')).toBe(false);
  });

  it('rejects a query nested past the ceiling', () => {
    const deep = `{ a { b { c { d { e { f { g { h { i { j } } } } } } } } } }`;
    expect(exceedsDepth(deep)).toBe(true);
  });

  it('requires authentication before executing anything', async () => {
    const response = await request(app).post('/v1/graphql').send({ query: '{ me { id } }' });
    expect(response.status).toBe(401);
  });

  it('publishes the SDL for client codegen', async () => {
    const response = await request(app).get('/v1/graphql/schema');
    expect(response.status).toBe(200);
    expect(response.text).toContain('type Job');
  });
});

describe('subtitle serialisation', () => {
  const track: SubtitleTrack = {
    language: 'en',
    translated: false,
    cues: [
      {
        id: '1',
        start: 0.5,
        end: 2.25,
        text: 'Hello there',
        words: [
          { text: 'Hello', start: 0.5, end: 1.2 },
          { text: 'there', start: 1.3, end: 2.25 },
        ],
      },
      { id: '2', start: 3661.5, end: 3663, text: 'An hour later' },
    ],
  };

  it('numbers SRT cues from one and uses comma milliseconds', () => {
    const srt = toSrt(track);
    expect(srt).toContain('1\n00:00:00,500 --> 00:00:02,250\nHello there');
    expect(srt).toContain('2\n01:01:01,500 --> 01:01:03,000\nAn hour later');
  });

  it('emits a WEBVTT header and dot milliseconds', () => {
    const vtt = toVtt(track);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:00.500 --> 00:00:02.250');
    expect(vtt).not.toContain(',');
  });

  it('inlines per-word timings for karaoke', () => {
    const karaoke = toKaraokeVtt(track);
    expect(karaoke).toContain('<00:00:00.500>Hello <00:00:01.300>there');
    // A cue with no word timings falls back to its plain text.
    expect(karaoke).toContain('An hour later');
  });
});

describe('storage keys', () => {
  it('namespaces by kind, user and date and keeps the extension', () => {
    const key = buildStorageKey('user-1', 'My Take.MP4', 'video');
    expect(key).toMatch(/^video\/user-1\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.mp4$/);
  });

  it('drops an extension that is not a plausible one', () => {
    const key = buildStorageKey('user-1', 'payload.this-is-not-an-extension', 'audio');
    expect(key.endsWith('.this-is-not-an-extension')).toBe(false);
  });

  it('never reflects a traversal attempt into the key', () => {
    const key = buildStorageKey('user-1', '../../etc/passwd', 'video');
    expect(key).not.toContain('..');
  });
});

describe('ApiError', () => {
  it('serialises to the shape the error handler emits', () => {
    const error = ApiError.planLimit('Upgrade to continue.', { required: 100 });
    expect(error.status).toBe(402);
    expect(error.toJSON()).toEqual({
      error: {
        code: 'plan_limit',
        message: 'Upgrade to continue.',
        details: { required: 100 },
      },
    });
  });
});
