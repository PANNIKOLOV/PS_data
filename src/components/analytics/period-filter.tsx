'use client';

import { useCallback, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarRange, LoaderCircle } from 'lucide-react';

import { Input, Select } from '@/components/ui/field';
import {
  CUSTOM_PERIOD,
  GRANULARITIES,
  MAX_CUSTOM_RANGE_DAYS,
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type Granularity,
  type PeriodSelection,
} from '@/lib/analytics/periods';
import { cn } from '@/lib/utils';

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly',
};

/** Earliest date the inputs offer. PrestaShop shops predate this rarely enough. */
const EARLIEST = '2000-01-01';

/** Adds days to a `YYYY-MM-DD` string, staying on the calendar. */
function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

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
  rangeStart,
  rangeEnd,
}: {
  preset: PeriodSelection;
  granularity: Granularity;
  allowedGranularities: Granularity[];
  onlyValid: boolean;
  /** The period currently on screen, as calendar dates, `rangeEnd` inclusive. */
  rangeStart: string;
  rangeEnd: string;
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

  const isCustom = preset === CUSTOM_PERIOD;

  /*
   * Both ends move together so the pair is never invalid on its way to the URL.
   * Dragging the start past the end, or the end before the start, collapses the
   * range to that single day — which is what a date picker normally does, and
   * avoids a round trip that would only be rejected server-side.
   */
  const setStart = (value: string) => {
    if (!value) return;
    update({ period: CUSTOM_PERIOD, from: value, to: value > rangeEnd ? value : rangeEnd });
  };

  const setEnd = (value: string) => {
    if (!value) return;
    update({ period: CUSTOM_PERIOD, from: value < rangeStart ? value : rangeStart, to: value });
  };

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
            const value = event.target.value;
            // A new period may not support the current bucket size; let the
            // server pick a suitable default rather than sending an invalid pair.
            if (value === CUSTOM_PERIOD) {
              // Seed the pickers with the window already on screen, so choosing
              // "Custom range" never blanks the page while two dates are typed.
              update({ period: value, from: rangeStart, to: rangeEnd, granularity: null });
            } else {
              update({ period: value, from: null, to: null, granularity: null });
            }
          }}
          className="h-9 w-auto min-w-[9.5rem] pl-8 text-xs"
        >
          {PERIOD_PRESETS.map((option) => (
            <option key={option} value={option}>
              {PERIOD_LABELS[option]}
            </option>
          ))}
          <option value={CUSTOM_PERIOD}>Custom range…</option>
        </Select>
      </div>

      {isCustom ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="Range start date"
            value={rangeStart}
            min={EARLIEST}
            max={rangeEnd}
            onChange={(event) => setStart(event.target.value)}
            className="h-9 w-auto text-xs"
          />
          <span aria-hidden className="text-xs text-content-muted">
            to
          </span>
          <Input
            type="date"
            aria-label="Range end date"
            value={rangeEnd}
            min={rangeStart}
            // Both ends are capped so the span can never exceed what the
            // resolver accepts; the server checks it again regardless.
            max={shiftDays(rangeStart, MAX_CUSTOM_RANGE_DAYS - 1)}
            onChange={(event) => setEnd(event.target.value)}
            className="h-9 w-auto text-xs"
          />
        </div>
      ) : null}

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
