import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  localised,
  parseShopDate,
  toBoolean,
  toInteger,
  toNullableInteger,
  toNumber,
  toTrimmedString,
} from '@/lib/prestashop/normalize';

describe('scalar coercion', () => {
  it('reads numbers whether the shop sends strings or numbers', () => {
    // PrestaShop 1.7/8 send "12.50"; 9 may send 12.5.
    assert.equal(toNumber('12.50'), 12.5);
    assert.equal(toNumber(12.5), 12.5);
    assert.equal(toNumber(''), 0);
    assert.equal(toNumber('not a number'), 0);
    assert.equal(toNumber(undefined, 1), 1);
    assert.equal(toNumber(Number.NaN, 3), 3);
  });

  it('reads booleans from PrestaShop 0/1 flags', () => {
    assert.equal(toBoolean('1'), true);
    assert.equal(toBoolean(1), true);
    assert.equal(toBoolean(true), true);
    assert.equal(toBoolean('0'), false);
    assert.equal(toBoolean(0), false);
    assert.equal(toBoolean(undefined), false);
  });

  it('treats absent and zero foreign keys as null', () => {
    // PrestaShop uses 0 for "no related record", which must not become a real id.
    assert.equal(toNullableInteger('0'), null);
    assert.equal(toNullableInteger(''), null);
    assert.equal(toNullableInteger(undefined), null);
    assert.equal(toNullableInteger('42'), 42);
  });

  it('trims strings and collapses blanks to null', () => {
    assert.equal(toTrimmedString('  Bank wire '), 'Bank wire');
    assert.equal(toTrimmedString('   '), null);
    assert.equal(toTrimmedString(undefined), null);
  });

  it('truncates rather than rounds when coercing to integer', () => {
    assert.equal(toInteger('7.9'), 7);
  });
});

describe('multilingual fields', () => {
  it('accepts a plain string from a single-language shop', () => {
    assert.equal(localised('Payment accepted'), 'Payment accepted');
  });

  it('accepts the array form from a multi-language shop', () => {
    const value = [
      { id: '1', value: 'Payment accepted' },
      { id: '2', value: 'Paiement accepté' },
    ];
    assert.equal(localised(value), 'Payment accepted');
    assert.equal(localised(value, 2), 'Paiement accepté');
  });

  it('falls back to the first non-empty translation', () => {
    assert.equal(localised([{ id: '1', value: '' }, { id: '2', value: 'Shipped' }]), 'Shipped');
  });

  it('returns null when there is nothing usable', () => {
    assert.equal(localised(undefined), null);
    assert.equal(localised([]), null);
  });
});

describe('shop-local timestamps', () => {
  it('interprets a naive timestamp in the shop timezone', () => {
    // 09:00 in Athens during summer (EEST, UTC+3) is 06:00 UTC.
    assert.equal(parseShopDate('2026-07-15 09:00:00', 'Europe/Athens'), '2026-07-15T06:00:00.000Z');
  });

  it('applies the offset in force on that date, not today', () => {
    // Athens is UTC+2 in winter, so 09:00 local is 07:00 UTC.
    assert.equal(parseShopDate('2026-01-15 09:00:00', 'Europe/Athens'), '2026-01-15T07:00:00.000Z');
  });

  it('handles a shop running on UTC', () => {
    assert.equal(parseShopDate('2026-03-10 22:30:00', 'UTC'), '2026-03-10T22:30:00.000Z');
  });

  it('handles timezones west of UTC', () => {
    // New York in March is UTC-4 (EDT), so 20:00 local is 00:00 UTC the next day.
    assert.equal(parseShopDate('2026-03-10 20:00:00', 'America/New_York'), '2026-03-11T00:00:00.000Z');
  });

  it('treats the PrestaShop zero date as absent', () => {
    assert.equal(parseShopDate('0000-00-00 00:00:00', 'UTC'), null);
    assert.equal(parseShopDate('', 'UTC'), null);
    assert.equal(parseShopDate(undefined, 'UTC'), null);
  });

  it('falls back to UTC when the shop timezone is unknown', () => {
    assert.equal(parseShopDate('2026-07-15 09:00:00', 'Not/AZone'), '2026-07-15T09:00:00.000Z');
  });

  it('accepts an ISO-style separator too', () => {
    assert.equal(parseShopDate('2026-07-15T09:00:00', 'UTC'), '2026-07-15T09:00:00.000Z');
  });
});
