'use client';

import { motion } from 'framer-motion';
import { Activity, Languages, RotateCcw, Sliders, Sparkles } from 'lucide-react';
import {
  ENHANCEMENTS,
  ENHANCEMENT_LABELS,
  EXPRESSION_CONTROL_META,
  SUPPORTED_LANGUAGES,
  type Enhancement,
  type VoiceAnalysis,
} from '@lipsync/shared';
import { useStudio } from '@/store/studio';
import { Badge, CheckCard, Slider, Toggle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/* Expression                                                          */
/* ------------------------------------------------------------------ */

export function ExpressionPanel() {
  const expression = useStudio((state) => state.expression);
  const setExpression = useStudio((state) => state.setExpression);
  const resetExpression = useStudio((state) => state.resetExpression);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="size-4 text-brand" />
          <p className="text-sm font-medium">Expression</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw className="size-3.5" />}
          onClick={resetExpression}
        >
          Reset
        </Button>
      </div>

      <div className="space-y-5">
        {EXPRESSION_CONTROL_META.map((control) => (
          <Slider
            key={control.key}
            label={control.label}
            hint={control.hint}
            value={expression[control.key]}
            onChange={(value) => setExpression(control.key, value)}
          />
        ))}
      </div>

      <p className="mt-5 rounded-lg bg-surface-raised/60 p-3 text-xs leading-relaxed text-ink-subtle">
        50 means &ldquo;leave the original alone&rdquo;. Anything you do not move is preserved from
        the source take.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Enhancements                                                        */
/* ------------------------------------------------------------------ */

export function EnhancementPanel() {
  const enhancements = useStudio((state) => state.enhancements);
  const toggle = useStudio((state) => state.toggleEnhancement);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="size-4 text-brand" />
        <p className="text-sm font-medium">Enhancements</p>
        {enhancements.length > 0 && <Badge tone="brand">{enhancements.length} on</Badge>}
      </div>

      <div className="space-y-2">
        {ENHANCEMENTS.map((id: Enhancement) => (
          <CheckCard
            key={id}
            checked={enhancements.includes(id)}
            onChange={() => toggle(id)}
            title={ENHANCEMENT_LABELS[id].name}
            detail={ENHANCEMENT_LABELS[id].detail}
          />
        ))}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-subtle">
        Each enhancement adds roughly 10% to the credit cost and to the render time. They are
        applied in a fixed order regardless of the order you pick them.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Audio and language                                                  */
/* ------------------------------------------------------------------ */

export function AudioPanel() {
  const musicMode = useStudio((state) => state.musicMode);
  const karaokeTiming = useStudio((state) => state.karaokeTiming);
  const subtitlesEnabled = useStudio((state) => state.subtitlesEnabled);
  const burnInSubtitles = useStudio((state) => state.burnInSubtitles);
  const subtitleLanguages = useStudio((state) => state.subtitleLanguages);
  const translateTo = useStudio((state) => state.translateTo);
  const setFlag = useStudio((state) => state.setFlag);
  const setSubtitleLanguages = useStudio((state) => state.setSubtitleLanguages);
  const setTranslateTo = useStudio((state) => state.setTranslateTo);

  const toggleLanguage = (code: string) =>
    setSubtitleLanguages(
      subtitleLanguages.includes(code)
        ? subtitleLanguages.filter((c) => c !== code)
        : [...subtitleLanguages, code],
    );

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Toggle
          checked={musicMode}
          onChange={(value) => setFlag('musicMode', value)}
          label="Music mode"
          description="Follow sung vowels rather than forcing speech phonemes, and use the detected beat grid."
        />
        <Toggle
          checked={karaokeTiming}
          onChange={(value) => setFlag('karaokeTiming', value)}
          label="Karaoke timing"
          description="Produce word-level timings so lyrics can highlight in time with the vocal."
          disabled={!musicMode && !subtitlesEnabled}
        />
      </div>

      <div className="border-t border-line pt-5">
        <div className="mb-4 flex items-center gap-2">
          <Languages className="size-4 text-brand" />
          <p className="text-sm font-medium">Subtitles</p>
        </div>

        <div className="space-y-4">
          <Toggle
            checked={subtitlesEnabled}
            onChange={(value) => setFlag('subtitlesEnabled', value)}
            label="Generate subtitles"
            description="Transcribe the audio and produce editable cues."
          />

          {subtitlesEnabled && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="space-y-4 overflow-hidden pl-12"
            >
              <div>
                <p className="mb-2 text-xs font-medium text-ink-muted">Languages</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUPPORTED_LANGUAGES.map((language) => {
                    const active = subtitleLanguages.includes(language.code);
                    return (
                      <button
                        key={language.code}
                        type="button"
                        onClick={() => toggleLanguage(language.code)}
                        aria-pressed={active}
                        className={cn(
                          'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                          active
                            ? 'border-brand/50 bg-brand/15 text-brand'
                            : 'border-line text-ink-muted hover:border-line-strong',
                        )}
                      >
                        {language.native}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Toggle
                checked={burnInSubtitles}
                onChange={(value) => setFlag('burnInSubtitles', value)}
                label="Burn into the video"
                description="Permanent captions, for platforms that ignore sidecar subtitle files."
              />
            </motion.div>
          )}
        </div>
      </div>

      <div className="border-t border-line pt-5">
        <p className="mb-2 text-sm font-medium">Translate and re-sync</p>
        <p className="mb-3 text-xs leading-relaxed text-ink-subtle">
          Translate the speech, then match the mouth to the translation instead of the original.
        </p>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setTranslateTo(null)}
            aria-pressed={translateTo === null}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
              translateTo === null
                ? 'border-brand/50 bg-brand/15 text-brand'
                : 'border-line text-ink-muted hover:border-line-strong',
            )}
          >
            Keep original
          </button>
          {SUPPORTED_LANGUAGES.map((language) => (
            <button
              key={language.code}
              type="button"
              onClick={() => setTranslateTo(language.code)}
              aria-pressed={translateTo === language.code}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                translateTo === language.code
                  ? 'border-brand/50 bg-brand/15 text-brand'
                  : 'border-line text-ink-muted hover:border-line-strong',
              )}
            >
              {language.native}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Voice analysis                                                      */
/* ------------------------------------------------------------------ */

/** Renders a confidence as a bar plus its number — the number is the point. */
function ConfidenceRow({
  label,
  value,
  confidence,
}: {
  label: string;
  value: string;
  confidence: number;
}) {
  // Below 50% we say so rather than presenting a guess as a finding.
  const weak = confidence < 0.5;

  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-28 shrink-0 text-xs text-ink-subtle">{label}</span>
      <span className={cn('flex-1 text-sm font-medium', weak && 'text-ink-muted')}>
        {value}
        {weak && <span className="ml-1.5 text-xs font-normal text-warning">low confidence</span>}
      </span>
      <span className="flex w-24 shrink-0 items-center gap-2">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-line">
          <motion.span
            className={cn('block h-full rounded-full', weak ? 'bg-warning' : 'bg-success')}
            initial={{ width: 0 }}
            animate={{ width: `${confidence * 100}%` }}
            transition={{ duration: 0.6 }}
          />
        </span>
        <span className="w-8 text-right font-mono text-[11px] tabular-nums text-ink-subtle">
          {Math.round(confidence * 100)}%
        </span>
      </span>
    </div>
  );
}

export function AnalysisPanel({ analysis }: { analysis: VoiceAnalysis | null }) {
  if (!analysis) {
    return (
      <div className="rounded-xl border border-dashed border-line p-6 text-center">
        <Activity className="mx-auto mb-3 size-5 text-ink-subtle" />
        <p className="text-sm font-medium">No analysis yet</p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">
          Add an audio track and we will detect its language, emotion, tempo and speaking rate —
          each with a confidence score.
        </p>
      </div>
    );
  }

  const languageName =
    SUPPORTED_LANGUAGES.find((l) => l.code === analysis.language.value)?.name ??
    String(analysis.language.value).toUpperCase();

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Activity className="size-4 text-brand" />
        <p className="text-sm font-medium">Voice analysis</p>
        {analysis.isMusic && <Badge tone="brand">Music detected</Badge>}
      </div>

      <div className="divide-y divide-line">
        <ConfidenceRow
          label="Language"
          value={languageName}
          confidence={analysis.language.confidence}
        />
        <ConfidenceRow
          label="Emotion"
          value={String(analysis.emotion.value)}
          confidence={analysis.emotion.confidence}
        />
        <ConfidenceRow
          label="Speaker"
          value={String(analysis.gender.value)}
          confidence={analysis.gender.confidence}
        />
        <ConfidenceRow
          label="Speaking rate"
          value={`${Math.round(Number(analysis.speakingRate.value))} wpm`}
          confidence={analysis.speakingRate.confidence}
        />
        {analysis.tempo && (
          <ConfidenceRow
            label="Tempo"
            value={`${Number(analysis.tempo.value).toFixed(0)} BPM`}
            confidence={analysis.tempo.confidence}
          />
        )}
      </div>

      {analysis.beats.length > 0 && (
        <p className="mt-3 text-xs text-ink-subtle">
          {analysis.beats.length} beats detected — used for the karaoke grid.
        </p>
      )}
    </div>
  );
}
