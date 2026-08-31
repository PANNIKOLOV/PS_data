'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react';

import { requestShopSync, type SyncRequestState } from '@/app/(app)/shops/actions';
import { Button } from '@/components/ui/button';
import { describeCadence } from '@/lib/sync-schedule';
import type { ManualSyncQuota } from '@/lib/sync-status';
import { formatRelativeTime } from '@/lib/utils';

/**
 * The refresh bar above a shop's figures: when the data was last pulled, what
 * the viewer has left today, and the button that pulls it now.
 *
 * It sits on its own row rather than among the header actions because a sync
 * takes seconds and reports back in a sentence — there has to be room for that
 * sentence without the page jumping.
 *
 * The button disables itself once the allowance is gone, but that is only a
 * courtesy: the cap is enforced in the database, so a stale page or a
 * hand-made POST is refused there rather than here.
 */

function SubmitButton({ exhausted }: { exhausted: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="primary" size="sm" disabled={pending || exhausted}>
      {pending ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
      )}
      {pending ? 'Syncing…' : 'Sync now'}
    </Button>
  );
}

/** "Refreshes every 6 hours", or a plain statement that nothing is scheduled. */
function cadenceLine(intervalMinutes: number): string {
  return intervalMinutes > 0
    ? `Refreshes ${describeCadence(intervalMinutes).toLowerCase()}`
    : 'No automatic refresh';
}

/** "3 of 5 left today", or the reset time once the allowance is spent. */
function quotaLine(quota: ManualSyncQuota, timezone: string): string {
  if (!quota.isLimited) return 'No daily limit on your account';
  if (quota.allowed === 0) return 'Manual refresh is turned off for this shop';

  const remaining = quota.remaining ?? 0;
  if (remaining > 0) {
    return `${remaining} of ${quota.allowed} refreshes left today`;
  }

  const resets = quota.resetsAt
    ? new Date(quota.resetsAt).toLocaleTimeString('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return resets
    ? `Daily limit reached — resets at ${resets}, ${timezone} time`
    : 'Daily limit reached for today';
}

export function SyncNowBar({
  shopId,
  quota,
  timezone,
  lastSyncAt,
  intervalMinutes,
}: {
  shopId: string;
  quota: ManualSyncQuota;
  timezone: string;
  lastSyncAt: string | null;
  intervalMinutes: number;
}) {
  const [state, formAction] = useActionState<SyncRequestState, FormData>(requestShopSync, {});

  const exhausted = quota.isLimited && (quota.allowed === 0 || (quota.remaining ?? 0) <= 0);

  return (
    <div className="mb-4 rounded-(--radius-card) border border-border-subtle bg-surface-card px-4 py-3 card-shadow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-content-primary">
            Data last refreshed {formatRelativeTime(lastSyncAt)}
          </p>
          <p className="mt-0.5 text-xs text-content-muted">
            {cadenceLine(intervalMinutes)} · {quotaLine(quota, timezone)}
          </p>
        </div>

        <form action={formAction} className="shrink-0">
          <input type="hidden" name="shopId" value={shopId} />
          <SubmitButton exhausted={exhausted} />
        </form>
      </div>

      {state.error ? (
        <p
          role="alert"
          className="mt-2.5 flex items-start gap-1.5 border-t border-border-subtle pt-2.5 text-xs text-negative"
        >
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </p>
      ) : null}

      {state.success ? (
        <p
          role="status"
          className="mt-2.5 flex items-start gap-1.5 border-t border-border-subtle pt-2.5 text-xs text-positive"
        >
          <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{state.success}</span>
        </p>
      ) : null}
    </div>
  );
}
