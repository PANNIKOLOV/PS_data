'use client';

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AXIS_PROPS, CHART_GRID_PROPS } from '@/components/charts/chart-theme';
import { useChartColors } from '@/components/charts/use-chart-colors';
import type { Granularity } from '@/lib/analytics/periods';
import type { TimeseriesPoint } from '@/lib/analytics/queries';
import { formatCurrency, formatNumber } from '@/lib/utils';

/**
 * A metric over the selected period, with the preceding period behind it.
 *
 * The two series are aligned by position rather than by date — the previous
 * period covers different days, so the point of the overlay is "same distance
 * into the period", not "same date". Where the periods differ in length, the
 * shorter one simply runs out.
 */
export function ComparisonChart({
  current,
  previous,
  metric,
  granularity,
  timezone,
  currency,
}: {
  current: TimeseriesPoint[];
  previous: TimeseriesPoint[];
  metric: 'revenue' | 'orders';
  granularity: Granularity;
  timezone: string;
  currency: string;
}) {
  const colors = useChartColors();

  const data = useMemo(() => {
    const read = (point: TimeseriesPoint | undefined) =>
      point === undefined ? null : metric === 'revenue' ? point.revenue : point.ordersCount;

    return current.map((point, index) => ({
      label: formatBucket(point.bucket, granularity, timezone),
      current: read(point),
      previous: read(previous[index]),
    }));
  }, [current, previous, granularity, metric, timezone]);

  const format = (value: number) =>
    metric === 'revenue' ? formatCurrency(value, currency) : formatNumber(value);
  const formatAxis = (value: number) =>
    metric === 'revenue'
      ? formatCurrency(value, currency, { compact: true })
      : formatNumber(value, { compact: true });

  return (
    <div className="h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`cmp-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.series[0]} stopOpacity={0.28} />
              <stop offset="100%" stopColor={colors.series[0]} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid {...CHART_GRID_PROPS} stroke={colors.grid} />
          <XAxis
            dataKey="label"
            {...AXIS_PROPS}
            tick={{ ...AXIS_PROPS.tick, fill: colors.axis }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            {...AXIS_PROPS}
            tick={{ ...AXIS_PROPS.tick, fill: colors.axis }}
            tickFormatter={formatAxis}
            width={58}
          />
          <Tooltip
            cursor={{ stroke: colors.grid }}
            contentStyle={{
              backgroundColor: colors.tooltipBg,
              border: `1px solid ${colors.tooltipBorder}`,
              borderRadius: '0.625rem',
              fontSize: '0.75rem',
              color: colors.tooltipText,
            }}
            labelStyle={{ color: colors.tooltipText, fontWeight: 600, marginBottom: 2 }}
            formatter={(value: number, name: string) => [
              format(value),
              name === 'current' ? 'This period' : 'Previous period',
            ]}
          />
          <Legend
            iconType="plainline"
            iconSize={14}
            wrapperStyle={{ fontSize: '0.75rem', paddingTop: 8, color: colors.axis }}
            formatter={(value: string) =>
              value === 'current' ? 'This period' : 'Previous period'
            }
          />
          {/* Drawn first so the current period reads on top of it. */}
          <Area
            type="monotone"
            dataKey="previous"
            stroke={colors.axis}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="transparent"
            dot={false}
            connectNulls
          />
          <Area
            type="monotone"
            dataKey="current"
            stroke={colors.series[0]}
            strokeWidth={2}
            fill={`url(#cmp-${metric})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatBucket(iso: string, granularity: Granularity, timezone: string): string {
  const date = new Date(iso);
  const base: Intl.DateTimeFormatOptions = { timeZone: timezone };

  switch (granularity) {
    case 'day':
    case 'week':
      return date.toLocaleDateString('en-GB', { ...base, day: 'numeric', month: 'short' });
    case 'month':
      return date.toLocaleDateString('en-GB', { ...base, month: 'short', year: '2-digit' });
    case 'quarter': {
      const month = Number(date.toLocaleDateString('en-GB', { ...base, month: 'numeric' }));
      return `Q${Math.floor((month - 1) / 3) + 1} '${date.toLocaleDateString('en-GB', { ...base, year: '2-digit' })}`;
    }
    case 'year':
      return date.toLocaleDateString('en-GB', { ...base, year: 'numeric' });
  }
}
