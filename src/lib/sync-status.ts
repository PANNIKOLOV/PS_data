import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * The caller's manual-sync allowance for one shop.
 *
 * Read through the request-scoped client so the database answers for the
 * signed-in user, not for the service role. The same function that reports the
 * allowance here is not the one that enforces it — `claim_manual_sync` does
 * that — so a stale figure on screen can never turn into an extra sync.
 */

export interface ManualSyncQuota {
  used: number;
  allowed: number;
  /** Syncs left today, or null when the caller is not capped. */
  remaining: number | null;
  /** False for admins, who are not capped. */
  isLimited: boolean;
  /** When the count returns to zero, in the shop's timezone. */
  resetsAt: string | null;
}

/** Shown when the shop is not visible, which the page will already have handled. */
const NO_QUOTA: ManualSyncQuota = {
  used: 0,
  allowed: 0,
  remaining: 0,
  isLimited: true,
  resetsAt: null,
};

export async function fetchManualSyncQuota(shopId: string): Promise<ManualSyncQuota> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('manual_sync_quota', { p_shop_id: shopId });

  const row = data?.[0];
  if (error || !row) return NO_QUOTA;

  return {
    used: row.used,
    allowed: row.allowed,
    remaining: row.is_limited ? Math.max(0, row.allowed - row.used) : null,
    isLimited: row.is_limited,
    resetsAt: row.resets_at,
  };
}
