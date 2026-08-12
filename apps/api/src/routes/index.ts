import { Router } from 'express';
import {
  APP_NAME,
  ENGINE_LIST,
  ENHANCEMENT_LABELS,
  EXPRESSION_CONTROL_META,
  SOCIAL_PRESETS,
  SUPPORTED_LANGUAGES,
} from '@lipsync/shared';
import { prisma } from '../lib/prisma.js';
import { getRedis } from '../lib/redis.js';
import { aiClient } from '../services/aiClient.js';
import { queueCounts } from '../services/queue.js';
import { authRouter } from './auth.js';
import { projectsRouter } from './projects.js';
import { assetsRouter } from './assets.js';
import { jobsRouter } from './jobs.js';
import { subtitlesRouter } from './subtitles.js';
import { billingRouter } from './billing.js';
import { developerRouter } from './developer.js';
import { dashboardRouter } from './dashboard.js';
import { adminRouter } from './admin.js';
import { voiceRouter } from './voice.js';
import { graphqlRouter } from './graphql.js';

export const apiRouter = Router();

/**
 * Static catalogue the frontend renders without needing a session — engine
 * cards, enhancement copy, slider metadata, languages and export presets all
 * come from @lipsync/shared so the UI and the renderer cannot disagree.
 */
apiRouter.get('/catalogue', (_req, res) => {
  res.json({
    app: APP_NAME,
    engines: ENGINE_LIST,
    enhancements: ENHANCEMENT_LABELS,
    expressionControls: EXPRESSION_CONTROL_META,
    languages: SUPPORTED_LANGUAGES,
    socialPresets: SOCIAL_PRESETS,
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/assets', assetsRouter);
apiRouter.use('/jobs', jobsRouter);
apiRouter.use('/subtitles', subtitlesRouter);
apiRouter.use('/billing', billingRouter);
apiRouter.use('/developer', developerRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/voice', voiceRouter);
apiRouter.use('/graphql', graphqlRouter);

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

/** Liveness — is the process up? Deliberately does no I/O. */
export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

/**
 * Readiness — should this instance receive traffic? Checks every dependency and
 * reports 503 if any hard dependency is down, so the load balancer drains it.
 */
healthRouter.get('/ready', async (_req, res) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  await Promise.all([
    prisma
      .$queryRaw`SELECT 1`
      .then(() => {
        checks.database = { ok: true };
      })
      .catch((error) => {
        checks.database = { ok: false, detail: String(error).slice(0, 200) };
      }),

    (async () => {
      const redis = getRedis();
      if (!redis) {
        checks.redis = { ok: true, detail: 'disabled' };
        return;
      }
      try {
        await redis.ping();
        checks.redis = { ok: true };
      } catch (error) {
        checks.redis = { ok: false, detail: String(error).slice(0, 200) };
      }
    })(),

    aiClient
      .health()
      .then((health) => {
        checks.aiService = { ok: true, detail: health.gpu ? 'gpu' : 'cpu' };
      })
      .catch(() => {
        // The AI service being down degrades rendering but not the whole API,
        // so it is reported without failing readiness.
        checks.aiService = { ok: false, detail: 'unreachable' };
      }),
  ]);

  const hardDependenciesOk = checks.database?.ok !== false && checks.redis?.ok !== false;

  res.status(hardDependenciesOk ? 200 : 503).json({
    status: hardDependenciesOk ? 'ready' : 'degraded',
    checks,
    queue: await queueCounts().catch(() => null),
  });
});
