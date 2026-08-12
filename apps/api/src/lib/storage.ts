import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface PresignedUpload {
  /** Where the browser PUTs the bytes. */
  url: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  storageKey: string;
  expiresInSeconds: number;
}

export interface StorageDriver {
  readonly name: string;
  /** Mint a direct-to-storage upload so large files never transit the API. */
  createUploadUrl(key: string, contentType: string, sizeBytes: number): Promise<PresignedUpload>;
  /** Time-limited read URL for a private object. */
  createDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  putStream(key: string, body: Readable, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** Namespaced, collision-proof key. Keeping the extension helps CDN sniffing. */
export function buildStorageKey(userId: string, filename: string, kind: string): string {
  const dot = filename.lastIndexOf('.');
  const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase();
  const safeExt = /^\.[a-z0-9]{1,6}$/.test(ext) ? ext : '';
  const today = new Date().toISOString().slice(0, 10);
  return `${kind}/${userId}/${today}/${randomUUID()}${safeExt}`;
}

/**
 * Local disk driver — the default so a fresh clone works with no cloud account.
 * Uploads are proxied through the API's own /uploads endpoint instead of being
 * presigned, which is fine at development volumes.
 */
class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly root: string;

  constructor(rootPath: string) {
    this.root = resolve(rootPath);
  }

  /**
   * Refuses keys that would escape the storage root. A key is attacker-influenced
   * (it embeds a filename), so `../` traversal has to be impossible, not unlikely.
   */
  private pathFor(key: string): string {
    const target = resolve(join(this.root, key));
    if (target !== this.root && !target.startsWith(this.root + '/')) {
      throw new Error(`Refusing to resolve storage key outside the root: ${key}`);
    }
    return target;
  }

  async createUploadUrl(key: string, contentType: string): Promise<PresignedUpload> {
    return {
      url: `${env.API_URL}/v1/uploads/local/${encodeURIComponent(key)}`,
      method: 'PUT',
      headers: { 'content-type': contentType },
      storageKey: key,
      expiresInSeconds: 3600,
    };
  }

  async createDownloadUrl(key: string): Promise<string> {
    return `${env.STORAGE_PUBLIC_URL}/${key}`;
  }

  async putStream(key: string, body: Readable): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await pipeline(body, createWriteStream(target));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * S3-compatible driver covering AWS S3, Cloudflare R2, Google Cloud Storage's
 * interoperability endpoint and Azure Blob via its S3 proxy — they differ only
 * in endpoint and virtual-host style, both of which are configuration.
 *
 * Signing is SigV4, implemented here rather than pulled from the AWS SDK to
 * keep the API image small; presigned PUT/GET is the only operation we need.
 */
class S3CompatibleDriver implements StorageDriver {
  constructor(
    readonly name: string,
    private readonly opts: {
      bucket: string;
      region: string;
      endpoint: string;
      accessKey: string;
      secretKey: string;
      publicUrl: string;
    },
  ) {}

  private sign(
    method: 'PUT' | 'GET' | 'HEAD' | 'DELETE',
    key: string,
    expiresInSeconds: number,
  ): string {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const host = new URL(this.opts.endpoint).host;
    const credentialScope = `${dateStamp}/${this.opts.region}/s3/aws4_request`;

    const query = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.opts.accessKey}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': 'host',
    });

    const canonicalUri = `/${this.opts.bucket}/${key
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;

    const canonicalRequest = [
      method,
      canonicalUri,
      query.toString(),
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    // SigV4 derives the signing key by chaining HMACs over date, region and
    // service, so a leaked signature is scoped to one day and one bucket region.
    const kDate = hmacSha256(`AWS4${this.opts.secretKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, this.opts.region);
    const kService = hmacSha256(kRegion, 's3');
    const kSigning = hmacSha256(kService, 'aws4_request');
    const signature = hmacSha256(kSigning, stringToSign).toString('hex');

    query.set('X-Amz-Signature', signature);
    return `${this.opts.endpoint}${canonicalUri}?${query.toString()}`;
  }

  async createUploadUrl(
    key: string,
    contentType: string,
  ): Promise<PresignedUpload> {
    return {
      url: this.sign('PUT', key, 3600),
      method: 'PUT',
      headers: { 'content-type': contentType },
      storageKey: key,
      expiresInSeconds: 3600,
    };
  }

  async createDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return this.sign('GET', key, expiresInSeconds);
  }

  async putStream(key: string, body: Readable, contentType: string): Promise<void> {
    const url = this.sign('PUT', key, 900);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    const response = await fetch(url, {
      method: 'PUT',
      body: Buffer.concat(chunks),
      headers: { 'content-type': contentType },
    });
    if (!response.ok) {
      throw new Error(`Storage PUT failed with ${response.status}`);
    }
  }

  async delete(key: string): Promise<void> {
    const response = await fetch(this.sign('DELETE', key, 900), { method: 'DELETE' });
    // A missing object is the state we wanted, so 404 is success, not failure.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Storage DELETE failed with ${response.status}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    const response = await fetch(this.sign('HEAD', key, 60), { method: 'HEAD' });
    return response.ok;
  }
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

const DEFAULT_ENDPOINTS: Record<string, (region: string) => string> = {
  s3: (region) => `https://s3.${region}.amazonaws.com`,
  gcs: () => 'https://storage.googleapis.com',
  r2: () => 'https://r2.cloudflarestorage.com',
  azure: () => 'https://blob.core.windows.net',
};

function buildDriver(): StorageDriver {
  const driver = env.STORAGE_DRIVER;
  if (driver === 'local') {
    return new LocalStorageDriver(env.STORAGE_LOCAL_PATH);
  }

  const accessKey = env.STORAGE_ACCESS_KEY;
  const secretKey = env.STORAGE_SECRET_KEY;
  if (!accessKey || !secretKey) {
    logger.warn(
      { driver },
      'STORAGE_DRIVER is set to a cloud driver but no credentials were supplied — falling back to local disk',
    );
    return new LocalStorageDriver(env.STORAGE_LOCAL_PATH);
  }

  const endpoint =
    env.STORAGE_ENDPOINT ?? DEFAULT_ENDPOINTS[driver]?.(env.STORAGE_REGION) ?? '';

  return new S3CompatibleDriver(driver, {
    bucket: env.STORAGE_BUCKET,
    region: env.STORAGE_REGION,
    endpoint,
    accessKey,
    secretKey,
    publicUrl: env.STORAGE_PUBLIC_URL,
  });
}

export const storage: StorageDriver = buildDriver();
