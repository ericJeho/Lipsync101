import type { MetadataRoute } from 'next';

// Required by `output: export` (the Android build): without it Next cannot
// prove the route is static and refuses to emit it. These are already
// static in the server build, so this changes nothing there.
export const dynamic = 'force-static';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Signed-in surfaces carry no public value and can leak project names
      // through search results, so they stay out of the index.
      disallow: ['/dashboard', '/admin', '/auth/', '/api/'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
