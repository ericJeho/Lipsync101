import type { MetadataRoute } from 'next';

// Required by `output: export` (the Android build): without it Next cannot
// prove the route is static and refuses to emit it. These are already
// static in the server build, so this changes nothing there.
export const dynamic = 'force-static';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: siteUrl, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${siteUrl}/studio`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${siteUrl}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${siteUrl}/developers`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
  ];
}
