import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, letting later Tailwind utilities win over earlier ones.
 *
 * Without the merge step, `cn('px-4', 'px-6')` emits both and the winner is
 * whichever CSS rule happens to come later in the stylesheet — which makes
 * component prop overrides unreliable.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
