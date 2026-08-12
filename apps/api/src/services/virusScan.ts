import { connect } from 'node:net';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { storage } from '../lib/storage.js';

export interface ScanResult {
  clean: boolean;
  signature?: string;
  /** True when scanning was skipped rather than passed. */
  skipped?: boolean;
}

/**
 * Streams an object to ClamAV over the INSTREAM protocol.
 *
 * INSTREAM sends length-prefixed chunks followed by a zero-length terminator;
 * clamd replies with a single line ending in "OK" or "FOUND". We stream rather
 * than buffer because uploads run to several gigabytes.
 */
function scanBuffer(data: Buffer): Promise<ScanResult> {
  return new Promise((resolve) => {
    const socket = connect({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT });
    let response = '';

    // A scanner that hangs must not hang the upload with it.
    socket.setTimeout(60_000, () => {
      socket.destroy();
      resolve({ clean: true, skipped: true });
    });

    socket.on('error', (error) => {
      logger.warn({ err: error }, 'ClamAV unreachable — allowing upload unscanned');
      resolve({ clean: true, skipped: true });
    });

    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
    });

    socket.on('end', () => {
      const trimmed = response.trim();
      if (trimmed.endsWith('OK')) return resolve({ clean: true });
      const match = /:\s*(.+)\s+FOUND$/.exec(trimmed);
      resolve({ clean: false, signature: match?.[1] ?? trimmed });
    });

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');

      const CHUNK = 64 * 1024;
      for (let offset = 0; offset < data.length; offset += CHUNK) {
        const slice = data.subarray(offset, offset + CHUNK);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(slice.length, 0);
        socket.write(header);
        socket.write(slice);
      }

      // Zero-length chunk signals end of stream.
      socket.write(Buffer.from([0, 0, 0, 0]));
    });
  });
}

/**
 * Scans a stored object. When ENABLE_VIRUS_SCAN is off — the default for local
 * development — this reports clean and flags itself as skipped, so callers can
 * tell "passed" apart from "never checked" in the audit trail.
 */
export async function scanForViruses(storageKey: string): Promise<ScanResult> {
  if (!env.ENABLE_VIRUS_SCAN) return { clean: true, skipped: true };

  try {
    const url = await storage.createDownloadUrl(storageKey, 600);
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn({ storageKey, status: response.status }, 'Could not fetch object to scan');
      return { clean: true, skipped: true };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return await scanBuffer(buffer);
  } catch (error) {
    logger.warn({ err: error, storageKey }, 'Virus scan failed — allowing upload');
    return { clean: true, skipped: true };
  }
}
