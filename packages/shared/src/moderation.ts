/** Content-safety vocabulary shared by the API, the AI service and the admin UI. */

export const MODERATION_CATEGORIES = [
  'nsfw',
  'nonconsensual_likeness',
  'violence',
  'copyright',
  'spam',
] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

export const MODERATION_CATEGORY_LABELS: Record<
  ModerationCategory,
  { name: string; detail: string }
> = {
  nsfw: {
    name: 'Adult content',
    detail: 'Sexual or explicit imagery in the source video or generated frames.',
  },
  nonconsensual_likeness: {
    name: 'Non-consensual likeness',
    detail:
      'A recognisable person driven by audio they did not record, without a matching consent record.',
  },
  violence: {
    name: 'Violence',
    detail: 'Graphic injury, gore, or content depicting real-world harm.',
  },
  copyright: {
    name: 'Copyright',
    detail: 'Audio or footage matching a known rights-holder fingerprint.',
  },
  spam: {
    name: 'Spam / abuse',
    detail: 'Bulk near-identical renders, or accounts tripping automated abuse heuristics.',
  },
};

export type ModerationAction = 'allow' | 'flag' | 'block';

export interface ModerationSignal {
  category: ModerationCategory;
  /** 0..1 */
  score: number;
  detail?: string;
}

export interface ModerationVerdict {
  action: ModerationAction;
  signals: ModerationSignal[];
  /** Set when a human reviewer has since overridden the automated call. */
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

/**
 * Thresholds are per-category because the cost of a false positive differs.
 * Blocking a wedding video for "violence" is worse than holding a suspected
 * non-consensual deepfake for review, so the likeness threshold sits lower.
 */
export const MODERATION_THRESHOLDS: Record<
  ModerationCategory,
  { flag: number; block: number }
> = {
  nsfw: { flag: 0.55, block: 0.85 },
  nonconsensual_likeness: { flag: 0.4, block: 0.8 },
  violence: { flag: 0.6, block: 0.9 },
  copyright: { flag: 0.5, block: 0.92 },
  spam: { flag: 0.7, block: 0.95 },
};

export function verdictFor(signals: ModerationSignal[]): ModerationVerdict {
  let action: ModerationAction = 'allow';
  for (const signal of signals) {
    const threshold = MODERATION_THRESHOLDS[signal.category];
    if (!threshold) continue;
    if (signal.score >= threshold.block) return { action: 'block', signals };
    if (signal.score >= threshold.flag) action = 'flag';
  }
  return { action, signals };
}
