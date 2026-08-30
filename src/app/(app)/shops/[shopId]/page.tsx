import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package, Receipt, TrendingUp, UserPlus } from 'lucide-react';

import { PeriodFilter } from '@/components/analytics/period-filter';
import { ExportButton } from '@/components/analytics/export-button';
import { OrdersTable } from '@/components/analytics/orders-table';
import { WeekdayPerformanceChart } from '@/components/analytics/weekday-performance';
import { ComparisonChart } from '@/components/charts/comparison-chart';
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
  fetchRecentOrders,
  fetchStatusBreakdown,
  fetchSummary,
  fetchTimeseries,
  getViewerContext,
} from '@/lib/analytics/queries';
import { concentration, periodShape, weekdayPerformance } from '@/lib/analytics/insights';
import { parseDashboardParams, type RawSearchParams } from '@/lib/analytics/search-params';
import { canViewMetric } from '@/lib/permissions';
import { formatCurrency, formatNumber, formatRelativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Shop analytics' };

/** Daily buckets stop being useful — and start being expensive — beyond a year. */
function spansAtMostAYear(range: { from: Date; to: Date }): boolean {
  return range.to.getTime() - range.from.getTime() <= 400 * 86_400_000;
}

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

  const [
    current,
    previous,
    timeseries,
    previousSeries,
    dailySeries,
    statusRows,
    paymentRows,
    mixRows,
    recentOrders,
  ] = await Promise.all([
    fetchSummary(scope, view.period, view.onlyValid),
    fetchSummary(scope, view.period.previous, view.onlyValid),
    can('trends')
      ? fetchTimeseries(scope, view.period, view.granularity, shop.timezone, view.onlyValid)
      : Promise.resolve([]),
    // The preceding period, drawn behind the current one for comparison.
    can('trends')
      ? fetchTimeseries(
          scope,
          view.period.previous,
          view.granularity,
          shop.timezone,
          view.onlyValid,
        )
      : Promise.resolve([]),
    /*
     * Weekday and daily-shape figures need day buckets. When the viewer has
     * chosen a coarser grouping the chart series cannot answer them, so a day
     * series is fetched alongside — but only for spans where daily buckets stay
     * meaningful, to avoid pulling years of rows for a figure nobody reads.
     */
    can('trends') && spansAtMostAYear(view.period)
      ? fetchTimeseries(scope, view.period, 'day', shop.timezone, view.onlyValid)
      : Promise.resolve([]),
    fetchStatusBreakdown(permissions, scope, view.period),
    fetchPaymentBreakdown(permissions, scope, view.period, view.onlyValid),
    fetchCustomerMix(permissions, scope, view.period, view.onlyValid),
    can('orders') ? fetchRecentOrders(shop.id, view.period, view.onlyValid) : Promise.resolve([]),
  ]);

  const weekdays = weekdayPerformance(dailySeries, shop.timezone);
  const shape = periodShape(dailySeries);
  const paymentConcentration = concentration(paymentRows.map((row) => row.revenue));

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

      {can('trends') && shape.totalDays > 0 ? (
        <section
          aria-label="Trading pattern"
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          <Figure
            label="Best day"
            value={
              shape.bestDay
                ? formatCurrency(shape.bestDay.revenue, currency, { compact: true })
                : '—'
            }
            detail={
              shape.bestDay
                ? new Date(shape.bestDay.date).toLocaleDateString('en-GB', {
                    timeZone: shop.timezone,
                    day: 'numeric',
                    month: 'short',
                  })
                : 'No sales yet'
            }
          />
          <Figure
            label="Average day"
            value={formatCurrency(shape.averageDailyRevenue, currency, { compact: true })}
            detail={`${shape.averageDailyOrders.toFixed(1)} orders/day`}
          />
          <Figure
            label="Days with orders"
            value={`${shape.activeDays} of ${shape.totalDays}`}
            detail={`${Math.round((shape.activeDays / shape.totalDays) * 100)}% of the period`}
          />
          <Figure
            label="Top 3 payment methods"
            value={paymentConcentration > 0 ? `${Math.round(paymentConcentration)}%` : '—'}
            detail="share of revenue"
          />
        </section>
      ) : null}

      {can('trends') ? (
        <Card className="mt-4">
          <CardHeader
            title="Revenue vs previous period"
            description={`Grouped by ${view.granularity} · dashed line is the preceding ${view.period.label.toLowerCase()}`}
          />
          <CardBody>
            {timeseries.length > 0 ? (
              <ComparisonChart
                current={timeseries}
                previous={previousSeries}
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
      ) : null}

      {can('trends') ? (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Trading by weekday" description="Average revenue per weekday" />
            <CardBody>
              {dailySeries.length > 0 ? (
                <WeekdayPerformanceChart rows={weekdays} currency={currency} />
              ) : (
                <EmptyState
                  title="Not available for this range"
                  description="Weekday patterns are shown for periods up to about a year."
                />
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

      {can('orders') ? (
        <Card className="mt-4">
          <CardHeader
            title="Recent orders"
            description={`The ${recentOrders.length} most recent in this period · no customer details are stored`}
          />
          <CardBody className="p-0 sm:p-0">
            <OrdersTable orders={recentOrders} currency={currency} timezone={shop.timezone} />
          </CardBody>
        </Card>
      ) : null}

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

/** A compact labelled figure with a supporting line beneath it. */
function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-(--radius-card) border border-border-subtle bg-surface-card p-4 card-shadow">
      <p className="text-xs font-medium text-content-secondary">{label}</p>
      <p className="tabular mt-1.5 text-lg font-semibold tracking-tight text-content-primary">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-content-muted">{detail}</p>
    </div>
  );
}
