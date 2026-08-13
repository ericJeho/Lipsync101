import { join } from 'node:path';

/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Vercel produces its own build output and does not want a standalone bundle;
// setting it there is at best redundant and at worst changes what gets traced.
// Everywhere else — the Docker image especially — standalone is exactly what
// we want, so the mode follows the target rather than being hardcoded.
const onVercel = Boolean(process.env.VERCEL);

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  ...(onVercel ? {} : { output: 'standalone' }),

  // The workspace root, so file tracing follows symlinked workspace packages
  // instead of stopping at apps/web.
  outputFileTracingRoot: join(import.meta.dirname, '../../'),

  // The shared package ships TypeScript source, so Next has to compile it
  // rather than treating it as a prebuilt dependency.
  transpilePackages: ['@lipsync/shared'],

  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },

  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },

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
};

export default nextConfig;
