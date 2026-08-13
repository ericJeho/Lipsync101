# Android app

LipSync Studio for Android is the same studio UI, exported to static files and
shipped inside the APK, wrapped in a Capacitor shell that gives it the native
pieces a browser cannot provide.

## Why a wrapper and not a rewrite

The studio is a React app whose expensive parts — the timeline, the expression
controls, the comparison player — are pure UI over an API. A React Native
rewrite would reimplement all of that to reach the same place, and would then
need keeping in step with the web version forever.

What the app genuinely needs from the platform is a short list: a real file
picker, microphone recording, a share sheet, the hardware back button, and a
launcher icon. Capacitor supplies exactly those and leaves the UI alone.

The UI is bundled in the APK rather than loaded from a URL, so it opens
instantly and offline. Only the API calls go over the network.

## Building

```bash
npm install
npm run sync --workspace @lipsync/mobile      # export web → stage → cap sync
npm run apk:debug --workspace @lipsync/mobile # → android/app/build/outputs/apk/debug/
```

`sync` does three things, and all three matter:

1. Builds the web app with `MOBILE_EXPORT=true`, which swaps Next into
   `output: 'export'` and drops the server-only features a static export cannot
   implement (rewrites and headers).
2. Copies `apps/web/out` into `apps/mobile/www`.
3. Runs `cap sync android`, which packs `www` into the native project's assets
   and regenerates the plugin registry.

**The API URL is baked in at build time.** `NEXT_PUBLIC_*` values are inlined
into the JavaScript bundle, and there is no runtime environment inside an APK,
so this has to be right when you build:

```bash
MOBILE_EXPORT=true NEXT_PUBLIC_API_URL=https://api.yourdomain.com \
  npm run build --workspace @lipsync/web
```

Pointing a shipped build at a different backend means rebuilding.

## CI builds the APK for you

`.github/workflows/android.yml` runs on every push touching the app and uploads
both APKs as artifacts. GitHub runners ship with the Android SDK, so this needs
no setup beyond pushing.

Download from the run's **Artifacts** section:

| Artifact | Installable | Use |
| --- | --- | --- |
| `lipsync-studio-debug-apk` | Yes | Sideload and test |
| `lipsync-studio-release-apk` | Only if signing secrets are set | Distribution |

Run it by hand with a specific backend via **Actions → Android APK → Run
workflow**, which takes an `api_url` input.

## Signing a release

Unsigned APKs will not install. Generate a keystore once and keep it somewhere
you will not lose it — losing it means you can never update an app already
published under that key:

```bash
keytool -genkey -v -keystore lipsync-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias lipsync
```

Locally, `apps/mobile/android/keystore.properties` (gitignored):

```properties
storeFile=/absolute/path/to/lipsync-release.jks
storePassword=...
keyAlias=lipsync
keyPassword=...
```

In CI, four repository secrets: `ANDROID_KEYSTORE_PATH`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Without them the release build still completes — it just produces an unsigned
APK, which proves the build works without pretending it is shippable.

## Installing a debug build

```bash
adb install -r app-debug.apk
```

The debug build uses application id `app.lipsyncstudio.mobile.debug`, so it
installs alongside a release build rather than replacing it.

## What is configured, and why

**Cleartext traffic is denied** (`network_security_config.xml`). The app carries
auth tokens, presigned upload URLs and user media. `minSdkVersion` is 24 rather
than Capacitor's default 22 specifically because the network security config is
ignored below API 24 — leaving it at 22 would have made the cleartext ban
decorative on the oldest devices.

**Backups are off** (`data_extraction_rules.xml`). The WebView's storage holds
the refresh cookie; letting it into a cloud backup or a device transfer moves
credentials somewhere the user never agreed to.

**Release builds are not debuggable.** Otherwise anyone can attach a debugger to
a shipped app and read what the WebView holds.

**Permissions are the minimum, and none are required to install.** Microphone
for in-app recording, and the Android 13+ per-type media permissions for picking
a video or track — with legacy `READ_EXTERNAL_STORAGE` capped at API 32, since
asking for broad storage on a modern device gets an app rejected from Play.
Recording is one of four ways to supply audio, so the microphone is declared
`required="false"` and the app installs on devices without one.

**Code shrinking is off.** Capacitor bridges JavaScript to native through
reflection, and R8 without a maintained keep-list strips what the bridge looks
up at runtime. The failure mode is a release build that installs and then shows
a blank screen. Turn it on only with a device to test against.

## Known limits

**`targetSdk` is 34, not 35.** That is what Capacitor 6 ships and tests against;
raising it needs a newer Android Gradle Plugin than Capacitor 6 pins. Sideloading
is unaffected, but Google Play requires 35 for new submissions — upgrade to
Capacitor 7 before submitting.

**The studio is a desktop-shaped UI on a phone.** It collapses to a single
column and has no horizontal overflow at 390px, but the timeline in particular
is built for a mouse. Treat the first build as a working port, not a finished
phone experience: the timeline wants touch gestures, and the upload flow wants
the native picker rather than the web file input.

**Renders still need the backend.** The APK contains the UI. Sign-in, uploads
and rendering all require the API, worker and inference service to be running —
see [DEPLOYMENT.md](DEPLOYMENT.md).
