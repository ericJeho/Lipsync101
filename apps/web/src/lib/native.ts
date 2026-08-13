'use client';

/**
 * Thin bridge to the Capacitor runtime.
 *
 * Deliberately talks to the `window.Capacitor` global rather than importing
 * `@capacitor/core`. The packages live in the mobile workspace, and importing
 * them here would pull a native bridge into the browser bundle that no web
 * visitor can use. Every call below is a no-op off-device.
 */

interface CapacitorPlugin {
  [method: string]: (options?: Record<string, unknown>) => Promise<unknown>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, CapacitorPlugin | undefined>;
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

export function isNative(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

export function platform(): 'web' | 'android' | 'ios' {
  if (typeof window === 'undefined') return 'web';
  const value = window.Capacitor?.getPlatform?.() ?? 'web';
  return value === 'android' || value === 'ios' ? value : 'web';
}

function plugin(name: string): CapacitorPlugin | null {
  if (!isNative()) return null;
  return window.Capacitor?.Plugins?.[name] ?? null;
}

/** Fire-and-forget: a missing plugin must never break the UI around it. */
async function call(
  pluginName: string,
  method: string,
  options?: Record<string, unknown>,
): Promise<void> {
  const target = plugin(pluginName);
  const fn = target?.[method];
  if (typeof fn !== 'function') return;
  try {
    await fn(options);
  } catch {
    // Plugin not installed, or the platform refused. Neither is worth
    // surfacing to a user mid-task.
  }
}

export const native = {
  /** Tints the status bar to match the app chrome. */
  async setStatusBar(theme: 'dark' | 'light'): Promise<void> {
    await call('StatusBar', 'setStyle', { style: theme === 'dark' ? 'DARK' : 'LIGHT' });
    await call('StatusBar', 'setBackgroundColor', {
      color: theme === 'dark' ? '#0a0a12' : '#fbfbfe',
    });
  },

  /**
   * Dismisses the splash once React has painted. Capacitor auto-hides on a
   * timer as a fallback, but hiding on first paint avoids the gap where the
   * splash is gone and the UI has not arrived.
   */
  async hideSplash(): Promise<void> {
    await call('SplashScreen', 'hide');
  },

  /** A short tick on a meaningful action — starting a render, mostly. */
  async tap(style: 'light' | 'medium' | 'heavy' = 'light'): Promise<void> {
    await call('Haptics', 'impact', { style: style.toUpperCase() });
  },

  async share(options: { title?: string; text?: string; url?: string }): Promise<void> {
    await call('Share', 'share', options);
  },

  async exitApp(): Promise<void> {
    await call('App', 'exitApp');
  },
};

/**
 * Wires the Android hardware back button to browser history.
 *
 * Without this the back button closes the app from any screen, which on
 * Android reads as a bug — users expect it to step back through the app first
 * and only exit from the root.
 */
export function registerBackButton(onBack: () => boolean): () => void {
  const app = plugin('App');
  if (!app) return () => undefined;

  let remove: (() => void) | undefined;

  const addListener = app.addListener as unknown as
    | ((event: string, handler: () => void) => Promise<{ remove: () => void }>)
    | undefined;

  if (typeof addListener !== 'function') return () => undefined;

  void addListener('backButton', () => {
    // The handler returns true when it consumed the press; otherwise we are at
    // the root of the app and the press means "leave".
    if (!onBack()) void native.exitApp();
  }).then((handle) => {
    remove = handle.remove;
  });

  return () => remove?.();
}
