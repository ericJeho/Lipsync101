import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '../config/env.js';
import { logger } from './logger.js';

/**
 * `tsx watch` re-evaluates modules on every save, which would otherwise leak a
 * connection pool per reload until Postgres refuses new clients. Caching the
 * client on `globalThis` keeps exactly one pool alive across reloads.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!isProduction) globalForPrisma.prisma = prisma;

export async function disconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (error) {
    logger.warn({ error }, 'Failed to disconnect Prisma cleanly');
  }
}

/**
 * `BigInt` has no JSON representation, and `storageUsedBytes` / `sizeBytes` are
 * both BigInt columns. Serialise them as numbers — byte counts stay well inside
 * the safe integer range until an individual file exceeds 9 petabytes.
 */
export function serialiseBigInts<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? Number(v) : v)),
  ) as T;
}
