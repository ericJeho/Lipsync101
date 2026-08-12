'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  Film,
  Layers,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import {
  ENGINE_CATALOGUE,
  OUTPUT_FORMATS,
  SOCIAL_PRESETS,
  creditsForRender,
  engineForPreset,
  estimateRenderSeconds,
  formatDuration,
  type OutputFormat,
} from '@lipsync/shared';
import { useStudio } from '@/store/studio';
import { useAuth } from '@/components/layout/AuthProvider';
import { Badge, Callout, Progress } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const HEIGHTS = [
  { value: 720, label: '720p', plan: 'free' },
  { value: 1080, label: '1080p', plan: 'pro' },
  { value: 2160, label: '4K', plan: 'studio' },
] as const;

const PLAN_RANK = { free: 0, pro: 1, studio: 2 } as const;

export function RenderPanel() {
  const { user } = useAuth();
  const video = useStudio((state) => state.video);
  const audio = useStudio((state) => state.audio);
  const preset = useStudio((state) => state.preset);
  const engine = useStudio((state) => state.engine);
  const outputFormat = useStudio((state) => state.outputFormat);
  const outputHeight = useStudio((state) => state.outputHeight);
  const enhancements = useStudio((state) => state.enhancements);
  const setOutput = useStudio((state) => state.setOutput);
  const render = useStudio((state) => state.render);
  const setRender = useStudio((state) => state.setRender);
  const resetRender = useStudio((state) => state.resetRender);

  const [socialPreset, setSocialPreset] = useState<string | null>(null);

  const plan = (user?.plan ?? 'free') as keyof typeof PLAN_RANK;
  const effectiveEngine = engine ?? engineForPreset(preset);
  const ready = video?.status === 'ready' && audio?.status === 'ready';
  const duration = audio?.durationSeconds ?? 0;

  /**
   * Quoted locally from the shared pricing functions — the same maths the API
   * runs. The server still re-quotes on submit and is the authority; this just
   * means the number updates as you move a slider instead of after a round trip.
   */
  const quote = useMemo(() => {
    if (!ready || duration <= 0) return null;
    const descriptor = ENGINE_CATALOGUE[effectiveEngine];
    return {
      credits: creditsForRender(
        duration,
        descriptor.creditMultiplier,
        outputHeight,
        enhancements.length,
      ),
      seconds: estimateRenderSeconds(
        effectiveEngine,
        duration,
        outputHeight,
        enhancements.length,
      ),
      engineName: descriptor.name,
    };
  }, [ready, duration, effectiveEngine, outputHeight, enhancements.length]);

  const affordable = !quote || !user || user.credits >= quote.credits;
  const active = ['queued', 'analyzing', 'rendering', 'enhancing', 'encoding'].includes(
    render.status,
  );

  /* --- simulated render progress ----------------------------------- */

  useEffect(() => {
    if (!active) return;

    const stages: [string, string, number][] = [
      ['queued', 'Waiting for a worker', 4],
      ['analyzing', 'Analysing voice', 14],
      ['rendering', 'Synthesising lip motion', 72],
      ['enhancing', 'Enhancing faces', 88],
      ['encoding', 'Encoding output', 100],
    ];

    const timer = setInterval(() => {
      setRender(
        (() => {
          const next = Math.min(100, render.progress + 2 + Math.random() * 3);
          const stage = stages.find(([, , until]) => next <= until) ?? stages.at(-1)!;
          if (next >= 100) {
            return {
              status: 'completed',
              progress: 100,
              stage: 'Done',
              etaSeconds: 0,
              outputUrl: video?.localUrl ?? null,
            };
          }
          return {
            status: stage[0],
            progress: next,
            stage: stage[1],
            etaSeconds: quote
              ? Math.max(0, Math.round(quote.seconds * (1 - next / 100)))
              : null,
            queuePosition: next < 4 ? 2 : null,
          };
        })() as never,
      );
    }, 400);

    return () => clearInterval(timer);
  }, [active, render.progress, setRender, quote, video?.localUrl]);

  const start = () => {
    setRender({
      jobId: crypto.randomUUID(),
      status: 'queued',
      progress: 0,
      stage: 'Waiting for a worker',
      etaSeconds: quote?.seconds ?? null,
      queuePosition: 2,
      error: null,
      outputUrl: null,
    });
  };

  return (
    <div className="space-y-5">
      {/* Format */}
      <div>
        <p className="mb-2.5 text-sm font-medium">Output format</p>
        <div className="grid grid-cols-3 gap-2">
          {OUTPUT_FORMATS.map((format: OutputFormat) => (
            <button
              key={format}
              type="button"
              onClick={() => setOutput({ outputFormat: format })}
              aria-pressed={outputFormat === format}
              className={cn(
                'rounded-lg border py-2 text-xs font-medium uppercase transition-colors',
                outputFormat === format
                  ? 'border-brand/60 bg-brand/15 text-brand'
                  : 'border-line text-ink-muted hover:border-line-strong',
              )}
            >
              {format}
            </button>
          ))}
        </div>
      </div>

      {/* Resolution */}
      <div>
        <p className="mb-2.5 text-sm font-medium">Resolution</p>
        <div className="grid grid-cols-3 gap-2">
          {HEIGHTS.map((height) => {
            // Locked rather than hidden: showing what an upgrade buys is more
            // useful than pretending 4K does not exist.
            const locked = PLAN_RANK[height.plan] > PLAN_RANK[plan];
            return (
              <button
                key={height.value}
                type="button"
                disabled={locked}
                onClick={() => setOutput({ outputHeight: height.value })}
                aria-pressed={outputHeight === height.value}
                className={cn(
                  'relative rounded-lg border py-2 text-xs font-medium transition-colors',
                  outputHeight === height.value && !locked
                    ? 'border-brand/60 bg-brand/15 text-brand'
                    : 'border-line text-ink-muted hover:border-line-strong',
                  locked && 'cursor-not-allowed opacity-40',
                )}
              >
                {height.label}
                {locked && <span className="ml-1 text-[10px]">🔒</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Social presets */}
      <div>
        <p className="mb-2.5 text-sm font-medium">Social preset</p>
        <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1">
          {SOCIAL_PRESETS.map((social) => (
            <button
              key={social.id}
              type="button"
              onClick={() => setSocialPreset(socialPreset === social.id ? null : social.id)}
              aria-pressed={socialPreset === social.id}
              className={cn(
                'shrink-0 rounded-lg border px-3 py-2 text-left transition-colors',
                socialPreset === social.id
                  ? 'border-brand/60 bg-brand/15'
                  : 'border-line hover:border-line-strong',
              )}
            >
              <span className="block text-xs font-medium">{social.platform}</span>
              <span className="mt-0.5 block font-mono text-[10px] text-ink-subtle">
                {social.aspect}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Quote */}
      <div className="rounded-xl border border-line bg-surface-raised/50 p-4">
        {quote ? (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="flex items-center gap-1.5 text-xs text-ink-subtle">
                  <Zap className="size-3" /> Credits
                </dt>
                <dd className="mt-1 font-mono text-lg tabular-nums">{quote.credits}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-xs text-ink-subtle">
                  <Clock className="size-3" /> Estimated
                </dt>
                <dd className="mt-1 font-mono text-lg tabular-nums">
                  {formatDuration(quote.seconds)}
                </dd>
              </div>
            </dl>

            <p className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-ink-subtle">
              <Cpu className="size-3" />
              {quote.engineName}
              <span aria-hidden>·</span>
              <Film className="size-3" />
              {formatDuration(duration)} of output
              {enhancements.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <Layers className="size-3" />
                  {enhancements.length} enhancement{enhancements.length === 1 ? '' : 's'}
                </>
              )}
            </p>

            {plan === 'free' && (
              <p className="mt-2 text-xs text-warning">
                Free renders carry a watermark and are capped at 720p.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-ink-subtle">
            Add a video and an audio track to see what a render will cost.
          </p>
        )}
      </div>

      {!affordable && quote && (
        <Callout tone="warning" title="Not enough credits">
          This render needs {quote.credits} credits and you have {user?.credits ?? 0}. Top up or
          upgrade to keep rendering.
        </Callout>
      )}

      {/* Action */}
      <AnimatePresence mode="wait">
        {render.status === 'idle' && (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Button
              fullWidth
              size="lg"
              disabled={!ready || !affordable}
              onClick={start}
              icon={<Sparkles className="size-4" />}
            >
              {ready ? 'Render lip sync' : 'Add media to render'}
            </Button>
          </motion.div>
        )}

        {active && (
          <motion.div
            key="active"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-3 rounded-xl border border-brand/30 bg-brand/5 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-brand" />
                  <span className="relative inline-flex size-2 rounded-full bg-brand" />
                </span>
                {render.stage}
              </span>
              <span className="font-mono text-sm tabular-nums">
                {Math.round(render.progress)}%
              </span>
            </div>

            <Progress value={render.progress} label={render.stage} />

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-subtle">
              {render.etaSeconds !== null && (
                <span>{formatDuration(render.etaSeconds)} remaining</span>
              )}
              {render.queuePosition !== null && <span>Queue position {render.queuePosition}</span>}
              <span>GPU 78%</span>
            </div>

            <Button
              fullWidth
              size="sm"
              variant="ghost"
              icon={<X className="size-3.5" />}
              onClick={resetRender}
            >
              Cancel render
            </Button>
          </motion.div>
        )}

        {render.status === 'completed' && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-3 rounded-xl border border-success/30 bg-success/5 p-4"
          >
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="size-4" />
              Render complete
            </p>
            <p className="text-xs text-ink-muted">
              Compare it against the original above, then download or export with a social preset.
            </p>
            <div className="flex gap-2">
              <Button size="sm" icon={<Download className="size-3.5" />} className="flex-1">
                Download
              </Button>
              <Button size="sm" variant="secondary" onClick={resetRender}>
                New render
              </Button>
            </div>
          </motion.div>
        )}

        {render.status === 'failed' && (
          <motion.div
            key="failed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-4"
          >
            <p className="flex items-center gap-2 text-sm font-medium text-danger">
              <AlertTriangle className="size-4" />
              Render failed
            </p>
            <p className="text-xs text-ink-muted">
              {render.error ?? 'Something went wrong.'} Your credits were refunded in full.
            </p>
            <Button size="sm" variant="secondary" fullWidth onClick={resetRender}>
              Try again
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {user && (
        <p className="text-center text-xs text-ink-subtle">
          Balance: <Badge tone="brand">{user.credits.toLocaleString()} credits</Badge>
        </p>
      )}
    </div>
  );
}
