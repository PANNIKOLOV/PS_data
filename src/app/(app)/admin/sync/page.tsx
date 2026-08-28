import type { Metadata } from 'next';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { createClient } from '@/lib/supabase/server';
import { formatNumber, formatRelativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Sync history' };

export default async function SyncHistoryPage() {
  const supabase = await createClient();

  const [{ data: runs }, { data: shops }] = await Promise.all([
    supabase.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(60),
    supabase.from('shops').select('id, name'),
  ]);

  const shopNames = new Map((shops ?? []).map((shop) => [shop.id, shop.name]));

  return (
    <>
      <PageHeader
        title="Sync history"
        description="The 60 most recent synchronisation runs across every shop."
      />

      <Card>
        {(runs ?? []).length === 0 ? (
          <EmptyState
            icon={<RefreshCw className="h-5 w-5" aria-hidden />}
            title="Nothing has synced yet"
            description="Trigger a sync from a shop's settings page to import its order history."
          />
        ) : (
          <CardBody className="p-0 sm:p-0">
            <div className="scroll-x">
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left">
                    <th scope="col" className="px-5 py-3 text-xs font-medium text-content-muted">
                      Shop
                    </th>
                    <th scope="col" className="px-4 py-3 text-xs font-medium text-content-muted">
                      Started
                    </th>
                    <th scope="col" className="px-4 py-3 text-xs font-medium text-content-muted">
                      Trigger
                    </th>
                    <th scope="col" className="px-4 py-3 text-xs font-medium text-content-muted">
                      Orders
                    </th>
                    <th scope="col" className="px-4 py-3 text-xs font-medium text-content-muted">
                      Customers
                    </th>
                    <th scope="col" className="px-4 py-3 text-xs font-medium text-content-muted">
                      Duration
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-medium text-content-muted">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {(runs ?? []).map((run) => (
                    <tr key={run.id} className="transition-colors hover:bg-surface-hover">
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
          </CardBody>
        )}
      </Card>
    </>
  );
}
