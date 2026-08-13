#!/usr/bin/env node
/**
 * Copies the web app's static export into www/, which is what Capacitor packs
 * into the APK.
 *
 * Capacitor resolves `webDir` relative to this project, and pointing it across
 * the workspace at ../web/out worked unreliably — `cap sync` resolves it from
 * a different cwd depending on how it is invoked. Staging into a local www/ is
 * one extra copy and removes the ambiguity.
 */

import { cp, rm, stat, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../web/out');
const destination = resolve(here, '../www');

async function main() {
  try {
    const info = await stat(source);
    if (!info.isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(
      `\nNo web export found at ${source}\n\n` +
        `Build it first:\n  MOBILE_EXPORT=true npm run build --workspace @lipsync/web\n` +
        `or just run:\n  npm run sync --workspace @lipsync/mobile\n`,
    );
    process.exit(1);
  }

  // Replace rather than merge: a stale chunk left behind from a previous build
  // is the kind of thing that only shows up as a blank screen on a device.
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });

  const entries = await readdir(destination);
  console.log(
    `Staged ${entries.length} entries from web/out into mobile/www ` +
      `(index.html ${entries.includes('index.html') ? 'present' : 'MISSING'})`,
  );
}

await main();
