import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

import {
  ConnectionTester,
  DeleteShopControl,
  SyncControls,
} from '@/app/(app)/admin/shops/shop-actions';
import { ShopForm } from '@/app/(app)/admin/shops/shop-form';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { createClient } from '@/lib/supabase/server';
import { formatNumber, formatRelativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Shop settings' };

export default async function AdminShopDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const [{ shopId }, { created }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const { data: shop } = await supabase.from('shops').select('*').eq('id', shopId).single();
  if (!shop) notFound();

  const [{ data: runs }, { data: assignments }] = await Promise.all([
    supabase
      .from('sync_runs')
      .select('*')
      .eq('shop_id', shopId)
      .order('started_at', { ascending: false })
      .limit(8),
    supabase.from('shop_assignments').select('user_id, metrics').eq('shop_id', shopId),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/admin/shops"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-content-muted transition-colors hover:text-content-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Manage shops
      </Link>

      <PageHeader
        title={shop.name}
        description={`Last synced ${formatRelativeTime(shop.last_sync_at)} · ${(assignments ?? []).length} marketer assignment${(assignments ?? []).length === 1 ? '' : 's'}`}
        actions={
          <Link
            href={`/shops/${shop.id}`}
            className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3.5 text-xs font-medium text-content-primary transition-colors hover:bg-surface-hover"
          >
            View analytics
          </Link>
        }
      />

      {created ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-positive-soft px-3.5 py-2.5 text-xs text-positive">
          <CheckCircle2 className="mt-px h-4 w-4 shrink-0" aria-hidden />
          <span>
            Shop connected. Run a full sync below to import its order history, then assign it to a
            marketer under Users &amp; access.
          </span>
        </div>
      ) : null}

      {shop.last_sync_status === 'failed' && shop.last_sync_error ? (
        <div className="mb-4 rounded-lg bg-negative-soft px-3.5 py-2.5 text-xs text-negative">
          <span className="font-medium">Last sync failed:</span> {shop.last_sync_error}
        </div>
      ) : null}

      <div className="space-y-4">
        <Card>
          <CardHeader title="Connection" description="Verify the shop is reachable and import data" />
          <CardBody className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <ConnectionTester shopId={shop.id} />
            <SyncControls shopId={shop.id} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Settings" />
          <CardBody>
            <ShopForm shop={shop} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent syncs" description="The eight most recent runs" />
          <CardBody className="p-0 sm:p-0">
            {(runs ?? []).length === 0 ? (
              <EmptyState
                title="No syncs yet"
                description="Run a full sync above to import this shop's order history."
              />
            ) : (
              <div className="scroll-x">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-left">
                      <th scope="col" className="px-5 py-2.5 text-xs font-medium text-content-muted">
                        Started
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-xs font-medium text-content-muted">
                        Trigger
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-xs font-medium text-content-muted">
                        Records
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-xs font-medium text-content-muted">
                        Duration
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-xs font-medium text-content-muted">
                        Result
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {(runs ?? []).map((run) => (
                      <tr key={run.id}>
                        <td className="px-5 py-2.5 text-xs text-content-secondary">
                          {formatRelativeTime(run.started_at)}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-content-secondary capitalize">
                          {run.trigger_source}
                        </td>
                        <td className="tabular px-4 py-2.5 text-xs text-content-secondary">
                          {formatNumber(run.orders_synced)} orders ·{' '}
                          {formatNumber(run.customers_synced)} customers
                        </td>
                        <td className="tabular px-4 py-2.5 text-xs text-content-secondary">
                          {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
                        </td>
                        <td className="px-5 py-2.5">
                          {run.status === 'success' ? (
                            <Badge tone="positive">Success</Badge>
                          ) : run.status === 'partial' ? (
                            <Badge tone="warning" title={run.error_message ?? undefined}>
                              Partial
                            </Badge>
                          ) : run.status === 'failed' ? (
                            <Badge tone="negative" title={run.error_message ?? undefined}>
                              Failed
                            </Badge>
                          ) : (
                            <Badge tone="accent">Running</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="border-negative/25">
          <CardHeader title="Danger zone" description="These actions cannot be undone" />
          <CardBody>
            <DeleteShopControl shopId={shop.id} shopName={shop.name} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
