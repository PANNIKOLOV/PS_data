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

/**
 * A hand-picked range, rather than one of the presets.
 *
 * Kept out of PERIOD_PRESETS so the switch in `resolvePeriod` stays exhaustive:
 * a custom range needs two dates, which a preset name cannot carry.
 */
export const CUSTOM_PERIOD = 'custom';
export type PeriodSelection = PeriodPreset | typeof CUSTOM_PERIOD;

/**
 * The longest custom range on offer.
 *
 * Not a database limit — the analytics functions aggregate server-side and cope
 * with more — but a span nobody reads in one chart, and a cheap guard against a
 * hand-edited URL asking for a thousand years of empty buckets.
 */
export const MAX_CUSTOM_RANGE_DAYS = 1827; // five years

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
  preset: PeriodSelection;
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

/** A calendar date the shop would recognise, as `YYYY-MM-DD`. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Reads `YYYY-MM-DD`, rejecting anything that is not a real date.
 *
 * The round-trip check is what catches 2026-02-30: Date.UTC would roll it
 * forward to 2 March rather than refusing it.
 */
export function parseCalendarDate(value: string | undefined | null): CalendarDate | null {
  const match = typeof value === 'string' ? CALENDAR_DATE.exec(value) : null;
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 2000 || year > 2100) return null;

  const rolled = new Date(Date.UTC(year, month - 1, day));
  if (
    rolled.getUTCFullYear() !== year ||
    rolled.getUTCMonth() + 1 !== month ||
    rolled.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** Renders an instant as the calendar date a `<input type="date">` expects. */
export function toCalendarDate(instant: Date, timezone: string): string {
  const parts = partsInTimezone(instant, safeTimezone(timezone));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
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

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * "1 Mar – 15 Apr 2026", dropping whatever both ends share.
 *
 * Built from the calendar fields rather than formatted from the instants: these
 * dates are already the shop's own, and rendering them through Intl in the
 * viewer's zone would shift them by a day at the edges.
 */
function describeRange(from: CalendarDate, to: CalendarDate): string {
  const day = (date: CalendarDate) => `${date.day} ${MONTH_NAMES[date.month - 1]}`;

  if (from.year === to.year && from.month === to.month && from.day === to.day) {
    return `${day(from)} ${from.year}`;
  }
  if (from.year === to.year) {
    return `${day(from)} – ${day(to)} ${to.year}`;
  }
  return `${day(from)} ${from.year} – ${day(to)} ${to.year}`;
}

/**
 * Resolves a hand-picked range, or null when it is not usable.
 *
 * `to` is the last day the viewer wants included, which is how a date picker
 * reads; the returned range runs to the following local midnight so it stays
 * half-open like every other period here.
 *
 * Returning null rather than clamping is deliberate: a caller that cannot make
 * sense of the dates should fall back to a period the viewer can see is not
 * what they asked for, instead of quietly reporting on a different window.
 */
export function resolveCustomPeriod(
  fromValue: string | undefined | null,
  toValue: string | undefined | null,
  timezone: string,
  granularityOverride?: Granularity,
): ResolvedPeriod | null {
  const startDate = parseCalendarDate(fromValue);
  const endDate = parseCalendarDate(toValue);
  if (!startDate || !endDate) return null;

  const tz = safeTimezone(timezone);
  const from = zonedTimeToInstant(tz, startDate.year, startDate.month, startDate.day);
  const to = zonedTimeToInstant(tz, endDate.year, endDate.month, endDate.day + 1);

  const spanMs = to.getTime() - from.getTime();
  if (spanMs <= 0) return null;
  if (spanMs > MAX_CUSTOM_RANGE_DAYS * DAY_MS) return null;

  return {
    preset: CUSTOM_PERIOD,
    label: describeRange(startDate, endDate),
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
