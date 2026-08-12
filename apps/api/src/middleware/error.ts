import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError, isApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProduction } from '../config/env.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound(`No route matches ${req.method} ${req.path}`));
}

/** Turns Zod's issue list into `{ "field.path": "message" }` for form display. */
function fieldErrors(error: ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    result[path] ??= issue.message;
  }
  return result;
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (res.headersSent) return;

  if (isApiError(error)) {
    if (error.status >= 500) {
      logger.error({ err: error, path: req.path }, 'Request failed');
    }
    res.status(error.status).json(error.toJSON());
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'validation_failed',
        message: 'Some fields need attention.',
        details: fieldErrors(error),
      },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 unique violation, P2025 record not found — both are client errors,
    // and letting them fall through to 500 would hide a fixable mistake.
    if (error.code === 'P2002') {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'value';
      res.status(409).json({
        error: { code: 'conflict', message: `That ${target} is already in use.` },
      });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
      return;
    }
  }

  logger.error({ err: error, path: req.path, method: req.method }, 'Unhandled error');

  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our side.',
      // Stack traces are a disclosure risk, so they stay out of production bodies.
      ...(isProduction ? {} : { details: String(error) }),
    },
  });
}
