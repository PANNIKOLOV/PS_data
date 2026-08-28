'use client';

import { useEffect, useState } from 'react';

import { SERIES_FALLBACKS, SERIES_VARS, cssVar } from '@/components/charts/chart-theme';

export interface ChartColors {
  series: string[];
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}

const SERVER_COLORS: ChartColors = {
  series: [...SERIES_FALLBACKS],
  grid: '#e5e7eb',
  axis: '#9ca3af',
  tooltipBg: '#ffffff',
  tooltipBorder: '#e5e7eb',
  tooltipText: '#111827',
};

/**
 * Resolves theme colours for Recharts, re-reading them when the theme toggles.
 *
 * Watching the `class` attribute on <html> is what keeps chart colours in step
 * with the light/dark switch without a page reload.
 */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(SERVER_COLORS);

  useEffect(() => {
    const read = (): ChartColors => ({
      series: SERIES_VARS.map((name, index) => cssVar(name, SERIES_FALLBACKS[index]!)),
      grid: cssVar('--grid-line', SERVER_COLORS.grid),
      axis: cssVar('--text-muted', SERVER_COLORS.axis),
      tooltipBg: cssVar('--surface-card', SERVER_COLORS.tooltipBg),
      tooltipBorder: cssVar('--border-subtle', SERVER_COLORS.tooltipBorder),
      tooltipText: cssVar('--text-primary', SERVER_COLORS.tooltipText),
    });

    setColors(read());

    const observer = new MutationObserver(() => setColors(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return colors;
}
