import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { resolve } from 'node:path';
import { env, isProduction, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { apiRouter, healthRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { localUploadRouter } from './routes/localUpload.js';

export function createApp(): Express {
  const app = express();

  // Behind nginx/an ALB, `req.ip` is only correct when Express is told how many
  // proxies sit in front of it — and rate limiting keys on that value.
  app.set('trust proxy', isProduction ? 1 : false);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON and media, never HTML that loads scripts, so the
      // default CSP would only produce noise. The web app sets its own.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  app.use(
    cors({
      origin: [env.WEB_URL],
      credentials: true,
      // X-API-Key is how server-to-server callers authenticate.
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Idempotency-Key'],
      exposedHeaders: ['RateLimit', 'RateLimit-Policy'],
    }),
  );

  app.use(compression());
  app.use(cookieParser());

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        // Successful requests at debug keeps production logs to the signal:
        // client errors at warn, server errors at error.
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'debug';
        },
        customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
      }),
    );
  }

  // The Stripe webhook needs the raw body to verify its signature, so JSON
  // parsing is skipped for that one path and applied inside the route instead.
  app.use((req, res, next) => {
    if (req.originalUrl === '/v1/billing/webhooks/stripe') return next();
    express.json({ limit: '2mb' })(req, res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(healthRouter);

  // Local-disk storage serves media straight off the filesystem; cloud drivers
  // hand out presigned URLs instead and never hit these routes.
  if (env.STORAGE_DRIVER === 'local') {
    app.use(
      '/media',
      express.static(resolve(env.STORAGE_LOCAL_PATH), {
        maxAge: '1h',
        // Renders are private; a guessable path should not also be a listing.
        index: false,
        dotfiles: 'deny',
      }),
    );
    app.use('/v1/uploads/local', localUploadRouter);
  }

  app.use('/v1', globalLimiter, apiRouter);

  app.get('/', (_req, res) => {
    res.json({
      name: 'LipSync Studio API',
      version: '1.0.0',
      docs: `${env.API_URL}/v1/graphql/schema`,
      health: `${env.API_URL}/health`,
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
