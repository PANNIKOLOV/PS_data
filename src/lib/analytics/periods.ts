/**
 * Reporting periods.
 *
 * Ranges are half-open [from, to) so a record on a boundary is counted exactly
 * once. All arithmetic happens in the shop's timezone, then converts to real
 * instants, so "this month" means the shop's month rather than the viewer's.
 */

export const GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const PERIOD_PRESETS = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_12_months',
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  this_year: 'This year',
  last_year: 'Last year',
  last_12_months: 'Last 12 months',
};

export interface DateRange {
  from: Date;
  to: Date;
}

export interface ResolvedPeriod extends DateRange {
  preset: PeriodPreset;
  label: string;
  /** Bucket size that suits the span, unless the viewer overrode it. */
  granularity: Granularity;
  /** The equivalent range immediately before this one, for period-on-period change. */
  previous: DateRange;
}

export function isPeriodPreset(value: string): value is PeriodPreset {
  return (PERIOD_PRESETS as readonly string[]).includes(value);
}

export function isGranularity(value: string): value is Granularity {
  return (GRANULARITIES as readonly string[]).includes(value);
}

/**
 * Wall-clock fields of an instant, as read in a given timezone.
 */
function partsInTimezone(instant: Date, timezone: string) {
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

  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/**
 * Converts a local wall-clock reading in `timezone` into a real instant.
 *
 * Applied twice, because the UTC offset itself depends on the instant: the
 * first pass gives an approximation, the second corrects it across a DST
 * boundary.
 */
function zonedTimeToInstant(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  let instant = new Date(naiveUtc);
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = partsInTimezone(instant, timezone);
    const roundTrip = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    instant = new Date(instant.getTime() + (naiveUtc - roundTrip));
  }
  return instant;
}

function safeTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}

/** Resolves a preset into concrete instants, in the given timezone. */
export function resolvePeriod(
  preset: PeriodPreset,
  timezone: string,
  now: Date = new Date(),
  granularityOverride?: Granularity,
): ResolvedPeriod {
  const tz = safeTimezone(timezone);
  const today = partsInTimezone(now, tz);
  const startOfDay = (year: number, month: number, day: number) =>
    zonedTimeToInstant(tz, year, month, day);

  const quarterStartMonth = Math.floor((today.month - 1) / 3) * 3 + 1;

  let from: Date;
  let to: Date;

  switch (preset) {
    case 'today':
      from = startOfDay(today.year, today.month, today.day);
      to = startOfDay(today.year, today.month, today.day + 1);
      break;
    case 'yesterday':
      from = startOfDay(today.year, today.month, today.day - 1);
      to = startOfDay(today.year, today.month, today.day);
      break;
    case 'last_7_days':
      from = startOfDay(today.year, today.month, today.day - 6);
      to = startOfDay(today.year, today.month, today.day + 1);
      break;
    case 'last_30_days':
      from = startOfDay(today.year, today.month, today.day - 29);
      to = startOfDay(today.year, today.month, today.day + 1);
      break;
    case 'this_month':
      from = startOfDay(today.year, today.month, 1);
      to = zonedTimeToInstant(tz, today.year, today.month + 1, 1);
      break;
    case 'last_month':
      from = zonedTimeToInstant(tz, today.year, today.month - 1, 1);
      to = startOfDay(today.year, today.month, 1);
      break;
    case 'this_quarter':
      from = zonedTimeToInstant(tz, today.year, quarterStartMonth, 1);
      to = zonedTimeToInstant(tz, today.year, quarterStartMonth + 3, 1);
      break;
    case 'last_quarter':
      from = zonedTimeToInstant(tz, today.year, quarterStartMonth - 3, 1);
      to = zonedTimeToInstant(tz, today.year, quarterStartMonth, 1);
      break;
    case 'this_year':
      from = zonedTimeToInstant(tz, today.year, 1, 1);
      to = zonedTimeToInstant(tz, today.year + 1, 1, 1);
      break;
    case 'last_year':
      from = zonedTimeToInstant(tz, today.year - 1, 1, 1);
      to = zonedTimeToInstant(tz, today.year, 1, 1);
      break;
    case 'last_12_months':
      from = zonedTimeToInstant(tz, today.year, today.month - 11, 1);
      to = zonedTimeToInstant(tz, today.year, today.month + 1, 1);
      break;
  }

  const spanMs = to.getTime() - from.getTime();

  return {
    preset,
    label: PERIOD_LABELS[preset],
    from,
    to,
    granularity: granularityOverride ?? defaultGranularity(spanMs),
    previous: { from: new Date(from.getTime() - spanMs), to: from },
  };
}

const DAY_MS = 86_400_000;

/** Picks a bucket size that yields a readable number of points. */
export function defaultGranularity(spanMs: number): Granularity {
  const days = spanMs / DAY_MS;
  if (days <= 2) return 'day';
  if (days <= 62) return 'day';
  if (days <= 190) return 'week';
  if (days <= 400) return 'month';
  if (days <= 1500) return 'quarter';
  return 'year';
}

/** Granularities that make sense for a span; finer ones would be unreadable. */
export function allowedGranularities(spanMs: number): Granularity[] {
  const days = spanMs / DAY_MS;
  const allowed: Granularity[] = ['day'];
  if (days > 13) allowed.push('week');
  if (days > 45) allowed.push('month');
  if (days > 120) allowed.push('quarter');
  if (days > 366) allowed.push('year');
  return allowed;
}

/** Percentage change between two periods, or null when there is no baseline. */
export function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
