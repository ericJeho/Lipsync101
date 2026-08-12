import { Router } from 'express';
import { z } from 'zod';
import { MODERATION_CATEGORIES, PLAN_IDS } from '@lipsync/shared';
import { prisma, serialiseBigInts } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { actorOf, requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { pauseQueue, queueCounts, removeRender, resumeQueue } from '../services/queue.js';
import { aiClient } from '../services/aiClient.js';

export const adminRouter = Router();
adminRouter.use(requireAuth());

const idParam = z.object({ id: z.string().uuid() });

/** Records who did what, so privileged actions are always attributable. */
async function audit(
  userId: string,
  action: string,
  target: string,
  metadata: Record<string, unknown>,
  ip?: string,
) {
  await prisma.auditLog.create({
    data: { userId, action, target, metadata: metadata as object, ip },
  });
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

adminRouter.get('/overview', requireRole('admin'), async (_req, res, next) => {
  try {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const monthAgo = new Date(Date.now() - 30 * 86_400_000);

    const [
      totalUsers,
      newUsers,
      usersByPlan,
      jobsToday,
      jobsByStatus,
      revenue,
      pendingFlags,
      storage,
      queue,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: monthAgo } } }),
      prisma.user.groupBy({ by: ['plan'], _count: { _all: true } }),
      prisma.job.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.payment.aggregate({
        where: { status: 'succeeded', settledAt: { gte: monthAgo } },
        _sum: { amountMinor: true },
      }),
      prisma.moderationFlag.count({ where: { reviewedAt: null } }),
      prisma.user.aggregate({ _sum: { storageUsedBytes: true } }),
      queueCounts(),
    ]);

    const aiHealth = await aiClient.health().catch(() => ({
      status: 'unreachable',
      gpu: false,
      engines: [] as string[],
    }));

    res.json({
      users: {
        total: totalUsers,
        newThisMonth: newUsers,
        byPlan: Object.fromEntries(usersByPlan.map((r) => [r.plan, r._count._all])),
      },
      jobs: {
        last24h: jobsToday,
        byStatus: Object.fromEntries(jobsByStatus.map((r) => [r.status, r._count._all])),
      },
      revenue: {
        // Stored in minor units; the dashboard formats it.
        last30DaysMinor: revenue._sum.amountMinor ?? 0,
        currency: 'USD',
      },
      moderation: { pendingFlags },
      storage: { totalBytes: Number(storage._sum.storageUsedBytes ?? 0) },
      queue,
      aiService: aiHealth,
    });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

adminRouter.get(
  '/users',
  requireRole('admin'),
  validateQuery(
    z.object({
      take: z.coerce.number().int().min(1).max(100).default(25),
      skip: z.coerce.number().int().min(0).default(0),
      search: z.string().max(200).optional(),
      plan: z.enum(PLAN_IDS).optional(),
      suspended: z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => (v === undefined ? undefined : v === 'true')),
    }),
  ),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as {
        take: number;
        skip: number;
        search?: string;
        plan?: string;
        suspended?: boolean;
      };

      const where = {
        ...(query.search
          ? {
              OR: [
                { email: { contains: query.search, mode: 'insensitive' as const } },
                { name: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...(query.plan ? { plan: query.plan as never } : {}),
        ...(query.suspended === undefined
          ? {}
          : { suspendedAt: query.suspended ? { not: null } : null }),
      };

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: query.take,
          skip: query.skip,
          select: {
            id: true,
            email: true,
            name: true,
            plan: true,
            role: true,
            credits: true,
            storageUsedBytes: true,
            suspendedAt: true,
            suspendedReason: true,
            createdAt: true,
            lastSeenAt: true,
            _count: { select: { jobs: true, projects: true } },
          },
        }),
        prisma.user.count({ where }),
      ]);

      res.json({ users: serialiseBigInts(users), total });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  '/users/:id/suspend',
  requireRole('admin', 'moderator'),
  validateParams(idParam),
  validateBody(z.object({ reason: z.string().min(3).max(500) })),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const targetId = req.params.id!;

      if (targetId === actor.userId) {
        throw ApiError.badRequest('You cannot suspend your own account.');
      }

      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) throw ApiError.notFound('No such user.');
      // A moderator suspending an admin would be a privilege inversion.
      if (target.role === 'admin' && actor.role !== 'admin') {
        throw ApiError.forbidden('Only an admin can suspend another admin.');
      }

      const user = await prisma.user.update({
        where: { id: targetId },
        data: { suspendedAt: new Date(), suspendedReason: req.body.reason },
      });

      // Suspension has to end the user's live sessions, or their existing
      // access token keeps working until it expires.
      await prisma.session.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await audit(actor.userId, 'user.suspended', targetId, { reason: req.body.reason }, req.ip);
      res.json({ user: serialiseBigInts(user) });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  '/users/:id/reinstate',
  requireRole('admin', 'moderator'),
  validateParams(idParam),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const user = await prisma.user.update({
        where: { id: req.params.id! },
        data: { suspendedAt: null, suspendedReason: null },
      });
      await audit(actor.userId, 'user.reinstated', user.id, {}, req.ip);
      res.json({ user: serialiseBigInts(user) });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.patch(
  '/users/:id',
  requireRole('admin'),
  validateParams(idParam),
  validateBody(
    z.object({
      plan: z.enum(PLAN_IDS).optional(),
      role: z.enum(['user', 'moderator', 'admin']).optional(),
      credits: z.number().int().min(0).max(10_000_000).optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const targetId = req.params.id!;

      // Without this, an admin could demote themselves and leave the deployment
      // with no way back in.
      if (targetId === actor.userId && req.body.role && req.body.role !== 'admin') {
        throw ApiError.badRequest('You cannot remove your own admin role.');
      }

      const user = await prisma.user.update({
        where: { id: targetId },
        data: {
          ...(req.body.plan ? { plan: req.body.plan } : {}),
          ...(req.body.role ? { role: req.body.role } : {}),
          ...(req.body.credits !== undefined ? { credits: req.body.credits } : {}),
        },
      });

      await audit(actor.userId, 'user.updated', targetId, req.body, req.ip);
      res.json({ user: serialiseBigInts(user) });
    } catch (error) {
      next(error);
    }
  },
);

/* ------------------------------------------------------------------ */
/* GPU jobs                                                            */
/* ------------------------------------------------------------------ */

adminRouter.get(
  '/jobs',
  requireRole('admin'),
  validateQuery(
    z.object({
      take: z.coerce.number().int().min(1).max(100).default(50),
      status: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { take: number; status?: string };
      const jobs = await prisma.job.findMany({
        where: query.status ? { status: query.status as never } : {},
        orderBy: { createdAt: 'desc' },
        take: query.take,
        include: {
          user: { select: { id: true, email: true, plan: true } },
          project: { select: { id: true, name: true } },
        },
      });
      res.json({ jobs: serialiseBigInts(jobs), queue: await queueCounts() });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post('/jobs/:id/kill', requireRole('admin'), validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const job = await prisma.job.findUnique({ where: { id: req.params.id! } });
    if (!job) throw ApiError.notFound('No such render.');

    await removeRender(job.id);
    await aiClient.cancel(job.id).catch(() => undefined);

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'cancelled',
        stage: 'Stopped by an administrator',
        completedAt: new Date(),
        error: 'Stopped by an administrator.',
      },
    });

    await audit(actor.userId, 'job.killed', job.id, { userId: job.userId }, req.ip);
    res.json({ job: serialiseBigInts(updated) });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/queue/pause', requireRole('admin'), async (req, res, next) => {
  try {
    await pauseQueue();
    await audit(actorOf(req).userId, 'queue.paused', 'render', {}, req.ip);
    res.json({ paused: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/queue/resume', requireRole('admin'), async (req, res, next) => {
  try {
    await resumeQueue();
    await audit(actorOf(req).userId, 'queue.resumed', 'render', {}, req.ip);
    res.json({ paused: false });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Moderation                                                          */
/* ------------------------------------------------------------------ */

adminRouter.get(
  '/moderation',
  requireRole('admin', 'moderator'),
  validateQuery(
    z.object({
      reviewed: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
      action: z.enum(['allow', 'flag', 'block']).optional(),
      take: z.coerce.number().int().min(1).max(100).default(50),
    }),
  ),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as {
        reviewed: boolean;
        action?: string;
        take: number;
      };

      const flags = await prisma.moderationFlag.findMany({
        where: {
          reviewedAt: query.reviewed ? { not: null } : null,
          ...(query.action ? { action: query.action as never } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: query.take,
        include: {
          asset: {
            select: { id: true, filename: true, kind: true, userId: true, status: true },
          },
          job: { select: { id: true, status: true, userId: true } },
          reviewedBy: { select: { id: true, email: true } },
        },
      });

      res.json({ flags: serialiseBigInts(flags), categories: MODERATION_CATEGORIES });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  '/moderation/:id/review',
  requireRole('admin', 'moderator'),
  validateParams(idParam),
  validateBody(
    z.object({
      decision: z.enum(['uphold', 'overturn']),
      note: z.string().max(1000).optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const flag = await prisma.moderationFlag.findUnique({
        where: { id: req.params.id! },
        include: { asset: true },
      });
      if (!flag) throw ApiError.notFound('No such flag.');

      const updated = await prisma.moderationFlag.update({
        where: { id: flag.id },
        data: {
          action: req.body.decision === 'uphold' ? 'block' : 'allow',
          reviewedById: actor.userId,
          reviewedAt: new Date(),
          reviewNote: req.body.note ?? null,
        },
      });

      // Overturning a block has to actually restore the asset, otherwise the
      // review is cosmetic and the user still cannot use their file.
      if (req.body.decision === 'overturn' && flag.assetId) {
        await prisma.asset.update({
          where: { id: flag.assetId },
          data: { status: 'ready' },
        });
      }
      if (req.body.decision === 'uphold' && flag.assetId) {
        await prisma.asset.update({
          where: { id: flag.assetId },
          data: { status: 'quarantined' },
        });
      }

      await audit(actor.userId, `moderation.${req.body.decision}`, flag.id, {}, req.ip);
      res.json({ flag: serialiseBigInts(updated) });
    } catch (error) {
      next(error);
    }
  },
);

/* ------------------------------------------------------------------ */
/* Payments and logs                                                   */
/* ------------------------------------------------------------------ */

adminRouter.get('/payments', requireRole('admin'), async (req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, email: true } } },
    });
    res.json({ payments: serialiseBigInts(payments) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get(
  '/logs',
  requireRole('admin'),
  validateQuery(
    z.object({
      take: z.coerce.number().int().min(1).max(200).default(100),
      action: z.string().max(80).optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as { take: number; action?: string };
      const logs = await prisma.auditLog.findMany({
        where: query.action ? { action: { startsWith: query.action } } : {},
        orderBy: { createdAt: 'desc' },
        take: query.take,
        include: { user: { select: { id: true, email: true } } },
      });
      res.json({ logs: serialiseBigInts(logs) });
    } catch (error) {
      next(error);
    }
  },
);

/** Daily signups, renders and revenue for the analytics charts. */
adminRouter.get(
  '/analytics',
  requireRole('admin'),
  validateQuery(z.object({ days: z.coerce.number().int().min(7).max(90).default(30) })),
  async (req, res, next) => {
    try {
      const days = (req.query as unknown as { days: number }).days;
      const since = new Date(Date.now() - days * 86_400_000);

      // Grouping by day is far cheaper in SQL than pulling every row into Node
      // and bucketing it here.
      const [signups, renders, revenue] = await Promise.all([
        prisma.$queryRaw<{ day: Date; count: bigint }[]>`
          SELECT date_trunc('day', "createdAt") AS day, count(*) AS count
          FROM "User" WHERE "createdAt" >= ${since}
          GROUP BY day ORDER BY day ASC`,
        prisma.$queryRaw<{ day: Date; count: bigint; status: string }[]>`
          SELECT date_trunc('day', "createdAt") AS day, "status"::text AS status, count(*) AS count
          FROM "Job" WHERE "createdAt" >= ${since}
          GROUP BY day, status ORDER BY day ASC`,
        prisma.$queryRaw<{ day: Date; total: bigint }[]>`
          SELECT date_trunc('day', "settledAt") AS day, sum("amountMinor") AS total
          FROM "Payment" WHERE "status" = 'succeeded' AND "settledAt" >= ${since}
          GROUP BY day ORDER BY day ASC`,
      ]);

      res.json({
        days,
        signups: signups.map((r) => ({ day: r.day, count: Number(r.count) })),
        renders: renders.map((r) => ({
          day: r.day,
          status: r.status,
          count: Number(r.count),
        })),
        revenue: revenue.map((r) => ({ day: r.day, totalMinor: Number(r.total) })),
      });
    } catch (error) {
      next(error);
    }
  },
);
