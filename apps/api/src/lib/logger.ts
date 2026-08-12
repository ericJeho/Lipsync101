import pino from 'pino';
import { env, isProduction } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Pretty output is a dev nicety; in production we emit newline-delimited JSON
  // so the log shipper can parse it without a transform.
  transport: isProduction
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } },
  // Anything that could carry a credential gets stripped before it hits disk.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'res.headers["set-cookie"]',
      'password',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      '*.accessToken',
      '*.twoFactorSecret',
      '*.secret',
    ],
    censor: '[redacted]',
  },
  base: { service: 'lipsync-api' },
});

export type Logger = typeof logger;
