import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { concentration, periodShape, weekdayPerformance } from '@/lib/analytics/insights';
import type { TimeseriesPoint } from '@/lib/analytics/queries';

const day = (bucket: string, orders: number, revenue: number): TimeseriesPoint => ({
  bucket,
  ordersCount: orders,
  revenue,
  newRegistrations: 0,
});

// 2026-03-02 is a Monday.
const WEEK: TimeseriesPoint[] = [
  day('2026-03-02T00:00:00Z', 2, 100), // Mon
  day('2026-03-03T00:00:00Z', 1, 50),  // Tue
  day('2026-03-04T00:00:00Z', 0, 0),   // Wed
  day('2026-03-05T00:00:00Z', 3, 300), // Thu
  day('2026-03-06T00:00:00Z', 1, 20),  // Fri
  day('2026-03-07T00:00:00Z', 0, 0),   // Sat
  day('2026-03-08T00:00:00Z', 1, 30),  // Sun
];

describe('weekday performance', () => {
  it('attributes each day to the right weekday', () => {
    const rows = weekdayPerformance(WEEK, 'UTC');
    assert.equal(rows[0]!.label, 'Mon');
    assert.equal(rows[0]!.revenue, 100);
    assert.equal(rows[3]!.label, 'Thu');
    assert.equal(rows[3]!.revenue, 300);
    assert.equal(rows[6]!.label, 'Sun');
    assert.equal(rows[6]!.revenue, 30);
  });

  it('averages over how often each weekday occurred', () => {
    // Two Mondays, so the average is half the total.
    const rows = weekdayPerformance([...WEEK, day('2026-03-09T00:00:00Z', 2, 200)], 'UTC');
    assert.equal(rows[0]!.occurrences, 2);
    assert.equal(rows[0]!.revenue, 300);
    assert.equal(rows[0]!.averageRevenue, 150);
  });

  it('reads the weekday in the shop timezone rather than UTC', () => {
    // Local midnight Monday in Athens is 22:00 Sunday UTC; read naively in UTC
    // this lands on Sunday and shifts the whole distribution by a day.
    const athensMonday = day('2026-03-01T22:00:00Z', 5, 500);
    const rows = weekdayPerformance([athensMonday], 'Europe/Athens');
    assert.equal(rows[0]!.label, 'Mon');
    assert.equal(rows[0]!.revenue, 500);
  });

  it('always returns all seven weekdays', () => {
    assert.equal(weekdayPerformance([], 'UTC').length, 7);
  });
});

describe('period shape', () => {
  it('finds the best and quietest trading days', () => {
    const shape = periodShape(WEEK);
    assert.equal(shape.bestDay?.revenue, 300);
    assert.equal(shape.quietestDay?.revenue, 0);
  });

  it('averages across every day, including days with no orders', () => {
    const shape = periodShape(WEEK);
    assert.equal(shape.totalDays, 7);
    assert.equal(shape.activeDays, 5);
    assert.equal(shape.averageDailyRevenue, 500 / 7);
  });

  it('reports no best day when nothing sold', () => {
    const shape = periodShape([day('2026-03-02T00:00:00Z', 0, 0)]);
    assert.equal(shape.bestDay, null);
    assert.equal(shape.quietestDay, null);
  });

  it('handles an empty series', () => {
    const shape = periodShape([]);
    assert.equal(shape.totalDays, 0);
    assert.equal(shape.averageDailyRevenue, 0);
  });
});

describe('concentration', () => {
  it('reports the share held by the largest contributors', () => {
    assert.equal(concentration([50, 30, 15, 5], 3), 95);
  });

  it('is zero when there is nothing to share', () => {
    assert.equal(concentration([], 3), 0);
    assert.equal(concentration([0, 0], 3), 0);
  });
});
