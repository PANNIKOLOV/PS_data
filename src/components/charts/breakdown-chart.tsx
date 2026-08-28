'use client';

import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { useChartColors } from '@/components/charts/use-chart-colors';
import type { BreakdownRow } from '@/lib/analytics/queries';
import { formatCurrency, formatNumber } from '@/lib/utils';

/** Slices beyond this are folded into "Other" so the legend stays readable. */
const MAX_SLICES = 6;

export function BreakdownChart({
  rows,
  currency,
}: {
  rows: BreakdownRow[];
  currency: string;
}) {
  const colors = useChartColors();

  const { slices, total } = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b.ordersCount - a.ordersCount);
    const head = sorted.slice(0, MAX_SLICES);
    const tail = sorted.slice(MAX_SLICES);

    if (tail.length > 0) {
      head.push({
        label: `Other (${tail.length})`,
        ordersCount: tail.reduce((sum, row) => sum + row.ordersCount, 0),
        revenue: tail.reduce((sum, row) => sum + row.revenue, 0),
      });
    }

    return {
      slices: head,
      total: sorted.reduce((sum, row) => sum + row.ordersCount, 0),
    };
  }, [rows]);

  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="h-44 w-full shrink-0 sm:w-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="ordersCount"
              nameKey="label"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={2}
              strokeWidth={0}
            >
              {slices.map((slice, index) => (
                <Cell key={slice.label} fill={colors.series[index % colors.series.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: colors.tooltipBg,
                border: `1px solid ${colors.tooltipBorder}`,
                borderRadius: '0.625rem',
                fontSize: '0.75rem',
                color: colors.tooltipText,
              }}
              formatter={(value: number, name: string) => [
                `${formatNumber(value)} orders (${((value / total) * 100).toFixed(1)}%)`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/*
        The legend doubles as the data table. On a phone this is the part that
        actually gets read, so it carries the exact figures rather than colours
        alone.
      */}
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((slice, index) => (
          <li key={slice.label} className="flex items-center gap-2.5 text-xs">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colors.series[index % colors.series.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-content-secondary">{slice.label}</span>
            <span className="tabular shrink-0 font-medium text-content-primary">
              {formatNumber(slice.ordersCount)}
            </span>
            <span className="tabular w-12 shrink-0 text-right text-content-muted">
              {((slice.ordersCount / total) * 100).toFixed(0)}%
            </span>
            <span className="tabular hidden w-24 shrink-0 text-right text-content-muted sm:block">
              {formatCurrency(slice.revenue, currency, { compact: true })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars — better than a pie when the labels matter more than the split. */
export function BreakdownBars({
  rows,
  currency,
  limit = 8,
}: {
  rows: BreakdownRow[];
  currency: string;
  limit?: number;
}) {
  const colors = useChartColors();

  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.ordersCount - a.ordersCount).slice(0, limit),
    [rows, limit],
  );

  const max = Math.max(...sorted.map((row) => row.ordersCount), 1);

  return (
    <ul className="space-y-2.5">
      {sorted.map((row, index) => (
        <li key={row.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-medium text-content-primary">{row.label}</span>
            <span className="tabular shrink-0 text-content-muted">
              {formatNumber(row.ordersCount)} · {formatCurrency(row.revenue, currency, { compact: true })}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-inset">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.max((row.ordersCount / max) * 100, 2)}%`,
                backgroundColor: colors.series[index % colors.series.length],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
