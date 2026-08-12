'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { AuthShell } from '@/components/layout/AuthShell';
import { Callout } from '@/components/ui/primitives';
import { useAuth } from '@/components/layout/AuthProvider';
import { setAccessToken } from '@/lib/api';

/**
 * Lands here after an OAuth round trip. The API puts the access token in the
 * URL fragment rather than the query string so it never reaches a server log
 * or the Referer header, and we strip it from history immediately.
 */
export default function OAuthCallbackPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('access_token');

    if (!token) {
      setError('That sign-in did not complete. Try again from the sign-in page.');
      return;
    }

    setAccessToken(token);
    window.history.replaceState(null, '', window.location.pathname);

    void refresh().then(() => router.replace('/dashboard'));
  }, [refresh, router]);

  return (
    <AuthShell title="Signing you in" subtitle="One moment.">
      {error ? (
        <Callout tone="danger">{error}</Callout>
      ) : (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="size-6 animate-spin text-brand" />
        </div>
      )}
    </AuthShell>
  );
}
