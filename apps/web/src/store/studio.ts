'use client';

import { create } from 'zustand';
import {
  DEFAULT_EXPRESSION,
  type Enhancement,
  type ExpressionControls,
  type LipsyncEngine,
  type QualityPreset,
  type SubtitleTrack,
  type TimelineState,
  type VoiceAnalysis,
} from '@lipsync/shared';

/**
 * Studio state.
 *
 * Undo/redo is implemented over the timeline only. Snapshotting the whole
 * store would mean Ctrl+Z could rewind an upload or a submitted render, which
 * is not what anyone expects that key to do.
 */

export interface StudioAsset {
  id: string;
  filename: string;
  kind: 'video' | 'audio';
  sizeBytes: number;
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  /** Object URL for local preview before the upload finishes. */
  localUrl?: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  uploadProgress: number;
  error?: string;
}

export interface RenderState {
  jobId: string | null;
  status: string;
  progress: number;
  stage: string;
  etaSeconds: number | null;
  queuePosition: number | null;
  outputUrl: string | null;
  error: string | null;
}

const MAX_HISTORY = 50;

interface StudioState {
  projectId: string | null;
  projectName: string;

  video: StudioAsset | null;
  audio: StudioAsset | null;

  engine: LipsyncEngine | null;
  preset: QualityPreset;
  outputFormat: 'mp4' | 'mov' | 'gif';
  outputHeight: 720 | 1080 | 2160;
  enhancements: Enhancement[];
  expression: ExpressionControls;
  musicMode: boolean;
  karaokeTiming: boolean;
  subtitlesEnabled: boolean;
  burnInSubtitles: boolean;
  subtitleLanguages: string[];
  translateTo: string | null;

  analysis: VoiceAnalysis | null;
  subtitles: SubtitleTrack[];

  timeline: TimelineState;
  past: TimelineState[];
  future: TimelineState[];

  render: RenderState;

  /* actions */
  setProject: (id: string | null, name: string) => void;
  setAsset: (kind: 'video' | 'audio', asset: StudioAsset | null) => void;
  patchAsset: (kind: 'video' | 'audio', patch: Partial<StudioAsset>) => void;
  setEngine: (engine: LipsyncEngine | null) => void;
  setPreset: (preset: QualityPreset) => void;
  setOutput: (patch: Partial<Pick<StudioState, 'outputFormat' | 'outputHeight'>>) => void;
  toggleEnhancement: (enhancement: Enhancement) => void;
  setExpression: (key: keyof ExpressionControls, value: number) => void;
  resetExpression: () => void;
  setFlag: (
    key: 'musicMode' | 'karaokeTiming' | 'subtitlesEnabled' | 'burnInSubtitles',
    value: boolean,
  ) => void;
  setSubtitleLanguages: (languages: string[]) => void;
  setTranslateTo: (code: string | null) => void;
  setAnalysis: (analysis: VoiceAnalysis | null) => void;
  setSubtitles: (tracks: SubtitleTrack[]) => void;

  commitTimeline: (next: TimelineState) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setRender: (patch: Partial<RenderState>) => void;
  resetRender: () => void;
  reset: () => void;
}

const emptyTimeline: TimelineState = {
  durationSeconds: 0,
  tracks: [
    { id: 'video-1', kind: 'video', label: 'Video', clips: [] },
    { id: 'audio-1', kind: 'audio', label: 'Driving audio', clips: [] },
    { id: 'subtitle-1', kind: 'subtitle', label: 'Subtitles', clips: [] },
  ],
};

const idleRender: RenderState = {
  jobId: null,
  status: 'idle',
  progress: 0,
  stage: '',
  etaSeconds: null,
  queuePosition: null,
  outputUrl: null,
  error: null,
};

export const useStudio = create<StudioState>((set, get) => ({
  projectId: null,
  projectName: 'Untitled project',

  video: null,
  audio: null,

  engine: null,
  preset: 'balanced',
  outputFormat: 'mp4',
  outputHeight: 1080,
  enhancements: ['faceRestore'],
  expression: { ...DEFAULT_EXPRESSION },
  musicMode: false,
  karaokeTiming: false,
  subtitlesEnabled: false,
  burnInSubtitles: false,
  subtitleLanguages: [],
  translateTo: null,

  analysis: null,
  subtitles: [],

  timeline: emptyTimeline,
  past: [],
  future: [],

  render: idleRender,

  setProject: (projectId, projectName) => set({ projectId, projectName }),

  setAsset: (kind, asset) =>
    set((state) => {
      const next = { ...state, [kind]: asset } as StudioState;

      // Dropping in new media rebuilds the timeline: keeping clips that point
      // at a replaced asset would leave the editor showing stale ranges.
      if (asset?.status === 'ready') {
        const duration = Math.max(
          kind === 'audio' ? asset.durationSeconds : (state.audio?.durationSeconds ?? 0),
          kind === 'video' ? asset.durationSeconds : (state.video?.durationSeconds ?? 0),
        );
        next.timeline = {
          durationSeconds: duration,
          tracks: emptyTimeline.tracks.map((track) => {
            const source = track.kind === 'video' ? next.video : track.kind === 'audio' ? next.audio : null;
            if (!source) return { ...track, clips: [] };
            return {
              ...track,
              clips: [
                {
                  id: `${track.id}-clip-1`,
                  assetId: source.id,
                  label: source.filename,
                  start: 0,
                  duration: source.durationSeconds,
                  sourceIn: 0,
                },
              ],
            };
          }),
        };
        next.past = [];
        next.future = [];
      }

      return next;
    }),

  patchAsset: (kind, patch) =>
    set((state) => {
      const current = state[kind];
      return current ? ({ [kind]: { ...current, ...patch } } as Partial<StudioState>) : {};
    }),

  setEngine: (engine) => set({ engine }),
  setPreset: (preset) => set({ preset, engine: null }),
  setOutput: (patch) => set(patch),

  toggleEnhancement: (enhancement) =>
    set((state) => ({
      enhancements: state.enhancements.includes(enhancement)
        ? state.enhancements.filter((e) => e !== enhancement)
        : [...state.enhancements, enhancement],
    })),

  setExpression: (key, value) =>
    set((state) => ({ expression: { ...state.expression, [key]: value } })),

  resetExpression: () => set({ expression: { ...DEFAULT_EXPRESSION } }),

  setFlag: (key, value) => set({ [key]: value } as Partial<StudioState>),
  setSubtitleLanguages: (subtitleLanguages) => set({ subtitleLanguages }),
  setTranslateTo: (translateTo) => set({ translateTo }),
  setAnalysis: (analysis) =>
    set((state) => ({
      analysis,
      // A track the analyser identified as music switches the studio into
      // music mode automatically — the user can still turn it off.
      musicMode: analysis?.isMusic ?? state.musicMode,
    })),
  setSubtitles: (subtitles) => set({ subtitles }),

  commitTimeline: (next) =>
    set((state) => ({
      timeline: next,
      // Bounded history: an unbounded stack in a long editing session holds
      // every intermediate state in memory for no benefit.
      past: [...state.past, state.timeline].slice(-MAX_HISTORY),
      future: [],
    })),

  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return {};
      return {
        timeline: previous,
        past: state.past.slice(0, -1),
        future: [state.timeline, ...state.future].slice(0, MAX_HISTORY),
      };
    }),

  redo: () =>
    set((state) => {
      const [next, ...rest] = state.future;
      if (!next) return {};
      return {
        timeline: next,
        past: [...state.past, state.timeline].slice(-MAX_HISTORY),
        future: rest,
      };
    }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  setRender: (patch) => set((state) => ({ render: { ...state.render, ...patch } })),
  resetRender: () => set({ render: idleRender }),

  reset: () =>
    set({
      video: null,
      audio: null,
      analysis: null,
      subtitles: [],
      timeline: emptyTimeline,
      past: [],
      future: [],
      render: idleRender,
      expression: { ...DEFAULT_EXPRESSION },
    }),
}));

/* ------------------------------------------------------------------ */
/* Timeline operations                                                 */
/* ------------------------------------------------------------------ */

/**
 * Splits the clip under the playhead in two.
 *
 * Returns the timeline unchanged when the playhead is not strictly inside a
 * clip — splitting exactly at a boundary would create a zero-length clip.
 */
export function splitAt(timeline: TimelineState, trackId: string, at: number): TimelineState {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (track.id !== trackId) return track;

      const clips = track.clips.flatMap((clip) => {
        const end = clip.start + clip.duration;
        if (at <= clip.start || at >= end) return [clip];

        const offset = at - clip.start;
        return [
          { ...clip, duration: offset },
          {
            ...clip,
            id: `${clip.id}-b${Math.round(at * 1000)}`,
            start: at,
            duration: clip.duration - offset,
            sourceIn: clip.sourceIn + offset,
          },
        ];
      });

      return { ...track, clips };
    }),
  };
}

/** Trims a clip's in and out points, keeping at least 100ms of content. */
export function trimClip(
  timeline: TimelineState,
  trackId: string,
  clipId: string,
  edge: 'start' | 'end',
  delta: number,
): TimelineState {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id !== clipId) return clip;

          if (edge === 'end') {
            return { ...clip, duration: Math.max(0.1, clip.duration + delta) };
          }

          // Trimming the head moves the clip's position and its source in-point
          // together, so the visible frames stay put rather than sliding.
          const shift = Math.min(delta, clip.duration - 0.1);
          return {
            ...clip,
            start: Math.max(0, clip.start + shift),
            sourceIn: Math.max(0, clip.sourceIn + shift),
            duration: clip.duration - shift,
          };
        }),
      };
    }),
  };
}

/** Merges adjacent clips that came from the same asset. */
export function mergeClips(timeline: TimelineState, trackId: string): TimelineState {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (track.id !== trackId) return track;

      const sorted = [...track.clips].sort((a, b) => a.start - b.start);
      const merged = sorted.reduce<typeof sorted>((accumulator, clip) => {
        const previous = accumulator.at(-1);
        const contiguous =
          previous &&
          previous.assetId === clip.assetId &&
          Math.abs(previous.start + previous.duration - clip.start) < 0.05;

        if (contiguous && previous) {
          previous.duration += clip.duration;
          return accumulator;
        }
        return [...accumulator, { ...clip }];
      }, []);

      return { ...track, clips: merged };
    }),
  };
}

export function removeClip(
  timeline: TimelineState,
  trackId: string,
  clipId: string,
): TimelineState {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === trackId
        ? { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) }
        : track,
    ),
  };
}

/** Moves a clip along its track, clamped to the timeline bounds. */
export function moveClip(
  timeline: TimelineState,
  trackId: string,
  clipId: string,
  toStart: number,
): TimelineState {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                start: Math.max(0, Math.min(toStart, timeline.durationSeconds - clip.duration)),
              }
            : clip,
        ),
      };
    }),
  };
}
