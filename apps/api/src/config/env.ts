import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/**
 * Every knob the API reads, validated once at boot.
 *
 * Anything that would let the service start in a silently insecure state is
 * required in production but allowed to fall back in development, so a fresh
 * clone runs with no .env at all.
 */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  WEB_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z
    .string()
    .default('postgresql://lipsync:lipsync@localhost:5432/lipsync?schema=public'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-please'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /** Where the Python inference service lives. */
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  AI_SERVICE_TOKEN: z.string().default('dev-ai-token'),

  STORAGE_DRIVER: z.enum(['local', 's3', 'r2', 'gcs', 'azure']).default('local'),
  STORAGE_BUCKET: z.string().default('lipsync-media'),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  STORAGE_PUBLIC_URL: z.string().default('http://localhost:4000/media'),
  STORAGE_LOCAL_PATH: z.string().default('./storage'),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_SECRET: z.string().optional(),
  AIRTEL_CLIENT_ID: z.string().optional(),
  AIRTEL_SECRET: z.string().optional(),
  MTN_SUBSCRIPTION_KEY: z.string().optional(),
  MTN_API_USER: z.string().optional(),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('LipSync Studio <no-reply@lipsyncstudio.app>'),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),

  /** Files older than this are swept by the retention worker. */
  DEFAULT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  /** Disable to run the API without Redis (tests, local UI work). */
  ENABLE_QUEUE: booleanish.default(true),
  ENABLE_VIRUS_SCAN: booleanish.default(false),
  CLAMAV_HOST: z.string().default('clamav'),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof schema>;

function parseEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const value = parsed.data;

  if (value.NODE_ENV === 'production') {
    const placeholders: string[] = [];
    if (value.JWT_ACCESS_SECRET.startsWith('dev-')) placeholders.push('JWT_ACCESS_SECRET');
    if (value.JWT_REFRESH_SECRET.startsWith('dev-')) placeholders.push('JWT_REFRESH_SECRET');
    if (value.AI_SERVICE_TOKEN.startsWith('dev-')) placeholders.push('AI_SERVICE_TOKEN');
    if (placeholders.length > 0) {
      throw new Error(
        `Refusing to start in production with development defaults for: ${placeholders.join(', ')}`,
      );
    }
  }

  return value;
}

export const env = parseEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
