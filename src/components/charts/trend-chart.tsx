'use client';

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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

export type TrendMetric = 'revenue' | 'orders' | 'registrations';

const METRIC_LABELS: Record<TrendMetric, string> = {
  revenue: 'Revenue',
  orders: 'Orders',
  registrations: 'Registrations',
};

/** Bucket labels tuned per granularity, so a year of months stays readable. */
function formatBucket(iso: string, granularity: Granularity, timezone: string): string {
  const date = new Date(iso);
  const base: Intl.DateTimeFormatOptions = { timeZone: timezone };

  switch (granularity) {
    case 'day':
      return date.toLocaleDateString('en-GB', { ...base, day: 'numeric', month: 'short' });
    case 'week':
      return date.toLocaleDateString('en-GB', { ...base, day: 'numeric', month: 'short' });
    case 'month':
      return date.toLocaleDateString('en-GB', { ...base, month: 'short', year: '2-digit' });
    case 'quarter': {
      const month = Number(date.toLocaleDateString('en-GB', { ...base, month: 'numeric' }));
      const year = date.toLocaleDateString('en-GB', { ...base, year: '2-digit' });
      return `Q${Math.floor((month - 1) / 3) + 1} '${year}`;
    }
    case 'year':
      return date.toLocaleDateString('en-GB', { ...base, year: 'numeric' });
  }
}

export function TrendChart({
  data,
  metric,
  granularity,
  timezone,
  currency,
  variant = 'area',
}: {
  data: TimeseriesPoint[];
  metric: TrendMetric;
  granularity: Granularity;
  timezone: string;
  currency: string;
  variant?: 'area' | 'bar';
}) {
  const colors = useChartColors();

  const chartData = useMemo(
    () =>
      data.map((point) => ({
        label: formatBucket(point.bucket, granularity, timezone),
        value:
          metric === 'revenue'
            ? point.revenue
            : metric === 'orders'
              ? point.ordersCount
              : point.newRegistrations,
      })),
    [data, granularity, metric, timezone],
  );

  const formatValue = (value: number) =>
    metric === 'revenue' ? formatCurrency(value, currency) : formatNumber(value);

  const formatAxis = (value: number) =>
    metric === 'revenue'
      ? formatCurrency(value, currency, { compact: true })
      : formatNumber(value, { compact: true });

  const seriesColor = colors.series[metric === 'revenue' ? 0 : metric === 'orders' ? 1 : 2]!;

  const tooltip = (
    <Tooltip
      cursor={{ fill: colors.grid, fillOpacity: 0.35 }}
      contentStyle={{
        backgroundColor: colors.tooltipBg,
        border: `1px solid ${colors.tooltipBorder}`,
        borderRadius: '0.625rem',
        fontSize: '0.75rem',
        color: colors.tooltipText,
        boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)',
      }}
      labelStyle={{ color: colors.tooltipText, fontWeight: 600, marginBottom: 2 }}
      formatter={(value: number) => [formatValue(value), METRIC_LABELS[metric]]}
    />
  );

  const axes = (
    <>
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
    </>
  );

  return (
    <div className="h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        {variant === 'bar' ? (
          <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {axes}
            {tooltip}
            <Bar dataKey="value" fill={seriesColor} radius={[4, 4, 0, 0]} maxBarSize={44} />
          </BarChart>
        ) : (
          <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={seriesColor} stopOpacity={0.28} />
                <stop offset="100%" stopColor={seriesColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {axes}
            {tooltip}
            <Area
              type="monotone"
              dataKey="value"
              stroke={seriesColor}
              strokeWidth={2}
              fill={`url(#fill-${metric})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Two series side by side, for comparing revenue against order volume. */
export function DualTrendChart({
  data,
  granularity,
  timezone,
  currency,
}: {
  data: TimeseriesPoint[];
  granularity: Granularity;
  timezone: string;
  currency: string;
}) {
  const colors = useChartColors();

  const chartData = useMemo(
    () =>
      data.map((point) => ({
        label: formatBucket(point.bucket, granularity, timezone),
        revenue: point.revenue,
        orders: point.ordersCount,
      })),
    [data, granularity, timezone],
  );

  return (
    <div className="h-64 w-full sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="fill-dual-revenue" x1="0" y1="0" x2="0" y2="1">
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
            yAxisId="revenue"
            {...AXIS_PROPS}
            tick={{ ...AXIS_PROPS.tick, fill: colors.axis }}
            tickFormatter={(value: number) => formatCurrency(value, currency, { compact: true })}
            width={58}
          />
          <YAxis
            yAxisId="orders"
            orientation="right"
            {...AXIS_PROPS}
            tick={{ ...AXIS_PROPS.tick, fill: colors.axis }}
            tickFormatter={(value: number) => formatNumber(value, { compact: true })}
            width={44}
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
            formatter={(value: number, name: string) =>
              name === 'revenue'
                ? [formatCurrency(value, currency), 'Revenue']
                : [formatNumber(value), 'Orders']
            }
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: '0.75rem', paddingTop: 8 }}
            formatter={(value: string) => (value === 'revenue' ? 'Revenue' : 'Orders')}
          />
          <Area
            yAxisId="revenue"
            type="monotone"
            dataKey="revenue"
            stroke={colors.series[0]}
            strokeWidth={2}
            fill="url(#fill-dual-revenue)"
            dot={false}
          />
          <Area
            yAxisId="orders"
            type="monotone"
            dataKey="orders"
            stroke={colors.series[1]}
            strokeWidth={2}
            fill="transparent"
            strokeDasharray="4 3"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
