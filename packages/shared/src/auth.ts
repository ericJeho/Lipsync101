import { z } from 'zod';
import { PLAN_IDS } from './billing.js';

export const USER_ROLES = ['user', 'moderator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const OAUTH_PROVIDERS = ['google', 'apple', 'github', 'microsoft'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Google',
  apple: 'Apple',
  github: 'GitHub',
  microsoft: 'Microsoft',
};

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: UserRole;
  plan: (typeof PLAN_IDS)[number];
  credits: number;
  storageUsedBytes: number;
  twoFactorEnabled: boolean;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface AuthSession {
  user: PublicUser;
  tokens: AuthTokens;
}

/**
 * Password rules. Deliberately length-first: a long passphrase beats a short
 * string with a symbol bolted on, so we ask for 12 characters and only two
 * character classes rather than the usual four.
 */
export const PASSWORD_MIN_LENGTH = 12;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(200, 'That password is too long.')
  .refine(
    (value) =>
      [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(value)).length >= 2,
    'Mix in at least two of: lowercase, uppercase, numbers, symbols.',
  );

export const emailSchema = z.string().email('Enter a valid email address.').max(320);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1).max(80).optional(),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You need to accept the terms to continue.' }),
  }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
  /** Six-digit TOTP code, required when the account has 2FA enabled. */
  totp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.').optional(),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/** Rough strength meter for the signup form. Returns 0..4. */
export function passwordStrength(password: string): number {
  if (!password) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  const lengthScore = password.length >= 20 ? 2 : password.length >= 14 ? 1 : 0;
  return Math.min(4, Math.max(0, classes - 1) + lengthScore);
}

export const PASSWORD_STRENGTH_LABELS = [
  'Too weak',
  'Weak',
  'Fair',
  'Strong',
  'Excellent',
] as const;
