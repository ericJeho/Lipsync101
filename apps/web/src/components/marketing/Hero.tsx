'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Play, Waves } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/primitives';

/** Deterministic bar heights — Math.random() here would break hydration. */
const WAVE_BARS = Array.from({ length: 56 }, (_, i) =>
  Math.round(28 + 52 * Math.abs(Math.sin(i / 3.4) * Math.cos(i / 7.1))),
);

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden px-4 pb-24 pt-20 sm:px-6 sm:pt-28 lg:px-8">
      {/* Ambient gradient wash. aria-hidden and pointer-events-none so it is
          purely decorative and never intercepts a click. */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute left-1/2 top-0 size-[52rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-brand/25 blur-[140px] animate-aurora" />
        <div className="absolute right-0 top-1/3 size-[36rem] rounded-full bg-accent/20 blur-[130px] animate-float" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'linear-gradient(hsl(var(--ink)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--ink)) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black, transparent)',
          }}
        />
      </div>

      <div className="mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Badge tone="brand" dot className="mb-6">
            Six engines · 10 languages · 4K output
          </Badge>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
        >
          Make any face speak <span className="gradient-text">any audio</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.12 }}
          className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-ink-muted"
        >
          Upload a video and a track — speech, singing or a translation — and get back a render
          where the mouth matches the phonemes and everything else stays exactly as you shot it.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.19 }}
          className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Link href="/studio">
            <Button size="lg" iconAfter={<ArrowRight className="size-4" />}>
              Open the studio
            </Button>
          </Link>
          <Link href="/pricing">
            <Button size="lg" variant="outline" icon={<Play className="size-4" />}>
              See what it costs
            </Button>
          </Link>
        </motion.div>

        <p className="mt-5 text-xs text-ink-subtle">
          Free tier: 720p, 5 minutes a month. No card required.
        </p>
      </div>

      {/* Before / after panel */}
      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.28 }}
        className="relative mx-auto mt-20 max-w-5xl"
      >
        <div className="gradient-ring glass-strong rounded-panel p-2 shadow-panel">
          <div className="grid gap-2 sm:grid-cols-2">
            <PreviewPane label="Original" tone="neutral" />
            <PreviewPane label="Lip-synced" tone="brand" active />
          </div>

          <div className="flex items-center gap-4 px-4 py-4">
            <Waves className="size-4 shrink-0 text-brand" aria-hidden />
            <div
              className="flex h-10 flex-1 items-center gap-[3px]"
              role="img"
              aria-label="Audio waveform of the driving track"
            >
              {WAVE_BARS.map((height, index) => (
                <motion.span
                  key={index}
                  className="w-full rounded-full bg-gradient-to-t from-brand/40 to-accent/80"
                  style={{ height: `${height}%` }}
                  animate={{ scaleY: [1, 0.55, 1] }}
                  transition={{
                    duration: 1.6,
                    repeat: Infinity,
                    // Staggering by index makes the bars read as a travelling
                    // wave rather than all pulsing together.
                    delay: (index % 14) * 0.09,
                    ease: 'easeInOut',
                  }}
                />
              ))}
            </div>
            <span className="hidden shrink-0 font-mono text-xs tabular-nums text-ink-subtle sm:block">
              00:42
            </span>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function PreviewPane({
  label,
  tone,
  active,
}: {
  label: string;
  tone: 'neutral' | 'brand';
  active?: boolean;
}) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-surface-raised">
      <div
        className={
          tone === 'brand'
            ? 'absolute inset-0 bg-gradient-to-br from-brand/25 via-transparent to-accent/25'
            : 'absolute inset-0 bg-gradient-to-br from-line/40 to-transparent'
        }
      />

      {/* Stylised face placeholder — the real page ships a sample render here. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          <div className="size-24 rounded-full bg-line-strong/60 sm:size-28" />
          <div className="absolute left-1/2 top-[38%] flex -translate-x-1/2 gap-5">
            <span className="size-2 rounded-full bg-ink/50" />
            <span className="size-2 rounded-full bg-ink/50" />
          </div>
          <motion.div
            className="absolute left-1/2 top-[62%] h-2 -translate-x-1/2 rounded-full bg-ink/60"
            animate={active ? { width: [14, 26, 10, 22, 14], height: [6, 10, 4, 8, 6] } : {}}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            style={{ width: 18 }}
          />
        </div>
      </div>

      <span className="absolute left-3 top-3 rounded-md bg-canvas/70 px-2 py-1 text-[11px] font-medium backdrop-blur">
        {label}
      </span>

      {active && (
        <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-canvas/70 px-2 py-1 text-[11px] font-medium backdrop-blur">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-success" />
            <span className="relative inline-flex size-1.5 rounded-full bg-success" />
          </span>
          Synced
        </span>
      )}
    </div>
  );
}
