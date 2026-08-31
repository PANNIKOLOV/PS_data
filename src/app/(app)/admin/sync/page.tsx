import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { createClient } from '@/lib/supabase/server';
import { describeCadence, schedulerHealth, type SchedulerHealth } from '@/lib/sync-schedule';
import { formatNumber, formatRelativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Sync history' };

export default async function SyncHistoryPage() {
  const supabase = await createClient();

  const [{ data: runs }, { data: ticks }, { data: shops }, { data: profiles }] = await Promise.all([
    supabase.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(60),
    supabase
      .from('scheduler_runs')
      .select('*')
      .order('ran_at', { ascending: false })
      .limit(40),
    supabase.from('shops').select('id, name, is_active, sync_interval_minutes, last_sync_at'),
    // Admins can read every profile, so this resolves whoever pressed "sync
    // now" — useful for seeing which marketer is using up a shop's allowance.
    supabase.from('profiles').select('id, full_name, email'),
  ]);

  const shopNames = new Map((shops ?? []).map((shop) => [shop.id, shop.name]));
  const userNames = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.full_name?.trim() || profile.email]),
  );

  const health = schedulerHealth(ticks ?? []);
  const scheduled = (shops ?? []).filter(
    (shop) => shop.is_active && shop.sync_interval_minutes > 0,
  );

  return (
    <>
      <PageHeader
        title="Sync history"
        description="Whether the scheduler is running, and what each run collected."
      />

      <SchedulerStatus health={health} scheduledShops={scheduled.length} />

      <Card className="mt-4">
        <CardHeader
          title="Scheduler ticks"
          description="Every call to the sync endpoint, including ones with nothing due. Kept for 30 days."
        />
        {(ticks ?? []).length === 0 ? (
          <EmptyState
            icon={<Clock className="h-5 w-5" aria-hidden />}
            title="The scheduler has never run"
            description="Nothing has called the sync endpoint yet. Set SYNC_CRON_SECRET on the server and add the cron job, then check back after the next tick."
          />
        ) : (
          <CardBody className="p-0 sm:p-0">
            <div className="scroll-x">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left">
                    <Th className="px-5">When</Th>
                    <Th>Shops checked</Th>
                    <Th>Due</Th>
                    <Th>Synced</Th>
                    <Th>Took</Th>
                    <Th className="px-5">Result</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {(ticks ?? []).map((tick) => (
                    <tr key={tick.id} className="align-top transition-colors hover:bg-surface-hover">
                      <td className="px-5 py-2.5 text-xs text-content-secondary">
                        {formatRelativeTime(tick.ran_at)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-xs text-content-secondary">
                        {formatNumber(tick.shops_considered)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-xs text-content-secondary">
                        {formatNumber(tick.shops_due)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-xs text-content-secondary">
                        {formatNumber(tick.shops_synced)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-xs text-content-secondary">
                        {tick.duration_ms === null ? '—' : `${(tick.duration_ms / 1000).toFixed(1)}s`}
                      </td>
                      <td className="px-5 py-2.5">
                        {tick.shops_failed > 0 || tick.error_message ? (
                          <div className="space-y-1">
                            <Badge tone="negative">
                              {tick.shops_failed > 0
                                ? `${tick.shops_failed} failed`
                                : 'Run failed'}
                            </Badge>
                            {tick.error_message ? (
                              <p className="max-w-md text-xs break-words text-negative">
                                {tick.error_message}
                              </p>
                            ) : null}
                          </div>
                        ) : tick.shops_due === 0 ? (
                          <Badge tone="neutral">Nothing due</Badge>
                        ) : (
                          <Badge tone="positive">Synced {tick.shops_synced}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Sync runs"
          description="The 60 most recent runs across every shop, scheduled and manual."
        />
        {(runs ?? []).length === 0 ? (
          <EmptyState
            icon={<RefreshCw className="h-5 w-5" aria-hidden />}
            title="Nothing has synced yet"
            description="Trigger a sync from a shop's settings page to import its order history."
          />
        ) : (
          <CardBody className="p-0 sm:p-0">
            <div className="scroll-x">
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left">
                    <Th className="px-5">Shop</Th>
                    <Th>Started</Th>
                    <Th>Trigger</Th>
                    <Th>Started by</Th>
                    <Th>Orders</Th>
                    <Th>Customers</Th>
                    <Th>Took</Th>
                    <Th className="px-5">Result</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {(runs ?? []).map((run) => (
                    <tr key={run.id} className="align-top transition-colors hover:bg-surface-hover">
                      <td className="px-5 py-2.5">
                        <Link
                          href={`/admin/shops/${run.shop_id}`}
                          className="text-xs font-medium text-accent-text hover:underline"
                        >
                          {shopNames.get(run.shop_id) ?? 'Deleted shop'}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-content-secondary">
                        {formatRelativeTime(run.started_at)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-content-secondary capitalize">
                        {run.trigger_source}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-content-secondary">
                        {run.triggered_by ? (
                          (userNames.get(run.triggered_by) ?? 'Removed account')
                        ) : (
                          <span className="text-content-muted">Scheduler</span>
                        )}
                      </td>
                      <td className="tabular px-4 py-2.5 text-xs text-content-secondary">
                        {formatNumber(run.orders_synced)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-xs text-content-secondary">
                        {formatNumber(run.customers_synced)}
                      </td>
                      <td className="tabular px-4 py-2.5 text-xs text-content-secondary">
                        {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="space-y-1">
                          {run.status === 'success' ? (
                            <Badge tone="positive">Success</Badge>
                          ) : run.status === 'partial' ? (
                            <Badge tone="warning">Partial</Badge>
                          ) : run.status === 'failed' ? (
                            <Badge tone="negative">Failed</Badge>
                          ) : (
                            <Badge tone="accent">Running</Badge>
                          )}
                          {/*
                            Shown in full rather than as a tooltip: the message
                            is the whole reason to open this page after a failure,
                            and a tooltip is invisible on a touch screen.
                          */}
                          {run.error_message ? (
                            <p
                              className={`max-w-md text-xs break-words ${
                                run.status === 'failed' ? 'text-negative' : 'text-warning'
                              }`}
                            >
                              {run.error_message}
                            </p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        )}
      </Card>
    </>
  );
}

/** The one figure an admin came here for: is the cron job alive? */
function SchedulerStatus({
  health,
  scheduledShops,
}: {
  health: SchedulerHealth;
  scheduledShops: number;
}) {
  const tone =
    health.state === 'healthy'
      ? { wrap: 'border-positive/30 bg-positive-soft', text: 'text-positive' }
      : { wrap: 'border-negative/30 bg-negative-soft', text: 'text-negative' };

  const Icon =
    health.state === 'healthy' ? CheckCircle2 : health.state === 'never' ? Clock : AlertTriangle;

  const headline =
    health.state === 'healthy'
      ? `Scheduler ran ${formatRelativeTime(health.lastRanAt)}`
      : health.state === 'stale'
        ? `Scheduler last ran ${formatRelativeTime(health.lastRanAt)}`
        : 'Scheduler has never run';

  return (
    <div className={`rounded-(--radius-card) border px-4 py-3.5 ${tone.wrap}`}>
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-4.5 w-4.5 shrink-0 ${tone.text}`} aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className={`text-sm font-semibold ${tone.text}`}>{headline}</p>

          {health.state === 'never' ? (
            <div className="space-y-1.5 text-xs text-content-secondary">
              <p>
                Nothing has called the sync endpoint. Shops will only update when someone presses
                Sync now.
              </p>
              <p>
                Set <code className="font-mono">SYNC_CRON_SECRET</code> in the server environment,
                restart the app, then add a cron job posting to{' '}
                <code className="font-mono break-all">/api/cron/sync</code> with that secret as a
                bearer token. A 401 back from the endpoint means the two values do not match.
              </p>
            </div>
          ) : (
            <p className="text-xs text-content-secondary">
              {health.ticksLastDay} {health.ticksLastDay === 1 ? 'tick' : 'ticks'} in the last 24
              hours
              {health.cadenceMinutes
                ? ` · about ${describeCadence(health.cadenceMinutes).toLowerCase()}`
                : ''}{' '}
              · {scheduledShops} {scheduledShops === 1 ? 'shop is' : 'shops are'} on a schedule
            </p>
          )}

          {health.state === 'stale' ? (
            <p className="text-xs text-content-secondary">
              The cron job has stopped calling the endpoint, or is now failing. Check it still
              exists in your hosting panel and that the secret it sends still matches the one in the
              app.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`py-3 text-xs font-medium text-content-muted ${className || 'px-4'}`}
    >
      {children}
    </th>
  );
}
