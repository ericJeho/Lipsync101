'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  AudioLines,
  Blend,
  Boxes,
  Captions,
  Check,
  Cpu,
  Gauge,
  Globe,
  Layers,
  Mic,
  Music4,
  Scissors,
  ShieldCheck,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import { ENGINE_LIST, PLAN_LIST, SUPPORTED_LANGUAGES } from '@lipsync/shared';
import { Badge, Card, SectionHeading } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
  transition: { duration: 0.5 },
};

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    icon: Upload,
    title: 'Bring your media',
    body: 'Drop a video, then give it a track — upload audio, record straight into the browser, pull the audio out of another clip, or paste a link.',
  },
  {
    icon: Cpu,
    title: 'Pick an engine',
    body: 'Choose fast, balanced or highest quality and we route to the right model — or name the engine yourself if you know what you want.',
  },
  {
    icon: Wand2,
    title: 'Shape the performance',
    body: 'Six sliders control mouth intensity, smile, blinks, expression, head motion and emotion. Everything you do not touch is preserved.',
  },
  {
    icon: Sparkles,
    title: 'Render and export',
    body: 'Watch progress live, compare against the original frame by frame, then export to MP4, MOV or GIF with social presets applied.',
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="How it works"
        title="Four steps from raw footage to a finished render"
        description="No timeline gymnastics required. The defaults produce a good result, and every control is there when you want to push past them."
      />

      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <motion.div key={step.title} {...fadeUp} transition={{ duration: 0.5, delay: index * 0.08 }}>
            <Card className="h-full">
              <div className="mb-5 flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand/15 text-brand">
                  <step.icon className="size-5" />
                </span>
                <span className="font-mono text-xs text-ink-subtle">0{index + 1}</span>
              </div>
              <h3 className="mb-2 text-base font-semibold">{step.title}</h3>
              <p className="text-sm leading-relaxed text-ink-muted">{step.body}</p>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Engines                                                             */
/* ------------------------------------------------------------------ */

export function Engines() {
  return (
    <section id="engines" className="border-y border-line/60 bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Engines"
          title="Six models, because no single one wins every time"
          description="They differ in what they synthesise and what they preserve. Pick a speed preset and we route for you, or choose the engine yourself when the footage calls for something specific."
        />

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {ENGINE_LIST.map((engine, index) => (
            <motion.div
              key={engine.id}
              {...fadeUp}
              transition={{ duration: 0.5, delay: index * 0.06 }}
            >
              <Card className="flex h-full flex-col" glow={engine.defaultFor.length > 0}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold">{engine.name}</h3>
                  {engine.defaultFor.length > 0 && (
                    <Badge tone="brand">Default · {engine.defaultFor[0]}</Badge>
                  )}
                </div>

                <p className="mb-3 text-sm font-medium text-brand">{engine.tagline}</p>
                <p className="mb-5 flex-1 text-sm leading-relaxed text-ink-muted">
                  {engine.description}
                </p>

                <div className="mb-4 flex flex-wrap gap-1.5">
                  {engine.capabilities.headMotion && <Badge>Head motion</Badge>}
                  {engine.capabilities.eyeBlink && <Badge>Blinks</Badge>}
                  {engine.capabilities.music && <Badge>Singing</Badge>}
                  {engine.capabilities.stillImage && <Badge>Stills</Badge>}
                  {engine.capabilities.realtime && <Badge tone="success">Real-time</Badge>}
                </div>

                <dl className="grid grid-cols-2 gap-3 border-t border-line pt-4 text-xs">
                  <div>
                    <dt className="text-ink-subtle">Relative cost</dt>
                    <dd className="mt-0.5 font-mono tabular-nums">
                      {engine.creditMultiplier.toFixed(1)}×
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-subtle">Max height</dt>
                    <dd className="mt-0.5 font-mono tabular-nums">
                      {engine.capabilities.maxHeight}p
                    </dd>
                  </div>
                </dl>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Feature grid                                                        */
/* ------------------------------------------------------------------ */

const FEATURES = [
  {
    icon: AudioLines,
    title: 'Voice analysis with real confidence scores',
    body: 'Language, emotion, speaker gender, speaking rate and tempo — each reported with how sure the model actually is, so you know when to trust it.',
  },
  {
    icon: Music4,
    title: 'Music mode and karaoke timing',
    body: 'Beat detection drives a karaoke grid, and mouth shapes follow sung vowels rather than being forced into speech phonemes.',
    id: 'translation',
  },
  {
    icon: Captions,
    title: 'Subtitles you can actually edit',
    body: 'Word-level timings, a cue editor that refuses overlaps, and SRT / WebVTT / karaoke VTT export.',
    id: 'subtitles',
  },
  {
    icon: Globe,
    title: 'Translate and re-sync',
    body: `Ten languages including Swahili and Chichewa. Translate the speech, then lip-sync the face to the translation.`,
  },
  {
    icon: Blend,
    title: 'Enhancement stack',
    body: 'Face restoration, denoise, skin, colour, relight, stabilisation and HD upscale — applied in the order that actually preserves detail.',
  },
  {
    icon: Scissors,
    title: 'Timeline editor',
    body: 'Split, trim, merge and replace audio with undo and redo, then preview before you spend a single credit on a render.',
  },
  {
    icon: Boxes,
    title: 'Batch rendering',
    body: 'Queue up to fifty clips, watch each progress bar, and pause, resume or cancel the whole batch without losing finished work.',
    id: 'batch',
  },
  {
    icon: Gauge,
    title: 'Live render telemetry',
    body: 'Rendering percentage, remaining time, queue position and GPU utilisation over a WebSocket. Email when it lands.',
  },
  {
    icon: Mic,
    title: 'Voice cloning, gated properly',
    body: 'Clone a voice from samples and sync to generated speech — behind an explicit consent record we store with the model.',
  },
];

export function Features() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="Capabilities"
        title="Everything around the sync, not just the sync"
        description="The model is one step in a pipeline. The rest is what turns a research demo into something you can ship on a deadline."
      />

      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, index) => (
          <motion.div
            key={feature.title}
            id={feature.id}
            {...fadeUp}
            transition={{ duration: 0.5, delay: (index % 3) * 0.07 }}
          >
            <Card className="h-full transition-colors hover:border-line-strong">
              <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-surface-raised text-brand">
                <feature.icon className="size-5" />
              </span>
              <h3 className="mb-2 text-base font-semibold">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-ink-muted">{feature.body}</p>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Languages                                                           */
/* ------------------------------------------------------------------ */

export function Languages() {
  return (
    <section className="border-y border-line/60 bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:justify-between">
          <SectionHeading
            eyebrow="Languages"
            title="Ten languages, transcribed and translated"
            description="Generate captions in the source language, translate them, then re-sync the face to the translated speech so the mouth matches the words a viewer actually hears."
          />

          <div className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end">
            {SUPPORTED_LANGUAGES.map((language) => (
              <span
                key={language.code}
                className="rounded-xl border border-line bg-surface-raised/60 px-3.5 py-2 text-sm"
              >
                <span className="font-medium">{language.native}</span>
                <span className="ml-2 font-mono text-xs text-ink-subtle">{language.code}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pricing preview                                                     */
/* ------------------------------------------------------------------ */

export function PricingPreview() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow="Pricing"
        title="Start free, pay when you ship"
        description="Every plan gets all six engines and all ten languages. What changes is resolution, volume and whether the output carries a watermark."
        className="mx-auto text-center"
      />

      <div className="mx-auto mt-14 grid max-w-5xl gap-6 lg:grid-cols-3">
        {PLAN_LIST.map((plan) => (
          <Card
            key={plan.id}
            glow={plan.highlighted}
            className={cn('flex flex-col', plan.highlighted && 'lg:-mt-4 lg:mb-4')}
          >
            {plan.highlighted && (
              <Badge tone="brand" className="mb-4 self-start">
                Most popular
              </Badge>
            )}
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            <p className="mt-1 text-sm text-ink-muted">{plan.tagline}</p>

            <p className="mt-6 flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-tight">${plan.monthlyUsd}</span>
              <span className="text-sm text-ink-subtle">/month</span>
            </p>

            <ul className="mt-6 flex-1 space-y-3">
              {plan.features.map((feature) => (
                <li key={feature} className="flex gap-2.5 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  <span className="text-ink-muted">{feature}</span>
                </li>
              ))}
            </ul>

            <Link href="/pricing" className="mt-8">
              <Button fullWidth variant={plan.highlighted ? 'primary' : 'secondary'}>
                {plan.monthlyUsd === 0 ? 'Start free' : `Choose ${plan.name}`}
              </Button>
            </Link>
          </Card>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Responsible use                                                     */
/* ------------------------------------------------------------------ */

export function ResponsibleUse() {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
      <Card glow className="overflow-hidden p-8 sm:p-12">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <span className="mb-5 flex size-11 items-center justify-center rounded-xl bg-success/15 text-success">
              <ShieldCheck className="size-5" />
            </span>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Synthetic media, handled carefully
            </h2>
            <p className="mt-4 text-pretty leading-relaxed text-ink-muted">
              This tool puts words in people&rsquo;s mouths. That is genuinely useful for dubbing,
              accessibility and localisation, and genuinely harmful in the wrong hands — so the
              safeguards are part of the product rather than a policy page nobody reads.
            </p>
            <Link href="/policy/acceptable-use" className="mt-7 inline-block">
              <Button variant="outline" iconAfter={<ArrowRight className="size-4" />}>
                Read the acceptable use policy
              </Button>
            </Link>
          </div>

          <ul className="space-y-4">
            {[
              'Every upload is scanned for policy violations before it can be rendered, so you find out early rather than after paying credits.',
              'Voice cloning requires an explicit consent affirmation, stored with the timestamp and address that produced it.',
              'Suspected non-consensual likenesses are routed to human review rather than silently blocked or silently allowed.',
              'Free renders carry a visible watermark, and files are deleted automatically on your plan’s retention schedule.',
            ].map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-relaxed">
                <Layers className="mt-0.5 size-4 shrink-0 text-brand" />
                <span className="text-ink-muted">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </section>
  );
}
