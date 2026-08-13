'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from './ThemeProvider';
import { isNative, native, registerBackButton } from '@/lib/native';

/**
 * Native-only behaviour for the Android shell. Renders nothing, and does
 * nothing at all in a browser.
 */
export function NativeShell() {
  const { theme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  // Dismiss the splash as soon as React has painted something.
  useEffect(() => {
    if (!isNative()) return;
    void native.hideSplash();
  }, []);

  // Keep the status bar in step with the in-app theme toggle.
  useEffect(() => {
    if (!isNative()) return;
    void native.setStatusBar(theme);
  }, [theme]);

  useEffect(() => {
    if (!isNative()) return;

    return registerBackButton(() => {
      // At the root, report "not handled" so the shell exits the app — which
      // is what a user pressing back on the home screen means.
      if (pathname === '/' ) return false;

      router.back();
      return true;
    });
  }, [pathname, router]);

  return null;
}
