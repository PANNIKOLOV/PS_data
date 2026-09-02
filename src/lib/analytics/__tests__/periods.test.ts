import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_CUSTOM_RANGE_DAYS,
  allowedGranularities,
  defaultGranularity,
  parseCalendarDate,
  percentageChange,
  resolveCustomPeriod,
  resolvePeriod,
  toCalendarDate,
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

describe('calendar dates', () => {
  it('reads a well-formed date', () => {
    assert.deepEqual(parseCalendarDate('2026-03-09'), { year: 2026, month: 3, day: 9 });
  });

  it('refuses a day that does not exist', () => {
    // Date.UTC would roll this to 2 March rather than rejecting it.
    assert.equal(parseCalendarDate('2026-02-30'), null);
    assert.equal(parseCalendarDate('2026-13-01'), null);
  });

  it('accepts a leap day only in a leap year', () => {
    assert.notEqual(parseCalendarDate('2028-02-29'), null);
    assert.equal(parseCalendarDate('2026-02-29'), null);
  });

  it('refuses anything that is not YYYY-MM-DD', () => {
    for (const value of ['', '9/3/2026', '2026-3-9', 'yesterday', undefined, null]) {
      assert.equal(parseCalendarDate(value), null, String(value));
    }
  });

  it('refuses a year outside the range a shop could plausibly use', () => {
    assert.equal(parseCalendarDate('1899-01-01'), null);
    assert.equal(parseCalendarDate('9999-01-01'), null);
  });

  it('renders an instant as the shop sees it, not as the viewer does', () => {
    // 21:30 UTC on 14 July is already the 15th in Athens.
    const instant = new Date('2026-07-14T21:30:00Z');
    assert.equal(toCalendarDate(instant, 'Europe/Athens'), '2026-07-15');
    assert.equal(toCalendarDate(instant, 'UTC'), '2026-07-14');
  });
});

describe('custom ranges', () => {
  it('runs from local midnight to the midnight after the last day', () => {
    const period = resolveCustomPeriod('2026-03-01', '2026-03-31', 'Europe/Athens');
    assert.ok(period);
    // Midnight in Athens on 1 March is 22:00 UTC on 28 February (EET, UTC+2).
    assert.equal(period.from.toISOString(), '2026-02-28T22:00:00.000Z');
    // The end day is inclusive, so the range closes at the start of 1 April.
    assert.equal(period.to.toISOString(), '2026-03-31T21:00:00.000Z');
  });

  it('includes a single day when both ends match', () => {
    const period = resolveCustomPeriod('2026-03-09', '2026-03-09', 'UTC');
    assert.ok(period);
    assert.equal(period.from.toISOString(), '2026-03-09T00:00:00.000Z');
    assert.equal(period.to.toISOString(), '2026-03-10T00:00:00.000Z');
    assert.equal(period.label, '9 Mar 2026');
  });

  it('compares against the equally long window immediately before', () => {
    const period = resolveCustomPeriod('2026-03-08', '2026-03-14', 'UTC');
    assert.ok(period);
    assert.equal(period.previous.to.toISOString(), period.from.toISOString());
    assert.equal(period.previous.from.toISOString(), '2026-03-01T00:00:00.000Z');
  });

  it('labels a range by dropping what both ends share', () => {
    assert.equal(resolveCustomPeriod('2026-03-01', '2026-04-15', 'UTC')?.label, '1 Mar – 15 Apr 2026');
    assert.equal(
      resolveCustomPeriod('2025-12-20', '2026-01-05', 'UTC')?.label,
      '20 Dec 2025 – 5 Jan 2026',
    );
  });

  it('picks a bucket size to suit the span', () => {
    assert.equal(resolveCustomPeriod('2026-03-01', '2026-03-31', 'UTC')?.granularity, 'day');
    assert.equal(resolveCustomPeriod('2024-01-01', '2026-01-01', 'UTC')?.granularity, 'quarter');
  });

  it('honours an explicit bucket size', () => {
    const period = resolveCustomPeriod('2026-01-01', '2026-12-31', 'UTC', 'month');
    assert.equal(period?.granularity, 'month');
  });

  it('refuses a backwards range rather than swapping it', () => {
    assert.equal(resolveCustomPeriod('2026-03-31', '2026-03-01', 'UTC'), null);
  });

  it('refuses a span longer than the cap', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const tooLate = new Date(start.getTime() + MAX_CUSTOM_RANGE_DAYS * 86_400_000);
    assert.equal(
      resolveCustomPeriod('2026-01-01', tooLate.toISOString().slice(0, 10), 'UTC'),
      null,
    );
  });

  it('refuses a malformed or missing bound', () => {
    assert.equal(resolveCustomPeriod('2026-03-01', undefined, 'UTC'), null);
    assert.equal(resolveCustomPeriod('not-a-date', '2026-03-01', 'UTC'), null);
  });

  it('falls back to UTC for an unusable timezone', () => {
    const period = resolveCustomPeriod('2026-03-01', '2026-03-01', 'Not/AZone');
    assert.equal(period?.from.toISOString(), '2026-03-01T00:00:00.000Z');
  });

  it('keeps a whole number of days across a clock change', () => {
    // Europe/Athens moves to summer time on 29 March 2026, so this range is
    // one hour short of five 24-hour days.
    const period = resolveCustomPeriod('2026-03-27', '2026-03-31', 'Europe/Athens');
    assert.ok(period);
    assert.equal(period.to.getTime() - period.from.getTime(), 5 * 86_400_000 - 3_600_000);
  });
});
