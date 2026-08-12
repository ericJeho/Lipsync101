import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';
import { closeRedis } from './lib/redis.js';
import { closeQueues } from './services/queue.js';
import { closeRealtime, initRealtime } from './realtime/socket.js';

const app = createApp();
const server = createServer(app);

initRealtime(server);

server.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, storage: env.STORAGE_DRIVER },
    `LipSync Studio API listening on ${env.API_URL}`,
  );
});

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests finish,
 * then close the pools. Without this a rolling deploy drops requests that were
 * mid-flight when the container got SIGTERM.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  // If something wedges, exit anyway rather than hanging the orchestrator.
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out — exiting');
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  server.close();
  await closeRealtime().catch(() => undefined);
  await closeQueues().catch(() => undefined);
  await closeRedis().catch(() => undefined);
  await disconnectPrisma();

  clearTimeout(forceExit);
  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  // The process is in an undefined state after this; log and let the
  // orchestrator restart us rather than limping on.
  logger.fatal({ err: error }, 'Uncaught exception — exiting');
  void shutdown('uncaughtException');
});

export { app, server };
