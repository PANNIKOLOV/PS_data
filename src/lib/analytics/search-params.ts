import {
  allowedGranularities,
  CUSTOM_PERIOD,
  isGranularity,
  isPeriodPreset,
  resolveCustomPeriod,
  resolvePeriod,
  toCalendarDate,
  type Granularity,
  type PeriodPreset,
  type ResolvedPeriod,
} from '@/lib/analytics/periods';

/**
 * Parses dashboard query parameters into a validated view state.
 *
 * Everything is bounds-checked: an unknown period, an unusable granularity for
 * the chosen span, an impossible date pair, or an unrecognised shop id all fall
 * back to a safe default rather than reaching the database.
 */

export interface DashboardParams {
  period: ResolvedPeriod;
  granularity: Granularity;
  granularityOptions: Granularity[];
  onlyValid: boolean;
  selectedShopIds: string[];
  /**
   * The resolved period as calendar dates in the shop's timezone, `to`
   * inclusive. Pre-fills the date inputs, so switching to a custom range starts
   * from the window already on screen rather than from nothing.
   */
  rangeStart: string;
  rangeEnd: string;
}

export interface RawSearchParams {
  period?: string;
  /** Custom range bounds, `YYYY-MM-DD`, read only when period is "custom". */
  from?: string;
  to?: string;
  granularity?: string;
  valid?: string;
  shop?: string | string[];
}

const DEFAULT_PRESET: PeriodPreset = 'last_30_days';

/**
 * The period the query string asks for, or the default when it cannot be had.
 *
 * Resolved twice by the caller — once to learn the span, once with the chosen
 * granularity — so it is a function rather than inline.
 */
function resolveRequestedPeriod(
  raw: RawSearchParams,
  timezone: string,
  now: Date,
  granularity?: Granularity,
): ResolvedPeriod {
  if (raw.period === CUSTOM_PERIOD) {
    const custom = resolveCustomPeriod(raw.from, raw.to, timezone, granularity);
    // A malformed or reversed pair falls through to the preset below rather
    // than erroring: the viewer sees a period they recognise as not theirs.
    if (custom) return custom;
  }

  const preset = raw.period && isPeriodPreset(raw.period) ? raw.period : DEFAULT_PRESET;
  return resolvePeriod(preset, timezone, now, granularity);
}

export function parseDashboardParams(
  raw: RawSearchParams,
  availableShopIds: readonly string[],
  timezone: string,
  now: Date = new Date(),
): DashboardParams {
  // Resolve once to learn the span, which decides which granularities are usable.
  const base = resolveRequestedPeriod(raw, timezone, now);
  const options = allowedGranularities(base.to.getTime() - base.from.getTime());

  const requested = raw.granularity;
  const granularity =
    requested && isGranularity(requested) && options.includes(requested)
      ? requested
      : options.includes(base.granularity)
        ? base.granularity
        : options[options.length - 1]!;

  const period = resolveRequestedPeriod(raw, timezone, now, granularity);

  // Only ids the viewer actually has access to survive; unknown ids are dropped
  // rather than passed through to the query.
  const requestedShops = raw.shop === undefined ? [] : Array.isArray(raw.shop) ? raw.shop : [raw.shop];
  const filtered = requestedShops.filter((id) => availableShopIds.includes(id));

  return {
    period,
    granularity,
    granularityOptions: options,
    onlyValid: raw.valid === '1' || raw.valid === 'true',
    selectedShopIds: filtered.length > 0 ? filtered : [...availableShopIds],
    rangeStart: toCalendarDate(period.from, timezone),
    // The range is half-open, so its last included day is the moment before it ends.
    rangeEnd: toCalendarDate(new Date(period.to.getTime() - 1), timezone),
  };
}
