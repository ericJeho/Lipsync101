import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import { ApiError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { hashToken, verifyAccessToken } from '../services/tokens.js';

export interface AuthenticatedActor {
  userId: string;
  email: string;
  role: UserRole;
  plan: string;
  /** How the caller proved identity — API keys get a narrower scope set. */
  via: 'bearer' | 'api_key';
  scopes: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: AuthenticatedActor;
    }
  }
}

const BEARER_PREFIX = /^Bearer\s+/i;

async function actorFromApiKey(rawKey: string): Promise<AuthenticatedActor> {
  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashToken(rawKey) },
    include: { user: true },
  });

  if (!record || record.revokedAt) {
    throw ApiError.unauthorized('That API key is not valid.');
  }
  if (record.user.suspendedAt) {
    throw ApiError.forbidden('This account is suspended.');
  }

  // Fire-and-forget: last-used tracking must never fail the request itself.
  void prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    userId: record.userId,
    email: record.user.email,
    role: record.user.role,
    plan: record.user.plan,
    via: 'api_key',
    scopes: record.scopes,
  };
}

/** Populates `req.actor`, rejecting the request when no valid credential is present. */
export function requireAuth() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const apiKey = req.header('x-api-key');
      if (apiKey) {
        req.actor = await actorFromApiKey(apiKey);
        return next();
      }

      const header = req.header('authorization');
      if (!header || !BEARER_PREFIX.test(header)) {
        throw ApiError.unauthorized();
      }

      const claims = verifyAccessToken(header.replace(BEARER_PREFIX, '').trim());
      req.actor = {
        userId: claims.sub,
        email: claims.email,
        role: claims.role,
        plan: claims.plan,
        via: 'bearer',
        scopes: claims.scopes ?? ['*'],
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Populates `req.actor` when a credential is present, but never rejects. */
export function optionalAuth() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const apiKey = req.header('x-api-key');
      const header = req.header('authorization');
      if (apiKey) {
        req.actor = await actorFromApiKey(apiKey);
      } else if (header && BEARER_PREFIX.test(header)) {
        const claims = verifyAccessToken(header.replace(BEARER_PREFIX, '').trim());
        req.actor = {
          userId: claims.sub,
          email: claims.email,
          role: claims.role,
          plan: claims.plan,
          via: 'bearer',
          scopes: claims.scopes ?? ['*'],
        };
      }
    } catch {
      // An invalid credential on an optional route is the same as none at all.
    }
    next();
  };
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor) return next(ApiError.unauthorized());
    if (!roles.includes(req.actor.role)) {
      return next(ApiError.forbidden('That area is restricted.'));
    }
    next();
  };
}

/** Gates a route behind an API-key scope. Bearer sessions hold the `*` scope. */
export function requireScope(scope: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor) return next(ApiError.unauthorized());
    const { scopes } = req.actor;
    if (scopes.includes('*') || scopes.includes(scope)) return next();
    next(ApiError.forbidden(`This key is missing the "${scope}" scope.`));
  };
}

export function actorOf(req: Request): AuthenticatedActor {
  if (!req.actor) throw ApiError.unauthorized();
  return req.actor;
}
