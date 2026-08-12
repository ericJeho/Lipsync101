'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Clock,
  Download,
  FolderOpen,
  HardDrive,
  Plus,
  Sparkles,
  Star,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { PLANS, formatBytes, formatDuration } from '@lipsync/shared';
import { Nav } from '@/components/layout/Nav';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Progress, Skeleton, Tabs } from '@/components/ui/primitives';
import { useAuth } from '@/components/layout/AuthProvider';
import { api, type DashboardSummary, type JobSummary } from '@/lib/api';
import { cn } from '@/lib/cn';

type Tab = 'overview' | 'projects' | 'renders' | 'downloads';

const STATUS_TONE: Record<string, 'neutral' | 'brand' | 'success' | 'warning' | 'danger'> = {
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  paused: 'warning',
  queued: 'brand',
  analyzing: 'brand',
  rendering: 'brand',
  enhancing: 'brand',
  encoding: 'brand',
};

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    api.dashboard
      .summary()
      .then(setData)
      .catch(() => setUnreachable(true))
      .finally(() => setLoading(false));
  }, [authLoading]);

  if (!authLoading && !user) {
    return (
      <>
        <Nav />
        <main id="main" className="mx-auto max-w-2xl px-4 py-24">
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title="Sign in to see your dashboard"
            description="Your projects, renders, credits and downloads all live here."
            action={
              <Link href="/auth/login">
                <Button>Sign in</Button>
              </Link>
            }
          />
        </main>
      </>
    );
  }

  const plan = PLANS[(user?.plan ?? 'free') as keyof typeof PLANS];

  return (
    <>
      <Nav />

      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {user?.name ? `Welcome back, ${user.name.split(' ')[0]}` : 'Your dashboard'}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              {plan.name} plan · {user?.credits.toLocaleString() ?? 0} credits
            </p>
          </div>

          <Link href="/studio">
            <Button icon={<Plus className="size-4" />}>New render</Button>
          </Link>
        </header>

        <Tabs
          className="mb-7 max-w-lg"
          tabs={[
            { id: 'overview' as const, label: 'Overview' },
            { id: 'projects' as const, label: 'Projects', count: data?.counts.projects },
            { id: 'renders' as const, label: 'Renders', count: data?.counts.renders },
            { id: 'downloads' as const, label: 'Downloads' },
          ]}
          active={tab}
          onChange={setTab}
        />

        {unreachable && (
          <Card className="mb-6 border-warning/30 bg-warning/5">
            <p className="text-sm font-medium">The API is not reachable</p>
            <p className="mt-1.5 text-sm text-ink-muted">
              Start the backend with <code className="font-mono text-xs">npm run dev:api</code>, or
              bring the whole stack up with{' '}
              <code className="font-mono text-xs">npm run docker:up</code>. The studio still works
              without it.
            </p>
          </Card>
        )}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
        ) : (
          <>
            {tab === 'overview' && <Overview data={data} plan={plan} />}
            {tab === 'renders' && <RenderList jobs={data?.recentJobs ?? []} />}
            {tab === 'projects' && <ProjectList data={data} />}
            {tab === 'downloads' && (
              <RenderList jobs={(data?.recentJobs ?? []).filter((j) => j.status === 'completed')} downloads />
            )}
          </>
        )}
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Overview({
  data,
  plan,
}: {
  data: DashboardSummary | null;
  plan: (typeof PLANS)[keyof typeof PLANS];
}) {
  const storageUsed = data?.storage.usedBytes ?? 0;
  const storageLimit = data?.storage.limitBytes ?? plan.limits.storageBytes;
  const secondsUsed = data?.usage.secondsUsed ?? 0;
  const secondsIncluded = data?.usage.secondsIncluded ?? null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Zap className="size-4" />}
          label="Credits"
          value={(data?.user.credits ?? 0).toLocaleString()}
        />
        <StatCard
          icon={<TrendingUp className="size-4" />}
          label="Renders in flight"
          value={String(data?.counts.inFlight ?? 0)}
          detail={
            data?.queue.waiting
              ? `${data.queue.waiting} waiting across the queue`
              : 'Queue is clear'
          }
        />
        <StatCard
          icon={<FolderOpen className="size-4" />}
          label="Projects"
          value={String(data?.counts.projects ?? 0)}
          detail={
            plan.limits.maxProjects === null
              ? 'Unlimited on your plan'
              : `of ${plan.limits.maxProjects} on ${plan.name}`
          }
        />
        <StatCard
          icon={<Clock className="size-4" />}
          label="Rendered this period"
          value={formatDuration(secondsUsed)}
          detail={
            secondsIncluded === null
              ? 'Unmetered'
              : `of ${formatDuration(secondsIncluded)} included`
          }
          progress={
            secondsIncluded === null
              ? undefined
              : Math.min(100, (secondsUsed / secondsIncluded) * 100)
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-medium">Recent renders</p>
            <Link href="/studio" className="text-xs text-brand hover:underline">
              New render
            </Link>
          </div>
          <RenderList jobs={data?.recentJobs ?? []} compact />
        </Card>

        <div className="space-y-4">
          <Card>
            <p className="mb-3 flex items-center gap-2 text-sm font-medium">
              <HardDrive className="size-4 text-brand" />
              Storage
            </p>
            <Progress
              value={(storageUsed / storageLimit) * 100}
              label="Storage used"
            />
            <p className="mt-2 text-xs text-ink-subtle">
              {formatBytes(storageUsed)} of {formatBytes(storageLimit)}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
              Files are deleted automatically after {plan.limits.retentionDays} days on your plan.
            </p>
          </Card>

          <Card>
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Star className="size-4 text-brand" />
              Favourites
            </p>
            {data?.favorites.length ? (
              <ul className="space-y-2">
                {data.favorites.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/studio?project=${project.id}`}
                      className="block truncate rounded-lg px-2 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
                    >
                      {project.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-subtle">
                Star a project and it will show up here for quick access.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  progress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
  progress?: number;
}) {
  return (
    <Card>
      <p className="mb-3 flex items-center gap-2 text-xs text-ink-subtle">
        <span className="text-brand">{icon}</span>
        {label}
      </p>
      <p className="font-mono text-2xl tabular-nums">{value}</p>
      {progress !== undefined && <Progress value={progress} className="mt-3" label={label} />}
      {detail && <p className="mt-2 text-xs text-ink-subtle">{detail}</p>}
    </Card>
  );
}

function RenderList({
  jobs,
  compact,
  downloads,
}: {
  jobs: JobSummary[];
  compact?: boolean;
  downloads?: boolean;
}) {
  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={<Sparkles className="size-5" />}
        title={downloads ? 'Nothing to download yet' : 'No renders yet'}
        description={
          downloads
            ? 'Finished renders show up here, ready to download in MP4, MOV or GIF.'
            : 'Head into the studio, drop in a video and a track, and render your first lip sync.'
        }
        action={
          <Link href="/studio">
            <Button>Open the studio</Button>
          </Link>
        }
      />
    );
  }

  return (
    <ul className={cn('divide-y divide-line', !compact && 'rounded-panel border border-line')}>
      {jobs.map((job, index) => (
        <motion.li
          key={job.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.03 }}
          className={cn('flex items-center gap-4 py-3', !compact && 'px-4')}
        >
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-raised">
            {job.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={job.thumbnailUrl} alt="" className="size-full object-cover" />
            ) : (
              <Sparkles className="size-4 text-ink-subtle" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{job.project?.name ?? 'Untitled'}</p>
            <p className="mt-0.5 truncate text-xs text-ink-subtle">
              {job.engine} · {job.outputHeight}p · {job.outputFormat.toUpperCase()}
              {job.creditsCharged > 0 && ` · ${job.creditsCharged} credits`}
            </p>
          </div>

          {job.status === 'rendering' && (
            <div className="hidden w-28 sm:block">
              <Progress value={job.progress} label={job.stage} />
            </div>
          )}

          <Badge tone={STATUS_TONE[job.status] ?? 'neutral'}>{job.status}</Badge>

          {job.status === 'completed' && (
            <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />}>
              <span className="sr-only sm:not-sr-only">Download</span>
            </Button>
          )}
        </motion.li>
      ))}
    </ul>
  );
}

function ProjectList({ data }: { data: DashboardSummary | null }) {
  const projects = data?.favorites ?? [];

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<FolderOpen className="size-5" />}
        title="No projects yet"
        description="A project holds your media, timeline and every render you make from it."
        action={
          <Link href="/studio">
            <Button icon={<Plus className="size-4" />}>Create a project</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <Card key={project.id} className="transition-colors hover:border-line-strong">
          <div className="mb-3 aspect-video overflow-hidden rounded-lg bg-surface-raised" />
          <p className="truncate text-sm font-medium">{project.name}</p>
          <p className="mt-1 text-xs text-ink-subtle">
            {project._count?.jobs ?? 0} renders · updated{' '}
            {new Date(project.updatedAt).toLocaleDateString()}
          </p>
        </Card>
      ))}
    </div>
  );
}
