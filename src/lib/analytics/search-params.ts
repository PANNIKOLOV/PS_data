import {
  allowedGranularities,
  isGranularity,
  isPeriodPreset,
  resolvePeriod,
  type Granularity,
  type PeriodPreset,
  type ResolvedPeriod,
} from '@/lib/analytics/periods';

/**
 * Parses dashboard query parameters into a validated view state.
 *
 * Everything is bounds-checked: an unknown period, an unusable granularity for
 * the chosen span, or an unrecognised shop id all fall back to a safe default
 * rather than reaching the database.
 */

export interface DashboardParams {
  period: ResolvedPeriod;
  granularity: Granularity;
  granularityOptions: Granularity[];
  onlyValid: boolean;
  selectedShopIds: string[];
}

export interface RawSearchParams {
  period?: string;
  granularity?: string;
  valid?: string;
  shop?: string | string[];
}

const DEFAULT_PRESET: PeriodPreset = 'last_30_days';

export function parseDashboardParams(
  raw: RawSearchParams,
  availableShopIds: readonly string[],
  timezone: string,
  now: Date = new Date(),
): DashboardParams {
  const preset = raw.period && isPeriodPreset(raw.period) ? raw.period : DEFAULT_PRESET;

  // Resolve once to learn the span, which decides which granularities are usable.
  const base = resolvePeriod(preset, timezone, now);
  const options = allowedGranularities(base.to.getTime() - base.from.getTime());

  const requested = raw.granularity;
  const granularity =
    requested && isGranularity(requested) && options.includes(requested)
      ? requested
      : options.includes(base.granularity)
        ? base.granularity
        : options[options.length - 1]!;

  const period = resolvePeriod(preset, timezone, now, granularity);

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
  };
}
