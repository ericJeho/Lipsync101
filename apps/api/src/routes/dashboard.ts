import { Router } from 'express';
import { z } from 'zod';
import { PLANS } from '@lipsync/shared';
import { prisma, serialiseBigInts } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { actorOf, requireAuth } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { queueCounts } from '../services/queue.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth());

const idParam = z.object({ id: z.string().uuid() });

/** Everything the dashboard landing page needs, in one round trip. */
dashboardRouter.get('/', async (req, res, next) => {
  try {
    const actor = actorOf(req);

    const [user, projectCount, jobCounts, recentJobs, favorites, queue] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: actor.userId } }),
      prisma.project.count({ where: { userId: actor.userId, archivedAt: null } }),
      prisma.job.groupBy({
        by: ['status'],
        where: { userId: actor.userId },
        _count: { _all: true },
      }),
      prisma.job.findMany({
        where: { userId: actor.userId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { project: { select: { id: true, name: true } } },
      }),
      prisma.project.findMany({
        where: { userId: actor.userId, favorite: true, archivedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 6,
      }),
      queueCounts(),
    ]);

    const plan = PLANS[user.plan];
    const byStatus = Object.fromEntries(
      jobCounts.map((row) => [row.status, row._count._all]),
    ) as Record<string, number>;

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        credits: user.credits,
      },
      storage: {
        usedBytes: Number(user.storageUsedBytes),
        limitBytes: plan.limits.storageBytes,
      },
      usage: {
        secondsUsed: user.periodSecondsUsed,
        secondsIncluded:
          plan.limits.minutesPerMonth === null ? null : plan.limits.minutesPerMonth * 60,
        resetsAt: user.periodResetAt.toISOString(),
      },
      counts: {
        projects: projectCount,
        renders: Object.values(byStatus).reduce((total, n) => total + n, 0),
        completed: byStatus.completed ?? 0,
        failed: byStatus.failed ?? 0,
        inFlight:
          (byStatus.queued ?? 0) +
          (byStatus.analyzing ?? 0) +
          (byStatus.rendering ?? 0) +
          (byStatus.enhancing ?? 0) +
          (byStatus.encoding ?? 0),
      },
      recentJobs: serialiseBigInts(recentJobs),
      favorites: serialiseBigInts(favorites),
      queue,
    });
  } catch (error) {
    next(error);
  }
});

/** Completed renders, newest first — the "Downloads" view. */
dashboardRouter.get('/downloads', async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const jobs = await prisma.job.findMany({
      where: { userId: actor.userId, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      take: 100,
      include: { project: { select: { id: true, name: true } } },
    });
    res.json({ downloads: serialiseBigInts(jobs) });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get('/notifications', async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const [notifications, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: actor.userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({ where: { userId: actor.userId, readAt: null } }),
    ]);
    res.json({ notifications, unread });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.post('/notifications/:id/read', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id!, userId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.post('/notifications/read-all', async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const result = await prisma.notification.updateMany({
      where: { userId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

dashboardRouter.patch(
  '/profile',
  validateBody(
    z.object({
      name: z.string().min(1).max(80).optional(),
      avatarUrl: z.string().url().nullable().optional(),
      locale: z.string().min(2).max(8).optional(),
      countryCode: z.string().length(2).optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const user = await prisma.user.update({
        where: { id: actor.userId },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name } : {}),
          ...(req.body.avatarUrl !== undefined ? { avatarUrl: req.body.avatarUrl } : {}),
          ...(req.body.locale !== undefined ? { locale: req.body.locale } : {}),
          ...(req.body.countryCode !== undefined
            ? { countryCode: req.body.countryCode.toUpperCase() }
            : {}),
        },
      });
      res.json({ user: serialiseBigInts(user) });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GDPR export. Returns everything we hold on the account as one JSON document.
 */
dashboardRouter.get('/export', async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      include: {
        projects: true,
        assets: { select: { id: true, filename: true, kind: true, createdAt: true } },
        jobs: true,
        payments: true,
        notifications: true,
      },
    });

    const { passwordHash: _passwordHash, twoFactorSecret: _secret, recoveryCodes: _codes, ...safe } =
      user;

    res.setHeader('content-type', 'application/json');
    res.setHeader('content-disposition', 'attachment; filename="lipsync-studio-export.json"');
    res.send(JSON.stringify(serialiseBigInts(safe), null, 2));
  } catch (error) {
    next(error);
  }
});

/**
 * GDPR erasure. Requires the account email as confirmation, because a cascade
 * delete of every project and render is not something to do on a stray click.
 */
dashboardRouter.post(
  '/delete-account',
  validateBody(z.object({ confirmEmail: z.string().email() })),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      if (req.body.confirmEmail.toLowerCase() !== actor.email.toLowerCase()) {
        throw ApiError.badRequest('Type your account email exactly to confirm deletion.');
      }

      const running = await prisma.job.count({
        where: {
          userId: actor.userId,
          status: { in: ['queued', 'analyzing', 'rendering', 'enhancing', 'encoding'] },
        },
      });
      if (running > 0) {
        throw ApiError.conflict('Cancel your in-flight renders before deleting the account.');
      }

      await prisma.auditLog.create({
        data: {
          userId: null,
          action: 'account.deleted',
          target: actor.userId,
          metadata: { email: actor.email },
          ip: req.ip,
        },
      });

      await prisma.user.delete({ where: { id: actor.userId } });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);
