import { Router } from 'express';
import { z } from 'zod';
import { PLANS } from '@lipsync/shared';
import { prisma, serialiseBigInts } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { actorOf, requireAuth } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { storage } from '../lib/storage.js';
import { aiClient } from '../services/aiClient.js';

export const voiceRouter = Router();
voiceRouter.use(requireAuth());

const idParam = z.object({ id: z.string().uuid() });

/**
 * Voice cloning is the feature most open to misuse, so consent is a hard
 * precondition rather than a checkbox we record and ignore: without an explicit
 * affirmation the request is rejected, and the affirmation is stored with the
 * timestamp and IP that produced it.
 */
const createSchema = z.object({
  name: z.string().min(1).max(80),
  sampleAssetIds: z.array(z.string().uuid()).min(1).max(10),
  consent: z.literal(true, {
    errorMap: () => ({
      message:
        'You must confirm you own this voice, or have the speaker’s explicit permission, to clone it.',
    }),
  }),
});

voiceRouter.get('/', async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const clones = await prisma.voiceClone.findMany({
      where: { userId: actor.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        consentAcceptedAt: true,
      },
    });
    res.json({ clones });
  } catch (error) {
    next(error);
  }
});

voiceRouter.post('/', validateBody(createSchema), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const body = req.body as z.infer<typeof createSchema>;

    if (actor.plan === 'free') {
      throw ApiError.planLimit(
        'Voice cloning is available on the Pro and Studio plans.',
        { requiredPlan: 'pro' },
      );
    }

    const samples = await prisma.asset.findMany({
      where: {
        id: { in: body.sampleAssetIds },
        userId: actor.userId,
        kind: 'audio',
        status: 'ready',
      },
    });

    if (samples.length !== body.sampleAssetIds.length) {
      throw ApiError.badRequest(
        'Some of those samples are missing or still processing. Upload them again.',
      );
    }

    const clone = await prisma.voiceClone.create({
      data: {
        userId: actor.userId,
        name: body.name,
        sampleKeys: samples.map((s) => s.storageKey),
        status: 'training',
        consentAcceptedAt: new Date(),
        consentIp: req.ip ?? null,
      },
    });

    // Training runs out of band; the record starts as "training" and the
    // callback flips it to ready or failed.
    const sampleUrls = await Promise.all(
      samples.map((s) => storage.createDownloadUrl(s.storageKey, 3600)),
    );

    void aiClient
      .cloneVoice(sampleUrls, body.name)
      .then((result) =>
        prisma.voiceClone.update({
          where: { id: clone.id },
          data: { status: result.status, modelKey: result.modelKey },
        }),
      )
      .catch(async (error) => {
        logger.error({ err: error, cloneId: clone.id }, 'Voice clone training failed');
        await prisma.voiceClone
          .update({ where: { id: clone.id }, data: { status: 'failed' } })
          .catch(() => undefined);
      });

    res.status(202).json({
      clone: serialiseBigInts(clone),
      message: 'Training started. This usually takes a few minutes.',
    });
  } catch (error) {
    next(error);
  }
});

voiceRouter.get('/:id', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const clone = await prisma.voiceClone.findFirst({
      where: { id: req.params.id!, userId: actor.userId },
      select: { id: true, name: true, status: true, createdAt: true },
    });
    if (!clone) throw ApiError.notFound('That voice does not exist.');
    res.json({ clone });
  } catch (error) {
    next(error);
  }
});

voiceRouter.delete('/:id', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const result = await prisma.voiceClone.deleteMany({
      where: { id: req.params.id!, userId: actor.userId },
    });
    if (result.count === 0) throw ApiError.notFound('That voice does not exist.');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** Which plans include cloning — drives the upsell state in the UI. */
voiceRouter.get('/meta/availability', (req, res) => {
  const actor = actorOf(req);
  res.json({
    available: actor.plan !== 'free',
    plan: actor.plan,
    requiredPlan: 'pro',
    plans: Object.values(PLANS).map((p) => ({ id: p.id, name: p.name })),
  });
});
