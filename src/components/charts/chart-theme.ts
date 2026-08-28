/**
 * Shared chart styling.
 *
 * Recharts needs concrete values rather than CSS variables for some props, so
 * colours are read from the document at runtime and refreshed when the theme
 * changes. Everything else stays in one place so charts look like one family.
 */

export const CHART_GRID_PROPS = {
  strokeDasharray: '3 3',
  vertical: false,
} as const;

export const AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11 },
} as const;

/** Reads a CSS custom property, with a fallback for server rendering. */
export function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export const SERIES_VARS = [
  '--color-series-1',
  '--color-series-2',
  '--color-series-3',
  '--color-series-4',
  '--color-series-5',
  '--color-series-6',
  '--color-series-7',
  '--color-series-8',
] as const;

export const SERIES_FALLBACKS = [
  '#4f46e5',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#d946ef',
  '#8b5cf6',
  '#38bdf8',
] as const;
