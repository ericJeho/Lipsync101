'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Maximize2,
  MoveHorizontal,
  Pause,
  Play,
} from 'lucide-react';
import { formatDuration } from '@lipsync/shared';
import { cn } from '@/lib/cn';

type Mode = 'slider' | 'side-by-side';

/**
 * Before/after comparison.
 *
 * Both videos are kept in lockstep by seeking the result to the original's
 * currentTime on every frame — playing two elements independently drifts
 * within a few seconds and makes the comparison useless.
 */
export function ComparePlayer({
  originalUrl,
  resultUrl,
  fps = 30,
  className,
}: {
  originalUrl?: string;
  resultUrl?: string;
  fps?: number;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>('slider');
  const [position, setPosition] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const originalRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  /* --- keep the two elements in sync -------------------------------- */

  useEffect(() => {
    const original = originalRef.current;
    const result = resultRef.current;
    if (!original) return;

    const onTimeUpdate = () => {
      setTime(original.currentTime);
      // Only correct when they have actually drifted; assigning currentTime
      // every tick causes visible stutter.
      if (result && Math.abs(result.currentTime - original.currentTime) > 0.08) {
        result.currentTime = original.currentTime;
      }
    };

    const onLoaded = () => setDuration(original.duration || 0);
    const onEnded = () => setPlaying(false);

    original.addEventListener('timeupdate', onTimeUpdate);
    original.addEventListener('loadedmetadata', onLoaded);
    original.addEventListener('ended', onEnded);

    return () => {
      original.removeEventListener('timeupdate', onTimeUpdate);
      original.removeEventListener('loadedmetadata', onLoaded);
      original.removeEventListener('ended', onEnded);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const original = originalRef.current;
    const result = resultRef.current;
    if (!original) return;

    if (playing) {
      original.pause();
      result?.pause();
    } else {
      void original.play();
      void result?.play();
    }
    setPlaying(!playing);
  }, [playing]);

  const step = useCallback(
    (frames: number) => {
      const original = originalRef.current;
      const result = resultRef.current;
      if (!original) return;

      original.pause();
      result?.pause();
      setPlaying(false);

      const next = Math.max(0, Math.min(duration, original.currentTime + frames / fps));
      original.currentTime = next;
      if (result) result.currentTime = next;
      setTime(next);
    },
    [duration, fps],
  );

  /* --- slider drag -------------------------------------------------- */

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const frame = frameRef.current;
    if (!frame) return;

    const move = (pointer: PointerEvent) => {
      const bounds = frame.getBoundingClientRect();
      const percent = ((pointer.clientX - bounds.left) / bounds.width) * 100;
      setPosition(Math.max(0, Math.min(100, percent)));
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const enterFullscreen = () => {
    void frameRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  const hasResult = Boolean(resultUrl);

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-line bg-surface-raised/60 p-1">
          <button
            type="button"
            onClick={() => setMode('slider')}
            aria-pressed={mode === 'slider'}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              mode === 'slider' ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            <MoveHorizontal className="size-3.5" />
            Slider
          </button>
          <button
            type="button"
            onClick={() => setMode('side-by-side')}
            aria-pressed={mode === 'side-by-side'}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              mode === 'side-by-side' ? 'bg-surface text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            <Columns2 className="size-3.5" />
            Side by side
          </button>
        </div>

        <button
          type="button"
          onClick={enterFullscreen}
          aria-label="Fullscreen"
          className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
        >
          <Maximize2 className="size-4" />
        </button>
      </div>

      <div
        ref={frameRef}
        className="relative overflow-hidden rounded-panel border border-line bg-black"
      >
        {mode === 'side-by-side' ? (
          <div className="grid grid-cols-2 gap-px bg-line">
            <Pane label="Original" src={originalUrl} videoRef={originalRef} />
            <Pane label="Lip-synced" src={resultUrl} videoRef={resultRef} muted tone="brand" />
          </div>
        ) : (
          <div className="relative aspect-video">
            <Pane
              label="Original"
              src={originalUrl}
              videoRef={originalRef}
              className="absolute inset-0"
            />

            {/* The result is clipped to the right of the handle, so dragging
                wipes between the two rather than cross-fading. */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 0 0 ${position}%)` }}
            >
              <Pane
                label="Lip-synced"
                src={resultUrl}
                videoRef={resultRef}
                muted
                tone="brand"
                className="absolute inset-0"
                labelSide="right"
              />
            </div>

            <div
              className="absolute inset-y-0 z-10 w-0.5 cursor-ew-resize bg-white/90 shadow-lg"
              style={{ left: `${position}%` }}
              onPointerDown={startDrag}
            >
              <span className="absolute left-1/2 top-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-xl">
                <MoveHorizontal className="size-4" />
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={100}
              value={position}
              onChange={(event) => setPosition(Number(event.target.value))}
              aria-label="Comparison position"
              className="sr-only"
            />
          </div>
        )}

        {!hasResult && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <p className="max-w-xs px-6 text-center text-sm text-white/80">
              Render something and the result will appear here beside the original.
            </p>
          </div>
        )}
      </div>

      {/* Transport */}
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-raised/40 px-3 py-2">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous frame"
          className="rounded-lg p-1.5 text-ink-muted hover:bg-line hover:text-ink"
        >
          <ChevronLeft className="size-4" />
        </button>

        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex size-8 items-center justify-center rounded-lg gradient-brand text-white"
        >
          {playing ? (
            <Pause className="size-3.5 fill-current" />
          ) : (
            <Play className="size-3.5 fill-current" />
          )}
        </button>

        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next frame"
          className="rounded-lg p-1.5 text-ink-muted hover:bg-line hover:text-ink"
        >
          <ChevronRight className="size-4" />
        </button>

        <span className="font-mono text-xs tabular-nums text-ink-muted">
          {formatDuration(time)}
          <span className="text-ink-subtle"> / {formatDuration(duration)}</span>
        </span>

        <input
          type="range"
          min={0}
          max={duration || 1}
          step={1 / fps}
          value={time}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (originalRef.current) originalRef.current.currentTime = next;
            if (resultRef.current) resultRef.current.currentTime = next;
            setTime(next);
          }}
          aria-label="Seek"
          className="flex-1"
        />

        <span className="hidden shrink-0 font-mono text-[11px] text-ink-subtle sm:block">
          frame {Math.round(time * fps)}
        </span>
      </div>
    </div>
  );
}

function Pane({
  label,
  src,
  videoRef,
  muted,
  tone = 'neutral',
  className,
  labelSide = 'left',
}: {
  label: string;
  src?: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  muted?: boolean;
  tone?: 'neutral' | 'brand';
  className?: string;
  labelSide?: 'left' | 'right';
}) {
  return (
    <div className={cn('relative aspect-video bg-surface-raised', className)}>
      {src ? (
        <video
          ref={videoRef}
          src={src}
          muted={muted}
          playsInline
          className="size-full object-contain"
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <span className="text-xs text-ink-subtle">No media</span>
        </div>
      )}

      <span
        className={cn(
          'absolute top-3 rounded-md px-2 py-1 text-[11px] font-medium backdrop-blur',
          labelSide === 'left' ? 'left-3' : 'right-3',
          tone === 'brand' ? 'bg-brand/80 text-white' : 'bg-black/60 text-white',
        )}
      >
        {label}
      </span>
    </div>
  );
}
