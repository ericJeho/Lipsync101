import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import type { UserRole } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: UserRole;
  plan: string;
  /** Distinguishes a browser session token from an API-key-derived one. */
  kind: 'access' | 'api';
  scopes?: string[];
}

/**
 * Argon2id with parameters sized for an interactive login: ~64MB and 3 passes
 * lands around 100ms on a modern server core, which is slow enough to make
 * offline cracking expensive without making sign-in feel sluggish.
 */
const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed hash in the database should read as "wrong password", not 500.
    return false;
  }
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: 'lipsync-studio',
    audience: 'lipsync-api',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'lipsync-studio',
      audience: 'lipsync-api',
    }) as AccessTokenClaims;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, 'token_expired', 'Your session expired. Refresh and retry.');
    }
    throw ApiError.unauthorized('That token is not valid.');
  }
}

/** Opaque random string — refresh tokens are looked up, not decoded. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedSession {
  refreshToken: string;
  expiresAt: Date;
}

export async function issueRefreshSession(
  userId: string,
  meta: { userAgent?: string; ip?: string },
): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent?.slice(0, 500),
      ip: meta.ip,
      expiresAt,
    },
  });

  return { refreshToken, expiresAt };
}

/**
 * Exchanges a refresh token for a fresh one, invalidating the old row.
 *
 * Rotating on every use means a stolen token is only good until the legitimate
 * client next refreshes; after that the thief's copy is already revoked.
 */
export async function rotateRefreshSession(
  refreshToken: string,
  meta: { userAgent?: string; ip?: string },
): Promise<{ userId: string; refreshToken: string; expiresAt: Date }> {
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hashToken(refreshToken) },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw ApiError.unauthorized('Your session has expired. Sign in again.');
  }

  const issued = await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const next = generateRefreshToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await tx.session.create({
      data: {
        userId: session.userId,
        refreshTokenHash: hashToken(next),
        userAgent: meta.userAgent?.slice(0, 500),
        ip: meta.ip,
        expiresAt,
      },
    });
    return { refreshToken: next, expiresAt };
  });

  return { userId: session.userId, ...issued };
}

export async function revokeSession(refreshToken: string): Promise<void> {
  await prisma.session.updateMany({
    where: { refreshTokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/* ------------------------------------------------------------------ */
/* API keys                                                            */
/* ------------------------------------------------------------------ */

export interface GeneratedApiKey {
  /** Shown exactly once, at creation. */
  plaintext: string;
  prefix: string;
  hash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `lss_${secret}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, 12),
    hash: hashToken(plaintext),
  };
}

/** Constant-time compare so a caller cannot probe the hash byte by byte. */
export function tokensMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/* ------------------------------------------------------------------ */
/* Single-use email tokens                                             */
/* ------------------------------------------------------------------ */

export async function createVerificationToken(
  email: string,
  purpose: 'verify_email' | 'reset_password',
  ttlMinutes = 60,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await prisma.verificationToken.create({
    data: {
      tokenHash: hashToken(token),
      email: email.toLowerCase(),
      purpose,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    },
  });
  return token;
}

export async function consumeVerificationToken(
  token: string,
  purpose: 'verify_email' | 'reset_password',
): Promise<string> {
  const row = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) {
    throw ApiError.badRequest('That link is invalid or has expired. Request a new one.');
  }

  await prisma.verificationToken.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });

  return row.email;
}
