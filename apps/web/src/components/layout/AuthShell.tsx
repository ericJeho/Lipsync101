'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';

/**
 * Shared frame for the sign-in, register and password-reset screens.
 * Keeping them on one layout means the auth flow feels like one place rather
 * than three pages that happen to be adjacent.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main id="main" className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="absolute left-1/2 top-0 size-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/20 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 size-[28rem] rounded-full bg-accent/15 blur-[110px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5 font-semibold">
          <span className="flex size-9 items-center justify-center rounded-xl gradient-brand shadow-glow">
            <Sparkles className="size-4 text-white" />
          </span>
          LipSync Studio
        </Link>

        <div className="glass-strong gradient-ring rounded-panel p-7 shadow-panel">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>

        {footer && <p className="mt-6 text-center text-sm text-ink-muted">{footer}</p>}
      </motion.div>
    </main>
  );
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function OAuthButtons({
  providers,
  labels,
}: {
  providers: string[];
  labels: Record<string, string>;
}) {
  return (
    <div className="mt-6">
      <div className="relative mb-5 text-center">
        <span className="absolute inset-x-0 top-1/2 h-px bg-line" aria-hidden />
        <span className="relative bg-surface px-3 text-xs text-ink-subtle">or continue with</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {providers.map((provider) => (
          <a
            key={provider}
            // A full navigation, not a fetch: the OAuth handshake needs the
            // browser to leave the app and come back with a cookie.
            href={`${API_BASE}/v1/auth/oauth/${provider}`}
            className="flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface-raised/60 text-sm font-medium transition-colors hover:border-line-strong"
          >
            {labels[provider] ?? provider}
          </a>
        ))}
      </div>
    </div>
  );
}
