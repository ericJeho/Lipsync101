import { Router } from 'express';
import { z } from 'zod';
import { PLANS } from '@lipsync/shared';
import { prisma, serialiseBigInts } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { actorOf, requireAuth } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth());

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  take: z.coerce.number().int().min(1).max(100).default(24),
  skip: z.coerce.number().int().min(0).default(0),
  favorite: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  search: z.string().max(120).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  teamId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  favorite: z.boolean().optional(),
  timeline: z.unknown().optional(),
  archived: z.boolean().optional(),
});

/** Throws unless the project exists and the caller may act on it. */
async function loadOwnedProject(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: { include: { members: true } } },
  });

  if (!project) throw ApiError.notFound('That project does not exist.');

  const isOwner = project.userId === userId;
  const isTeamMember = project.team?.members.some((m) => m.userId === userId) ?? false;
  if (!isOwner && !isTeamMember) {
    // 404 rather than 403 — confirming the id exists tells an attacker they
    // guessed a real project.
    throw ApiError.notFound('That project does not exist.');
  }

  return project;
}

projectsRouter.get('/', validateQuery(listQuery), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const query = req.query as unknown as z.infer<typeof listQuery>;

    const where = {
      userId: actor.userId,
      archivedAt: query.archived ? { not: null } : null,
      ...(query.favorite !== undefined ? { favorite: query.favorite } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: query.take,
        skip: query.skip,
        include: {
          _count: { select: { jobs: true, assets: true } },
          jobs: {
            where: { status: 'completed' },
            orderBy: { completedAt: 'desc' },
            take: 1,
            select: { id: true, thumbnailUrl: true, outputUrl: true, completedAt: true },
          },
        },
      }),
      prisma.project.count({ where }),
    ]);

    res.json({ projects: serialiseBigInts(projects), total });
  } catch (error) {
    next(error);
  }
});

projectsRouter.post('/', validateBody(createSchema), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const body = req.body as z.infer<typeof createSchema>;

    const limit = PLANS[actor.plan as keyof typeof PLANS].limits.maxProjects;
    if (limit !== null) {
      const count = await prisma.project.count({
        where: { userId: actor.userId, archivedAt: null },
      });
      if (count >= limit) {
        throw ApiError.planLimit(
          `The ${PLANS[actor.plan as keyof typeof PLANS].name} plan holds ${limit} active ` +
            `projects. Archive one or upgrade for unlimited projects.`,
          { limit, count },
        );
      }
    }

    if (body.teamId) {
      const membership = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: body.teamId, userId: actor.userId } },
      });
      if (!membership) throw ApiError.forbidden('You are not a member of that team.');
    }

    const project = await prisma.project.create({
      data: {
        userId: actor.userId,
        name: body.name,
        description: body.description ?? null,
        teamId: body.teamId ?? null,
      },
    });

    res.status(201).json({ project: serialiseBigInts(project) });
  } catch (error) {
    next(error);
  }
});

projectsRouter.get('/:id', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    await loadOwnedProject(req.params.id!, actor.userId);

    const project = await prisma.project.findUnique({
      where: { id: req.params.id! },
      include: {
        assets: { orderBy: { createdAt: 'desc' } },
        jobs: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });

    res.json({ project: serialiseBigInts(project) });
  } catch (error) {
    next(error);
  }
});

projectsRouter.patch(
  '/:id',
  validateParams(idParam),
  validateBody(updateSchema),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      await loadOwnedProject(req.params.id!, actor.userId);
      const body = req.body as z.infer<typeof updateSchema>;

      const project = await prisma.project.update({
        where: { id: req.params.id! },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.favorite !== undefined ? { favorite: body.favorite } : {}),
          ...(body.timeline !== undefined
            ? { timeline: body.timeline as object }
            : {}),
          ...(body.archived !== undefined
            ? { archivedAt: body.archived ? new Date() : null }
            : {}),
        },
      });

      res.json({ project: serialiseBigInts(project) });
    } catch (error) {
      next(error);
    }
  },
);

projectsRouter.delete('/:id', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const project = await loadOwnedProject(req.params.id!, actor.userId);

    // Team projects can only be deleted by whoever created them; a viewer being
    // able to delete shared work would be a nasty surprise.
    if (project.userId !== actor.userId) {
      throw ApiError.forbidden('Only the project owner can delete it.');
    }

    const running = await prisma.job.count({
      where: {
        projectId: project.id,
        status: { in: ['queued', 'analyzing', 'rendering', 'enhancing', 'encoding'] },
      },
    });
    if (running > 0) {
      throw ApiError.conflict(
        `This project has ${running} render${running === 1 ? '' : 's'} in flight. ` +
          `Cancel them first, or wait for them to finish.`,
      );
    }

    await prisma.project.delete({ where: { id: project.id } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** Duplicates a project's settings and timeline without copying media. */
projectsRouter.post('/:id/duplicate', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const source = await loadOwnedProject(req.params.id!, actor.userId);

    const copy = await prisma.project.create({
      data: {
        userId: actor.userId,
        name: `${source.name} (copy)`,
        description: source.description,
        timeline: source.timeline ?? undefined,
        teamId: source.teamId,
      },
    });

    res.status(201).json({ project: serialiseBigInts(copy) });
  } catch (error) {
    next(error);
  }
});
