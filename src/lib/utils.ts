import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formats money in the viewer's locale. Falls back gracefully on odd currency codes. */
export function formatCurrency(
  value: number,
  currency = 'EUR',
  options: { compact?: boolean; locale?: string } = {},
): string {
  const { compact = false, locale = 'en-GB' } = options;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : 2,
      minimumFractionDigits: compact ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatNumber(value: number, options: { compact?: boolean; locale?: string } = {}): string {
  const { compact = false, locale = 'en-GB' } = options;
  return new Intl.NumberFormat(locale, {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}

export function formatPercent(value: number, fractionDigits = 1): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(fractionDigits)}%`;
}

/**
 * "2 minutes ago", "3 days ago", "in 4 hours" — for sync timestamps.
 *
 * Future instants are supported because the same helper renders when a shop is
 * next due to sync, which is normally still ahead.
 */
export function formatRelativeTime(value: string | Date | null | undefined): string {
  if (!value) return 'never';

  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return 'unknown';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const magnitude = Math.abs(seconds);
  if (magnitude < 60) return seconds >= 0 ? 'just now' : 'in under a minute';

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86_400],
    ['month', 2_592_000],
    ['year', 31_536_000],
  ];

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0]!;
  for (const unit of units) {
    // Chosen on magnitude, so a future instant picks the same unit as a past
    // one the same distance away.
    if (magnitude >= unit[1]) chosen = unit;
  }
  return formatter.format(-Math.round(seconds / chosen[1]), chosen[0]);
}

/** Escapes a value for CSV, guarding against spreadsheet formula injection. */
export function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);

  // A leading =, +, - or @ makes Excel and Sheets evaluate the cell as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(toCsvCell).join(',')).join('\r\n');
}

/** Deterministic series colour, so a payment method keeps its colour across charts. */
export function seriesColor(index: number): string {
  return `var(--color-series-${(index % 8) + 1})`;
}

export function initialsFrom(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}
