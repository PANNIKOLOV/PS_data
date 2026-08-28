import type { LucideIcon } from 'lucide-react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { cn, formatPercent } from '@/lib/utils';

/**
 * A single headline figure with its period-on-period movement.
 *
 * `invertTrend` exists for metrics where a rise is bad; nothing uses it yet,
 * but discounts and refunds are the obvious future callers.
 */
export function StatTile({
  label,
  value,
  change,
  icon: Icon,
  hint,
  invertTrend = false,
}: {
  label: string;
  value: string;
  change?: number | null;
  icon?: LucideIcon;
  hint?: string;
  invertTrend?: boolean;
}) {
  const hasChange = change !== null && change !== undefined;
  const isFlat = hasChange && Math.abs(change) < 0.05;
  const isPositive = hasChange && !isFlat && (invertTrend ? change < 0 : change > 0);
  const TrendIcon = !hasChange || isFlat ? Minus : change > 0 ? TrendingUp : TrendingDown;

  return (
    <div className="rounded-(--radius-card) border border-border-subtle bg-surface-card p-4 card-shadow">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-content-secondary">{label}</p>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-content-muted" aria-hidden /> : null}
      </div>

      <p className="tabular mt-2 text-2xl font-semibold tracking-tight text-content-primary">
        {value}
      </p>

      <div className="mt-1.5 flex items-center gap-1.5 text-xs">
        {hasChange ? (
          <>
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                isFlat ? 'text-content-muted' : isPositive ? 'text-positive' : 'text-negative',
              )}
            >
              <TrendIcon className="h-3.5 w-3.5" aria-hidden />
              <span className="tabular">{isFlat ? '0.0%' : formatPercent(change)}</span>
            </span>
            <span className="truncate text-content-muted">vs previous period</span>
          </>
        ) : (
          <span className="text-content-muted">{hint ?? 'No prior period to compare'}</span>
        )}
      </div>
    </div>
  );
}
