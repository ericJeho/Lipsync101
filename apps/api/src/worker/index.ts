import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { getRedis, closeRedis } from '../lib/redis.js';
import { disconnectPrisma, prisma } from '../lib/prisma.js';
import { storage } from '../lib/storage.js';
import {
  MAINTENANCE_QUEUE,
  RENDER_QUEUE,
  type MaintenanceJobData,
  type RenderJobData,
} from '../services/queue.js';
import { processRenderJob } from './processor.js';

/**
 * Render worker.
 *
 * Runs as its own process (and its own container in production) so GPU work
 * never competes with request handling, and so the worker pool can be scaled
 * against queue depth independently of the API.
 */

const connection = getRedis();

if (!connection) {
  logger.error('ENABLE_QUEUE is false — the worker has nothing to consume. Exiting.');
  process.exit(1);
}

/**
 * One render at a time per worker process. Concurrency here would mean two
 * renders sharing one GPU, which is slower overall than running them in series
 * and risks CUDA OOM on the larger models.
 */
const renderWorker = new Worker<RenderJobData>(RENDER_QUEUE, processRenderJob, {
  connection,
  concurrency: 1,
  // A long render must not be reclaimed as stalled mid-inference.
  lockDuration: 10 * 60_000,
  stalledInterval: 60_000,
});

renderWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Queue job completed');
});

renderWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, err: error }, 'Queue job failed');
});

renderWorker.on('error', (error) => {
  logger.error({ err: error }, 'Render worker error');
});

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */

/**
 * Deletes assets past their retention date.
 *
 * Retention is a GDPR commitment and a storage-cost control, so it runs as a
 * scheduled sweep rather than relying on users tidying up after themselves.
 */
async function retentionSweep(): Promise<{ deleted: number; freedBytes: number }> {
  const expired = await prisma.asset.findMany({
    where: { expiresAt: { lt: new Date() }, status: { not: 'deleted' } },
    take: 500,
  });

  let freedBytes = 0;
  let deleted = 0;

  for (const asset of expired) {
    // In-flight renders hold references to their inputs; deleting those would
    // fail the render for a reason the user cannot act on.
    const inUse = await prisma.job.count({
      where: {
        OR: [{ videoAssetId: asset.id }, { audioAssetId: asset.id }],
        status: { in: ['queued', 'analyzing', 'rendering', 'enhancing', 'encoding'] },
      },
    });
    if (inUse > 0) continue;

    await storage.delete(asset.storageKey).catch((error) => {
      logger.warn({ err: error, key: asset.storageKey }, 'Retention delete failed');
    });

    await prisma.$transaction([
      prisma.user.update({
        where: { id: asset.userId },
        data: { storageUsedBytes: { decrement: asset.sizeBytes } },
      }),
      prisma.asset.update({
        where: { id: asset.id },
        data: { status: 'deleted', storageKey: `deleted/${asset.id}` },
      }),
    ]);

    freedBytes += Number(asset.sizeBytes);
    deleted += 1;
  }

  return { deleted, freedBytes };
}

/** Clears expired and revoked sessions so the table does not grow forever. */
async function sessionSweep(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revokedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } },
      ],
    },
  });
  return result.count;
}

/** Disables endpoints that have failed repeatedly, so we stop hammering them. */
async function disableDeadWebhooks(): Promise<number> {
  const result = await prisma.webhookEndpoint.updateMany({
    where: { failureCount: { gte: 20 }, active: true },
    data: { active: false },
  });
  return result.count;
}

const maintenanceWorker = new Worker<MaintenanceJobData>(
  MAINTENANCE_QUEUE,
  async (job) => {
    switch (job.data.task) {
      case 'retention_sweep': {
        const result = await retentionSweep();
        logger.info(result, 'Retention sweep finished');
        return result;
      }
      case 'session_sweep': {
        const count = await sessionSweep();
        logger.info({ removed: count }, 'Session sweep finished');
        return { removed: count };
      }
      case 'webhook_retry': {
        const disabled = await disableDeadWebhooks();
        logger.info({ disabled }, 'Webhook maintenance finished');
        return { disabled };
      }
      default:
        throw new Error(`Unknown maintenance task: ${String(job.data.task)}`);
    }
  },
  { connection, concurrency: 1 },
);

logger.info(
  { queues: [RENDER_QUEUE, MAINTENANCE_QUEUE], storage: env.STORAGE_DRIVER },
  'LipSync render worker ready',
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Worker shutting down');
  // `close()` waits for the current render to finish rather than abandoning it
  // half-done, which would leave the user charged with nothing to show.
  await Promise.allSettled([renderWorker.close(), maintenanceWorker.close()]);
  await closeRedis();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { retentionSweep, sessionSweep, disableDeadWebhooks };
