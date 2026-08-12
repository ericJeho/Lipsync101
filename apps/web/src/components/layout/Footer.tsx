import Link from 'next/link';
import { Sparkles } from 'lucide-react';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/studio', label: 'Studio' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/developers', label: 'API & SDKs' },
      { href: '/dashboard', label: 'Dashboard' },
    ],
  },
  {
    title: 'Capabilities',
    links: [
      { href: '/#engines', label: 'Lip-sync engines' },
      { href: '/#translation', label: 'Translation' },
      { href: '/#subtitles', label: 'Subtitles & karaoke' },
      { href: '/#batch', label: 'Batch rendering' },
    ],
  },
  {
    title: 'Responsible use',
    links: [
      { href: '/policy/consent', label: 'Consent policy' },
      { href: '/policy/acceptable-use', label: 'Acceptable use' },
      { href: '/policy/privacy', label: 'Privacy & retention' },
      { href: '/policy/report', label: 'Report misuse' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line/60 bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <Link href="/" className="flex items-center gap-2.5 font-semibold">
              <span className="flex size-8 items-center justify-center rounded-xl gradient-brand">
                <Sparkles className="size-4 text-white" />
              </span>
              LipSync Studio
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-ink-muted">
              Lip-sync any video to any voice, song or language — while keeping the expression,
              blinks and head motion from the original take.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="mb-4 text-sm font-semibold">{column.title}</p>
              <ul className="space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-ink-muted transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-subtle">
            © {new Date().getFullYear()} LipSync Studio. Synthetic media — use it on faces and
            voices you have permission to use.
          </p>
          <p className="text-xs text-ink-subtle">
            Uploads are encrypted in transit and at rest, and deleted on your plan&rsquo;s
            retention schedule.
          </p>
        </div>
      </div>
    </footer>
  );
}
