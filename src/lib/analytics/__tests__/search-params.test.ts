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
