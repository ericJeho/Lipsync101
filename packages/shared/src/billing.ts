/** Subscription tiers, credit maths and the payment providers we accept. */

export const PLAN_IDS = ['free', 'pro', 'studio'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanLimits {
  /** Maximum output height in pixels. */
  maxHeight: 720 | 1080 | 2160;
  /** Rendered minutes included per month. `null` means unmetered. */
  minutesPerMonth: number | null;
  maxProjects: number | null;
  /** Longest single clip, in seconds. */
  maxClipSeconds: number;
  maxBatchSize: number;
  storageBytes: number;
  watermark: boolean;
  priorityRendering: boolean;
  apiAccess: boolean;
  teamWorkspace: boolean;
  /** Days an unrendered asset survives before automatic deletion. */
  retentionDays: number;
  concurrentJobs: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  monthlyUsd: number;
  yearlyUsd: number;
  limits: PlanLimits;
  features: string[];
  highlighted?: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Enough to prove it works on your own footage.',
    monthlyUsd: 0,
    yearlyUsd: 0,
    limits: {
      maxHeight: 720,
      minutesPerMonth: 5,
      maxProjects: 3,
      maxClipSeconds: 60,
      maxBatchSize: 1,
      storageBytes: 2 * 1024 * 1024 * 1024,
      watermark: true,
      priorityRendering: false,
      apiAccess: false,
      teamWorkspace: false,
      retentionDays: 7,
      concurrentJobs: 1,
    },
    features: [
      '720p output',
      '5 rendered minutes per month',
      'All six lip-sync engines',
      'Auto subtitles in 10 languages',
      'LipSync Studio watermark',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'For creators shipping every day.',
    monthlyUsd: 29,
    yearlyUsd: 290,
    limits: {
      maxHeight: 1080,
      minutesPerMonth: null,
      maxProjects: null,
      maxClipSeconds: 900,
      maxBatchSize: 10,
      storageBytes: 250 * 1024 * 1024 * 1024,
      watermark: false,
      priorityRendering: true,
      apiAccess: false,
      teamWorkspace: false,
      retentionDays: 90,
      concurrentJobs: 3,
    },
    features: [
      '1080p output',
      'Unlimited projects and render minutes',
      'No watermark',
      'Priority GPU queue',
      'Face restoration and HD upscaling',
      'Translation and voice cloning',
    ],
    highlighted: true,
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    tagline: 'Teams, pipelines and API-driven volume.',
    monthlyUsd: 99,
    yearlyUsd: 990,
    limits: {
      maxHeight: 2160,
      minutesPerMonth: null,
      maxProjects: null,
      maxClipSeconds: 3600,
      maxBatchSize: 50,
      storageBytes: 2 * 1024 * 1024 * 1024 * 1024,
      watermark: false,
      priorityRendering: true,
      apiAccess: true,
      teamWorkspace: true,
      retentionDays: 365,
      concurrentJobs: 10,
    },
    features: [
      '4K output',
      'REST + GraphQL API access',
      'Team workspace with shared projects',
      'Batch rendering up to 50 clips',
      'Webhooks and SDKs',
      'Priority support',
    ],
  },
};

export const PLAN_LIST: Plan[] = PLAN_IDS.map((id) => PLANS[id]);

/** Base credits charged per second of output before the engine multiplier. */
export const CREDITS_PER_OUTPUT_SECOND = 1;

export function creditsForRender(
  durationSeconds: number,
  engineMultiplier: number,
  outputHeight: number,
  enhancementCount = 0,
): number {
  const resolutionFactor = outputHeight >= 2160 ? 3 : outputHeight >= 1080 ? 1.5 : 1;
  const enhancementFactor = 1 + enhancementCount * 0.1;
  return Math.ceil(
    durationSeconds *
      CREDITS_PER_OUTPUT_SECOND *
      engineMultiplier *
      resolutionFactor *
      enhancementFactor,
  );
}

export const PAYMENT_PROVIDERS = [
  'stripe',
  'paypal',
  'airtel_money',
  'mtn_momo',
] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export interface PaymentMethodDescriptor {
  provider: PaymentProvider;
  name: string;
  /** Card brands / wallets surfaced under this provider. */
  accepts: string[];
  /** ISO-3166 alpha-2 codes, or `*` for everywhere the provider operates. */
  regions: string[];
  currency: string;
  /** Requires the payer to confirm a prompt on their handset. */
  requiresHandsetApproval: boolean;
}

export const PAYMENT_METHODS: Record<PaymentProvider, PaymentMethodDescriptor> = {
  stripe: {
    provider: 'stripe',
    name: 'Card',
    accepts: ['Visa', 'Mastercard', 'American Express', 'Apple Pay', 'Google Pay'],
    regions: ['*'],
    currency: 'USD',
    requiresHandsetApproval: false,
  },
  paypal: {
    provider: 'paypal',
    name: 'PayPal',
    accepts: ['PayPal balance', 'Linked card'],
    regions: ['*'],
    currency: 'USD',
    requiresHandsetApproval: false,
  },
  airtel_money: {
    provider: 'airtel_money',
    name: 'Airtel Money',
    accepts: ['Airtel Money wallet'],
    regions: ['MW', 'ZM', 'KE', 'TZ', 'UG', 'RW', 'NG'],
    currency: 'MWK',
    requiresHandsetApproval: true,
  },
  mtn_momo: {
    provider: 'mtn_momo',
    name: 'MTN Mobile Money',
    accepts: ['MTN MoMo wallet'],
    regions: ['UG', 'GH', 'CM', 'CI', 'RW', 'ZM', 'BJ'],
    currency: 'UGX',
    requiresHandsetApproval: true,
  },
};

export function methodsForRegion(countryCode: string): PaymentMethodDescriptor[] {
  const upper = countryCode.toUpperCase();
  return Object.values(PAYMENT_METHODS).filter(
    (m) => m.regions.includes('*') || m.regions.includes(upper),
  );
}
