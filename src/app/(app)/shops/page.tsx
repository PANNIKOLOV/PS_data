import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Store } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { resolvePeriod } from '@/lib/analytics/periods';
import { fetchShopTotals, getViewerContext } from '@/lib/analytics/queries';
import { formatCurrency, formatNumber, formatRelativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Shops' };

export default async function ShopsPage() {
  const { shops, permissions } = await getViewerContext();

  if (shops.length === 0) {
    return (
      <>
        <PageHeader title="Shops" />
        <Card>
          <EmptyState
            icon={<Store className="h-5 w-5" aria-hidden />}
            title="No shops available"
            description={
              permissions.role === 'admin'
                ? 'Connect a PrestaShop store from the admin panel to get started.'
                : 'An administrator has not assigned you a shop yet.'
            }
          />
        </Card>
      </>
    );
  }

  const period = resolvePeriod('last_30_days', shops[0]!.timezone);
  const totals = await fetchShopTotals(
    shops.map((shop) => shop.id),
    period,
    false,
  );
  const totalsById = new Map(totals.map((row) => [row.shopId, row]));

  return (
    <>
      <PageHeader
        title="Shops"
        description={`${shops.length} ${shops.length === 1 ? 'shop' : 'shops'} available to you · figures cover the last 30 days`}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shops.map((shop) => {
          const row = totalsById.get(shop.id);

          return (
            <Link key={shop.id} href={`/shops/${shop.id}`} className="group">
              <Card className="h-full transition-shadow group-hover:raised-shadow">
                <CardBody className="flex h-full flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                        <Store className="h-4.5 w-4.5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-content-primary">
                          {shop.name}
                        </p>
                        <p className="truncate text-xs text-content-muted">
                          {new URL(shop.base_url).hostname}
                        </p>
                      </div>
                    </div>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-content-muted transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </div>

                  <dl className="mt-4 grid grid-cols-3 gap-2">
                    <div>
                      <dt className="text-xs text-content-muted">Revenue</dt>
                      <dd className="tabular mt-0.5 text-sm font-semibold text-content-primary">
                        {formatCurrency(row?.revenue ?? 0, shop.currency_code, { compact: true })}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-muted">Orders</dt>
                      <dd className="tabular mt-0.5 text-sm font-semibold text-content-primary">
                        {formatNumber(row?.ordersCount ?? 0)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-muted">New</dt>
                      <dd className="tabular mt-0.5 text-sm font-semibold text-content-primary">
                        {formatNumber(row?.newRegistrations ?? 0)}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                    <span className="text-xs text-content-muted">
                      Synced {formatRelativeTime(shop.last_sync_at)}
                    </span>
                    <SyncBadge status={shop.last_sync_status} isActive={shop.is_active} />
                  </div>
                </CardBody>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function SyncBadge({
  status,
  isActive,
}: {
  status: string | null;
  isActive: boolean;
}) {
  if (!isActive) return <Badge tone="neutral">Paused</Badge>;

  switch (status) {
    case 'success':
      return <Badge tone="positive">Synced</Badge>;
    case 'partial':
      return <Badge tone="warning">Partial</Badge>;
    case 'failed':
      return <Badge tone="negative">Failed</Badge>;
    case 'running':
      return <Badge tone="accent">Syncing</Badge>;
    default:
      return <Badge tone="neutral">Never synced</Badge>;
  }
}
