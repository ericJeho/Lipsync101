import { Router } from 'express';
import { z } from 'zod';
import {
  DEFAULT_EXPRESSION,
  JOB_STATUSES,
  createJobSchema,
  expressionSchema,
  isTerminal,
  type MediaProbe,
} from '@lipsync/shared';
import { prisma, serialiseBigInts } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { actorOf, requireAuth, requireScope } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { renderLimiter } from '../middleware/rateLimit.js';
import { storage } from '../lib/storage.js';
import { aiClient } from '../services/aiClient.js';
import {
  assertConcurrencyAvailable,
  chargeForRender,
  maxBatchFor,
  quoteRender,
  refundRender,
} from '../services/entitlements.js';
import { enqueueRender, queuePositionOf, removeRender } from '../services/queue.js';
import { publishCredits } from '../realtime/socket.js';

export const jobsRouter = Router();
jobsRouter.use(requireAuth());

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  take: z.coerce.number().int().min(1).max(100).default(25),
  skip: z.coerce.number().int().min(0).default(0),
  status: z.enum(JOB_STATUSES).optional(),
  projectId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
});

/** Pulls the clip length off the probed asset, rejecting unprobed media. */
function durationOf(probe: unknown, label: string): number {
  const duration = (probe as MediaProbe | null)?.durationSeconds;
  if (!duration || duration <= 0) {
    throw ApiError.badRequest(
      `We do not have a duration for that ${label} yet. Finish the upload first.`,
    );
  }
  return duration;
}

/**
 * Validates a render request, prices it, charges credits and enqueues the work.
 *
 * Shared by the single-render endpoint and the batch endpoint so both take the
 * identical path through entitlements — a batch must not be a way to skip a
 * plan limit.
 */
async function submitRender(
  userId: string,
  payload: z.output<typeof createJobSchema>,
  options: { batchId?: string } = {},
) {
  const [user, project, videoAsset, audioAsset] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.project.findFirst({ where: { id: payload.projectId, userId } }),
    prisma.asset.findFirst({ where: { id: payload.videoAssetId, userId } }),
    prisma.asset.findFirst({ where: { id: payload.audioAssetId, userId } }),
  ]);

  if (!project) throw ApiError.notFound('That project does not exist.');
  if (!videoAsset || videoAsset.kind !== 'video') {
    throw ApiError.badRequest('Pick a video to lip-sync.');
  }
  if (!audioAsset || audioAsset.kind !== 'audio') {
    throw ApiError.badRequest('Pick an audio track to sync to.');
  }
  for (const asset of [videoAsset, audioAsset]) {
    if (asset.status !== 'ready') {
      throw ApiError.badRequest(
        asset.status === 'quarantined'
          ? 'One of those files was blocked by moderation and cannot be rendered.'
          : 'One of those files is still uploading.',
      );
    }
  }

  // The output is as long as the audio: the video is looped or trimmed to fit.
  const durationSeconds = durationOf(audioAsset.probe, 'audio track');
  durationOf(videoAsset.probe, 'video');

  const quote = quoteRender(user, {
    durationSeconds,
    preset: payload.preset,
    engine: payload.engine,
    outputHeight: payload.outputHeight,
    enhancementCount: payload.enhancements.length,
  });

  await assertConcurrencyAvailable(userId, user.plan);
  await chargeForRender(userId, quote.credits, durationSeconds);

  try {
    const job = await prisma.job.create({
      data: {
        userId,
        projectId: payload.projectId,
        batchId: options.batchId ?? null,
        videoAssetId: payload.videoAssetId,
        audioAssetId: payload.audioAssetId,
        engine: quote.engine,
        preset: payload.preset,
        outputFormat: payload.outputFormat,
        outputHeight: quote.outputHeight,
        enhancements: payload.enhancements,
        expression: (payload.expression ?? DEFAULT_EXPRESSION) as unknown as object,
        musicMode: payload.musicMode,
        karaokeTiming: payload.karaokeTiming,
        translateTo: payload.translateTo,
        voiceCloneId: payload.voiceCloneId,
        burnInSubtitles: payload.subtitles.burnIn,
        subtitleLanguages: payload.subtitles.enabled ? payload.subtitles.languages : [],
        notifyByEmail: payload.notifyByEmail,
        creditsCharged: quote.credits,
        etaSeconds: quote.estimatedSeconds,
        priority: quote.priority,
      },
    });

    await enqueueRender({ jobId: job.id, userId }, { priority: quote.priority });

    const remaining = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { credits: true },
    });
    publishCredits(userId, remaining.credits);

    return { job, quote };
  } catch (error) {
    // Anything after the charge must give the credits back — a user should
    // never pay for a render that was never created.
    await refundRender(userId, quote.credits, durationSeconds).catch((refundError) =>
      logger.error({ err: refundError, userId }, 'Refund after failed submit also failed'),
    );
    throw error;
  }
}

jobsRouter.post(
  '/',
  renderLimiter,
  requireScope('jobs:write'),
  validateBody(createJobSchema),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const { job, quote } = await submitRender(actor.userId, req.body);
      res.status(201).json({ job: serialiseBigInts(job), quote });
    } catch (error) {
      next(error);
    }
  },
);

/** Prices a render without submitting it — powers the cost preview in the UI. */
jobsRouter.post(
  '/quote',
  validateBody(
    z.object({
      audioAssetId: z.string().uuid(),
      preset: z.enum(['fast', 'balanced', 'highest']).default('balanced'),
      engine: z.string().optional(),
      outputHeight: z.coerce.number().int().default(1080),
      enhancementCount: z.coerce.number().int().min(0).max(7).default(0),
    }),
  ),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const [user, audioAsset] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: actor.userId } }),
        prisma.asset.findFirst({
          where: { id: req.body.audioAssetId, userId: actor.userId },
        }),
      ]);
      if (!audioAsset) throw ApiError.notFound('That audio track does not exist.');

      const quote = quoteRender(user, {
        durationSeconds: durationOf(audioAsset.probe, 'audio track'),
        preset: req.body.preset,
        engine: req.body.engine as never,
        outputHeight: req.body.outputHeight,
        enhancementCount: req.body.enhancementCount,
      });

      res.json({ quote, balance: user.credits });
    } catch (error) {
      next(error);
    }
  },
);

/* ------------------------------------------------------------------ */
/* Batch                                                               */
/* ------------------------------------------------------------------ */

jobsRouter.post(
  '/batch',
  renderLimiter,
  requireScope('jobs:write'),
  validateBody(
    z.object({
      name: z.string().min(1).max(120).default('Batch render'),
      jobs: z.array(createJobSchema).min(1).max(50),
    }),
  ),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
      const requested = req.body.jobs as z.output<typeof createJobSchema>[];

      const limit = maxBatchFor(user.plan);
      if (requested.length > limit) {
        throw ApiError.planLimit(
          `Your plan batches up to ${limit} render${limit === 1 ? '' : 's'} at a time.`,
          { limit, requested: requested.length },
        );
      }

      const batch = await prisma.batch.create({
        data: { userId: actor.userId, name: req.body.name },
      });

      // Each entry is submitted independently: one bad clip should not sink the
      // whole batch, so failures are collected and reported per item.
      const created: unknown[] = [];
      const failed: { index: number; message: string }[] = [];

      for (const [index, payload] of requested.entries()) {
        try {
          const { job } = await submitRender(actor.userId, payload, { batchId: batch.id });
          created.push(serialiseBigInts(job));
        } catch (error) {
          failed.push({
            index,
            message: error instanceof Error ? error.message : 'Could not queue this render.',
          });
        }
      }

      res.status(created.length > 0 ? 201 : 422).json({
        batch: serialiseBigInts(batch),
        jobs: created,
        failed,
      });
    } catch (error) {
      next(error);
    }
  },
);

jobsRouter.post('/batch/:id/pause', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const batch = await prisma.batch.findFirst({
      where: { id: req.params.id!, userId: actor.userId },
    });
    if (!batch) throw ApiError.notFound('That batch does not exist.');

    const queued = await prisma.job.findMany({
      where: { batchId: batch.id, status: 'queued' },
      select: { id: true },
    });

    // Only queued work can be paused; anything already on a GPU runs to
    // completion so we do not waste the cycles already spent.
    await Promise.all(queued.map((job) => removeRender(job.id)));
    await prisma.$transaction([
      prisma.batch.update({ where: { id: batch.id }, data: { paused: true } }),
      prisma.job.updateMany({
        where: { batchId: batch.id, status: 'queued' },
        data: { status: 'paused', stage: 'Paused' },
      }),
    ]);

    res.json({ paused: true, affected: queued.length });
  } catch (error) {
    next(error);
  }
});

jobsRouter.post('/batch/:id/resume', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const batch = await prisma.batch.findFirst({
      where: { id: req.params.id!, userId: actor.userId },
    });
    if (!batch) throw ApiError.notFound('That batch does not exist.');

    const paused = await prisma.job.findMany({
      where: { batchId: batch.id, status: 'paused' },
      select: { id: true, priority: true },
    });

    await prisma.$transaction([
      prisma.batch.update({ where: { id: batch.id }, data: { paused: false } }),
      prisma.job.updateMany({
        where: { batchId: batch.id, status: 'paused' },
        data: { status: 'queued', stage: 'Queued' },
      }),
    ]);

    await Promise.all(
      paused.map((job) =>
        enqueueRender({ jobId: job.id, userId: actor.userId }, { priority: job.priority }),
      ),
    );

    res.json({ resumed: true, affected: paused.length });
  } catch (error) {
    next(error);
  }
});

jobsRouter.get('/batch/:id', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const batch = await prisma.batch.findFirst({
      where: { id: req.params.id!, userId: actor.userId },
      include: { jobs: { orderBy: { createdAt: 'asc' } } },
    });
    if (!batch) throw ApiError.notFound('That batch does not exist.');

    const done = batch.jobs.filter((job) => isTerminal(job.status)).length;
    res.json({
      batch: serialiseBigInts(batch),
      summary: {
        total: batch.jobs.length,
        completed: batch.jobs.filter((j) => j.status === 'completed').length,
        failed: batch.jobs.filter((j) => j.status === 'failed').length,
        remaining: batch.jobs.length - done,
        // Remaining jobs run at the account's concurrency, so the estimate is
        // the serial sum divided by how many can run at once.
        etaSeconds: batch.jobs
          .filter((j) => !isTerminal(j.status))
          .reduce((total, j) => total + (j.etaSeconds ?? 0), 0),
      },
    });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Single job                                                          */
/* ------------------------------------------------------------------ */

jobsRouter.get('/', requireScope('jobs:read'), validateQuery(listQuery), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const query = req.query as unknown as z.infer<typeof listQuery>;

    const where = {
      userId: actor.userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
    };

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.take,
        skip: query.skip,
        include: {
          project: { select: { id: true, name: true } },
          videoAsset: { select: { id: true, filename: true } },
          audioAsset: { select: { id: true, filename: true } },
        },
      }),
      prisma.job.count({ where }),
    ]);

    res.json({ jobs: serialiseBigInts(jobs), total });
  } catch (error) {
    next(error);
  }
});

jobsRouter.get(
  '/:id',
  requireScope('jobs:read'),
  validateParams(idParam),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const job = await prisma.job.findFirst({
        where: { id: req.params.id!, userId: actor.userId },
        include: {
          project: { select: { id: true, name: true } },
          videoAsset: true,
          audioAsset: true,
        },
      });
      if (!job) throw ApiError.notFound('That render does not exist.');

      const queuePosition =
        job.status === 'queued' ? await queuePositionOf(job.id) : null;

      res.json({ job: serialiseBigInts({ ...job, queuePosition }) });
    } catch (error) {
      next(error);
    }
  },
);

/** Signed download link for a finished render. */
jobsRouter.get('/:id/download', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const job = await prisma.job.findFirst({
      where: { id: req.params.id!, userId: actor.userId },
    });
    if (!job) throw ApiError.notFound('That render does not exist.');
    if (job.status !== 'completed' || !job.outputKey) {
      throw ApiError.conflict('That render has not finished yet.');
    }

    res.json({ url: await storage.createDownloadUrl(job.outputKey, 900) });
  } catch (error) {
    next(error);
  }
});

jobsRouter.post('/:id/cancel', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const job = await prisma.job.findFirst({
      where: { id: req.params.id!, userId: actor.userId },
    });
    if (!job) throw ApiError.notFound('That render does not exist.');
    if (isTerminal(job.status)) {
      throw ApiError.conflict('That render already finished.');
    }

    await removeRender(job.id);
    await aiClient.cancel(job.id).catch(() => undefined);

    // Only refund work that never reached a GPU — cancelling a render that is
    // already consuming cycles still costs us those cycles.
    const refundable = job.status === 'queued' || job.status === 'paused';
    if (refundable && job.creditsCharged > 0) {
      const audio = await prisma.asset.findUnique({ where: { id: job.audioAssetId } });
      const duration = (audio?.probe as MediaProbe | null)?.durationSeconds ?? 0;
      await refundRender(job.userId, job.creditsCharged, duration);
    }

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'cancelled',
        stage: 'Cancelled',
        completedAt: new Date(),
        error: 'Cancelled by the account owner.',
      },
    });

    res.json({
      job: serialiseBigInts(updated),
      creditsRefunded: refundable ? job.creditsCharged : 0,
    });
  } catch (error) {
    next(error);
  }
});

/** Re-runs a failed render with optionally tweaked expression settings. */
jobsRouter.post(
  '/:id/retry',
  renderLimiter,
  validateParams(idParam),
  validateBody(z.object({ expression: expressionSchema.optional() })),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const previous = await prisma.job.findFirst({
        where: { id: req.params.id!, userId: actor.userId },
      });
      if (!previous) throw ApiError.notFound('That render does not exist.');
      if (previous.status !== 'failed' && previous.status !== 'cancelled') {
        throw ApiError.conflict('Only failed or cancelled renders can be retried.');
      }

      const { job, quote } = await submitRender(actor.userId, {
        projectId: previous.projectId,
        videoAssetId: previous.videoAssetId,
        audioAssetId: previous.audioAssetId,
        engine: previous.engine as never,
        preset: previous.preset as never,
        outputFormat: previous.outputFormat as never,
        outputHeight: previous.outputHeight as never,
        enhancements: previous.enhancements as never,
        expression: (req.body.expression ??
          (previous.expression as never)) as never,
        musicMode: previous.musicMode,
        karaokeTiming: previous.karaokeTiming,
        translateTo: previous.translateTo,
        voiceCloneId: previous.voiceCloneId,
        subtitles: {
          enabled: previous.subtitleLanguages.length > 0,
          burnIn: previous.burnInSubtitles,
          languages: previous.subtitleLanguages,
        },
        notifyByEmail: previous.notifyByEmail,
      });

      res.status(201).json({ job: serialiseBigInts(job), quote });
    } catch (error) {
      next(error);
    }
  },
);
