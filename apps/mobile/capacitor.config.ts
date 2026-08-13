import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android shell.
 *
 * The UI is the same Next.js studio, exported to static files and shipped
 * inside the APK, so it opens instantly and works offline up to the point it
 * needs the API. Everything that touches the network — sign-in, uploads,
 * renders — goes to the API host over HTTPS.
 */
const config: CapacitorConfig = {
  appId: 'app.lipsyncstudio.mobile',
  appName: 'LipSync Studio',
  webDir: 'www',

  android: {
    // Release builds must not be debuggable — it lets anyone attach a debugger
    // to a shipped app and read whatever the WebView holds, tokens included.
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
    captureInput: true,
  },

  server: {
    androidScheme: 'https',
    // Uploads go straight to object storage from the WebView, so those hosts
    // have to be reachable. Anything not listed here opens in the system
    // browser instead of inside the app.
    allowNavigation: [
      'lipsync-api.fly.dev',
      '*.r2.cloudflarestorage.com',
      '*.amazonaws.com',
      'storage.googleapis.com',
    ],
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      // Matches --canvas in the dark theme, so the splash does not flash a
      // different colour than the app it hands over to.
      backgroundColor: '#0a0a12',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a12',
      overlaysWebView: false,
    },
    Keyboard: {
      // The studio has text fields low on the screen; resizing the body rather
      // than panning keeps the submit button reachable above the keyboard.
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
