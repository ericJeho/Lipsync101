import { join } from 'node:path';

/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Traced standalone output — the Docker runtime stage copies only this,
  // rather than the full workspace node_modules.
  output: 'standalone',
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
