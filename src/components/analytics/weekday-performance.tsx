'use client';

import { useChartColors } from '@/components/charts/use-chart-colors';
import type { WeekdayPerformance } from '@/lib/analytics/insights';
import { formatCurrency, formatNumber } from '@/lib/utils';

/**
 * Which days of the week the shop actually trades on.
 *
 * Bars are scaled by average revenue per occurrence rather than by total, so a
 * period containing five Mondays and four Tuesdays does not make Monday look
 * stronger than it is.
 */
export function WeekdayPerformanceChart({
  rows,
  currency,
}: {
  rows: WeekdayPerformance[];
  currency: string;
}) {
  const colors = useChartColors();
  const max = Math.max(...rows.map((row) => row.averageRevenue), 1);
  const best = rows.reduce((a, b) => (b.averageRevenue > a.averageRevenue ? b : a), rows[0]!);

  return (
    <div className="space-y-2.5">
      {rows.map((row, index) => {
        const isBest = row.label === best.label && row.averageRevenue > 0;
        return (
          <div key={row.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span
                className={
                  isBest
                    ? 'font-semibold text-content-primary'
                    : 'font-medium text-content-secondary'
                }
              >
                {row.label}
                {isBest ? <span className="ml-1.5 text-accent-text">best</span> : null}
              </span>
              <span className="tabular text-content-muted">
                {formatCurrency(row.averageRevenue, currency, { compact: true })} avg ·{' '}
                {formatNumber(row.orders)} orders
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-inset">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max((row.averageRevenue / max) * 100, row.averageRevenue > 0 ? 2 : 0)}%`,
                  backgroundColor: isBest
                    ? colors.series[0]
                    : colors.series[(index % 7) + 1] ?? colors.series[1],
                }}
              />
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-xs text-content-muted">
        Averaged per occurrence of each weekday in the period.
      </p>
    </div>
  );
}
