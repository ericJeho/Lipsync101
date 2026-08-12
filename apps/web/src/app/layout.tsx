import type { Metadata, Viewport } from 'next';
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from '@lipsync/shared';
import { ThemeProvider } from '@/components/layout/ThemeProvider';
import { AuthProvider } from '@/components/layout/AuthProvider';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  keywords: [
    'lip sync',
    'AI video',
    'video dubbing',
    'Wav2Lip',
    'MuseTalk',
    'video translation',
    'AI subtitles',
    'talking head',
  ],
  authors: [{ name: APP_NAME }],
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: APP_NAME,
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: APP_DESCRIPTION,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: APP_NAME }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: APP_DESCRIPTION,
    images: ['/og.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  alternates: { canonical: siteUrl },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0a12' },
    { media: '(prefers-color-scheme: light)', color: '#fbfbfe' },
  ],
  width: 'device-width',
  initialScale: 1,
};

/**
 * Applies the stored theme before first paint.
 *
 * This has to be a blocking inline script: if the class were applied in an
 * effect the page would render in the default theme first and flash to the
 * user's choice a frame later.
 */
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('lipsync-theme');
    var system = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', stored || system);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: APP_NAME,
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web',
  description: APP_DESCRIPTION,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    description: 'Free tier with 720p output and 5 rendered minutes a month.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body>
        {/* First tab stop on every page — keyboard users should not have to
            traverse the whole nav to reach the content. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
