import { Router } from 'express';
import { z } from 'zod';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import {
  OAUTH_PROVIDERS,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type PublicUser,
} from '@lipsync/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { validateBody } from '../middleware/validate.js';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimit.js';
import { actorOf, requireAuth } from '../middleware/auth.js';
import { mailer } from '../services/mailer.js';
import {
  consumeVerificationToken,
  createVerificationToken,
  hashPassword,
  issueRefreshSession,
  revokeAllSessions,
  revokeSession,
  rotateRefreshSession,
  signAccessToken,
  verifyPassword,
} from '../services/tokens.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'lss_refresh';

function refreshCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    // Lax rather than Strict: the OAuth callback is a top-level cross-site
    // navigation back to us, and Strict would drop the cookie on that hop.
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/v1/auth',
    expires: expiresAt,
  };
}

export function toPublicUser(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
  plan: string;
  credits: number;
  storageUsedBytes: bigint;
  twoFactorEnabled: boolean;
  emailVerified: boolean;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role as PublicUser['role'],
    plan: user.plan as PublicUser['plan'],
    credits: user.credits,
    storageUsedBytes: Number(user.storageUsedBytes),
    twoFactorEnabled: user.twoFactorEnabled,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Registration and sign-in                                            */
/* ------------------------------------------------------------------ */

authRouter.post('/register', authLimiter, validateBody(registerSchema), async (req, res, next) => {
  try {
    const { email, password, name } = req.body as z.infer<typeof registerSchema>;
    const normalisedEmail = email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: normalisedEmail } });
    if (existing) {
      throw ApiError.conflict('An account with that email already exists.');
    }

    const user = await prisma.user.create({
      data: {
        email: normalisedEmail,
        passwordHash: await hashPassword(password),
        name: name ?? null,
      },
    });

    const token = await createVerificationToken(user.email, 'verify_email');
    await mailer.sendVerification(user.email, token);

    const session = await issueRefreshSession(user.id, {
      userAgent: req.header('user-agent'),
      ip: req.ip,
    });

    res.cookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions(session.expiresAt));
    res.status(201).json({
      user: toPublicUser(user),
      tokens: {
        accessToken: signAccessToken({
          sub: user.id,
          email: user.email,
          role: user.role,
          plan: user.plan,
          kind: 'access',
        }),
        refreshToken: session.refreshToken,
        expiresIn: 900,
      },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', authLimiter, validateBody(loginSchema), async (req, res, next) => {
  try {
    const { email, password, totp } = req.body as z.infer<typeof loginSchema>;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // The same message and roughly the same work for "no such user" and "wrong
    // password", so the response cannot be used to enumerate accounts.
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
      throw ApiError.unauthorized('That email and password do not match.');
    }

    if (user.suspendedAt) {
      throw ApiError.forbidden(user.suspendedReason ?? 'This account is suspended.');
    }

    if (user.twoFactorEnabled) {
      if (!totp) {
        // 202 rather than 401: the credentials were correct, one more factor is
        // needed, and the client should show the code field rather than an error.
        res.status(202).json({ twoFactorRequired: true });
        return;
      }
      const secret = user.twoFactorSecret;
      const valid =
        Boolean(secret) && authenticator.verify({ token: totp, secret: secret as string });
      const recoveryIndex = user.recoveryCodes.indexOf(totp);

      if (!valid && recoveryIndex === -1) {
        throw ApiError.unauthorized('That code is not valid.');
      }
      if (!valid && recoveryIndex !== -1) {
        // Recovery codes are single-use.
        const remaining = user.recoveryCodes.filter((_, i) => i !== recoveryIndex);
        await prisma.user.update({
          where: { id: user.id },
          data: { recoveryCodes: remaining },
        });
      }
    }

    const session = await issueRefreshSession(user.id, {
      userAgent: req.header('user-agent'),
      ip: req.ip,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    res.cookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions(session.expiresAt));
    res.json({
      user: toPublicUser(user),
      tokens: {
        accessToken: signAccessToken({
          sub: user.id,
          email: user.email,
          role: user.role,
          plan: user.plan,
          kind: 'access',
        }),
        refreshToken: session.refreshToken,
        expiresIn: 900,
      },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const token =
      (req.body?.refreshToken as string | undefined) ?? req.cookies?.[REFRESH_COOKIE];
    if (!token) throw ApiError.unauthorized('No refresh token supplied.');

    const rotated = await rotateRefreshSession(token, {
      userAgent: req.header('user-agent'),
      ip: req.ip,
    });

    const user = await prisma.user.findUnique({ where: { id: rotated.userId } });
    if (!user) throw ApiError.unauthorized();
    if (user.suspendedAt) throw ApiError.forbidden('This account is suspended.');

    res.cookie(REFRESH_COOKIE, rotated.refreshToken, refreshCookieOptions(rotated.expiresAt));
    res.json({
      user: toPublicUser(user),
      tokens: {
        accessToken: signAccessToken({
          sub: user.id,
          email: user.email,
          role: user.role,
          plan: user.plan,
          kind: 'access',
        }),
        refreshToken: rotated.refreshToken,
        expiresIn: 900,
      },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const token =
      (req.body?.refreshToken as string | undefined) ?? req.cookies?.[REFRESH_COOKIE];
    if (token) await revokeSession(token);
    res.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout-all', requireAuth(), async (req, res, next) => {
  try {
    const count = await revokeAllSessions(actorOf(req).userId);
    res.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
    res.json({ revoked: count });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth(), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: actorOf(req).userId } });
    if (!user) throw ApiError.notFound('Account not found.');
    res.json({ user: toPublicUser(user) });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Email verification and password reset                               */
/* ------------------------------------------------------------------ */

authRouter.post(
  '/verify-email',
  validateBody(z.object({ token: z.string().min(20) })),
  async (req, res, next) => {
    try {
      const email = await consumeVerificationToken(req.body.token, 'verify_email');
      await prisma.user.update({ where: { email }, data: { emailVerified: true } });
      res.json({ verified: true });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  '/forgot-password',
  passwordResetLimiter,
  validateBody(forgotPasswordSchema),
  async (req, res, next) => {
    try {
      const email = req.body.email.toLowerCase();
      const user = await prisma.user.findUnique({ where: { email } });

      // Always the same response. Telling an unauthenticated caller whether an
      // address is registered leaks the user list one guess at a time.
      if (user) {
        const token = await createVerificationToken(email, 'reset_password');
        await mailer.sendPasswordReset(email, token);
      }

      res.json({
        sent: true,
        message: 'If that address has an account, a reset link is on its way.',
      });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  '/reset-password',
  passwordResetLimiter,
  validateBody(resetPasswordSchema),
  async (req, res, next) => {
    try {
      const email = await consumeVerificationToken(req.body.token, 'reset_password');
      const user = await prisma.user.update({
        where: { email },
        data: { passwordHash: await hashPassword(req.body.password) },
      });

      // A password reset is the standard response to a suspected compromise, so
      // every other session is invalidated along with it.
      await revokeAllSessions(user.id);
      res.json({ reset: true });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  '/change-password',
  requireAuth(),
  validateBody(
    z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(12),
    }),
  ),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const user = await prisma.user.findUnique({ where: { id: actor.userId } });
      if (!user?.passwordHash) throw ApiError.badRequest('This account has no password set.');
      if (!(await verifyPassword(user.passwordHash, req.body.currentPassword))) {
        throw ApiError.unauthorized('Your current password is not correct.');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(req.body.newPassword) },
      });
      await revokeAllSessions(user.id);
      res.json({ changed: true });
    } catch (error) {
      next(error);
    }
  },
);

/* ------------------------------------------------------------------ */
/* Two-factor authentication                                           */
/* ------------------------------------------------------------------ */

authRouter.post('/2fa/setup', requireAuth(), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(actor.email, 'LipSync Studio', secret);

    // Stored but not yet enabled — the user has to prove they can generate a
    // valid code before we start demanding one at sign-in.
    await prisma.user.update({
      where: { id: actor.userId },
      data: { twoFactorSecret: secret },
    });

    res.json({ secret, otpauth, qrDataUrl: await QRCode.toDataURL(otpauth) });
  } catch (error) {
    next(error);
  }
});

authRouter.post(
  '/2fa/enable',
  requireAuth(),
  validateBody(z.object({ token: z.string().regex(/^\d{6}$/) })),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const user = await prisma.user.findUnique({ where: { id: actor.userId } });
      if (!user?.twoFactorSecret) {
        throw ApiError.badRequest('Start the setup flow before enabling two-factor auth.');
      }
      if (!authenticator.verify({ token: req.body.token, secret: user.twoFactorSecret })) {
        throw ApiError.badRequest('That code is not valid. Check your authenticator app.');
      }

      const recoveryCodes = Array.from({ length: 10 }, () =>
        randomBytes(5).toString('hex').toUpperCase(),
      );

      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: true, recoveryCodes },
      });

      res.json({ enabled: true, recoveryCodes });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  '/2fa/disable',
  requireAuth(),
  validateBody(z.object({ password: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const user = await prisma.user.findUnique({ where: { id: actor.userId } });
      if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, req.body.password))) {
        throw ApiError.unauthorized('Confirm your password to turn off two-factor auth.');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: false, twoFactorSecret: null, recoveryCodes: [] },
      });

      res.json({ enabled: false });
    } catch (error) {
      next(error);
    }
  },
);

/* ------------------------------------------------------------------ */
/* OAuth                                                               */
/* ------------------------------------------------------------------ */

interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope: string;
  clientId?: string;
  clientSecret?: string;
}

const OAUTH_CONFIG: Record<string, OAuthProviderConfig> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userinfoUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scope: 'openid email profile',
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
  },
  apple: {
    authorizeUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    userinfoUrl: '',
    scope: 'name email',
    clientId: env.APPLE_CLIENT_ID,
    clientSecret: env.APPLE_CLIENT_SECRET,
  },
};

/** Which providers actually have credentials — the UI hides the rest. */
authRouter.get('/providers', (_req, res) => {
  res.json({
    providers: OAUTH_PROVIDERS.map((id) => ({
      id,
      configured: Boolean(OAUTH_CONFIG[id]?.clientId && OAUTH_CONFIG[id]?.clientSecret),
    })),
  });
});

authRouter.get('/oauth/:provider', (req, res, next) => {
  try {
    const provider = req.params.provider;
    const config = OAUTH_CONFIG[provider];
    if (!config) throw ApiError.notFound('Unknown sign-in provider.');
    if (!config.clientId || !config.clientSecret) {
      throw ApiError.serviceUnavailable(`${provider} sign-in is not configured on this deployment.`);
    }

    // `state` is a signed random value echoed back by the provider; comparing it
    // on return is what stops an attacker from forging the callback (CSRF).
    const state = randomBytes(16).toString('hex');
    res.cookie(`oauth_state_${provider}`, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 600_000,
    });

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${env.API_URL}/v1/auth/oauth/${provider}/callback`,
      response_type: 'code',
      scope: config.scope,
      state,
    });

    res.redirect(`${config.authorizeUrl}?${params.toString()}`);
  } catch (error) {
    next(error);
  }
});

authRouter.get('/oauth/:provider/callback', async (req, res, next) => {
  try {
    const provider = req.params.provider;
    const config = OAUTH_CONFIG[provider];
    if (!config?.clientId || !config.clientSecret) {
      throw ApiError.notFound('Unknown sign-in provider.');
    }

    const { code, state } = req.query as { code?: string; state?: string };
    const expectedState = req.cookies?.[`oauth_state_${provider}`];
    if (!code || !state || state !== expectedState) {
      throw ApiError.badRequest('That sign-in attempt could not be verified. Try again.');
    }
    res.clearCookie(`oauth_state_${provider}`);

    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${env.API_URL}/v1/auth/oauth/${provider}/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      throw ApiError.badRequest('The provider rejected that sign-in.');
    }

    const tokenBody = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenBody.access_token) throw ApiError.badRequest('No access token was returned.');

    const profileResponse = await fetch(config.userinfoUrl, {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        accept: 'application/json',
        'user-agent': 'lipsync-studio',
      },
    });

    const profile = (await profileResponse.json()) as {
      sub?: string;
      id?: number | string;
      email?: string;
      name?: string;
      picture?: string;
      avatar_url?: string;
    };

    const providerUserId = String(profile.sub ?? profile.id ?? '');
    const email = profile.email?.toLowerCase();
    if (!providerUserId || !email) {
      throw ApiError.badRequest(
        'That account did not share an email address, which we need to create your profile.',
      );
    }

    // Link by email when an account already exists — otherwise signing in with
    // Google after registering with a password would silently create a duplicate.
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: profile.name ?? null,
        avatarUrl: profile.picture ?? profile.avatar_url ?? null,
        emailVerified: true,
        accounts: { create: { provider, providerUserId } },
      },
      update: {
        lastSeenAt: new Date(),
        accounts: {
          connectOrCreate: {
            where: { provider_providerUserId: { provider, providerUserId } },
            create: { provider, providerUserId },
          },
        },
      },
    });

    if (user.suspendedAt) throw ApiError.forbidden('This account is suspended.');

    const session = await issueRefreshSession(user.id, {
      userAgent: req.header('user-agent'),
      ip: req.ip,
    });

    res.cookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions(session.expiresAt));

    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
      kind: 'access',
    });

    // The token rides back in the fragment so it never lands in server logs or
    // the Referer header on the next navigation.
    res.redirect(`${env.WEB_URL}/auth/callback#access_token=${accessToken}`);
  } catch (error) {
    logger.warn({ err: error }, 'OAuth callback failed');
    next(error);
  }
});
