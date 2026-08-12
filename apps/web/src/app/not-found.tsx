import Link from 'next/link';
import { Nav } from '@/components/layout/Nav';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <>
      <Nav />
      <main id="main" className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <p className="font-mono text-6xl font-semibold gradient-text">404</p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">We cannot find that page</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          The link may be out of date, or the project it pointed at may have been deleted.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/">
            <Button variant="secondary">Back home</Button>
          </Link>
          <Link href="/studio">
            <Button>Open the studio</Button>
          </Link>
        </div>
      </main>
    </>
  );
}
