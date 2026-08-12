import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { WS_EVENTS, type JobProgress, type QueueSnapshot } from '@lipsync/shared';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../services/tokens.js';

/**
 * Realtime progress channel.
 *
 * Rooms are per-user (`user:<id>`) and per-job (`job:<id>`). A client may only
 * join a job room after we have confirmed they own the job — without that check
 * anyone could watch anyone else's render progress by guessing an id.
 */

let io: SocketServer | null = null;

export function initRealtime(server: HttpServer): SocketServer {
  io = new SocketServer(server, {
    cors: { origin: env.WEB_URL, credentials: true },
    path: '/realtime',
    // Long renders sit idle between updates; a generous timeout avoids
    // reconnect churn on mobile networks that park background sockets.
    pingTimeout: 60_000,
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) return next(new Error('unauthorized'));

    try {
      const claims = verifyAccessToken(token);
      socket.data.userId = claims.sub;
      socket.data.role = claims.role;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    void socket.join(`user:${userId}`);

    socket.on(WS_EVENTS.subscribeJob, async (jobId: unknown) => {
      if (typeof jobId !== 'string') return;

      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: { userId: true },
      });

      if (!job || (job.userId !== userId && socket.data.role !== 'admin')) {
        socket.emit('error', { message: 'You do not have access to that render.' });
        return;
      }

      void socket.join(`job:${jobId}`);
    });

    socket.on(WS_EVENTS.unsubscribeJob, (jobId: unknown) => {
      if (typeof jobId === 'string') void socket.leave(`job:${jobId}`);
    });

    socket.on('disconnect', (reason) => {
      logger.debug({ userId, reason }, 'Realtime client disconnected');
    });
  });

  logger.info('Realtime gateway ready on /realtime');
  return io;
}

export function publishJobProgress(progress: JobProgress, userId: string): void {
  if (!io) return;
  io.to(`job:${progress.jobId}`).emit(WS_EVENTS.jobProgress, progress);
  io.to(`user:${userId}`).emit(WS_EVENTS.jobProgress, progress);
}

export function publishJobCompleted(
  userId: string,
  payload: { jobId: string; outputUrl: string | null; thumbnailUrl: string | null },
): void {
  if (!io) return;
  io.to(`job:${payload.jobId}`).emit(WS_EVENTS.jobCompleted, payload);
  io.to(`user:${userId}`).emit(WS_EVENTS.jobCompleted, payload);
}

export function publishJobFailed(
  userId: string,
  payload: { jobId: string; error: string; creditsRefunded: number },
): void {
  if (!io) return;
  io.to(`job:${payload.jobId}`).emit(WS_EVENTS.jobFailed, payload);
  io.to(`user:${userId}`).emit(WS_EVENTS.jobFailed, payload);
}

export function publishCredits(userId: string, credits: number): void {
  io?.to(`user:${userId}`).emit(WS_EVENTS.creditsUpdate, { credits });
}

/** Broadcast to everyone — queue depth is not user-specific. */
export function publishQueueSnapshot(snapshot: QueueSnapshot): void {
  io?.emit(WS_EVENTS.queueUpdate, snapshot);
}

export function getRealtime(): SocketServer | null {
  return io;
}

export async function closeRealtime(): Promise<void> {
  await io?.close();
  io = null;
}
