'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Check, CreditCard, Minus, Smartphone } from 'lucide-react';
import {
  PAYMENT_METHODS,
  PLAN_LIST,
  formatBytes,
  formatDuration,
  type Plan,
} from '@lipsync/shared';
import { Nav } from '@/components/layout/Nav';
import { Footer } from '@/components/layout/Footer';
import { Button } from '@/components/ui/Button';
import { Badge, Card, SectionHeading } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

const COMPARISON: {
  label: string;
  render: (plan: Plan) => string | boolean;
}[] = [
  { label: 'Maximum resolution', render: (p) => `${p.limits.maxHeight}p` },
  {
    label: 'Rendered minutes',
    render: (p) =>
      p.limits.minutesPerMonth === null ? 'Unlimited' : `${p.limits.minutesPerMonth} / month`,
  },
  {
    label: 'Projects',
    render: (p) => (p.limits.maxProjects === null ? 'Unlimited' : String(p.limits.maxProjects)),
  },
  { label: 'Longest clip', render: (p) => formatDuration(p.limits.maxClipSeconds) },
  { label: 'Batch size', render: (p) => `${p.limits.maxBatchSize} clips` },
  { label: 'Concurrent renders', render: (p) => String(p.limits.concurrentJobs) },
  { label: 'Storage', render: (p) => formatBytes(p.limits.storageBytes, 0) },
  { label: 'File retention', render: (p) => `${p.limits.retentionDays} days` },
  { label: 'Watermark-free', render: (p) => !p.limits.watermark },
  { label: 'Priority GPU queue', render: (p) => p.limits.priorityRendering },
  { label: 'REST & GraphQL API', render: (p) => p.limits.apiAccess },
  { label: 'Team workspace', render: (p) => p.limits.teamWorkspace },
];

export default function PricingPage() {
  const [yearly, setYearly] = useState(false);

  return (
    <>
      <Nav />

      <main id="main">
        <section className="mx-auto max-w-7xl px-4 pb-16 pt-20 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="Pricing"
            title="Pay for output, not for seats"
            description="Every plan includes all six engines, all ten languages, subtitles, translation and the timeline editor. What changes is resolution, volume and watermarking."
            className="mx-auto text-center"
          />

          <div className="mt-9 flex items-center justify-center gap-3">
            <span className={cn('text-sm', !yearly && 'font-medium')}>Monthly</span>
            <button
              type="button"
              role="switch"
              aria-checked={yearly}
              aria-label="Bill yearly"
              onClick={() => setYearly((value) => !value)}
              className={cn(
                'relative h-6 w-11 rounded-full transition-colors',
                yearly ? 'gradient-brand' : 'bg-line-strong',
              )}
            >
              <motion.span
                className="absolute top-0.5 size-5 rounded-full bg-white shadow"
                animate={{ left: yearly ? 22 : 2 }}
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              />
            </button>
            <span className={cn('text-sm', yearly && 'font-medium')}>
              Yearly <Badge tone="success">2 months free</Badge>
            </span>
          </div>

          <div className="mx-auto mt-14 grid max-w-5xl gap-6 lg:grid-cols-3">
            {PLAN_LIST.map((plan) => {
              const price = yearly ? plan.yearlyUsd : plan.monthlyUsd;
              return (
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

                  <h2 className="text-lg font-semibold">{plan.name}</h2>
                  <p className="mt-1 text-sm text-ink-muted">{plan.tagline}</p>

                  <p className="mt-6 flex items-baseline gap-1.5">
                    <span className="text-4xl font-semibold tracking-tight">${price}</span>
                    <span className="text-sm text-ink-subtle">/{yearly ? 'year' : 'month'}</span>
                  </p>

                  <ul className="mt-6 flex-1 space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-2.5 text-sm">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" />
                        <span className="text-ink-muted">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Link href={plan.id === 'free' ? '/auth/register' : '/dashboard/billing'} className="mt-8">
                    <Button fullWidth variant={plan.highlighted ? 'primary' : 'secondary'}>
                      {plan.id === 'free' ? 'Start free' : `Choose ${plan.name}`}
                    </Button>
                  </Link>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Comparison table */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
          <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight">
            Compare the plans
          </h2>

          <div className="overflow-x-auto rounded-panel border border-line">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">Feature comparison across plans</caption>
              <thead>
                <tr className="border-b border-line bg-surface-raised/50">
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    Feature
                  </th>
                  {PLAN_LIST.map((plan) => (
                    <th key={plan.id} scope="col" className="px-4 py-3 text-center font-medium">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {COMPARISON.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="px-4 py-3 text-left font-normal text-ink-muted">
                      {row.label}
                    </th>
                    {PLAN_LIST.map((plan) => {
                      const value = row.render(plan);
                      return (
                        <td key={plan.id} className="px-4 py-3 text-center">
                          {typeof value === 'boolean' ? (
                            value ? (
                              <Check className="mx-auto size-4 text-success" />
                            ) : (
                              <Minus className="mx-auto size-4 text-ink-subtle" />
                            )
                          ) : (
                            <span className="tabular-nums">{value}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Payment methods */}
        <section className="mx-auto max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
          <Card>
            <h2 className="mb-2 text-lg font-semibold">How you can pay</h2>
            <p className="mb-6 text-sm text-ink-muted">
              Cards and wallets everywhere, plus mobile money across the markets where it is the
              normal way to pay.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {Object.values(PAYMENT_METHODS).map((method) => (
                <div
                  key={method.provider}
                  className="flex items-start gap-3 rounded-xl border border-line bg-surface-raised/40 p-4"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
                    {method.requiresHandsetApproval ? (
                      <Smartphone className="size-4" />
                    ) : (
                      <CreditCard className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{method.name}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">
                      {method.accepts.join(', ')}
                    </p>
                    {method.requiresHandsetApproval && (
                      <p className="mt-1.5 text-xs text-ink-subtle">
                        Approve the prompt on your handset — available in{' '}
                        {method.regions.join(', ')}.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>
      </main>

      <Footer />
    </>
  );
}
