/**
 * Coercion helpers for PrestaShop webservice payloads.
 *
 * The webservice is loosely typed: numbers arrive as strings, booleans as "0"
 * or "1", and multilingual fields as either a plain string (single-language
 * shop) or an array of `{ id, value }` (multi-language shop). PrestaShop 9 also
 * returns some previously stringy numerics as real JSON numbers, so every
 * reader here accepts both shapes.
 */

import type { LocalisedValue } from '@/lib/prestashop/resources';

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function toInteger(value: unknown, fallback = 0): number {
  return Math.trunc(toNumber(value, fallback));
}

export function toNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = toInteger(value, Number.NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  return false;
}

export function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Picks a display string out of a possibly-multilingual field. */
export function localised(value: LocalisedValue | undefined, preferredLanguageId?: number): string | null {
  if (!value) return null;
  if (typeof value === 'string') return toTrimmedString(value);

  if (Array.isArray(value)) {
    if (preferredLanguageId !== undefined) {
      const match = value.find((entry) => toInteger(entry.id) === preferredLanguageId);
      if (match) return toTrimmedString(match.value);
    }
    for (const entry of value) {
      const text = toTrimmedString(entry.value);
      if (text) return text;
    }
  }
  return null;
}

/**
 * PrestaShop emits `YYYY-MM-DD HH:MM:SS` in the shop's own local time, with no
 * offset. We attach the shop's configured timezone to turn it into a real
 * instant; without this every figure would silently drift by the UTC offset.
 *
 * `0000-00-00 00:00:00` is PrestaShop's "unset" marker and yields null.
 */
export function parseShopDate(value: unknown, timezone: string): string | null {
  const text = toTrimmedString(value);
  if (!text || text.startsWith('0000-00-00')) return null;

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!match) {
    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
  }

  const [, year, month, day, hour, minute, second] = match.map(Number) as [
    number, number, number, number, number, number, number,
  ];

  // Interpret the wall-clock reading as UTC first, then subtract the offset that
  // the shop's timezone had at that moment.
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = timezoneOffsetMs(new Date(asUtc), timezone);
  return new Date(asUtc - offsetMs).toISOString();
}

const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timezone: string): Intl.DateTimeFormat | null {
  const cached = offsetFormatterCache.get(timezone);
  if (cached) return cached;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatterCache.set(timezone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

/** Offset of `timezone` from UTC at a given instant, in milliseconds. */
function timezoneOffsetMs(instant: Date, timezone: string): number {
  const formatter = offsetFormatter(timezone);
  if (!formatter) return 0;

  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const localAsUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  );

  return localAsUtc - instant.getTime();
}
