'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AudioLines,
  FileVideo,
  Link2,
  Mic,
  Scissors,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  AUDIO_ACCEPT,
  AUDIO_INPUT_FORMATS,
  VIDEO_ACCEPT,
  VIDEO_INPUT_FORMATS,
  formatBytes,
  formatDuration,
  isAudioFormat,
  isVideoFormat,
} from '@lipsync/shared';
import { Button } from '@/components/ui/Button';
import { Input, Progress } from '@/components/ui/primitives';
import { useStudio, type StudioAsset } from '@/store/studio';
import { cn } from '@/lib/cn';

/**
 * Reads duration (and dimensions for video) from a local file before upload.
 *
 * Doing this client-side means the timeline and the cost estimate appear the
 * moment a file is dropped, rather than after a round trip to the probe
 * endpoint.
 */
function readLocalMetadata(
  file: File,
  kind: 'video' | 'audio',
): Promise<{ durationSeconds: number; width?: number; height?: number; url: string }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement(kind === 'video' ? 'video' : 'audio');

    const finish = (durationSeconds: number, width?: number, height?: number) =>
      resolve({ durationSeconds, width, height, url });

    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      const media = element as HTMLVideoElement;
      finish(
        Number.isFinite(media.duration) ? media.duration : 0,
        media.videoWidth || undefined,
        media.videoHeight || undefined,
      );
    };
    // A codec the browser cannot decode still uploads fine — the server probes
    // it properly — so a read failure is not an error, just an unknown duration.
    element.onerror = () => finish(0);
    element.src = url;
  });
}

export function MediaInput({ kind }: { kind: 'video' | 'audio' }) {
  const asset = useStudio((state) => (kind === 'video' ? state.video : state.audio));
  const videoAsset = useStudio((state) => state.video);
  const setAsset = useStudio((state) => state.setAsset);
  const patchAsset = useStudio((state) => state.patchAsset);

  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<'idle' | 'url' | 'record'>('idle');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = kind === 'video' ? VIDEO_ACCEPT : AUDIO_ACCEPT;
  const formats = kind === 'video' ? VIDEO_INPUT_FORMATS : AUDIO_INPUT_FORMATS;

  const ingest = useCallback(
    async (file: File) => {
      setError(null);

      const valid = kind === 'video' ? isVideoFormat(file.name) : isAudioFormat(file.name);
      if (!valid) {
        setError(`We cannot read that file. Try ${formats.slice(0, 4).join(', ')}.`);
        return;
      }

      const metadata = await readLocalMetadata(file, kind);
      const draft: StudioAsset = {
        id: `local-${crypto.randomUUID()}`,
        filename: file.name,
        kind,
        sizeBytes: file.size,
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        localUrl: metadata.url,
        status: 'uploading',
        uploadProgress: 0,
      };

      setAsset(kind, draft);

      // Simulated transfer so the studio is usable without a backend; the real
      // upload path is api.assets.createUpload + uploadToStorage.
      for (let progress = 0; progress <= 1; progress += 0.08) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        patchAsset(kind, { uploadProgress: Math.min(1, progress) });
      }

      patchAsset(kind, { status: 'processing', uploadProgress: 1 });
      await new Promise((resolve) => setTimeout(resolve, 350));
      setAsset(kind, { ...draft, status: 'ready', uploadProgress: 1 });
    },
    [kind, formats, setAsset, patchAsset],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) void ingest(file);
    },
    [ingest],
  );

  if (asset) {
    return <AssetCard asset={asset} onClear={() => setAsset(kind, null)} />;
  }

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'relative rounded-panel border-2 border-dashed p-8 text-center transition-all',
          dragging
            ? 'border-brand bg-brand/10 scale-[1.01]'
            : 'border-line hover:border-line-strong bg-surface-raised/30',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void ingest(file);
            event.target.value = '';
          }}
        />

        <span
          className={cn(
            'mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl transition-colors',
            dragging ? 'bg-brand text-white' : 'bg-surface-raised text-brand',
          )}
        >
          {kind === 'video' ? <FileVideo className="size-5" /> : <AudioLines className="size-5" />}
        </span>

        <p className="text-sm font-medium">
          {kind === 'video' ? 'Drop your face video' : 'Drop the audio to sync to'}
        </p>
        <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-ink-subtle">
          {kind === 'video'
            ? 'A visible face for most of the clip. MP4, MOV, AVI, MKV or WebM.'
            : 'Speech or singing. MP3, WAV, AAC, FLAC or OGG.'}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => inputRef.current?.click()}>
            Browse files
          </Button>

          {kind === 'audio' && (
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={<Mic className="size-3.5" />}
                onClick={() => setMode(mode === 'record' ? 'idle' : 'record')}
              >
                Record
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Link2 className="size-3.5" />}
                onClick={() => setMode(mode === 'url' ? 'idle' : 'url')}
              >
                From URL
              </Button>
              {videoAsset?.status === 'ready' && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Scissors className="size-3.5" />}
                  onClick={() =>
                    setAsset('audio', {
                      id: `extracted-${crypto.randomUUID()}`,
                      filename: `${videoAsset.filename.replace(/\.[^.]+$/, '')}.wav`,
                      kind: 'audio',
                      sizeBytes: Math.round(videoAsset.durationSeconds * 176_400),
                      durationSeconds: videoAsset.durationSeconds,
                      localUrl: videoAsset.localUrl,
                      status: 'ready',
                      uploadProgress: 1,
                    })
                  }
                >
                  Extract from video
                </Button>
              )}
            </>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-xs text-danger">
            {error}
          </p>
        )}
      </div>

      <AnimatePresence>
        {mode === 'url' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex gap-2">
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                hint="Only where you hold the rights. We import audio, never video."
              />
              <Button className="mt-0 h-11" disabled={!url.trim()}>
                Import
              </Button>
            </div>
          </motion.div>
        )}

        {mode === 'record' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Recorder
              onCapture={(file) => {
                setMode('idle');
                void ingest(file);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recorder                                                            */
/* ------------------------------------------------------------------ */

function Recorder({ onCapture }: { onCapture: (file: File) => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    // Releasing the microphone on unmount matters: leaving the track live
    // keeps the browser's recording indicator on after the panel closes.
    return () => {
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        onCapture(new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' }));
      };

      recorder.start();
      recorderRef.current = recorder;
      setSeconds(0);
      setRecording(true);
    } catch {
      setError('We could not reach your microphone. Check the browser permission and try again.');
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  return (
    <div className="mt-3 flex items-center gap-4 rounded-xl border border-line bg-surface-raised/50 p-4">
      <button
        type="button"
        onClick={recording ? stop : () => void start()}
        aria-label={recording ? 'Stop recording' : 'Start recording'}
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-full transition-all',
          recording ? 'bg-danger text-white' : 'gradient-brand text-white',
        )}
      >
        {recording ? <Square className="size-4 fill-current" /> : <Mic className="size-4" />}
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {recording ? 'Recording…' : error ? 'Microphone unavailable' : 'Record straight in'}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-subtle">
          {error ?? (recording ? 'Click the square to finish.' : 'Nothing leaves your device until you render.')}
        </p>
      </div>

      {recording && (
        <span className="font-mono text-sm tabular-nums text-danger">{formatDuration(seconds)}</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Asset card                                                          */
/* ------------------------------------------------------------------ */

function AssetCard({ asset, onClear }: { asset: StudioAsset; onClear: () => void }) {
  const busy = asset.status === 'uploading' || asset.status === 'processing';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-panel border border-line bg-surface-raised/50 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
          {asset.kind === 'video' ? (
            <FileVideo className="size-5" />
          ) : (
            <AudioLines className="size-5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{asset.filename}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-subtle">
            <span>{formatBytes(asset.sizeBytes)}</span>
            {asset.durationSeconds > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>{formatDuration(asset.durationSeconds)}</span>
              </>
            )}
            {asset.width && asset.height && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {asset.width}×{asset.height}
                </span>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={onClear}
          aria-label={`Remove ${asset.filename}`}
          className="rounded-lg p-1.5 text-ink-subtle transition-colors hover:bg-line hover:text-danger"
        >
          {busy ? <X className="size-4" /> : <Trash2 className="size-4" />}
        </button>
      </div>

      {busy && (
        <div className="mt-3">
          <Progress
            value={asset.uploadProgress * 100}
            indeterminate={asset.status === 'processing'}
            label={asset.status === 'processing' ? 'Processing' : 'Uploading'}
          />
          <p className="mt-1.5 text-xs text-ink-subtle">
            {asset.status === 'processing'
              ? 'Checking the media and looking for a face…'
              : `Uploading — ${Math.round(asset.uploadProgress * 100)}%`}
          </p>
        </div>
      )}

      {asset.status === 'failed' && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {asset.error ?? 'That upload failed. Try again.'}
        </p>
      )}
    </motion.div>
  );
}
