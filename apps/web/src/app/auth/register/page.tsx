'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AtSign, Lock, Sparkles, User } from 'lucide-react';
import {
  OAUTH_PROVIDER_LABELS,
  OAUTH_PROVIDERS,
  PASSWORD_STRENGTH_LABELS,
  passwordStrength,
} from '@lipsync/shared';
import { AuthShell, OAuthButtons } from '@/components/layout/AuthShell';
import { Button } from '@/components/ui/Button';
import { Callout, Input } from '@/components/ui/primitives';
import { useAuth } from '@/components/layout/AuthProvider';
import { ApiClientError, api } from '@/lib/api';
import { cn } from '@/lib/cn';

const STRENGTH_COLOURS = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'];

export default function RegisterPage() {
  const router = useRouter();
  const { signUp, user } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);

  const strength = useMemo(() => passwordStrength(password), [password]);

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  useEffect(() => {
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
      await signUp(email, password, name || undefined);
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
      title="Create your account"
      subtitle="720p renders and five minutes a month, free. No card."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/auth/login" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Callout tone="danger">{error}</Callout>}

        <Input
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          icon={<User className="size-4" />}
          autoComplete="name"
          placeholder="Optional"
          error={fieldErrors.name}
        />

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
            autoComplete="new-password"
            required
            error={fieldErrors.password}
            hint="At least 12 characters. A memorable phrase beats a short scramble."
          />

          {password.length > 0 && (
            <div className="mt-2.5 flex items-center gap-3">
              <div className="flex flex-1 gap-1">
                {[0, 1, 2, 3].map((index) => (
                  <span
                    key={index}
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors',
                      index < strength ? STRENGTH_COLOURS[strength] : 'bg-line',
                    )}
                  />
                ))}
              </div>
              <span className="w-20 text-right text-xs text-ink-subtle">
                {PASSWORD_STRENGTH_LABELS[strength]}
              </span>
            </div>
          )}
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-ink-muted">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 rounded border-line-strong accent-[hsl(var(--brand))]"
            required
          />
          <span>
            I agree to the{' '}
            <Link href="/policy/acceptable-use" className="text-brand hover:underline">
              acceptable use policy
            </Link>{' '}
            — including that I only lip-sync faces and voices I have permission to use.
          </span>
        </label>
        {fieldErrors.acceptedTerms && (
          <p role="alert" className="text-xs text-danger">
            {fieldErrors.acceptedTerms}
          </p>
        )}

        <Button
          type="submit"
          fullWidth
          size="lg"
          loading={submitting}
          disabled={!accepted}
          icon={<Sparkles className="size-4" />}
        >
          Create account
        </Button>
      </form>

      {providers.length > 0 && (
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
