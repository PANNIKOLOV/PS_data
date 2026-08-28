import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package, Receipt, TrendingUp, UserPlus } from 'lucide-react';

import { PeriodFilter } from '@/components/analytics/period-filter';
import { ExportButton } from '@/components/analytics/export-button';
import { BreakdownBars, BreakdownChart } from '@/components/charts/breakdown-chart';
import { TrendChart } from '@/components/charts/trend-chart';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, RestrictedState } from '@/components/ui/states';
import { StatTile } from '@/components/ui/stat-tile';
import { percentageChange } from '@/lib/analytics/periods';
import {
  fetchCustomerMix,
  fetchPaymentBreakdown,
  fetchStatusBreakdown,
  fetchSummary,
  fetchTimeseries,
  getViewerContext,
} from '@/lib/analytics/queries';
import { parseDashboardParams, type RawSearchParams } from '@/lib/analytics/search-params';
import { canViewMetric } from '@/lib/permissions';
import { formatCurrency, formatNumber, formatRelativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Shop analytics' };

export default async function ShopDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopId: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const [{ shopId }, raw] = await Promise.all([params, searchParams]);
  const { shops, permissions } = await getViewerContext();

  // RLS keeps unassigned shops out of this list, so a miss is a genuine 404
  // whether the shop does not exist or the viewer may not see it.
  const shop = shops.find((candidate) => candidate.id === shopId);
  if (!shop) notFound();

  const view = parseDashboardParams(raw, [shop.id], shop.timezone);
  const scope = [shop.id];
  const can = (metric: Parameters<typeof canViewMetric>[2]) =>
    canViewMetric(permissions, shop.id, metric);

  const [current, previous, timeseries, statusRows, paymentRows, mixRows] = await Promise.all([
    fetchSummary(scope, view.period, view.onlyValid),
    fetchSummary(scope, view.period.previous, view.onlyValid),
    can('trends')
      ? fetchTimeseries(scope, view.period, view.granularity, shop.timezone, view.onlyValid)
      : Promise.resolve([]),
    fetchStatusBreakdown(permissions, scope, view.period),
    fetchPaymentBreakdown(permissions, scope, view.period, view.onlyValid),
    fetchCustomerMix(permissions, scope, view.period, view.onlyValid),
  ]);

  const currency = shop.currency_code;

  return (
    <>
      <Link
        href="/shops"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-content-muted transition-colors hover:text-content-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        All shops
      </Link>

      <PageHeader
        title={shop.name}
        description={`${view.period.label} · ${shop.timezone} · synced ${formatRelativeTime(shop.last_sync_at)}`}
        actions={
          <>
            <PeriodFilter
              preset={view.period.preset}
              granularity={view.granularity}
              allowedGranularities={view.granularityOptions}
              onlyValid={view.onlyValid}
            />
            {can('export') ? (
              <ExportButton
                shopName={shop.name}
                periodLabel={view.period.label}
                granularity={view.granularity}
                currency={currency}
                timezone={shop.timezone}
                summary={current}
                timeseries={timeseries}
                statusRows={can('status_breakdown') ? statusRows : []}
                paymentRows={can('payment_methods') ? paymentRows : []}
              />
            ) : null}
          </>
        }
      />

      <section
        aria-label="Headline figures"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {can('revenue') ? (
          <StatTile
            label="Revenue"
            value={formatCurrency(current.revenue, currency)}
            change={percentageChange(current.revenue, previous.revenue)}
            icon={TrendingUp}
          />
        ) : null}
        {can('orders') ? (
          <StatTile
            label="Orders"
            value={formatNumber(current.ordersCount)}
            change={percentageChange(current.ordersCount, previous.ordersCount)}
            icon={Package}
          />
        ) : null}
        {can('aov') ? (
          <StatTile
            label="Average order value"
            value={formatCurrency(current.averageOrderValue, currency)}
            change={percentageChange(current.averageOrderValue, previous.averageOrderValue)}
            icon={Receipt}
          />
        ) : null}
        {can('customers') ? (
          <StatTile
            label="Registered customers"
            value={formatNumber(current.newRegistrations)}
            change={percentageChange(current.newRegistrations, previous.newRegistrations)}
            icon={UserPlus}
          />
        ) : null}
      </section>

      {can('trends') ? (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Revenue" description={`Grouped by ${view.granularity}`} />
            <CardBody>
              {timeseries.length > 0 ? (
                <TrendChart
                  data={timeseries}
                  metric="revenue"
                  granularity={view.granularity}
                  timezone={shop.timezone}
                  currency={currency}
                />
              ) : (
                <EmptyState title="No activity in this period" />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Orders" description={`Grouped by ${view.granularity}`} />
            <CardBody>
              {timeseries.length > 0 ? (
                <TrendChart
                  data={timeseries}
                  metric="orders"
                  granularity={view.granularity}
                  timezone={shop.timezone}
                  currency={currency}
                  variant="bar"
                />
              ) : (
                <EmptyState title="No activity in this period" />
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {can('customers') && can('trends') ? (
        <Card className="mt-4">
          <CardHeader
            title="Customer registrations"
            description="New accounts created in the period"
          />
          <CardBody>
            {timeseries.length > 0 ? (
              <TrendChart
                data={timeseries}
                metric="registrations"
                granularity={view.granularity}
                timezone={shop.timezone}
                currency={currency}
                variant="bar"
              />
            ) : (
              <EmptyState title="No registrations in this period" />
            )}
          </CardBody>
        </Card>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Order statuses" />
          <CardBody>
            {!can('status_breakdown') ? (
              <RestrictedState title="Order status breakdown" />
            ) : statusRows.length > 0 ? (
              <BreakdownChart rows={statusRows} currency={currency} />
            ) : (
              <EmptyState title="No orders in this period" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Payment methods" />
          <CardBody>
            {!can('payment_methods') ? (
              <RestrictedState title="Payment method breakdown" />
            ) : paymentRows.length > 0 ? (
              <BreakdownBars rows={paymentRows} currency={currency} />
            ) : (
              <EmptyState title="No orders in this period" />
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="New vs returning" description="Orders split by buyer history" />
        <CardBody>
          {!can('returning') ? (
            <RestrictedState title="New versus returning" />
          ) : mixRows.length > 0 ? (
            <BreakdownChart rows={mixRows} currency={currency} />
          ) : (
            <EmptyState title="No orders in this period" />
          )}
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Shop details" />
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-content-muted">PrestaShop version</dt>
              <dd className="mt-1 font-medium text-content-primary">
                {shop.detected_version ? (
                  <Badge tone="accent">{shop.detected_version}</Badge>
                ) : (
                  <Badge tone="neutral">{shop.ps_version}.x (declared)</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-content-muted">Currency</dt>
              <dd className="mt-1 font-medium text-content-primary">{shop.currency_code}</dd>
            </div>
            <div>
              <dt className="text-xs text-content-muted">Timezone</dt>
              <dd className="mt-1 font-medium text-content-primary">{shop.timezone}</dd>
            </div>
            <div>
              <dt className="text-xs text-content-muted">Unique buyers</dt>
              <dd className="tabular mt-1 font-medium text-content-primary">
                {formatNumber(current.uniqueCustomers)}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </>
  );
}
