import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { env, isTest } from '../config/env.js';
import { ApiError } from '../lib/errors.js';

/**
 * Rate limits are keyed by account when we know one, IP otherwise. Keying on IP
 * alone would let one abusive account rotate addresses, and would also punish
 * everyone behind a shared NAT for one user's traffic.
 */
function keyFor(req: Request): string {
  if (req.actor) return `user:${req.actor.userId}`;
  return `ip:${req.ip ?? 'unknown'}`;
}

function build(options: Partial<Options> & { max: number; windowMs: number }) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyFor,
    // Limits would make the test suite flaky and prove nothing, so they are off
    // under NODE_ENV=test; the limiter itself is covered by its own unit test.
    skip: () => isTest,
    handler: (_req, _res, next) => next(ApiError.tooManyRequests()),
    ...options,
  });
}

/** Baseline limit applied to the whole API surface. */
export const globalLimiter = build({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
});

/**
 * Credential endpoints get a much tighter budget — this is the difference
 * between an attacker testing ten passwords a minute and ten thousand.
 */
export const authLimiter = build({
  windowMs: 15 * 60_000,
  max: 10,
  skipSuccessfulRequests: true,
});

/** Password reset mail is expensive and abusable as a spam amplifier. */
export const passwordResetLimiter = build({
  windowMs: 60 * 60_000,
  max: 5,
});

/** Render submission — the endpoint that actually costs GPU money. */
export const renderLimiter = build({
  windowMs: 60_000,
  max: 20,
});

export const uploadLimiter = build({
  windowMs: 60_000,
  max: 60,
});
