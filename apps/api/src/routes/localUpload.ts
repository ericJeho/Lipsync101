import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { storage } from '../lib/storage.js';
import { requireAuth, actorOf } from '../middleware/auth.js';

/**
 * Receives bytes for the local-disk storage driver.
 *
 * Cloud drivers presign a URL and the browser PUTs straight to the bucket. With
 * local storage there is no bucket, so this stands in for it — authenticated,
 * and only ever writing to a key the caller already reserved.
 */
export const localUploadRouter = Router();

localUploadRouter.put('/:key', requireAuth(), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const key = decodeURIComponent(req.params.key ?? '');

    // The key must correspond to an asset row this user created, which makes
    // arbitrary writes impossible even before the path check in the driver.
    const asset = await prisma.asset.findFirst({
      where: { storageKey: key, userId: actor.userId },
    });
    if (!asset) throw ApiError.notFound('No upload was reserved for that key.');
    if (asset.status !== 'uploading') {
      throw ApiError.conflict('That upload already completed.');
    }

    await storage.putStream(key, req, asset.mimeType);
    res.status(201).json({ key, received: true });
  } catch (error) {
    next(error);
  }
});
