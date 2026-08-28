'use client';

import { useCallback, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarRange, LoaderCircle } from 'lucide-react';

import { Select } from '@/components/ui/field';
import {
  GRANULARITIES,
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type Granularity,
  type PeriodPreset,
} from '@/lib/analytics/periods';
import { cn } from '@/lib/utils';

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly',
};

/**
 * Period, granularity and validity controls.
 *
 * State lives in the URL rather than component state, so a particular view can
 * be bookmarked or shared, and the server component re-renders with real data
 * instead of the client refetching.
 */
export function PeriodFilter({
  preset,
  granularity,
  allowedGranularities,
  onlyValid,
}: {
  preset: PeriodPreset;
  granularity: Granularity;
  allowedGranularities: Granularity[];
  onlyValid: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const update = useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <CalendarRange
          className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-content-muted"
          aria-hidden
        />
        <Select
          aria-label="Reporting period"
          value={preset}
          onChange={(event) => {
            // A new period may not support the current bucket size; let the
            // server pick a suitable default rather than sending an invalid pair.
            update({ period: event.target.value, granularity: null });
          }}
          className="h-9 w-auto min-w-[9.5rem] pl-8 text-xs"
        >
          {PERIOD_PRESETS.map((option) => (
            <option key={option} value={option}>
              {PERIOD_LABELS[option]}
            </option>
          ))}
        </Select>
      </div>

      <Select
        aria-label="Grouping"
        value={granularity}
        onChange={(event) => update({ granularity: event.target.value })}
        className="h-9 w-auto min-w-[7.5rem] text-xs"
      >
        {GRANULARITIES.filter((option) => allowedGranularities.includes(option)).map((option) => (
          <option key={option} value={option}>
            {GRANULARITY_LABELS[option]}
          </option>
        ))}
      </Select>

      <label
        className={cn(
          'inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-surface-card px-3 text-xs font-medium text-content-secondary transition-colors',
          'hover:bg-surface-hover',
        )}
      >
        <input
          type="checkbox"
          checked={onlyValid}
          onChange={(event) => update({ valid: event.target.checked ? '1' : null })}
          className="h-3.5 w-3.5 rounded border-border-strong accent-[var(--accent)]"
        />
        Paid orders only
      </label>

      {isPending ? (
        <LoaderCircle className="h-4 w-4 animate-spin text-content-muted" aria-label="Loading" />
      ) : null}
    </div>
  );
}
