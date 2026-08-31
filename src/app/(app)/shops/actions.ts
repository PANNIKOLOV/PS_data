'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { syncShop } from '@/lib/prestashop/sync';
import { createClient } from '@/lib/supabase/server';

/**
 * Marketer-initiated refresh.
 *
 * A server action is a POST endpoint, so this re-checks the caller rather than
 * trusting the page that rendered the button.
 *
 * The access check and the daily cap are both made by `claim_manual_sync` in
 * the database, under the caller's own identity. That matters because the sync
 * engine itself runs with the service role and bypasses Row Level Security: if
 * the decision were made here, this function would be the only thing between a
 * marketer and unlimited requests against the shop's server. The claim also
 * records the run, so the row the cap counts is the row this sync reports to.
 */

export interface SyncRequestState {
  error?: string;
  success?: string;
}

/** Re-read window, matching the admin incremental sync. */
const OVERLAP_MS = 60 * 60 * 1000;

export async function requestShopSync(
  _prev: SyncRequestState,
  formData: FormData,
): Promise<SyncRequestState> {
  const user = await requireUser();

  const shopId = String(formData.get('shopId') ?? '');
  if (!shopId) return { error: 'No shop was specified.' };

  const supabase = await createClient();

  const { data: runId, error: claimError } = await supabase.rpc('claim_manual_sync', {
    p_shop_id: shopId,
  });

  if (claimError || !runId) {
    return { error: describeClaimFailure(claimError) };
  }

  // Row Level Security already limits this to shops the caller may see, and the
  // claim above has confirmed the same thing.
  const { data: shop } = await supabase
    .from('shops')
    .select('last_sync_at')
    .eq('id', shopId)
    .single();

  const since = shop?.last_sync_at
    ? new Date(new Date(shop.last_sync_at).getTime() - OVERLAP_MS)
    : undefined;

  const result = await syncShop(shopId, {
    since,
    triggerSource: 'manual',
    triggeredBy: user.id,
    runId,
  });

  revalidatePath('/shops');
  revalidatePath(`/shops/${shopId}`);
  revalidatePath('/dashboard');

  if (result.status === 'failed') {
    return {
      error: `${result.error ?? 'The refresh failed.'} This attempt still counts towards today's limit.`,
    };
  }

  const summary =
    result.ordersSynced === 0 && result.customersSynced === 0
      ? 'Up to date — nothing new since the last sync.'
      : `Refreshed: ${result.ordersSynced} orders and ${result.customersSynced} customer records.`;

  return result.warnings.length > 0
    ? { success: `${summary} ${result.warnings.join(' ')}` }
    : { success: summary };
}

/**
 * Turns a rejected claim into something a marketer can act on.
 *
 * The database raises with its own SQLSTATE per reason, so the message can be
 * matched on the code rather than on wording that a future edit would break.
 */
function describeClaimFailure(error: { code?: string; message?: string } | null): string {
  switch (error?.code) {
    case 'PS001': // Daily cap reached.
    case 'PS002': // Another sync is already running.
    case 'PS003': // Shop paused, or manual syncing turned off.
      return error.message ?? 'This shop cannot be refreshed right now.';
    case '42501':
      return 'That shop is not available to you.';
    default:
      return error?.message
        ? `The refresh could not be started: ${error.message}`
        : 'The refresh could not be started.';
  }
}
