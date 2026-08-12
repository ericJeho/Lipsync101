'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AtSign, Send } from 'lucide-react';
import { AuthShell } from '@/components/layout/AuthShell';
import { Button } from '@/components/ui/Button';
import { Callout, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    // The endpoint answers identically whether or not the address is
    // registered, so there is no error branch to show here.
    await api.auth.forgotPassword(email).catch(() => undefined);
    setSent(true);
    setSubmitting(false);
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email you a link to choose a new one."
      footer={
        <Link href="/auth/login" className="font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Callout tone="success" title="Check your inbox">
          If that address has an account, a reset link is on its way. The link is good for an
          hour, and nothing changes until you use it.
        </Callout>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            icon={<AtSign className="size-4" />}
            autoComplete="email"
            required
          />
          <Button type="submit" fullWidth size="lg" loading={submitting} icon={<Send className="size-4" />}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
