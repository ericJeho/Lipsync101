import { describe, it, expect } from 'vitest';
import {
  ENGINE_CATALOGUE,
  ENGINE_LIST,
  engineForPreset,
  estimateRenderSeconds,
} from './models.js';
import { formatBytes, formatDuration, formatSrtTimestamp, isVideoFormat } from './media.js';
import { creditsForRender, methodsForRegion, PLANS } from './billing.js';
import { passwordSchema, passwordStrength } from './auth.js';
import { verdictFor } from './moderation.js';
import { isTerminal, createJobSchema, SUPPORTED_LANGUAGES } from './jobs.js';

describe('engine catalogue', () => {
  it('exposes a descriptor for every engine id', () => {
    for (const engine of ENGINE_LIST) {
      expect(ENGINE_CATALOGUE[engine.id].id).toBe(engine.id);
    }
  });

  it('resolves exactly one default engine per preset', () => {
    for (const preset of ['fast', 'balanced', 'highest'] as const) {
      const matches = ENGINE_LIST.filter((e) => e.defaultFor.includes(preset));
      expect(matches).toHaveLength(1);
      expect(engineForPreset(preset)).toBe(matches[0]!.id);
    }
  });

  it('scales the render estimate with resolution and clip length', () => {
    const short = estimateRenderSeconds('wav2lip', 10, 1080);
    const long = estimateRenderSeconds('wav2lip', 60, 1080);
    const uhd = estimateRenderSeconds('wav2lip', 60, 2160);
    expect(long).toBeGreaterThan(short);
    // 4K is 4x the pixels of 1080p, so the GPU term should roughly quadruple.
    expect(uhd).toBeGreaterThan(long * 3);
  });

  it('charges more for enhancements', () => {
    expect(estimateRenderSeconds('musetalk', 30, 1080, 3)).toBeGreaterThan(
      estimateRenderSeconds('musetalk', 30, 1080, 0),
    );
  });
});

describe('media helpers', () => {
  it('formats byte counts', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB');
  });

  it('formats durations either side of an hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });

  it('emits SRT timestamps with millisecond precision', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
    expect(formatSrtTimestamp(3661.5)).toBe('01:01:01,500');
  });

  it('recognises supported video extensions case-insensitively', () => {
    expect(isVideoFormat('take-01.MOV')).toBe(true);
    expect(isVideoFormat('song.mp3')).toBe(false);
  });
});

describe('billing', () => {
  it('charges 4K more than 720p for the same clip', () => {
    const sd = creditsForRender(60, 1, 720);
    const uhd = creditsForRender(60, 1, 2160);
    expect(uhd).toBe(sd * 3);
  });

  it('offers mobile money in Malawi and cards everywhere', () => {
    const mw = methodsForRegion('mw').map((m) => m.provider);
    expect(mw).toContain('airtel_money');
    expect(mw).toContain('stripe');
    expect(methodsForRegion('DE').map((m) => m.provider)).not.toContain('mtn_momo');
  });

  it('keeps the free plan watermarked and capped at 720p', () => {
    expect(PLANS.free.limits.watermark).toBe(true);
    expect(PLANS.free.limits.maxHeight).toBe(720);
    expect(PLANS.pro.limits.watermark).toBe(false);
  });
});

describe('auth', () => {
  it('accepts a long passphrase with two character classes', () => {
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
  });

  it('rejects short passwords even when complex', () => {
    expect(passwordSchema.safeParse('Ab1!xyz').success).toBe(false);
  });

  it('scores strength monotonically', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('aaaaaaaaaaaaaaaaaaaaaa')).toBeGreaterThan(
      passwordStrength('aaaaaaaaaaaa'),
    );
  });
});

describe('moderation', () => {
  it('blocks above the per-category block threshold', () => {
    expect(verdictFor([{ category: 'nsfw', score: 0.9 }]).action).toBe('block');
  });

  it('flags a likeness signal that would only be noise elsewhere', () => {
    expect(verdictFor([{ category: 'nonconsensual_likeness', score: 0.45 }]).action).toBe(
      'flag',
    );
    expect(verdictFor([{ category: 'violence', score: 0.45 }]).action).toBe('allow');
  });

  it('allows an empty signal set', () => {
    expect(verdictFor([]).action).toBe('allow');
  });
});

describe('jobs', () => {
  it('treats only finished states as terminal', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('rendering')).toBe(false);
    expect(isTerminal('paused')).toBe(false);
  });

  it('applies defaults when creating a job with the minimum payload', () => {
    const parsed = createJobSchema.parse({
      projectId: '00000000-0000-4000-8000-000000000001',
      videoAssetId: '00000000-0000-4000-8000-000000000002',
      audioAssetId: '00000000-0000-4000-8000-000000000003',
    });
    expect(parsed.preset).toBe('balanced');
    expect(parsed.outputHeight).toBe(1080);
    expect(parsed.enhancements).toEqual([]);
    expect(parsed.expression.mouthIntensity).toBe(70);
  });

  it('rejects a non-uuid asset id', () => {
    const result = createJobSchema.safeParse({
      projectId: 'not-a-uuid',
      videoAssetId: '00000000-0000-4000-8000-000000000002',
      audioAssetId: '00000000-0000-4000-8000-000000000003',
    });
    expect(result.success).toBe(false);
  });

  it('ships all ten advertised languages', () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(10);
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toContain('ny');
  });
});
