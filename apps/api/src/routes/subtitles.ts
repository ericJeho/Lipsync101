import { Router } from 'express';
import { z } from 'zod';
import {
  LANGUAGE_CODES,
  formatSrtTimestamp,
  type SubtitleCue,
  type SubtitleTrack,
} from '@lipsync/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { actorOf, requireAuth } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { storage } from '../lib/storage.js';
import { aiClient } from '../services/aiClient.js';

export const subtitlesRouter = Router();
subtitlesRouter.use(requireAuth());

const idParam = z.object({ id: z.string().uuid() });

const cueSchema = z.object({
  id: z.string().min(1),
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().max(500),
  speaker: z.string().max(80).optional(),
  words: z
    .array(
      z.object({
        text: z.string(),
        start: z.number().min(0),
        end: z.number().min(0),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .optional(),
});

/** Cues must be ordered and non-overlapping or players render them unpredictably. */
function assertWellFormed(cues: SubtitleCue[]): void {
  for (const [index, cue] of cues.entries()) {
    if (cue.end <= cue.start) {
      throw ApiError.unprocessable(
        `Cue ${index + 1} ends before it starts. Check the timing on "${cue.text.slice(0, 40)}".`,
      );
    }
    const previous = cues[index - 1];
    if (previous && cue.start < previous.end) {
      throw ApiError.unprocessable(
        `Cue ${index + 1} overlaps the one before it. Subtitles must not overlap.`,
      );
    }
  }
}

export function toSrt(track: SubtitleTrack): string {
  return track.cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${cue.text}\n`,
    )
    .join('\n');
}

export function toVtt(track: SubtitleTrack): string {
  const body = track.cues
    .map(
      (cue) =>
        `${formatSrtTimestamp(cue.start).replace(',', '.')} --> ` +
        `${formatSrtTimestamp(cue.end).replace(',', '.')}\n${cue.text}\n`,
    )
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/**
 * Karaoke uses WebVTT's inline `<hh:mm:ss.mmm>` cue timings, which players
 * honour natively — no custom renderer needed for word-level highlighting.
 */
export function toKaraokeVtt(track: SubtitleTrack): string {
  const body = track.cues
    .map((cue) => {
      const start = formatSrtTimestamp(cue.start).replace(',', '.');
      const end = formatSrtTimestamp(cue.end).replace(',', '.');
      const text = cue.words?.length
        ? cue.words
            .map((word) => `<${formatSrtTimestamp(word.start).replace(',', '.')}>${word.text}`)
            .join(' ')
        : cue.text;
      return `${start} --> ${end}\n${text}\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/** Generates subtitle tracks for a job's audio, optionally translated. */
subtitlesRouter.post(
  '/jobs/:id/generate',
  validateParams(idParam),
  validateBody(
    z.object({
      languages: z.array(z.enum(LANGUAGE_CODES as [string, ...string[]])).max(10).default([]),
      karaoke: z.boolean().default(false),
      sourceLanguage: z.string().min(2).max(8).optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const job = await prisma.job.findFirst({
        where: { id: req.params.id!, userId: actor.userId },
        include: { audioAsset: true },
      });
      if (!job) throw ApiError.notFound('That render does not exist.');

      const url = await storage.createDownloadUrl(job.audioAsset.storageKey, 3600);
      const tracks = await aiClient.transcribe(url, {
        language: req.body.sourceLanguage,
        translateTo: req.body.languages,
        karaoke: req.body.karaoke,
      });

      await prisma.job.update({
        where: { id: job.id },
        data: { subtitles: tracks as unknown as object },
      });

      res.json({ tracks });
    } catch (error) {
      next(error);
    }
  },
);

subtitlesRouter.get('/jobs/:id', validateParams(idParam), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const job = await prisma.job.findFirst({
      where: { id: req.params.id!, userId: actor.userId },
      select: { subtitles: true },
    });
    if (!job) throw ApiError.notFound('That render does not exist.');
    res.json({ tracks: (job.subtitles as SubtitleTrack[] | null) ?? [] });
  } catch (error) {
    next(error);
  }
});

/** Saves hand-edited cues back over a generated track. */
subtitlesRouter.put(
  '/jobs/:id',
  validateParams(idParam),
  validateBody(
    z.object({
      language: z.string().min(2).max(8),
      translated: z.boolean().default(false),
      cues: z.array(cueSchema).max(5000),
    }),
  ),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const job = await prisma.job.findFirst({
        where: { id: req.params.id!, userId: actor.userId },
        select: { id: true, subtitles: true },
      });
      if (!job) throw ApiError.notFound('That render does not exist.');

      const cues = [...(req.body.cues as SubtitleCue[])].sort((a, b) => a.start - b.start);
      assertWellFormed(cues);

      const existing = ((job.subtitles as SubtitleTrack[] | null) ?? []).filter(
        (track) => track.language !== req.body.language,
      );
      const next_ = [
        ...existing,
        { language: req.body.language, translated: req.body.translated, cues },
      ];

      await prisma.job.update({
        where: { id: job.id },
        data: { subtitles: next_ as unknown as object },
      });

      res.json({ tracks: next_ });
    } catch (error) {
      next(error);
    }
  },
);

/** Exports a track as SRT, WebVTT or karaoke VTT. */
subtitlesRouter.get(
  '/jobs/:id/export',
  validateParams(idParam),
  validateQuery(
    z.object({
      language: z.string().min(2).max(8).default('en'),
      format: z.enum(['srt', 'vtt', 'karaoke']).default('srt'),
    }),
  ),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const query = req.query as unknown as { language: string; format: string };

      const job = await prisma.job.findFirst({
        where: { id: req.params.id!, userId: actor.userId },
        select: { subtitles: true },
      });
      if (!job) throw ApiError.notFound('That render does not exist.');

      const tracks = (job.subtitles as SubtitleTrack[] | null) ?? [];
      const track = tracks.find((t) => t.language === query.language);
      if (!track) {
        throw ApiError.notFound(
          `No ${query.language.toUpperCase()} subtitles on this render. Generate them first.`,
        );
      }

      const body =
        query.format === 'srt'
          ? toSrt(track)
          : query.format === 'karaoke'
            ? toKaraokeVtt(track)
            : toVtt(track);

      const extension = query.format === 'srt' ? 'srt' : 'vtt';
      res.setHeader('content-type', query.format === 'srt' ? 'application/x-subrip' : 'text/vtt');
      res.setHeader(
        'content-disposition',
        `attachment; filename="subtitles.${query.language}.${extension}"`,
      );
      res.send(body);
    } catch (error) {
      next(error);
    }
  },
);
