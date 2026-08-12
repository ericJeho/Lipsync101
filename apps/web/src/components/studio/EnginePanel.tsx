'use client';

import { motion } from 'framer-motion';
import { Check, Cpu, Gauge, Sparkles, Zap } from 'lucide-react';
import {
  ENGINE_LIST,
  QUALITY_PRESETS,
  engineForPreset,
  type LipsyncEngine,
  type QualityPreset,
} from '@lipsync/shared';
import { useStudio } from '@/store/studio';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

const PRESET_META: Record<
  QualityPreset,
  { label: string; detail: string; icon: typeof Zap }
> = {
  fast: {
    label: 'Fast',
    detail: 'Draft in a fraction of the time. Great for checking timing.',
    icon: Zap,
  },
  balanced: {
    label: 'Balanced',
    detail: 'The default. Sharp mouth, identity preserved, sensible cost.',
    icon: Gauge,
  },
  highest: {
    label: 'Highest quality',
    detail: 'Slowest and dearest. Use it for the take you are shipping.',
    icon: Sparkles,
  },
};

export function EnginePanel() {
  const preset = useStudio((state) => state.preset);
  const engine = useStudio((state) => state.engine);
  const musicMode = useStudio((state) => state.musicMode);
  const setPreset = useStudio((state) => state.setPreset);
  const setEngine = useStudio((state) => state.setEngine);

  // With no explicit choice the preset decides, so the card for the engine
  // that will actually run still reads as selected.
  const effectiveEngine: LipsyncEngine = engine ?? engineForPreset(preset);

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-sm font-medium">Speed and quality</p>
        {/* Stacked rather than a three-column grid: this panel is a narrow
            sidebar, and three columns of prose there is unreadable. */}
        <div className="space-y-2">
          {QUALITY_PRESETS.map((id) => {
            const meta = PRESET_META[id];
            const active = preset === id && engine === null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPreset(id)}
                aria-pressed={active}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all',
                  active
                    ? 'border-brand/60 bg-brand/10'
                    : 'border-line bg-surface-raised/40 hover:border-line-strong',
                )}
              >
                <meta.icon
                  className={cn('mt-0.5 size-4 shrink-0', active ? 'text-brand' : 'text-ink-subtle')}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{meta.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-subtle">
                    {meta.detail}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium">Engine</p>
          {engine !== null && (
            <button
              type="button"
              onClick={() => setEngine(null)}
              className="text-xs text-brand hover:underline"
            >
              Back to automatic
            </button>
          )}
        </div>

        <div className="grid gap-2">
          {ENGINE_LIST.map((descriptor) => {
            const selected = descriptor.id === effectiveEngine;
            // Substituting silently would produce a technically-successful but
            // visibly wrong render, so an incompatible engine is shown as such.
            const incompatible = musicMode && !descriptor.capabilities.music;

            return (
              <motion.button
                key={descriptor.id}
                type="button"
                whileTap={{ scale: 0.99 }}
                onClick={() => !incompatible && setEngine(descriptor.id)}
                disabled={incompatible}
                aria-pressed={selected}
                className={cn(
                  'relative rounded-xl border p-4 text-left transition-all',
                  selected
                    ? 'border-brand/60 bg-brand/10'
                    : 'border-line bg-surface-raised/40 hover:border-line-strong',
                  incompatible && 'cursor-not-allowed opacity-40',
                )}
              >
                <span className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Cpu className={cn('size-3.5', selected ? 'text-brand' : 'text-ink-subtle')} />
                    {descriptor.name}
                  </span>
                  {selected && <Check className="size-4 shrink-0 text-brand" strokeWidth={3} />}
                </span>

                <span className="block text-xs leading-relaxed text-ink-muted">
                  {descriptor.tagline}
                </span>

                <span className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge tone={selected ? 'brand' : 'neutral'}>
                    {descriptor.creditMultiplier.toFixed(1)}× cost
                  </Badge>
                  {descriptor.capabilities.headMotion && <Badge>Head motion</Badge>}
                  {descriptor.capabilities.realtime && <Badge tone="success">Fast</Badge>}
                </span>

                {incompatible && (
                  <span className="mt-2 block text-[11px] text-warning">
                    Cannot handle singing — turn off music mode to use it.
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>

        {engine === null && (
          <p className="mt-3 text-xs text-ink-subtle">
            Automatic — the <strong className="text-ink-muted">{PRESET_META[preset].label}</strong>{' '}
            preset routes to {ENGINE_LIST.find((e) => e.id === effectiveEngine)?.name}.
          </p>
        )}
      </div>
    </div>
  );
}
