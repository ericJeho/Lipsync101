import { join } from 'node:path';

/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Vercel produces its own build output and does not want a standalone bundle;
// setting it there is at best redundant and at worst changes what gets traced.
// Everywhere else — the Docker image especially — standalone is exactly what
// we want, so the mode follows the target rather than being hardcoded.
const onVercel = Boolean(process.env.VERCEL);

// The Android app ships the UI as static files inside the APK and talks to the
// API over the network, so it needs `export` rather than a server build. Two
// server-only features have to come off with it: rewrites and headers, which a
// static export cannot implement (there is no server to run them). The native
// shell supplies the equivalent — Capacitor sets its own CSP and the app calls
// the API by absolute URL instead of proxying.
const forMobile = process.env.MOBILE_EXPORT === 'true';

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  ...(forMobile ? { output: 'export' } : onVercel ? {} : { output: 'standalone' }),

  // A static export has no image optimiser, and `next/image` refuses to build
  // without this rather than silently shipping unoptimised images.
  ...(forMobile ? { images: { unoptimized: true } } : {}),

  // file:// has no directory index, so every route needs its own index.html.
  ...(forMobile ? { trailingSlash: true } : {}),

  // The workspace root, so file tracing follows symlinked workspace packages
  // instead of stopping at apps/web.
  outputFileTracingRoot: join(import.meta.dirname, '../../'),

  // The shared package ships TypeScript source, so Next has to compile it
  // rather than treating it as a prebuilt dependency.
  transpilePackages: ['@lipsync/shared'],

  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },

  ...(forMobile ? {} : { images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  } }),

  ...(forMobile ? {} : {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            // Recording audio in the studio needs the microphone; nothing here
            // needs a camera or the user's location.
            value: 'camera=(), geolocation=(), microphone=(self)',
          },
        ],
      },
    ];
  },

  async rewrites() {
    // Same-origin API calls in development avoid CORS preflights on every
    // request and let the refresh cookie ride along untouched.
    return [{ source: '/api/:path*', destination: `${apiUrl}/v1/:path*` }];
  },
  }),
};

export default nextConfig;
