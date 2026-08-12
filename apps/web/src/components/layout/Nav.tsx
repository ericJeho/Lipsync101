'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, Moon, Sparkles, Sun, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/primitives';
import { useTheme } from './ThemeProvider';
import { useAuth } from './AuthProvider';
import { cn } from '@/lib/cn';

const LINKS = [
  { href: '/studio', label: 'Studio' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/developers', label: 'API' },
];

export function Nav() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const { user, loading } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line/60 glass">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8"
      >
        <Link href="/" className="flex shrink-0 items-center gap-2.5 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-xl gradient-brand shadow-glow">
            <Sparkles className="size-4 text-white" />
          </span>
          <span className="hidden sm:inline">LipSync Studio</span>
        </Link>

        <div className="hidden flex-1 items-center gap-1 md:flex">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'text-ink' : 'text-ink-muted hover:text-ink',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="flex size-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>

          {loading ? (
            <div className="skeleton h-9 w-24 rounded-xl" />
          ) : user ? (
            <>
              <Badge tone="brand" className="hidden sm:inline-flex">
                <Zap className="size-3" />
                {user.credits.toLocaleString()}
              </Badge>
              <Link href="/dashboard">
                <Button size="sm" variant="secondary">
                  Dashboard
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="hidden sm:block">
                <Button size="sm" variant="ghost">
                  Sign in
                </Button>
              </Link>
              <Link href="/auth/register">
                <Button size="sm">Start free</Button>
              </Link>
            </>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation"
            className="flex size-9 items-center justify-center rounded-lg text-ink-muted md:hidden"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-line md:hidden"
          >
            <div className="space-y-1 px-4 py-3">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-ink-muted hover:bg-surface-raised hover:text-ink"
                >
                  {link.label}
                </Link>
              ))}
              {!user && (
                <Link
                  href="/auth/login"
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-ink-muted hover:bg-surface-raised hover:text-ink"
                >
                  Sign in
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
