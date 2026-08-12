'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Cpu,
  DollarSign,
  HardDrive,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { MODERATION_CATEGORY_LABELS, formatBytes } from '@lipsync/shared';
import { Nav } from '@/components/layout/Nav';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Skeleton, Tabs } from '@/components/ui/primitives';
import { useAuth } from '@/components/layout/AuthProvider';
import {
  api,
  type AdminOverview,
  type AdminUser,
  type JobSummary,
  type ModerationFlagRow,
} from '@/lib/api';

type Tab = 'overview' | 'users' | 'gpu' | 'moderation';

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [flags, setFlags] = useState<ModerationFlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    // The API enforces the role too; this only avoids rendering an admin shell
    // that would then fail every request.
    if (user && user.role !== 'admin' && user.role !== 'moderator') {
      setDenied(true);
      setLoading(false);
      return;
    }

    Promise.allSettled([
      api.admin.overview().then(setOverview),
      api.admin.users({ take: 25 }).then((r) => setUsers(r.users)),
      api.admin.jobs().then((r) => setJobs(r.jobs)),
      api.admin.moderation().then((r) => setFlags(r.flags)),
    ]).finally(() => setLoading(false));
  }, [authLoading, user]);

  if (denied || (!authLoading && !user)) {
    return (
      <>
        <Nav />
        <main id="main" className="mx-auto max-w-2xl px-4 py-24">
          <EmptyState
            icon={<ShieldAlert className="size-5" />}
            title="Administrators only"
            description="This area covers user accounts, payments, GPU jobs and content moderation. Your account does not have access to it."
          />
        </main>
      </>
    );
  }

  return (
    <>
      <Nav />

      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Accounts, revenue, the render queue and the moderation review queue.
          </p>
        </header>

        <Tabs
          className="mb-7 max-w-xl"
          tabs={[
            { id: 'overview' as const, label: 'Overview' },
            { id: 'users' as const, label: 'Users', count: overview?.users.total },
            { id: 'gpu' as const, label: 'GPU jobs', count: overview?.queue.active },
            {
              id: 'moderation' as const,
              label: 'Moderation',
              count: overview?.moderation.pendingFlags,
            },
          ]}
          active={tab}
          onChange={setTab}
        />

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : (
          <>
            {tab === 'overview' && <OverviewTab overview={overview} />}
            {tab === 'users' && <UsersTab users={users} />}
            {tab === 'gpu' && <GpuTab jobs={jobs} overview={overview} />}
            {tab === 'moderation' && <ModerationTab flags={flags} setFlags={setFlags} />}
          </>
        )}
      </main>
    </>
  );
}

function OverviewTab({ overview }: { overview: AdminOverview | null }) {
  if (!overview) {
    return (
      <EmptyState
        icon={<Activity className="size-5" />}
        title="No data available"
        description="The API is not reachable. Bring the stack up with npm run docker:up."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<Users className="size-4" />}
          label="Users"
          value={overview.users.total.toLocaleString()}
          detail={`+${overview.users.newThisMonth} this month`}
        />
        <Stat
          icon={<Activity className="size-4" />}
          label="Renders (24h)"
          value={overview.jobs.last24h.toLocaleString()}
          detail={`${overview.queue.waiting} waiting, ${overview.queue.active} running`}
        />
        <Stat
          icon={<DollarSign className="size-4" />}
          label="Revenue (30d)"
          value={`$${(overview.revenue.last30DaysMinor / 100).toLocaleString()}`}
          detail={overview.revenue.currency}
        />
        <Stat
          icon={<HardDrive className="size-4" />}
          label="Storage"
          value={formatBytes(overview.storage.totalBytes, 0)}
          detail="Across all accounts"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <p className="mb-4 flex items-center gap-2 text-sm font-medium">
            <Cpu className="size-4 text-brand" />
            Inference service
          </p>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Status</dt>
              <dd>
                <Badge tone={overview.aiService.status === 'ok' ? 'success' : 'danger'}>
                  {overview.aiService.status}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Acceleration</dt>
              <dd>
                <Badge tone={overview.aiService.gpu ? 'success' : 'warning'}>
                  {overview.aiService.gpu ? 'GPU' : 'CPU only'}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Engines loaded</dt>
              <dd className="font-mono tabular-nums">{overview.aiService.engines.length}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <p className="mb-4 text-sm font-medium">Users by plan</p>
          <div className="space-y-3">
            {Object.entries(overview.users.byPlan).map(([plan, count]) => {
              const percent = (count / Math.max(1, overview.users.total)) * 100;
              return (
                <div key={plan}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="capitalize text-ink-muted">{plan}</span>
                    <span className="font-mono tabular-nums">{count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full gradient-brand" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Card>
      <p className="mb-3 flex items-center gap-2 text-xs text-ink-subtle">
        <span className="text-brand">{icon}</span>
        {label}
      </p>
      <p className="font-mono text-2xl tabular-nums">{value}</p>
      {detail && <p className="mt-2 text-xs text-ink-subtle">{detail}</p>}
    </Card>
  );
}

function UsersTab({ users }: { users: AdminUser[] }) {
  if (users.length === 0) {
    return <EmptyState icon={<Users className="size-5" />} title="No users to show" />;
  }

  return (
    <div className="overflow-x-auto rounded-panel border border-line">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-raised/50 text-left">
            <th scope="col" className="px-4 py-3 font-medium">Account</th>
            <th scope="col" className="px-4 py-3 font-medium">Plan</th>
            <th scope="col" className="px-4 py-3 font-medium">Credits</th>
            <th scope="col" className="px-4 py-3 font-medium">Renders</th>
            <th scope="col" className="px-4 py-3 font-medium">Storage</th>
            <th scope="col" className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {users.map((row) => (
            <tr key={row.id} className="transition-colors hover:bg-surface-raised/30">
              <td className="px-4 py-3">
                <p className="font-medium">{row.name ?? '—'}</p>
                <p className="text-xs text-ink-subtle">{row.email}</p>
              </td>
              <td className="px-4 py-3">
                <Badge tone={row.plan === 'free' ? 'neutral' : 'brand'}>{row.plan}</Badge>
              </td>
              <td className="px-4 py-3 font-mono tabular-nums">{row.credits.toLocaleString()}</td>
              <td className="px-4 py-3 font-mono tabular-nums">{row._count.jobs}</td>
              <td className="px-4 py-3 font-mono tabular-nums">
                {formatBytes(row.storageUsedBytes, 0)}
              </td>
              <td className="px-4 py-3">
                {row.suspendedAt ? (
                  <Badge tone="danger">Suspended</Badge>
                ) : (
                  <Badge tone="success">Active</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GpuTab({ jobs, overview }: { jobs: JobSummary[]; overview: AdminOverview | null }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat icon={<Activity className="size-4" />} label="Waiting" value={String(overview?.queue.waiting ?? 0)} />
        <Stat icon={<Cpu className="size-4" />} label="Running" value={String(overview?.queue.active ?? 0)} />
        <Stat icon={<Activity className="size-4" />} label="Completed" value={String(overview?.queue.completed ?? 0)} />
        <Stat icon={<AlertTriangle className="size-4" />} label="Failed" value={String(overview?.queue.failed ?? 0)} />
      </div>

      {jobs.length === 0 ? (
        <EmptyState icon={<Cpu className="size-5" />} title="The queue is empty" />
      ) : (
        <ul className="divide-y divide-line rounded-panel border border-line">
          {jobs.map((job) => (
            <li key={job.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{job.project?.name ?? job.id}</p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {job.engine} · {job.outputHeight}p · {job.stage}
                </p>
              </div>
              <span className="font-mono text-xs tabular-nums">{job.progress}%</span>
              <Badge tone={job.status === 'failed' ? 'danger' : 'brand'}>{job.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModerationTab({
  flags,
  setFlags,
}: {
  flags: ModerationFlagRow[];
  setFlags: (flags: ModerationFlagRow[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const review = async (id: string, decision: 'uphold' | 'overturn') => {
    setBusy(id);
    try {
      await api.admin.review(id, decision);
      setFlags(flags.filter((flag) => flag.id !== id));
    } finally {
      setBusy(null);
    }
  };

  if (flags.length === 0) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-5" />}
        title="Nothing waiting for review"
        description="Automated checks route anything uncertain here. An empty queue means nothing has been flagged."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {flags.map((flag) => (
        <Card key={flag.id}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={flag.action === 'block' ? 'danger' : 'warning'}>{flag.action}</Badge>
                <span className="text-xs text-ink-subtle">
                  {new Date(flag.createdAt).toLocaleString()}
                </span>
              </div>

              <p className="text-sm font-medium">
                {flag.asset?.filename ?? flag.job?.id ?? 'Unknown target'}
              </p>

              <ul className="mt-3 space-y-1.5">
                {flag.signals.map((signal, index) => {
                  const meta =
                    MODERATION_CATEGORY_LABELS[
                      signal.category as keyof typeof MODERATION_CATEGORY_LABELS
                    ];
                  return (
                    <li key={index} className="flex items-center gap-3 text-xs">
                      <span className="w-40 shrink-0 text-ink-muted">
                        {meta?.name ?? signal.category}
                      </span>
                      <span className="h-1 w-24 overflow-hidden rounded-full bg-line">
                        <span
                          className="block h-full rounded-full bg-danger"
                          style={{ width: `${signal.score * 100}%` }}
                        />
                      </span>
                      <span className="font-mono tabular-nums text-ink-subtle">
                        {Math.round(signal.score * 100)}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={busy === flag.id}
                onClick={() => void review(flag.id, 'overturn')}
              >
                Allow
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={busy === flag.id}
                onClick={() => void review(flag.id, 'uphold')}
              >
                Uphold block
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </ul>
  );
}
