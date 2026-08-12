'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthSession, PublicUser } from '@lipsync/shared';
import { api, apiFetch, setAccessToken } from '@/lib/api';

interface AuthContextValue {
  user: PublicUser | null;
  /** True until the initial session restore settles. */
  loading: boolean;
  signIn: (email: string, password: string, totp?: string) => Promise<'ok' | 'needs-2fa'>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Optimistically adjust the credit balance from a realtime event. */
  setCredits: (credits: number) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const restore = useCallback(async () => {
    try {
      // The refresh cookie is httpOnly, so the only way to know whether a
      // session exists is to ask. A 401 here is the normal signed-out case.
      const session = await apiFetch<AuthSession>('/auth/refresh', { method: 'POST' });
      setAccessToken(session.tokens.accessToken);
      setUser(session.user);
    } catch {
      setAccessToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    if (!user) return;
    // Access tokens last 15 minutes; refreshing at 12 keeps a long editing
    // session alive without the user ever seeing an auth error.
    const timer = setInterval(() => void restore(), 12 * 60_000);
    return () => clearInterval(timer);
  }, [user, restore]);

  const signIn = useCallback<AuthContextValue['signIn']>(async (email, password, totp) => {
    const result = await api.auth.login({ email, password, totp });
    if ('twoFactorRequired' in result) return 'needs-2fa';
    setAccessToken(result.tokens.accessToken);
    setUser(result.user);
    return 'ok';
  }, []);

  const signUp = useCallback<AuthContextValue['signUp']>(async (email, password, name) => {
    const session = await api.auth.register({ email, password, name, acceptedTerms: true });
    setAccessToken(session.tokens.accessToken);
    setUser(session.user);
  }, []);

  const signOut = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    setAccessToken(null);
    setUser(null);
  }, []);

  const setCredits = useCallback((credits: number) => {
    setUser((current) => (current ? { ...current, credits } : current));
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut, refresh: restore, setCredits }),
    [user, loading, signIn, signUp, signOut, restore, setCredits],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
}
