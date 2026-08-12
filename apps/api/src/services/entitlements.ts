import type { User } from '@prisma/client';
import {
  ENGINE_CATALOGUE,
  PLANS,
  creditsForRender,
  engineForPreset,
  estimateRenderSeconds,
  type LipsyncEngine,
  type PlanId,
  type QualityPreset,
} from '@lipsync/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';

/**
 * Everything that decides "is this account allowed to do this, and what does it
 * cost?" lives here, so the same rules apply whether a render was submitted
 * from the studio UI, the batch queue or the public API.
 */

export interface RenderQuote {
  engine: LipsyncEngine;
  outputHeight: number;
  credits: number;
  estimatedSeconds: number;
  watermark: boolean;
  priority: number;
}

function limitsFor(plan: PlanId) {
  return PLANS[plan].limits;
}

/** Rolls the monthly allowance over when the period has elapsed. */
export async function ensureCurrentPeriod(user: User): Promise<User> {
  if (user.periodResetAt > new Date()) return user;

  const nextReset = new Date();
  nextReset.setMonth(nextReset.getMonth() + 1);

  return prisma.user.update({
    where: { id: user.id },
    data: { periodSecondsUsed: 0, periodResetAt: nextReset },
  });
}

export function assertNotSuspended(user: Pick<User, 'suspendedAt' | 'suspendedReason'>) {
  if (user.suspendedAt) {
    throw ApiError.forbidden(
      user.suspendedReason ?? 'This account is suspended. Contact support.',
    );
  }
}

/**
 * Produces the quote for a render and rejects it if the plan forbids it.
 *
 * Resolution is clamped rather than rejected — a Free user who asks for 4K gets
 * 720p and a note, which is friendlier than a hard error mid-workflow. Length
 * and monthly-minute limits *are* hard errors, because silently truncating
 * someone's video would be worse than telling them.
 */
export function quoteRender(
  user: Pick<User, 'plan' | 'credits' | 'periodSecondsUsed'>,
  input: {
    durationSeconds: number;
    preset: QualityPreset;
    engine?: LipsyncEngine;
    outputHeight: number;
    enhancementCount: number;
  },
): RenderQuote {
  const limits = limitsFor(user.plan);

  if (input.durationSeconds > limits.maxClipSeconds) {
    throw ApiError.planLimit(
      `The ${PLANS[user.plan].name} plan renders clips up to ${Math.floor(
        limits.maxClipSeconds / 60,
      )} minutes. This one is ${Math.ceil(input.durationSeconds / 60)} minutes.`,
      { limit: limits.maxClipSeconds, actual: input.durationSeconds },
    );
  }

  if (limits.minutesPerMonth !== null) {
    const remaining = limits.minutesPerMonth * 60 - user.periodSecondsUsed;
    if (input.durationSeconds > remaining) {
      throw ApiError.planLimit(
        `That render needs ${Math.ceil(input.durationSeconds / 60)} minutes but only ` +
          `${Math.max(0, Math.floor(remaining / 60))} of your ${limits.minutesPerMonth} monthly ` +
          `minutes are left. Upgrade for unlimited rendering.`,
        { remainingSeconds: Math.max(0, remaining) },
      );
    }
  }

  const engine = input.engine ?? engineForPreset(input.preset);
  const outputHeight = Math.min(input.outputHeight, limits.maxHeight);

  const credits = creditsForRender(
    input.durationSeconds,
    ENGINE_CATALOGUE[engine].creditMultiplier,
    outputHeight,
    input.enhancementCount,
  );

  if (user.credits < credits) {
    throw ApiError.planLimit(
      `This render costs ${credits} credits and you have ${user.credits}. ` +
        `Top up or upgrade to keep rendering.`,
      { required: credits, available: user.credits },
    );
  }

  return {
    engine,
    outputHeight,
    credits,
    estimatedSeconds: estimateRenderSeconds(
      engine,
      input.durationSeconds,
      outputHeight,
      input.enhancementCount,
    ),
    watermark: limits.watermark,
    priority: limits.priorityRendering ? 10 : 0,
  };
}

/**
 * Debits credits and records usage in one transaction, with the balance check
 * inside the update. Two renders submitted at the same instant cannot both pass
 * a read-then-write check, so the guard belongs in the WHERE clause.
 */
export async function chargeForRender(
  userId: string,
  credits: number,
  durationSeconds: number,
): Promise<void> {
  const result = await prisma.user.updateMany({
    where: { id: userId, credits: { gte: credits } },
    data: {
      credits: { decrement: credits },
      periodSecondsUsed: { increment: Math.ceil(durationSeconds) },
    },
  });

  if (result.count === 0) {
    throw ApiError.planLimit('Your credit balance changed. Refresh and try again.');
  }
}

/** Returns credits after a failed render — the user got nothing, so they pay nothing. */
export async function refundRender(
  userId: string,
  credits: number,
  durationSeconds: number,
): Promise<void> {
  if (credits <= 0) return;
  await prisma.user.update({
    where: { id: userId },
    data: {
      credits: { increment: credits },
      periodSecondsUsed: { decrement: Math.ceil(durationSeconds) },
    },
  });
}

export async function assertConcurrencyAvailable(
  userId: string,
  plan: PlanId,
): Promise<void> {
  const limit = limitsFor(plan).concurrentJobs;
  const active = await prisma.job.count({
    where: { userId, status: { in: ['queued', 'analyzing', 'rendering', 'enhancing', 'encoding'] } },
  });

  if (active >= limit) {
    throw ApiError.planLimit(
      `The ${PLANS[plan].name} plan runs ${limit} render${limit === 1 ? '' : 's'} at a time. ` +
        `Wait for one to finish, or upgrade for more.`,
      { limit, active },
    );
  }
}

export async function assertStorageAvailable(
  user: Pick<User, 'plan' | 'storageUsedBytes'>,
  incomingBytes: number,
): Promise<void> {
  const limit = limitsFor(user.plan).storageBytes;
  if (Number(user.storageUsedBytes) + incomingBytes > limit) {
    throw ApiError.planLimit(
      'That upload would exceed your storage allowance. Delete a project or upgrade.',
      { limit, used: Number(user.storageUsedBytes) },
    );
  }
}

export function retentionDaysFor(plan: PlanId): number {
  return limitsFor(plan).retentionDays;
}

export function maxBatchFor(plan: PlanId): number {
  return limitsFor(plan).maxBatchSize;
}
