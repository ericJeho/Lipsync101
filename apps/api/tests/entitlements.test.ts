import { describe, it, expect } from 'vitest';
import { quoteRender } from '../src/services/entitlements.js';
import { ApiError } from '../src/lib/errors.js';

/**
 * `quoteRender` is where plan limits actually bite, so these cases are written
 * around the decisions a user would feel: being downgraded to 720p, being told
 * a clip is too long, and being stopped before an over-budget render starts.
 */

const freeUser = { plan: 'free' as const, credits: 10_000, periodSecondsUsed: 0 };
const proUser = { plan: 'pro' as const, credits: 10_000, periodSecondsUsed: 0 };
const studioUser = { plan: 'studio' as const, credits: 500_000, periodSecondsUsed: 0 };

const baseInput = {
  durationSeconds: 30,
  preset: 'balanced' as const,
  outputHeight: 1080,
  enhancementCount: 0,
};

describe('quoteRender', () => {
  it('clamps resolution to the plan ceiling rather than rejecting the render', () => {
    const quote = quoteRender(freeUser, { ...baseInput, outputHeight: 2160 });
    expect(quote.outputHeight).toBe(720);
  });

  it('lets Studio through at 4K', () => {
    expect(quoteRender(studioUser, { ...baseInput, outputHeight: 2160 }).outputHeight).toBe(
      2160,
    );
  });

  it('resolves the engine from the preset when none is named', () => {
    expect(quoteRender(proUser, { ...baseInput, preset: 'fast' }).engine).toBe('wav2lip');
    expect(quoteRender(proUser, { ...baseInput, preset: 'highest' }).engine).toBe(
      'videoretalking',
    );
  });

  it('honours an explicitly chosen engine over the preset default', () => {
    const quote = quoteRender(proUser, { ...baseInput, preset: 'fast', engine: 'synctalk' });
    expect(quote.engine).toBe('synctalk');
  });

  it('rejects a clip longer than the plan allows', () => {
    expect(() => quoteRender(freeUser, { ...baseInput, durationSeconds: 120 })).toThrow(
      ApiError,
    );
    try {
      quoteRender(freeUser, { ...baseInput, durationSeconds: 120 });
    } catch (error) {
      expect((error as ApiError).status).toBe(402);
      expect((error as ApiError).message).toContain('minutes');
    }
  });

  it('rejects a render that would exceed the monthly minute allowance', () => {
    // Free includes 300s a month and caps a single clip at 60s. With 270s
    // already spent, a 45s clip is under the per-clip cap but over what is left.
    const nearlySpent = { ...freeUser, periodSecondsUsed: 270 };
    expect(() => quoteRender(nearlySpent, { ...baseInput, durationSeconds: 45 })).toThrow(
      /monthly/i,
    );
  });

  it('still allows a render that exactly fits the remaining allowance', () => {
    const nearlySpent = { ...freeUser, periodSecondsUsed: 270 };
    expect(() =>
      quoteRender(nearlySpent, { ...baseInput, durationSeconds: 30 }),
    ).not.toThrow();
  });

  it('does not meter minutes on unlimited plans', () => {
    const heavyUser = { ...proUser, periodSecondsUsed: 500_000 };
    expect(() => quoteRender(heavyUser, baseInput)).not.toThrow();
  });

  it('refuses when the balance cannot cover the quote', () => {
    const broke = { ...proUser, credits: 1 };
    try {
      quoteRender(broke, baseInput);
      throw new Error('expected a plan-limit error');
    } catch (error) {
      expect((error as ApiError).code).toBe('plan_limit');
      expect((error as ApiError).message).toMatch(/credits/);
    }
  });

  it('charges more for a costlier engine at the same length', () => {
    const cheap = quoteRender(studioUser, { ...baseInput, engine: 'wav2lip' });
    const dear = quoteRender(studioUser, { ...baseInput, engine: 'synctalk' });
    expect(dear.credits).toBeGreaterThan(cheap.credits);
    expect(dear.estimatedSeconds).toBeGreaterThan(cheap.estimatedSeconds);
  });

  it('charges more as enhancements are stacked on', () => {
    const bare = quoteRender(studioUser, baseInput);
    const loaded = quoteRender(studioUser, { ...baseInput, enhancementCount: 5 });
    expect(loaded.credits).toBeGreaterThan(bare.credits);
  });

  it('watermarks free renders and prioritises paid ones', () => {
    expect(quoteRender(freeUser, baseInput).watermark).toBe(true);
    expect(quoteRender(freeUser, baseInput).priority).toBe(0);
    expect(quoteRender(proUser, baseInput).watermark).toBe(false);
    expect(quoteRender(proUser, baseInput).priority).toBeGreaterThan(0);
  });
});
