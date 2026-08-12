import { describe, it, expect, beforeEach } from 'vitest';
import type { TimelineState } from '@lipsync/shared';
import {
  mergeClips,
  moveClip,
  removeClip,
  splitAt,
  trimClip,
  useStudio,
} from './studio';

/**
 * The timeline operations are pure functions over a state object, which is the
 * reason they are worth testing directly: a split that produces a zero-length
 * clip or a trim that slides the visible frames is a subtle bug that only
 * shows up as "the editor feels wrong".
 */

function timelineWith(clips: TimelineState['tracks'][number]['clips']): TimelineState {
  return {
    durationSeconds: 30,
    tracks: [{ id: 'video-1', kind: 'video', label: 'Video', clips }],
  };
}

const oneClip = timelineWith([
  { id: 'c1', assetId: 'a1', label: 'take.mp4', start: 0, duration: 10, sourceIn: 0 },
]);

describe('splitAt', () => {
  it('splits a clip into two contiguous halves', () => {
    const result = splitAt(oneClip, 'video-1', 4);
    const clips = result.tracks[0]!.clips;

    expect(clips).toHaveLength(2);
    expect(clips[0]!.start).toBe(0);
    expect(clips[0]!.duration).toBe(4);
    expect(clips[1]!.start).toBe(4);
    expect(clips[1]!.duration).toBe(6);
  });

  it('advances the second half’s source in-point so no frames repeat', () => {
    const clips = splitAt(oneClip, 'video-1', 4).tracks[0]!.clips;
    expect(clips[1]!.sourceIn).toBe(4);
  });

  it('splits correctly on a clip that does not start at zero', () => {
    const shifted = timelineWith([
      { id: 'c1', assetId: 'a1', label: 'take', start: 5, duration: 10, sourceIn: 2 },
    ]);
    const clips = splitAt(shifted, 'video-1', 8).tracks[0]!.clips;

    expect(clips[0]!.duration).toBe(3);
    expect(clips[1]!.start).toBe(8);
    expect(clips[1]!.sourceIn).toBe(5);
  });

  it('leaves the timeline alone when the playhead is outside the clip', () => {
    expect(splitAt(oneClip, 'video-1', 20).tracks[0]!.clips).toHaveLength(1);
    expect(splitAt(oneClip, 'video-1', -1).tracks[0]!.clips).toHaveLength(1);
  });

  it('refuses to split exactly on a boundary, which would make a zero-length clip', () => {
    expect(splitAt(oneClip, 'video-1', 0).tracks[0]!.clips).toHaveLength(1);
    expect(splitAt(oneClip, 'video-1', 10).tracks[0]!.clips).toHaveLength(1);
  });

  it('does not touch other tracks', () => {
    const two: TimelineState = {
      durationSeconds: 30,
      tracks: [
        ...oneClip.tracks,
        {
          id: 'audio-1',
          kind: 'audio',
          label: 'Audio',
          clips: [
            { id: 'a1', assetId: 'x', label: 'vo', start: 0, duration: 10, sourceIn: 0 },
          ],
        },
      ],
    };
    expect(splitAt(two, 'video-1', 5).tracks[1]!.clips).toHaveLength(1);
  });
});

describe('trimClip', () => {
  it('shortens from the end without moving the clip', () => {
    const clip = trimClip(oneClip, 'video-1', 'c1', 'end', -3).tracks[0]!.clips[0]!;
    expect(clip.start).toBe(0);
    expect(clip.duration).toBe(7);
    expect(clip.sourceIn).toBe(0);
  });

  it('moves position and source together when trimming the head', () => {
    // Both must advance by the same amount, otherwise the visible frames slide.
    const clip = trimClip(oneClip, 'video-1', 'c1', 'start', 3).tracks[0]!.clips[0]!;
    expect(clip.start).toBe(3);
    expect(clip.sourceIn).toBe(3);
    expect(clip.duration).toBe(7);
  });

  it('never trims a clip out of existence', () => {
    const clip = trimClip(oneClip, 'video-1', 'c1', 'end', -100).tracks[0]!.clips[0]!;
    expect(clip.duration).toBeGreaterThan(0);
  });
});

describe('mergeClips', () => {
  it('rejoins two halves of the same source', () => {
    const split = splitAt(oneClip, 'video-1', 4);
    const merged = mergeClips(split, 'video-1').tracks[0]!.clips;

    expect(merged).toHaveLength(1);
    expect(merged[0]!.duration).toBe(10);
  });

  it('leaves a gap between clips intact', () => {
    const gapped = timelineWith([
      { id: 'c1', assetId: 'a1', label: 'x', start: 0, duration: 4, sourceIn: 0 },
      { id: 'c2', assetId: 'a1', label: 'x', start: 8, duration: 4, sourceIn: 4 },
    ]);
    expect(mergeClips(gapped, 'video-1').tracks[0]!.clips).toHaveLength(2);
  });

  it('does not merge adjacent clips from different assets', () => {
    const mixed = timelineWith([
      { id: 'c1', assetId: 'a1', label: 'x', start: 0, duration: 4, sourceIn: 0 },
      { id: 'c2', assetId: 'a2', label: 'y', start: 4, duration: 4, sourceIn: 0 },
    ]);
    expect(mergeClips(mixed, 'video-1').tracks[0]!.clips).toHaveLength(2);
  });
});

describe('moveClip', () => {
  it('clamps to the start of the timeline', () => {
    expect(moveClip(oneClip, 'video-1', 'c1', -5).tracks[0]!.clips[0]!.start).toBe(0);
  });

  it('clamps so the clip cannot run past the end', () => {
    // 30s timeline, 10s clip — the furthest it can start is 20s.
    expect(moveClip(oneClip, 'video-1', 'c1', 99).tracks[0]!.clips[0]!.start).toBe(20);
  });

  it('moves to a valid position untouched', () => {
    expect(moveClip(oneClip, 'video-1', 'c1', 7).tracks[0]!.clips[0]!.start).toBe(7);
  });
});

describe('removeClip', () => {
  it('removes only the named clip', () => {
    const split = splitAt(oneClip, 'video-1', 4);
    const target = split.tracks[0]!.clips[1]!.id;
    const result = removeClip(split, 'video-1', target);

    expect(result.tracks[0]!.clips).toHaveLength(1);
    expect(result.tracks[0]!.clips[0]!.id).toBe('c1');
  });
});

describe('undo and redo', () => {
  beforeEach(() => {
    useStudio.setState({ timeline: oneClip, past: [], future: [] });
  });

  it('restores the previous timeline', () => {
    const store = useStudio.getState();
    store.commitTimeline(splitAt(oneClip, 'video-1', 4));
    expect(useStudio.getState().timeline.tracks[0]!.clips).toHaveLength(2);

    useStudio.getState().undo();
    expect(useStudio.getState().timeline.tracks[0]!.clips).toHaveLength(1);
  });

  it('redoes what was undone', () => {
    useStudio.getState().commitTimeline(splitAt(oneClip, 'video-1', 4));
    useStudio.getState().undo();
    useStudio.getState().redo();
    expect(useStudio.getState().timeline.tracks[0]!.clips).toHaveLength(2);
  });

  it('is a no-op at either end of the history', () => {
    useStudio.getState().undo();
    expect(useStudio.getState().timeline.tracks[0]!.clips).toHaveLength(1);
    useStudio.getState().redo();
    expect(useStudio.getState().timeline.tracks[0]!.clips).toHaveLength(1);
  });

  it('drops the redo stack once a new edit is committed', () => {
    useStudio.getState().commitTimeline(splitAt(oneClip, 'video-1', 4));
    useStudio.getState().undo();
    expect(useStudio.getState().future).toHaveLength(1);

    useStudio.getState().commitTimeline(splitAt(oneClip, 'video-1', 6));
    expect(useStudio.getState().future).toHaveLength(0);
  });

  it('bounds the history so a long session does not grow without limit', () => {
    for (let index = 0; index < 80; index += 1) {
      useStudio.getState().commitTimeline(splitAt(oneClip, 'video-1', 1 + index * 0.1));
    }
    expect(useStudio.getState().past.length).toBeLessThanOrEqual(50);
  });
});

describe('studio settings', () => {
  beforeEach(() => {
    useStudio.setState({ engine: null, preset: 'balanced', enhancements: [], musicMode: false });
  });

  it('clears an explicit engine when the preset changes', () => {
    useStudio.getState().setEngine('synctalk');
    expect(useStudio.getState().engine).toBe('synctalk');

    useStudio.getState().setPreset('fast');
    expect(useStudio.getState().engine).toBeNull();
  });

  it('toggles enhancements on and back off', () => {
    useStudio.getState().toggleEnhancement('denoise');
    expect(useStudio.getState().enhancements).toContain('denoise');

    useStudio.getState().toggleEnhancement('denoise');
    expect(useStudio.getState().enhancements).not.toContain('denoise');
  });

  it('switches into music mode when the analyser reports music', () => {
    useStudio.getState().setAnalysis({
      language: { value: 'en', confidence: 0.9 },
      emotion: { value: 'happy', confidence: 0.6 },
      gender: { value: 'female', confidence: 0.8 },
      tempo: { value: 128, confidence: 0.9 },
      speakingRate: { value: 0, confidence: 0.2 },
      isMusic: true,
      beats: [0, 0.47, 0.94],
      durationSeconds: 12,
      waveform: [],
    });

    expect(useStudio.getState().musicMode).toBe(true);
  });
});
