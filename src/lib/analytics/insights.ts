/**
 * Figures derived from a daily time series.
 *
 * Everything here is computed from data the page already fetched, so none of it
 * costs an extra query or needs a database change. The trade-off is that these
 * are only as granular as the series: they require day buckets, and callers are
 * expected to check that before using them.
 */

import type { TimeseriesPoint } from '@/lib/analytics/queries';

export interface WeekdayPerformance {
  /** 0 = Monday, to match how trading weeks are usually read. */
  weekday: number;
  label: string;
  orders: number;
  revenue: number;
  /** Days of this weekday in the period, so the averages mean something. */
  occurrences: number;
  averageRevenue: number;
}

export interface PeriodShape {
  /** The single best day by revenue, or null when nothing sold. */
  bestDay: { date: string; revenue: number; orders: number } | null;
  quietestDay: { date: string; revenue: number; orders: number } | null;
  /** Mean across every day in the period, including days with no orders. */
  averageDailyRevenue: number;
  averageDailyOrders: number;
  /** Days with at least one order, against the length of the period. */
  activeDays: number;
  totalDays: number;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * Reads the weekday of a bucket in the shop's timezone.
 *
 * The bucket is an instant marking local midnight, so reading it in any other
 * zone can land on the previous day and shift the whole distribution.
 */
function weekdayIn(iso: string, timezone: string): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
    new Date(iso),
  );
  const index = WEEKDAY_LABELS.indexOf(short as (typeof WEEKDAY_LABELS)[number]);
  return index === -1 ? 0 : index;
}

/** Totals per weekday. Only meaningful for a day-bucketed series. */
export function weekdayPerformance(
  points: TimeseriesPoint[],
  timezone: string,
): WeekdayPerformance[] {
  const buckets = WEEKDAY_LABELS.map((label, weekday) => ({
    weekday,
    label,
    orders: 0,
    revenue: 0,
    occurrences: 0,
    averageRevenue: 0,
  }));

  for (const point of points) {
    const bucket = buckets[weekdayIn(point.bucket, timezone)]!;
    bucket.orders += point.ordersCount;
    bucket.revenue += point.revenue;
    bucket.occurrences += 1;
  }

  for (const bucket of buckets) {
    bucket.averageRevenue = bucket.occurrences > 0 ? bucket.revenue / bucket.occurrences : 0;
  }

  return buckets;
}

/** Best and quietest days, plus averages across the period. */
export function periodShape(points: TimeseriesPoint[]): PeriodShape {
  if (points.length === 0) {
    return {
      bestDay: null,
      quietestDay: null,
      averageDailyRevenue: 0,
      averageDailyOrders: 0,
      activeDays: 0,
      totalDays: 0,
    };
  }

  let best = points[0]!;
  let quietest = points[0]!;
  let revenue = 0;
  let orders = 0;
  let activeDays = 0;

  for (const point of points) {
    if (point.revenue > best.revenue) best = point;
    if (point.revenue < quietest.revenue) quietest = point;
    revenue += point.revenue;
    orders += point.ordersCount;
    if (point.ordersCount > 0) activeDays += 1;
  }

  const asDay = (point: TimeseriesPoint) => ({
    date: point.bucket,
    revenue: point.revenue,
    orders: point.ordersCount,
  });

  return {
    // A "best day" is noise when nothing was sold at all.
    bestDay: best.revenue > 0 ? asDay(best) : null,
    quietestDay: activeDays > 0 ? asDay(quietest) : null,
    averageDailyRevenue: revenue / points.length,
    averageDailyOrders: orders / points.length,
    activeDays,
    totalDays: points.length,
  };
}

/** Share of revenue held by the largest contributors, e.g. top payment methods. */
export function concentration(values: number[], topN = 3): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  const top = [...values].sort((a, b) => b - a).slice(0, topN);
  return (top.reduce((sum, value) => sum + value, 0) / total) * 100;
}
