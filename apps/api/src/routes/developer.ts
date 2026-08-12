import { Router } from 'express';
import { z } from 'zod';
import { createHmac, randomBytes } from 'node:crypto';
import { PLANS } from '@lipsync/shared';
import { prisma, serialiseBigInts } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { actorOf, requireAuth } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { generateApiKey } from '../services/tokens.js';

export const developerRouter = Router();
developerRouter.use(requireAuth());

const idParam = z.object({ id: z.string().uuid() });

const AVAILABLE_SCOPES = [
  'jobs:read',
  'jobs:write',
  'projects:read',
  'projects:write',
  'assets:read',
  'assets:write',
  'subtitles:read',
] as const;

/** API access is a Studio-plan feature; enforce it before anything is issued. */
function assertApiAccess(plan: string): void {
  if (!PLANS[plan as keyof typeof PLANS]?.limits.apiAccess) {
    throw ApiError.planLimit(
      'API access is included with the Studio plan. Upgrade to issue keys.',
      { requiredPlan: 'studio' },
    );
  }
}

/* ------------------------------------------------------------------ */
/* API keys                                                            */
/* ------------------------------------------------------------------ */

developerRouter.get('/keys', async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const keys = await prisma.apiKey.findMany({
      where: { userId: actor.userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      // keyHash is deliberately absent: nothing downstream needs it, and not
      // selecting it means it cannot leak through a careless response.
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
    res.json({ keys, availableScopes: AVAILABLE_SCOPES });
  } catch (error) {
    next(error);
  }
});

developerRouter.post(
  '/keys',
  validateBody(
    z.object({
      name: z.string().min(1).max(80),
      scopes: z.array(z.enum(AVAILABLE_SCOPES)).min(1).default(['jobs:read', 'jobs:write']),
    }),
  ),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      assertApiAccess(actor.plan);

      const generated = generateApiKey();
      const key = await prisma.apiKey.create({
        data: {
          userId: actor.userId,
          name: req.body.name,
          prefix: generated.prefix,
          keyHash: generated.hash,
          scopes: req.body.scopes,
        },
        select: { id: true, name: true, prefix: true, scopes: true, createdAt: true },
      });

      res.status(201).json({
        key,
        // The only time the plaintext exists outside the client's hands.
        secret: generated.plaintext,
        warning: 'Copy this key now — it is not shown again.',
      });
    } catch (error) {
      next(error);
    }
  },
);

developerRouter.delete('/keys/:id', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const result = await prisma.apiKey.updateMany({
      where: { id: req.params.id!, userId: actor.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw ApiError.notFound('That key does not exist.');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

const WEBHOOK_EVENTS = [
  'job.queued',
  'job.started',
  'job.progress',
  'job.completed',
  'job.failed',
  'batch.completed',
] as const;

developerRouter.get('/webhooks', async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const webhooks = await prisma.webhookEndpoint.findMany({
      where: { userId: actor.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        failureCount: true,
        lastStatus: true,
        createdAt: true,
      },
    });
    res.json({ webhooks, availableEvents: WEBHOOK_EVENTS });
  } catch (error) {
    next(error);
  }
});

developerRouter.post(
  '/webhooks',
  validateBody(
    z.object({
      url: z.string().url(),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
    }),
  ),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      assertApiAccess(actor.plan);

      const url = new URL(req.body.url);

      // Refuse plaintext and private-network targets: an endpoint we POST to on
      // the user's behalf is an SSRF primitive if it can reach internal hosts.
      if (url.protocol !== 'https:') {
        throw ApiError.badRequest('Webhook endpoints must use HTTPS.');
      }
      if (
        /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(url.hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)
      ) {
        throw ApiError.badRequest('Webhook endpoints must be publicly reachable addresses.');
      }

      const webhook = await prisma.webhookEndpoint.create({
        data: {
          userId: actor.userId,
          url: req.body.url,
          events: req.body.events,
          secret: randomBytes(32).toString('hex'),
        },
      });

      res.status(201).json({
        webhook: serialiseBigInts(webhook),
        note:
          'Verify the X-LipSync-Signature header as an HMAC-SHA256 of the raw body ' +
          'using this secret.',
      });
    } catch (error) {
      next(error);
    }
  },
);

developerRouter.delete('/webhooks/:id', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const result = await prisma.webhookEndpoint.deleteMany({
      where: { id: req.params.id!, userId: actor.userId },
    });
    if (result.count === 0) throw ApiError.notFound('That webhook does not exist.');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** Sends a signed sample payload so integrators can verify their receiver. */
developerRouter.post('/webhooks/:id/test', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const webhook = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id!, userId: actor.userId },
    });
    if (!webhook) throw ApiError.notFound('That webhook does not exist.');

    const result = await deliverWebhook(webhook, 'job.completed', {
      jobId: '00000000-0000-4000-8000-000000000000',
      status: 'completed',
      test: true,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Signs and POSTs a webhook. Exported so the render worker uses the identical
 * signature scheme the docs describe.
 */
export async function deliverWebhook(
  webhook: { id: string; url: string; secret: string },
  event: string,
  payload: Record<string, unknown>,
): Promise<{ delivered: boolean; status: number | null }> {
  const body = JSON.stringify({ event, sentAt: new Date().toISOString(), data: payload });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', webhook.secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lipsync-event': event,
        'x-lipsync-signature': `t=${timestamp},v1=${signature}`,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    await prisma.webhookEndpoint.update({
      where: { id: webhook.id },
      data: {
        lastStatus: response.status,
        // Reset the counter on success so an endpoint that recovers is not
        // disabled by failures it has since fixed.
        failureCount: response.ok ? 0 : { increment: 1 },
        ...(response.ok ? {} : {}),
      },
    });

    return { delivered: response.ok, status: response.status };
  } catch (error) {
    logger.warn({ err: error, webhookId: webhook.id }, 'Webhook delivery failed');
    await prisma.webhookEndpoint
      .update({
        where: { id: webhook.id },
        data: { failureCount: { increment: 1 }, lastStatus: null },
      })
      .catch(() => undefined);
    return { delivered: false, status: null };
  }
}
