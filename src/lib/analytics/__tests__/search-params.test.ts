import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseDashboardParams } from '@/lib/analytics/search-params';

const NOW = new Date('2026-07-15T10:00:00Z');
const SHOPS = ['shop-a', 'shop-b'];

describe('dashboard parameter parsing', () => {
  it('falls back to a sensible default period', () => {
    const parsed = parseDashboardParams({}, SHOPS, 'UTC', NOW);
    assert.equal(parsed.period.preset, 'last_30_days');
  });

  it('ignores an unrecognised period instead of failing', () => {
    const parsed = parseDashboardParams({ period: 'all_time_ever' }, SHOPS, 'UTC', NOW);
    assert.equal(parsed.period.preset, 'last_30_days');
  });

  it('rejects a granularity too fine for the span', () => {
    // Yearly buckets over 30 days would produce a single meaningless point.
    const parsed = parseDashboardParams(
      { period: 'last_30_days', granularity: 'year' },
      SHOPS,
      'UTC',
      NOW,
    );
    assert.equal(parsed.granularity, 'day');
  });

  it('honours a granularity the span supports', () => {
    const parsed = parseDashboardParams(
      { period: 'this_year', granularity: 'quarter' },
      SHOPS,
      'UTC',
      NOW,
    );
    assert.equal(parsed.granularity, 'quarter');
  });

  it('drops shop ids the viewer cannot see', () => {
    const parsed = parseDashboardParams({ shop: ['shop-a', 'not-mine'] }, SHOPS, 'UTC', NOW);
    assert.deepEqual(parsed.selectedShopIds, ['shop-a']);
  });

  it('defaults to every accessible shop when none is chosen', () => {
    const parsed = parseDashboardParams({}, SHOPS, 'UTC', NOW);
    assert.deepEqual(parsed.selectedShopIds, SHOPS);
  });

  it('falls back to all shops when every requested id is invalid', () => {
    const parsed = parseDashboardParams({ shop: 'not-mine' }, SHOPS, 'UTC', NOW);
    assert.deepEqual(parsed.selectedShopIds, SHOPS);
  });

  it('accepts a single shop passed as a string', () => {
    const parsed = parseDashboardParams({ shop: 'shop-b' }, SHOPS, 'UTC', NOW);
    assert.deepEqual(parsed.selectedShopIds, ['shop-b']);
  });

  it('reads the paid-orders-only flag', () => {
    assert.equal(parseDashboardParams({ valid: '1' }, SHOPS, 'UTC', NOW).onlyValid, true);
    assert.equal(parseDashboardParams({ valid: 'true' }, SHOPS, 'UTC', NOW).onlyValid, true);
    assert.equal(parseDashboardParams({}, SHOPS, 'UTC', NOW).onlyValid, false);
    assert.equal(parseDashboardParams({ valid: '0' }, SHOPS, 'UTC', NOW).onlyValid, false);
  });

  it('offers only granularities that suit the chosen span', () => {
    const week = parseDashboardParams({ period: 'last_7_days' }, SHOPS, 'UTC', NOW);
    assert.deepEqual(week.granularityOptions, ['day']);

    const year = parseDashboardParams({ period: 'this_year' }, SHOPS, 'UTC', NOW);
    assert.ok(year.granularityOptions.includes('month'));
  });
});

describe('custom range parameters', () => {
  it('uses a well-formed pair', () => {
    const parsed = parseDashboardParams(
      { period: 'custom', from: '2026-03-01', to: '2026-03-31' },
      SHOPS,
      'UTC',
      NOW,
    );
    assert.equal(parsed.period.preset, 'custom');
    assert.equal(parsed.period.label, '1 Mar – 31 Mar 2026');
    assert.equal(parsed.rangeStart, '2026-03-01');
    assert.equal(parsed.rangeEnd, '2026-03-31');
  });

  it('falls back to the default when the dates make no sense', () => {
    // A reversed pair, a missing bound and a malformed value must all land
    // somewhere the viewer can see is not what they asked for.
    for (const raw of [
      { period: 'custom', from: '2026-03-31', to: '2026-03-01' },
      { period: 'custom', from: '2026-03-01' },
      { period: 'custom', from: '2026-03-01', to: '31/03/2026' },
      { period: 'custom' },
    ]) {
      const parsed = parseDashboardParams(raw, SHOPS, 'UTC', NOW);
      assert.equal(parsed.period.preset, 'last_30_days', JSON.stringify(raw));
    }
  });

  it('ignores custom bounds when a preset is selected', () => {
    const parsed = parseDashboardParams(
      { period: 'this_month', from: '2020-01-01', to: '2020-12-31' },
      SHOPS,
      'UTC',
      NOW,
    );
    assert.equal(parsed.period.preset, 'this_month');
    assert.equal(parsed.rangeStart, '2026-07-01');
  });

  it('offers only granularities the custom span supports', () => {
    const short = parseDashboardParams(
      { period: 'custom', from: '2026-03-01', to: '2026-03-07' },
      SHOPS,
      'UTC',
      NOW,
    );
    assert.deepEqual(short.granularityOptions, ['day']);

    const long = parseDashboardParams(
      { period: 'custom', from: '2024-01-01', to: '2026-01-01' },
      SHOPS,
      'UTC',
      NOW,
    );
    assert.ok(long.granularityOptions.includes('year'));
  });

  it('honours a granularity the custom span supports', () => {
    const parsed = parseDashboardParams(
      { period: 'custom', from: '2026-01-01', to: '2026-12-31', granularity: 'month' },
      SHOPS,
      'UTC',
      NOW,
    );
    assert.equal(parsed.granularity, 'month');
    assert.equal(parsed.period.granularity, 'month');
  });

  it('reports the range in the shop timezone, end day inclusive', () => {
    // The range closes at midnight on 1 April in Athens; the last day it
    // includes is 31 March, which is what the date inputs must show.
    const parsed = parseDashboardParams(
      { period: 'custom', from: '2026-03-01', to: '2026-03-31' },
      SHOPS,
      'Europe/Athens',
      NOW,
    );
    assert.equal(parsed.rangeStart, '2026-03-01');
    assert.equal(parsed.rangeEnd, '2026-03-31');
  });

  it('reports a preset range as dates too, so the pickers can be seeded', () => {
    const parsed = parseDashboardParams({ period: 'last_7_days' }, SHOPS, 'UTC', NOW);
    assert.equal(parsed.rangeStart, '2026-07-09');
    assert.equal(parsed.rangeEnd, '2026-07-15');
  });
});
