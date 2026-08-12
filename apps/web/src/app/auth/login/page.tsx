'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AtSign, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { OAUTH_PROVIDER_LABELS, OAUTH_PROVIDERS } from '@lipsync/shared';
import { AuthShell, OAuthButtons } from '@/components/layout/AuthShell';
import { Button } from '@/components/ui/Button';
import { Callout, Input } from '@/components/ui/primitives';
import { useAuth } from '@/components/layout/AuthProvider';
import { ApiClientError, api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, user } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  useEffect(() => {
    // Only offer the buttons for providers this deployment actually has keys
    // for — a button that always errors is worse than no button.
    api.auth
      .providers()
      .then((result) =>
        setProviders(result.providers.filter((p) => p.configured).map((p) => p.id)),
      )
      .catch(() => setProviders([]));
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      const outcome = await signIn(email, password, needsTotp ? totp : undefined);
      if (outcome === 'needs-2fa') {
        setNeedsTotp(true);
        return;
      }
      router.push('/dashboard');
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        setFieldErrors(caught.fieldErrors);
        setError(Object.keys(caught.fieldErrors).length > 0 ? null : caught.message);
      } else {
        setError('We could not reach the server. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Pick up where you left off."
      footer={
        <>
          New here?{' '}
          <Link href="/auth/register" className="font-medium text-brand hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Callout tone="danger">{error}</Callout>}

        {needsTotp ? (
          <>
            <Callout tone="brand" title="One more step">
              Enter the six-digit code from your authenticator app, or a recovery code.
            </Callout>
            <Input
              label="Authentication code"
              value={totp}
              onChange={(event) => setTotp(event.target.value)}
              icon={<ShieldCheck className="size-4" />}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              autoFocus
              error={fieldErrors.totp}
            />
          </>
        ) : (
          <>
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              icon={<AtSign className="size-4" />}
              autoComplete="email"
              required
              error={fieldErrors.email}
            />
            <div>
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                icon={<Lock className="size-4" />}
                autoComplete="current-password"
                required
                error={fieldErrors.password}
              />
              <div className="mt-2 text-right">
                <Link href="/auth/forgot" className="text-xs text-brand hover:underline">
                  Forgot your password?
                </Link>
              </div>
            </div>
          </>
        )}

        <Button type="submit" fullWidth size="lg" loading={submitting} icon={<KeyRound className="size-4" />}>
          {needsTotp ? 'Verify and sign in' : 'Sign in'}
        </Button>
      </form>

      {!needsTotp && providers.length > 0 && (
        <OAuthButtons
          providers={providers.filter((id) =>
            (OAUTH_PROVIDERS as readonly string[]).includes(id),
          )}
          labels={OAUTH_PROVIDER_LABELS}
        />
      )}
    </AuthShell>
  );
}
