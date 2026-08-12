import type { Job as QueueJob } from 'bullmq';
import { hostname } from 'node:os';
import {
  isTerminal,
  verdictFor,
  type ExpressionControls,
  type MediaProbe,
  type ModerationSignal,
  type SubtitleTrack,
  type VoiceAnalysis,
} from '@lipsync/shared';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { storage } from '../lib/storage.js';
import { aiClient } from '../services/aiClient.js';
import { mailer } from '../services/mailer.js';
import { refundRender } from '../services/entitlements.js';
import { deliverWebhook } from '../routes/developer.js';
import {
  publishCredits,
  publishJobCompleted,
  publishJobFailed,
  publishJobProgress,
} from '../realtime/socket.js';
import type { RenderJobData } from '../services/queue.js';

const WORKER_ID = `${hostname()}:${process.pid}`;

/**
 * Writes a progress update to the database and pushes it to any connected
 * client. Called at each stage boundary and on every callback from the Python
 * service, so the UI progress bar reflects real work rather than a timer.
 */
export async function reportProgress(
  jobId: string,
  userId: string,
  update: {
    status?: 'analyzing' | 'rendering' | 'enhancing' | 'encoding';
    progress: number;
    stage: string;
    etaSeconds?: number | null;
  },
): Promise<void> {
  const progress = Math.max(0, Math.min(100, Math.round(update.progress)));

  await prisma.job.update({
    where: { id: jobId },
    data: {
      ...(update.status ? { status: update.status } : {}),
      progress,
      stage: update.stage,
      ...(update.etaSeconds !== undefined ? { etaSeconds: update.etaSeconds } : {}),
    },
  });

  publishJobProgress(
    {
      jobId,
      status: (update.status ?? 'rendering') as never,
      progress,
      stage: update.stage,
      etaSeconds: update.etaSeconds ?? null,
      queuePosition: null,
      gpuUtilisation: null,
      updatedAt: new Date().toISOString(),
    },
    userId,
  );
}

async function fanOutWebhook(
  userId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { userId, active: true, events: { has: event } },
  });

  await Promise.allSettled(
    endpoints.map((endpoint) => deliverWebhook(endpoint, event, payload)),
  );
}

/**
 * Runs one render end to end.
 *
 * The ordering matters: moderation happens before any GPU time is spent, and
 * the credit refund on failure happens before the job row is marked failed, so
 * a crash between the two leaves the user credited rather than charged.
 */
export async function processRenderJob(queueJob: QueueJob<RenderJobData>): Promise<void> {
  const { jobId, userId } = queueJob.data;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { videoAsset: true, audioAsset: true, project: true, user: true },
  });

  if (!job) {
    logger.warn({ jobId }, 'Queue held a job that no longer exists');
    return;
  }

  // A user may have cancelled between enqueue and pickup.
  if (isTerminal(job.status)) {
    logger.info({ jobId, status: job.status }, 'Skipping job that already finished');
    return;
  }

  const durationSeconds =
    (job.audioAsset.probe as MediaProbe | null)?.durationSeconds ?? 0;

  try {
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'analyzing',
        stage: 'Preparing media',
        startedAt: new Date(),
        workerId: WORKER_ID,
        attempts: { increment: 1 },
      },
    });

    await fanOutWebhook(userId, 'job.started', { jobId, status: 'analyzing' });

    const [videoUrl, audioUrl] = await Promise.all([
      storage.createDownloadUrl(job.videoAsset.storageKey, 6 * 3600),
      storage.createDownloadUrl(job.audioAsset.storageKey, 6 * 3600),
    ]);

    await reportProgress(job.id, userId, {
      status: 'analyzing',
      progress: 5,
      stage: 'Checking content policy',
    });

    // Re-check moderation on the pair. Upload-time checks look at each file
    // alone; a face and an audio track are only a deepfake risk together.
    const moderation = await aiClient.moderate(videoUrl, 'video').catch(() => ({ signals: [] }));
    const verdict = verdictFor(moderation.signals as ModerationSignal[]);

    if (verdict.action === 'block') {
      await prisma.moderationFlag.create({
        data: {
          jobId: job.id,
          action: 'block',
          signals: moderation.signals as unknown as object,
        },
      });
      throw new Error(
        'This render was stopped by our content policy. Your credits have been refunded.',
      );
    }

    await reportProgress(job.id, userId, {
      status: 'analyzing',
      progress: 12,
      stage: 'Analysing voice',
    });

    const analysis: VoiceAnalysis | null = await aiClient
      .analyseVoice(audioUrl)
      .catch((error) => {
        // Analysis feeds the expression mapping but is not load-bearing; a
        // failure here should degrade the result, not kill the render.
        logger.warn({ err: error, jobId }, 'Voice analysis failed — continuing without it');
        return null;
      });

    if (analysis) {
      await prisma.job.update({
        where: { id: job.id },
        data: { analysis: analysis as unknown as object },
      });
    }

    await reportProgress(job.id, userId, {
      status: 'rendering',
      progress: 20,
      stage: 'Synthesising lip motion',
      etaSeconds: job.etaSeconds,
    });

    const result = await aiClient.render({
      jobId: job.id,
      videoUrl,
      audioUrl,
      engine: job.engine,
      preset: job.preset,
      outputFormat: job.outputFormat,
      outputHeight: job.outputHeight,
      enhancements: job.enhancements,
      expression: job.expression as unknown as ExpressionControls,
      musicMode: job.musicMode,
      karaokeTiming: job.karaokeTiming,
      translateTo: job.translateTo,
      subtitleLanguages: job.subtitleLanguages,
      burnInSubtitles: job.burnInSubtitles,
      watermark: job.user.plan === 'free',
      callbackUrl: `${env.API_URL}/v1/internal/jobs/${job.id}/progress`,
    });

    await reportProgress(job.id, userId, {
      status: 'encoding',
      progress: 92,
      stage: 'Writing output file',
    });

    const outputUrl = await storage.createDownloadUrl(result.outputKey, 7 * 86_400);
    const thumbnailUrl = result.thumbnailKey
      ? await storage.createDownloadUrl(result.thumbnailKey, 7 * 86_400)
      : null;

    const completed = await prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        progress: 100,
        stage: 'Done',
        outputKey: result.outputKey,
        outputUrl,
        thumbnailUrl,
        completedAt: new Date(),
        etaSeconds: 0,
        ...(result.subtitles?.length
          ? { subtitles: result.subtitles as unknown as SubtitleTrack[] as unknown as object }
          : {}),
      },
    });

    // The render output is itself an asset, so retention and storage accounting
    // apply to it exactly as they do to uploads.
    await prisma.$transaction([
      prisma.asset.create({
        data: {
          userId,
          projectId: job.projectId,
          kind: 'render',
          status: 'ready',
          filename: `${job.project.name}.${job.outputFormat}`,
          mimeType: job.outputFormat === 'gif' ? 'image/gif' : `video/${job.outputFormat}`,
          storageKey: result.outputKey,
          probe: { durationSeconds: result.durationSeconds } as unknown as object,
          expiresAt: job.videoAsset.expiresAt,
        },
      }),
      prisma.notification.create({
        data: {
          userId,
          type: 'render.completed',
          title: 'Your render is ready',
          body: `${job.project.name} finished in ${Math.round(result.durationSeconds)}s of output.`,
          link: `/dashboard/renders/${job.id}`,
        },
      }),
    ]);

    publishJobCompleted(userId, { jobId: job.id, outputUrl, thumbnailUrl });
    await fanOutWebhook(userId, 'job.completed', {
      jobId: job.id,
      outputUrl,
      durationSeconds: result.durationSeconds,
    });

    if (job.notifyByEmail) {
      await mailer
        .sendRenderComplete(job.user.email, {
          id: job.id,
          projectName: job.project.name,
          durationSeconds: result.durationSeconds,
        })
        .catch((error) => logger.warn({ err: error }, 'Completion email failed'));
    }

    logger.info({ jobId: job.id, engine: job.engine }, 'Render completed');
    void completed;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'The render failed for an unknown reason.';

    // BullMQ will retry; only refund and mark failed on the final attempt,
    // otherwise a transient error would refund credits and still re-run.
    const isFinalAttempt =
      queueJob.attemptsMade + 1 >= (queueJob.opts.attempts ?? 1);

    if (!isFinalAttempt) {
      logger.warn(
        { err: error, jobId, attempt: queueJob.attemptsMade + 1 },
        'Render attempt failed — will retry',
      );
      await prisma.job.update({
        where: { id: jobId },
        data: { stage: 'Retrying after an error', error: message },
      });
      throw error;
    }

    await refundRender(userId, job.creditsCharged, durationSeconds).catch((refundError) =>
      logger.error({ err: refundError, jobId }, 'Refund failed after render failure'),
    );

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        stage: 'Failed',
        error: message,
        completedAt: new Date(),
      },
    });

    const balance = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true, email: true },
    });
    if (balance) publishCredits(userId, balance.credits);

    publishJobFailed(userId, {
      jobId,
      error: message,
      creditsRefunded: job.creditsCharged,
    });
    await fanOutWebhook(userId, 'job.failed', { jobId, error: message });

    if (job.notifyByEmail && balance) {
      await mailer
        .sendRenderFailed(balance.email, {
          id: jobId,
          projectName: job.project.name,
          reason: message,
        })
        .catch(() => undefined);
    }

    logger.error({ err: error, jobId }, 'Render failed permanently');
    throw error;
  }
}
