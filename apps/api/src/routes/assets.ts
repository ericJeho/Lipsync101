import { Router } from 'express';
import { z } from 'zod';
import {
  AUDIO_INPUT_FORMATS,
  MAX_UPLOAD_BYTES,
  VIDEO_INPUT_FORMATS,
  extensionOf,
  verdictFor,
  type ModerationSignal,
} from '@lipsync/shared';
import { prisma, serialiseBigInts } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { actorOf, requireAuth } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { buildStorageKey, storage } from '../lib/storage.js';
import { aiClient } from '../services/aiClient.js';
import {
  assertStorageAvailable,
  retentionDaysFor,
} from '../services/entitlements.js';
import { scanForViruses } from '../services/virusScan.js';

export const assetsRouter = Router();
assetsRouter.use(requireAuth());

const idParam = z.object({ id: z.string().uuid() });

const createUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  kind: z.enum(['video', 'audio', 'image']),
  projectId: z.string().uuid().optional(),
});

/**
 * Filenames are attacker-controlled and end up in storage keys, HTTP headers
 * and eventually a download prompt. Strip anything that could be interpreted as
 * a path or a control character before it goes anywhere near disk.
 */
function sanitiseFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'upload';
  // Control characters, path/shell metacharacters and leading dots all go.
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '');
  return cleaned.slice(0, 200) || 'upload';
}

function assertFormatAllowed(kind: 'video' | 'audio' | 'image', filename: string): void {
  const ext = extensionOf(filename);
  if (kind === 'video' && !(VIDEO_INPUT_FORMATS as readonly string[]).includes(ext)) {
    throw ApiError.unprocessable(
      `We cannot read .${ext || '?'} video. Supported: ${VIDEO_INPUT_FORMATS.join(', ')}.`,
    );
  }
  if (kind === 'audio' && !(AUDIO_INPUT_FORMATS as readonly string[]).includes(ext)) {
    throw ApiError.unprocessable(
      `We cannot read .${ext || '?'} audio. Supported: ${AUDIO_INPUT_FORMATS.join(', ')}.`,
    );
  }
  if (kind === 'image' && !['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    throw ApiError.unprocessable('Portraits must be JPG, PNG or WebP.');
  }
}

/**
 * Step 1 of an upload: reserve an asset row and hand back a presigned URL.
 * The bytes go straight from browser to object storage — a 4GB video should
 * never be proxied through the API process.
 */
assetsRouter.post(
  '/uploads',
  uploadLimiter,
  validateBody(createUploadSchema),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const body = req.body as z.infer<typeof createUploadSchema>;
      const filename = sanitiseFilename(body.filename);

      assertFormatAllowed(body.kind, filename);

      const cap =
        body.kind === 'audio' ? MAX_UPLOAD_BYTES.audio : MAX_UPLOAD_BYTES.video;
      if (body.sizeBytes > cap) {
        throw ApiError.payloadTooLarge(
          `That file is larger than the ${Math.round(cap / 1024 ** 3)}GB upload limit.`,
        );
      }

      const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
      await assertStorageAvailable(user, body.sizeBytes);

      const storageKey = buildStorageKey(actor.userId, filename, body.kind);
      const upload = await storage.createUploadUrl(storageKey, body.contentType, body.sizeBytes);

      const expiresAt = new Date(
        Date.now() + retentionDaysFor(user.plan) * 86_400_000,
      );

      const asset = await prisma.asset.create({
        data: {
          userId: actor.userId,
          projectId: body.projectId ?? null,
          kind: body.kind,
          status: 'uploading',
          filename,
          mimeType: body.contentType,
          sizeBytes: BigInt(body.sizeBytes),
          storageKey,
          expiresAt,
        },
      });

      res.status(201).json({ asset: serialiseBigInts(asset), upload });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Step 2: the browser calls this once the PUT succeeded. We probe the media,
 * run the virus and moderation checks, and only then mark the asset usable.
 */
assetsRouter.post('/:id/complete', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const asset = await prisma.asset.findFirst({
      where: { id: req.params.id!, userId: actor.userId },
    });
    if (!asset) throw ApiError.notFound('That upload does not exist.');
    if (asset.status === 'ready') {
      res.json({ asset: serialiseBigInts(asset) });
      return;
    }

    if (!(await storage.exists(asset.storageKey))) {
      throw ApiError.badRequest('We cannot find those bytes. Try the upload again.');
    }

    await prisma.asset.update({ where: { id: asset.id }, data: { status: 'scanning' } });

    const scan = await scanForViruses(asset.storageKey);
    if (!scan.clean) {
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: 'quarantined' },
      });
      await storage.delete(asset.storageKey).catch(() => undefined);
      throw ApiError.unprocessable(
        `That file was rejected by the malware scanner (${scan.signature ?? 'unknown signature'}).`,
      );
    }

    const mediaUrl = await storage.createDownloadUrl(asset.storageKey, 3600);
    const probe = await aiClient.probe(mediaUrl);

    // Moderation runs on upload, not at render time, so a user finds out their
    // clip is unusable before spending credits on it.
    let signals: ModerationSignal[] = [];
    if (asset.kind !== 'subtitle') {
      const moderation = await aiClient
        .moderate(mediaUrl, asset.kind === 'audio' ? 'audio' : 'video')
        .catch((error) => {
          // A moderation outage must not block uploads; the render-time check
          // is the backstop.
          logger.warn({ err: error, assetId: asset.id }, 'Moderation check unavailable');
          return { signals: [] };
        });
      signals = moderation.signals as ModerationSignal[];
    }

    const verdict = verdictFor(signals);

    if (verdict.action !== 'allow') {
      await prisma.moderationFlag.create({
        data: {
          assetId: asset.id,
          action: verdict.action,
          signals: signals as unknown as object,
        },
      });
    }

    if (verdict.action === 'block') {
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: 'quarantined' },
      });
      throw ApiError.unprocessable(
        'That upload breaches our content policy and cannot be used. ' +
          'If you think this is a mistake, contact support and quote the asset id.',
      );
    }

    if (asset.kind === 'video' && probe.faceCount === 0) {
      throw ApiError.unprocessable(
        'We could not find a face in that video. Lip-sync needs a visible face for most of the clip.',
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: actor.userId },
        data: { storageUsedBytes: { increment: asset.sizeBytes } },
      });
      return tx.asset.update({
        where: { id: asset.id },
        data: { status: 'ready', probe: probe as unknown as object },
      });
    });

    res.json({ asset: serialiseBigInts(updated), moderation: verdict });
  } catch (error) {
    next(error);
  }
});

/** Runs voice analysis over an audio asset and caches the result on the row. */
assetsRouter.post('/:id/analyze', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const asset = await prisma.asset.findFirst({
      where: { id: req.params.id!, userId: actor.userId },
    });
    if (!asset) throw ApiError.notFound('That asset does not exist.');
    if (asset.kind !== 'audio') {
      throw ApiError.badRequest('Voice analysis only applies to audio assets.');
    }
    if (asset.analysis) {
      res.json({ analysis: asset.analysis, cached: true });
      return;
    }

    const url = await storage.createDownloadUrl(asset.storageKey, 3600);
    const analysis = await aiClient.analyseVoice(url);

    await prisma.asset.update({
      where: { id: asset.id },
      data: { analysis: analysis as unknown as object },
    });

    res.json({ analysis, cached: false });
  } catch (error) {
    next(error);
  }
});

/** Extracts the audio track from an uploaded video into a new audio asset. */
assetsRouter.post('/:id/extract-audio', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const source = await prisma.asset.findFirst({
      where: { id: req.params.id!, userId: actor.userId, kind: 'video' },
    });
    if (!source) throw ApiError.notFound('That video does not exist.');

    const url = await storage.createDownloadUrl(source.storageKey, 3600);
    const extracted = await aiClient.extractAudio(url);

    const asset = await prisma.asset.create({
      data: {
        userId: actor.userId,
        projectId: source.projectId,
        kind: 'audio',
        status: 'ready',
        filename: `${source.filename.replace(/\.[^.]+$/, '')}.wav`,
        mimeType: 'audio/wav',
        storageKey: extracted.key,
        probe: { durationSeconds: extracted.durationSeconds } as unknown as object,
        expiresAt: source.expiresAt,
      },
    });

    res.status(201).json({ asset: serialiseBigInts(asset) });
  } catch (error) {
    next(error);
  }
});

/**
 * Imports audio from a third-party URL. The AI service enforces an allowlist and
 * refuses anything it cannot establish rights for, so the user-facing error here
 * is deliberately explicit about why an import was declined.
 */
assetsRouter.post(
  '/import-url',
  uploadLimiter,
  validateBody(
    z.object({
      url: z.string().url(),
      projectId: z.string().uuid().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });

      const imported = await aiClient.importFromUrl(req.body.url);

      const asset = await prisma.asset.create({
        data: {
          userId: actor.userId,
          projectId: req.body.projectId ?? null,
          kind: 'audio',
          status: 'ready',
          filename: sanitiseFilename(`${imported.title}.wav`),
          mimeType: 'audio/wav',
          storageKey: imported.key,
          probe: { durationSeconds: imported.durationSeconds } as unknown as object,
          expiresAt: new Date(Date.now() + retentionDaysFor(user.plan) * 86_400_000),
        },
      });

      res.status(201).json({ asset: serialiseBigInts(asset) });
    } catch (error) {
      next(error);
    }
  },
);

assetsRouter.get('/:id/download', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const asset = await prisma.asset.findFirst({
      where: { id: req.params.id!, userId: actor.userId },
    });
    if (!asset || asset.status === 'deleted') throw ApiError.notFound('That asset does not exist.');
    if (asset.status === 'quarantined') {
      throw ApiError.forbidden('That asset is quarantined and cannot be downloaded.');
    }

    res.json({ url: await storage.createDownloadUrl(asset.storageKey, 900) });
  } catch (error) {
    next(error);
  }
});

assetsRouter.delete('/:id', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const asset = await prisma.asset.findFirst({
      where: { id: req.params.id!, userId: actor.userId },
    });
    if (!asset) throw ApiError.notFound('That asset does not exist.');

    const inUse = await prisma.job.count({
      where: {
        OR: [{ videoAssetId: asset.id }, { audioAssetId: asset.id }],
        status: { in: ['queued', 'analyzing', 'rendering', 'enhancing', 'encoding'] },
      },
    });
    if (inUse > 0) {
      throw ApiError.conflict('That file is being used by a render in progress.');
    }

    await storage.delete(asset.storageKey).catch((error) => {
      // The row must go even if the object is already gone, otherwise a failed
      // storage call leaves an undeletable asset in the user's library.
      logger.warn({ err: error, key: asset.storageKey }, 'Storage delete failed');
    });

    await prisma.$transaction([
      prisma.user.update({
        where: { id: actor.userId },
        data: { storageUsedBytes: { decrement: asset.sizeBytes } },
      }),
      prisma.asset.delete({ where: { id: asset.id } }),
    ]);

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
