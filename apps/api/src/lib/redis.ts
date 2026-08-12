import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Redis is optional in development. When ENABLE_QUEUE is off we hand back a
 * null client and every caller degrades to an in-process fallback, so the API
 * and the UI can be worked on without running the full stack.
 */
let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (!env.ENABLE_QUEUE) return null;
  if (client) return client;

  client = new Redis(env.REDIS_URL, {
    // BullMQ requires this; a bounded retry count would make blocking commands
    // throw mid-wait rather than reconnect.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });

  client.on('error', (error) => logger.error({ err: error }, 'Redis connection error'));
  client.on('ready', () => logger.info('Redis connected'));

  return client;
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  await client.quit().catch(() => client?.disconnect());
  client = null;
}
