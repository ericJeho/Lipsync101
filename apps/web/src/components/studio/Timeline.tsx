'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Captions,
  Combine,
  Film,
  Pause,
  Play,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
} from 'lucide-react';
import { formatDuration, type TimelineClip, type TimelineTrack } from '@lipsync/shared';
import {
  mergeClips,
  moveClip,
  removeClip,
  splitAt,
  useStudio,
} from '@/store/studio';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const TRACK_ICONS = {
  video: Film,
  audio: AudioLines,
  subtitle: Captions,
} as const;

const PIXELS_PER_SECOND_BASE = 60;

export function Timeline() {
  const timeline = useStudio((state) => state.timeline);
  const commit = useStudio((state) => state.commitTimeline);
  const undo = useStudio((state) => state.undo);
  const redo = useStudio((state) => state.redo);
  const pastLength = useStudio((state) => state.past.length);
  const futureLength = useStudio((state) => state.future.length);
  const analysis = useStudio((state) => state.analysis);

  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<{ trackId: string; clipId: string } | null>(null);
  const laneRef = useRef<HTMLDivElement>(null);

  const duration = timeline.durationSeconds || 30;
  const pixelsPerSecond = PIXELS_PER_SECOND_BASE * zoom;

  /* --- playback ---------------------------------------------------- */

  useEffect(() => {
    if (!playing) return;
    let frame: number;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = (now - last) / 1000;
      last = now;
      setPlayhead((current) => {
        const next = current + delta;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);

  /* --- keyboard ---------------------------------------------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never hijack keys while the user is typing in a field.
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        // Shift+Cmd+Z is redo on every platform that supports this at all.
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        setPlaying((value) => !value);
        return;
      }

      if (event.key === 'ArrowLeft') {
        setPlayhead((value) => Math.max(0, value - (event.shiftKey ? 1 : 1 / 30)));
      }
      if (event.key === 'ArrowRight') {
        setPlayhead((value) => Math.min(duration, value + (event.shiftKey ? 1 : 1 / 30)));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, duration]);

  /* --- interactions ------------------------------------------------ */

  const seekFromPointer = useCallback(
    (event: React.MouseEvent) => {
      const lane = laneRef.current;
      if (!lane) return;
      const bounds = lane.getBoundingClientRect();
      const offset = event.clientX - bounds.left + lane.scrollLeft;
      setPlayhead(Math.max(0, Math.min(duration, offset / pixelsPerSecond)));
    },
    [duration, pixelsPerSecond],
  );

  const handleSplit = () => {
    if (!selected) return;
    commit(splitAt(timeline, selected.trackId, playhead));
  };

  const handleDelete = () => {
    if (!selected) return;
    commit(removeClip(timeline, selected.trackId, selected.clipId));
    setSelected(null);
  };

  const handleMerge = () => {
    if (!selected) return;
    commit(mergeClips(timeline, selected.trackId));
  };

  const handleDrag = (trackId: string, clipId: string, deltaPixels: number, origin: number) => {
    commit(moveClip(timeline, trackId, clipId, origin + deltaPixels / pixelsPerSecond));
  };

  return (
    <div className="rounded-panel border border-line bg-surface-raised/40">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex size-8 items-center justify-center rounded-lg gradient-brand text-white"
        >
          {playing ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
        </button>

        <span className="font-mono text-xs tabular-nums text-ink-muted">
          {formatDuration(playhead)} <span className="text-ink-subtle">/ {formatDuration(duration)}</span>
        </span>

        <div className="mx-1 h-5 w-px bg-line" aria-hidden />

        <Button
          size="sm"
          variant="ghost"
          icon={<Undo2 className="size-3.5" />}
          onClick={undo}
          disabled={pastLength === 0}
          aria-label="Undo"
        >
          Undo
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Redo2 className="size-3.5" />}
          onClick={redo}
          disabled={futureLength === 0}
          aria-label="Redo"
        >
          Redo
        </Button>

        <div className="mx-1 h-5 w-px bg-line" aria-hidden />

        <Button
          size="sm"
          variant="ghost"
          icon={<Scissors className="size-3.5" />}
          onClick={handleSplit}
          disabled={!selected}
        >
          Split
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Combine className="size-3.5" />}
          onClick={handleMerge}
          disabled={!selected}
        >
          Merge
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 className="size-3.5" />}
          onClick={handleDelete}
          disabled={!selected}
        >
          Delete
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="timeline-zoom" className="text-xs text-ink-subtle">
            Zoom
          </label>
          <input
            id="timeline-zoom"
            type="range"
            min={0.4}
            max={4}
            step={0.1}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-24"
          />
        </div>
      </div>

      {/* Lanes */}
      <div className="flex">
        <div className="w-32 shrink-0 border-r border-line">
          <div className="h-7 border-b border-line" />
          {timeline.tracks.map((track) => {
            const Icon = TRACK_ICONS[track.kind];
            return (
              <div
                key={track.id}
                className="flex h-14 items-center gap-2 border-b border-line px-3 last:border-b-0"
              >
                <Icon className="size-3.5 shrink-0 text-ink-subtle" />
                <span className="truncate text-xs font-medium">{track.label}</span>
              </div>
            );
          })}
        </div>

        <div
          ref={laneRef}
          onClick={seekFromPointer}
          className="hide-scrollbar relative flex-1 cursor-crosshair overflow-x-auto"
        >
          <div style={{ width: duration * pixelsPerSecond, minWidth: '100%' }}>
            <Ruler duration={duration} pixelsPerSecond={pixelsPerSecond} />

            {timeline.tracks.map((track) => (
              <Lane
                key={track.id}
                track={track}
                pixelsPerSecond={pixelsPerSecond}
                beats={track.kind === 'audio' ? (analysis?.beats ?? []) : []}
                waveform={track.kind === 'audio' ? (analysis?.waveform ?? []) : []}
                selectedClipId={selected?.trackId === track.id ? selected.clipId : null}
                onSelect={(clipId) => setSelected({ trackId: track.id, clipId })}
                onDrag={handleDrag}
              />
            ))}
          </div>

          {/* Playhead */}
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-brand"
            style={{ left: playhead * pixelsPerSecond }}
            aria-hidden
          >
            <span className="absolute -left-1.5 top-0 size-3 rounded-b-sm bg-brand" />
          </div>
        </div>
      </div>

      <p className="border-t border-line px-3 py-2 text-[11px] text-ink-subtle">
        Space plays and pauses · arrows nudge a frame, shift+arrows a second · ⌘Z undoes,
        ⇧⌘Z redoes
      </p>
    </div>
  );
}

function Ruler({ duration, pixelsPerSecond }: { duration: number; pixelsPerSecond: number }) {
  // Choose an interval that keeps labels ~80px apart at any zoom, so the ruler
  // never turns into overlapping text.
  const target = 80 / pixelsPerSecond;
  const interval = [0.5, 1, 2, 5, 10, 15, 30, 60].find((step) => step >= target) ?? 60;
  const ticks = Math.ceil(duration / interval);

  return (
    <div className="relative h-7 border-b border-line">
      {Array.from({ length: ticks + 1 }, (_, index) => {
        const seconds = index * interval;
        return (
          <span
            key={index}
            className="absolute top-0 flex h-full items-center border-l border-line pl-1 font-mono text-[10px] tabular-nums text-ink-subtle"
            style={{ left: seconds * pixelsPerSecond }}
          >
            {formatDuration(seconds)}
          </span>
        );
      })}
    </div>
  );
}

function Lane({
  track,
  pixelsPerSecond,
  beats,
  waveform,
  selectedClipId,
  onSelect,
  onDrag,
}: {
  track: TimelineTrack;
  pixelsPerSecond: number;
  beats: number[];
  waveform: number[];
  selectedClipId: string | null;
  onSelect: (clipId: string) => void;
  onDrag: (trackId: string, clipId: string, deltaPixels: number, origin: number) => void;
}) {
  return (
    <div className="relative h-14 border-b border-line last:border-b-0">
      {beats.map((beat, index) => (
        <span
          key={index}
          className="absolute inset-y-0 w-px bg-accent/25"
          style={{ left: beat * pixelsPerSecond }}
          aria-hidden
        />
      ))}

      {track.clips.map((clip) => (
        <Clip
          key={clip.id}
          clip={clip}
          trackKind={track.kind}
          pixelsPerSecond={pixelsPerSecond}
          waveform={waveform}
          selected={clip.id === selectedClipId}
          onSelect={() => onSelect(clip.id)}
          onDrag={(delta, origin) => onDrag(track.id, clip.id, delta, origin)}
        />
      ))}

      {track.clips.length === 0 && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-ink-subtle">
          Empty
        </span>
      )}
    </div>
  );
}

function Clip({
  clip,
  trackKind,
  pixelsPerSecond,
  waveform,
  selected,
  onSelect,
  onDrag,
}: {
  clip: TimelineClip;
  trackKind: 'video' | 'audio' | 'subtitle';
  pixelsPerSecond: number;
  waveform: number[];
  selected: boolean;
  onSelect: () => void;
  onDrag: (deltaPixels: number, origin: number) => void;
}) {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: React.PointerEvent) => {
    event.stopPropagation();
    onSelect();

    const startX = event.clientX;
    const origin = clip.start;
    setDragging(true);

    const onMove = (move: PointerEvent) => onDrag(move.clientX - startX, origin);
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      aria-label={`${clip.label}, ${formatDuration(clip.duration)}`}
      className={cn(
        'absolute inset-y-1.5 overflow-hidden rounded-lg border text-left transition-shadow',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
        selected ? 'border-brand ring-2 ring-brand/40' : 'border-line-strong',
        trackKind === 'video' && 'bg-gradient-to-r from-brand/30 to-brand/15',
        trackKind === 'audio' && 'bg-gradient-to-r from-accent/25 to-accent/10',
        trackKind === 'subtitle' && 'bg-gradient-to-r from-success/20 to-success/10',
      )}
      style={{
        left: clip.start * pixelsPerSecond,
        width: Math.max(8, clip.duration * pixelsPerSecond),
      }}
    >
      {trackKind === 'audio' && waveform.length > 0 && (
        <span className="absolute inset-x-0 bottom-0 flex h-2/3 items-end gap-px px-0.5 opacity-60">
          {waveform.slice(0, 200).map((value, index) => (
            <span
              key={index}
              className="flex-1 rounded-t-sm bg-accent"
              style={{ height: `${Math.max(6, value * 100)}%` }}
            />
          ))}
        </span>
      )}

      <span className="relative block truncate px-2 py-1 text-[11px] font-medium">
        {clip.label}
      </span>
    </div>
  );
}
