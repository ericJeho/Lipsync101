import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

/**
 * Replaces `req.body` / `req.query` / `req.params` with the parsed result, so
 * downstream handlers see coerced, defaulted, trusted values rather than the
 * raw strings Express hands over.
 */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data;
    next();
  };
}

export function validateQuery<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(result.error);
    // Express 4 defines `query` as a getter on some versions, so assign the
    // parsed object onto a writable property instead of replacing the getter.
    Object.defineProperty(req, 'query', { value: result.data, writable: true });
    next();
  };
}

export function validateParams<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) return next(result.error);
    req.params = result.data as Record<string, string>;
    next();
  };
}

export type Validated<T extends ZodTypeAny> = z.infer<T>;
