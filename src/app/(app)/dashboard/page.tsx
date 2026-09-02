import type { Metadata } from 'next';
import Link from 'next/link';
import { CreditCard, Package, Receipt, Store, TrendingUp, UserPlus, Users } from 'lucide-react';

import { PeriodFilter } from '@/components/analytics/period-filter';
import { BreakdownBars, BreakdownChart } from '@/components/charts/breakdown-chart';
import { DualTrendChart } from '@/components/charts/trend-chart';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, RestrictedState } from '@/components/ui/states';
import { StatTile } from '@/components/ui/stat-tile';
import { percentageChange } from '@/lib/analytics/periods';
import {
  fetchCustomerMix,
  fetchPaymentBreakdown,
  fetchShopTotals,
  fetchStatusBreakdown,
  fetchSummary,
  fetchTimeseries,
  getViewerContext,
} from '@/lib/analytics/queries';
import { parseDashboardParams, type RawSearchParams } from '@/lib/analytics/search-params';
import { canViewMetricForAny, shopsAllowingMetric } from '@/lib/permissions';
import { formatCurrency, formatNumber } from '@/lib/utils';

export const metadata: Metadata = { title: 'Overview' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const { shops, permissions } = await getViewerContext();

  if (shops.length === 0) {
    return (
      <>
        <PageHeader title="Overview" />
        <Card>
          <EmptyState
            icon={<Store className="h-5 w-5" aria-hidden />}
            title="No shops are available to you yet"
            description={
              permissions.role === 'admin'
                ? 'Connect your first PrestaShop store to start collecting figures.'
                : 'An administrator needs to assign you a shop before any data appears here.'
            }
            action={
              permissions.role === 'admin' ? (
                <Link
                  href="/admin/shops/new"
                  className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
                >
                  Connect a shop
                </Link>
              ) : null
            }
          />
        </Card>
      </>
    );
  }

  // Cross-shop figures are reported in the timezone of the first shop; a mixed
  // selection is flagged below so the reader knows which clock applies.
  const primaryShop = shops[0]!;
  const shopIds = shops.map((shop) => shop.id);
  const params = parseDashboardParams(raw, shopIds, primaryShop.timezone);
  const selected = params.selectedShopIds;

  const currencies = new Set(
    shops.filter((shop) => selected.includes(shop.id)).map((shop) => shop.currency_code),
  );
  const displayCurrency = currencies.size === 1 ? [...currencies][0]! : primaryShop.currency_code;

  const canSee = (metric: Parameters<typeof canViewMetricForAny>[2]) =>
    canViewMetricForAny(permissions, selected, metric);

  // Each metric is queried only across the shops that permit it, so a withheld
  // figure never contributes to a total the viewer is allowed to see.
  const revenueShops = shopsAllowingMetric(permissions, selected, 'revenue');
  const ordersShops = shopsAllowingMetric(permissions, selected, 'orders');
  const trendShops = shopsAllowingMetric(permissions, selected, 'trends');

  const [current, previous, timeseries, statusRows, paymentRows, mixRows, shopTotals] =
    await Promise.all([
      fetchSummary(selected, params.period, params.onlyValid),
      fetchSummary(selected, params.period.previous, params.onlyValid),
      trendShops.length > 0
        ? fetchTimeseries(
            trendShops,
            params.period,
            params.granularity,
            primaryShop.timezone,
            params.onlyValid,
          )
        : Promise.resolve([]),
      fetchStatusBreakdown(permissions, selected, params.period),
      fetchPaymentBreakdown(permissions, selected, params.period, params.onlyValid),
      fetchCustomerMix(permissions, selected, params.period, params.onlyValid),
      fetchShopTotals(selected, params.period, params.onlyValid),
    ]);

  const mixedCurrencies = currencies.size > 1;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${params.period.label} · ${selected.length} ${selected.length === 1 ? 'shop' : 'shops'}`}
        actions={
          <PeriodFilter
            preset={params.period.preset}
            granularity={params.granularity}
            allowedGranularities={params.granularityOptions}
            onlyValid={params.onlyValid}
            rangeStart={params.rangeStart}
            rangeEnd={params.rangeEnd}
          />
        }
      />

      {mixedCurrencies ? (
        <div className="mb-4 rounded-lg bg-warning-soft px-3.5 py-2.5 text-xs text-warning">
          The selected shops report in different currencies ({[...currencies].join(', ')}). Totals
          below add the raw amounts together without conversion — compare shops individually for an
          accurate reading.
        </div>
      ) : null}

      <section
        aria-label="Headline figures"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {canSee('revenue') && revenueShops.length > 0 ? (
          <StatTile
            label="Revenue"
            value={formatCurrency(current.revenue, displayCurrency)}
            change={percentageChange(current.revenue, previous.revenue)}
            icon={TrendingUp}
          />
        ) : null}

        {canSee('orders') && ordersShops.length > 0 ? (
          <StatTile
            label="Orders"
            value={formatNumber(current.ordersCount)}
            change={percentageChange(current.ordersCount, previous.ordersCount)}
            icon={Package}
          />
        ) : null}

        {canSee('aov') ? (
          <StatTile
            label="Average order value"
            value={formatCurrency(current.averageOrderValue, displayCurrency)}
            change={percentageChange(current.averageOrderValue, previous.averageOrderValue)}
            icon={Receipt}
          />
        ) : null}

        {canSee('customers') ? (
          <StatTile
            label="Registered customers"
            value={formatNumber(current.newRegistrations)}
            change={percentageChange(current.newRegistrations, previous.newRegistrations)}
            icon={UserPlus}
          />
        ) : null}
      </section>

      {canSee('trends') ? (
        <Card className="mt-4">
          <CardHeader
            title="Revenue and orders"
            description={`Grouped by ${params.granularity} · ${primaryShop.timezone}`}
          />
          <CardBody>
            {timeseries.length > 0 ? (
              <DualTrendChart
                data={timeseries}
                granularity={params.granularity}
                timezone={primaryShop.timezone}
                currency={displayCurrency}
              />
            ) : (
              <EmptyState
                title="No activity in this period"
                description="Try a wider date range, or run a sync if this shop was connected recently."
              />
            )}
          </CardBody>
        </Card>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Order statuses" description="Where orders sit in the workflow" />
          <CardBody>
            {!canSee('status_breakdown') ? (
              <RestrictedState title="Order status breakdown" />
            ) : statusRows.length > 0 ? (
              <BreakdownChart rows={statusRows} currency={displayCurrency} />
            ) : (
              <EmptyState title="No orders in this period" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Payment methods" description="Modules customers checked out with" />
          <CardBody>
            {!canSee('payment_methods') ? (
              <RestrictedState title="Payment method breakdown" />
            ) : paymentRows.length > 0 ? (
              <BreakdownBars rows={paymentRows} currency={displayCurrency} />
            ) : (
              <EmptyState title="No orders in this period" />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="New vs returning" description="Orders by buyer history" />
          <CardBody>
            {!canSee('returning') ? (
              <RestrictedState title="New versus returning" />
            ) : mixRows.length > 0 ? (
              <BreakdownChart rows={mixRows} currency={displayCurrency} />
            ) : (
              <EmptyState title="No orders in this period" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Shops"
            description="Ranked by revenue over the selected period"
            action={
              <Link href="/shops" className="text-xs font-medium text-accent-text hover:underline">
                View all
              </Link>
            }
          />
          <CardBody className="p-0 sm:p-0">
            {shopTotals.length > 0 ? (
              <ul className="divide-y divide-border-subtle">
                {shopTotals.map((row) => (
                  <li key={row.shopId}>
                    <Link
                      href={`/shops/${row.shopId}?period=${params.period.preset}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover sm:px-5"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-inset text-content-muted">
                        <Store className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-content-primary">
                          {row.shopName}
                        </span>
                        <span className="tabular block text-xs text-content-muted">
                          {formatNumber(row.ordersCount)} orders ·{' '}
                          {formatNumber(row.newRegistrations)} new customers
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-sm font-semibold text-content-primary">
                        {formatCurrency(row.revenue, row.currencyCode, { compact: true })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No shop activity in this period" />
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Period detail"
          description="Every figure below covers the selected period"
        />
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Figure
              label="Unique buyers"
              value={formatNumber(current.uniqueCustomers)}
              icon={<Users className="h-3.5 w-3.5" aria-hidden />}
            />
            <Figure
              label="Product value"
              value={formatCurrency(current.itemsTotal, displayCurrency, { compact: true })}
            />
            <Figure
              label="Shipping"
              value={formatCurrency(current.shippingTotal, displayCurrency, { compact: true })}
            />
            <Figure
              label="Discounts"
              value={formatCurrency(current.discountsTotal, displayCurrency, { compact: true })}
              icon={<CreditCard className="h-3.5 w-3.5" aria-hidden />}
            />
            <Figure
              label="Orders per buyer"
              value={
                current.uniqueCustomers > 0
                  ? (current.ordersCount / current.uniqueCustomers).toFixed(2)
                  : '—'
              }
            />
          </dl>
        </CardBody>
      </Card>

      {permissions.role === 'marketer' ? (
        <p className="mt-4 text-center text-xs text-content-muted">
          <Badge tone="neutral">Marketer view</Badge>{' '}
          <span className="ml-1">
            You are seeing the shops and figures an administrator has shared with you.
          </span>
        </p>
      ) : null}
    </>
  );
}

function Figure({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-content-muted">
        {icon}
        {label}
      </dt>
      <dd className="tabular mt-1 text-base font-semibold text-content-primary">{value}</dd>
    </div>
  );
}
