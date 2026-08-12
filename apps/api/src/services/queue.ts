import { Queue, QueueEvents, type JobsOptions } from 'bullmq';
import { env } from '../config/env.js';
import { getRedis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

export const RENDER_QUEUE = 'lipsync:render';
export const MAINTENANCE_QUEUE = 'lipsync:maintenance';

export interface RenderJobData {
  jobId: string;
  userId: string;
}

export interface MaintenanceJobData {
  task: 'retention_sweep' | 'session_sweep' | 'webhook_retry';
}

let renderQueue: Queue<RenderJobData> | null = null;
let maintenanceQueue: Queue<MaintenanceJobData> | null = null;
let renderEvents: QueueEvents | null = null;

/**
 * Returns the render queue, or null when queueing is disabled.
 *
 * Callers must handle null rather than assuming a queue exists — with
 * ENABLE_QUEUE=false the API still accepts renders and marks them queued, which
 * is what lets the frontend be developed without Redis or a GPU.
 */
export function getRenderQueue(): Queue<RenderJobData> | null {
  if (!env.ENABLE_QUEUE) return null;
  const connection = getRedis();
  if (!connection) return null;

  renderQueue ??= new Queue<RenderJobData>(RENDER_QUEUE, {
    connection,
    defaultJobOptions: {
      // Three attempts with exponential backoff: transient CUDA OOM and
      // storage blips recover, genuine bad input fails the same way each time.
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 7 * 86_400 },
    },
  });

  return renderQueue;
}

export function getMaintenanceQueue(): Queue<MaintenanceJobData> | null {
  if (!env.ENABLE_QUEUE) return null;
  const connection = getRedis();
  if (!connection) return null;

  maintenanceQueue ??= new Queue<MaintenanceJobData>(MAINTENANCE_QUEUE, {
    connection,
    defaultJobOptions: { attempts: 2, removeOnComplete: true },
  });

  return maintenanceQueue;
}

export function getRenderEvents(): QueueEvents | null {
  if (!env.ENABLE_QUEUE) return null;
  const connection = getRedis();
  if (!connection) return null;
  renderEvents ??= new QueueEvents(RENDER_QUEUE, { connection });
  return renderEvents;
}

/**
 * Enqueues a render. Higher `priority` runs first — BullMQ treats lower
 * numbers as more urgent, so we invert the plan priority here.
 */
export async function enqueueRender(
  data: RenderJobData,
  options: { priority?: number; delayMs?: number } = {},
): Promise<string | null> {
  const queue = getRenderQueue();
  if (!queue) {
    logger.warn({ jobId: data.jobId }, 'Queue disabled — render was not dispatched');
    return null;
  }

  const jobOptions: JobsOptions = {
    jobId: data.jobId,
    priority: Math.max(1, 100 - (options.priority ?? 0)),
    delay: options.delayMs,
  };

  const job = await queue.add('render', data, jobOptions);
  return job.id ?? null;
}

export async function removeRender(jobId: string): Promise<boolean> {
  const queue = getRenderQueue();
  if (!queue) return false;
  const job = await queue.getJob(jobId);
  if (!job) return false;
  await job.remove().catch(() => undefined);
  return true;
}

/** Position in the waiting list, 1-based. Null when the job is already running. */
export async function queuePositionOf(jobId: string): Promise<number | null> {
  const queue = getRenderQueue();
  if (!queue) return null;
  const waiting = await queue.getWaiting(0, 500);
  const index = waiting.findIndex((job) => job.id === jobId);
  return index === -1 ? null : index + 1;
}

export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export async function queueCounts(): Promise<QueueCounts> {
  const queue = getRenderQueue();
  if (!queue) return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
}

export async function pauseQueue(): Promise<void> {
  await getRenderQueue()?.pause();
}

export async function resumeQueue(): Promise<void> {
  await getRenderQueue()?.resume();
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([
    renderQueue?.close(),
    maintenanceQueue?.close(),
    renderEvents?.close(),
  ]);
  renderQueue = null;
  maintenanceQueue = null;
  renderEvents = null;
}
