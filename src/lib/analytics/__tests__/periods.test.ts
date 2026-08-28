import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  allowedGranularities,
  defaultGranularity,
  percentageChange,
  resolvePeriod,
} from '@/lib/analytics/periods';

/** 15 July 2026, 10:00 UTC — a summer date, so Athens is at UTC+3. */
const NOW = new Date('2026-07-15T10:00:00Z');

describe('period resolution', () => {
  it('starts "today" at local midnight, not UTC midnight', () => {
    const period = resolvePeriod('today', 'Europe/Athens', NOW);
    // Midnight in Athens on 15 July is 21:00 UTC on the 14th.
    assert.equal(period.from.toISOString(), '2026-07-14T21:00:00.000Z');
    assert.equal(period.to.toISOString(), '2026-07-15T21:00:00.000Z');
  });

  it('matches UTC boundaries for a UTC shop', () => {
    const period = resolvePeriod('today', 'UTC', NOW);
    assert.equal(period.from.toISOString(), '2026-07-15T00:00:00.000Z');
    assert.equal(period.to.toISOString(), '2026-07-16T00:00:00.000Z');
  });

  it('covers whole calendar months', () => {
    const period = resolvePeriod('this_month', 'UTC', NOW);
    assert.equal(period.from.toISOString(), '2026-07-01T00:00:00.000Z');
    assert.equal(period.to.toISOString(), '2026-08-01T00:00:00.000Z');
  });

  it('rolls back across a year boundary for last month in January', () => {
    const january = new Date('2026-01-10T10:00:00Z');
    const period = resolvePeriod('last_month', 'UTC', january);
    assert.equal(period.from.toISOString(), '2025-12-01T00:00:00.000Z');
    assert.equal(period.to.toISOString(), '2026-01-01T00:00:00.000Z');
  });

  it('aligns quarters to calendar quarters', () => {
    // July falls in Q3, which runs July to September.
    const period = resolvePeriod('this_quarter', 'UTC', NOW);
    assert.equal(period.from.toISOString(), '2026-07-01T00:00:00.000Z');
    assert.equal(period.to.toISOString(), '2026-10-01T00:00:00.000Z');
  });

  it('rolls the previous quarter back across a year boundary', () => {
    const january = new Date('2026-01-10T10:00:00Z');
    const period = resolvePeriod('last_quarter', 'UTC', january);
    assert.equal(period.from.toISOString(), '2025-10-01T00:00:00.000Z');
    assert.equal(period.to.toISOString(), '2026-01-01T00:00:00.000Z');
  });

  it('covers whole calendar years', () => {
    const period = resolvePeriod('this_year', 'UTC', NOW);
    assert.equal(period.from.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(period.to.toISOString(), '2027-01-01T00:00:00.000Z');
  });

  it('spans twelve whole months for last_12_months', () => {
    const period = resolvePeriod('last_12_months', 'UTC', NOW);
    assert.equal(period.from.toISOString(), '2025-08-01T00:00:00.000Z');
    assert.equal(period.to.toISOString(), '2026-08-01T00:00:00.000Z');
  });

  it('includes both endpoints of a 7-day window', () => {
    const period = resolvePeriod('last_7_days', 'UTC', NOW);
    assert.equal(period.from.toISOString(), '2026-07-09T00:00:00.000Z');
    assert.equal(period.to.toISOString(), '2026-07-16T00:00:00.000Z');
    assert.equal((period.to.getTime() - period.from.getTime()) / 86_400_000, 7);
  });

  it('offers a comparison window of the same length, ending where this one starts', () => {
    const period = resolvePeriod('last_30_days', 'UTC', NOW);
    assert.equal(period.previous.to.getTime(), period.from.getTime());
    assert.equal(
      period.previous.to.getTime() - period.previous.from.getTime(),
      period.to.getTime() - period.from.getTime(),
    );
  });

  it('produces half-open ranges that tile without overlap', () => {
    const thisMonth = resolvePeriod('this_month', 'UTC', NOW);
    const lastMonth = resolvePeriod('last_month', 'UTC', NOW);
    assert.equal(lastMonth.to.getTime(), thisMonth.from.getTime());
  });

  it('keeps a full 24-hour day across a DST transition', () => {
    // European clocks go forward on 29 March 2026; that local day is 23 hours.
    const dstDay = new Date('2026-03-29T12:00:00Z');
    const period = resolvePeriod('today', 'Europe/Athens', dstDay);
    const hours = (period.to.getTime() - period.from.getTime()) / 3_600_000;
    assert.equal(hours, 23, 'the spring-forward day is 23 hours long in Athens');
  });

  it('falls back to UTC for an unknown timezone', () => {
    const period = resolvePeriod('today', 'Not/AZone', NOW);
    assert.equal(period.from.toISOString(), '2026-07-15T00:00:00.000Z');
  });
});

describe('granularity selection', () => {
  const days = (n: number) => n * 86_400_000;

  it('buckets short spans by day and long spans more coarsely', () => {
    assert.equal(defaultGranularity(days(1)), 'day');
    assert.equal(defaultGranularity(days(30)), 'day');
    assert.equal(defaultGranularity(days(120)), 'week');
    assert.equal(defaultGranularity(days(365)), 'month');
    assert.equal(defaultGranularity(days(1000)), 'quarter');
    assert.equal(defaultGranularity(days(2000)), 'year');
  });

  it('only offers granularities coarse enough to be readable', () => {
    assert.deepEqual(allowedGranularities(days(7)), ['day']);
    assert.deepEqual(allowedGranularities(days(365)), ['day', 'week', 'month', 'quarter']);
    assert.ok(allowedGranularities(days(800)).includes('year'));
  });
});

describe('period-on-period change', () => {
  it('computes a percentage change', () => {
    assert.equal(percentageChange(150, 100), 50);
    assert.equal(percentageChange(50, 100), -50);
    assert.equal(percentageChange(100, 100), 0);
  });

  it('reports no change rather than infinity when there is no baseline', () => {
    assert.equal(percentageChange(100, 0), null);
    assert.equal(percentageChange(0, 0), 0);
  });
});
