import { NextResponse, type NextRequest } from 'next/server';

import { safeCompare } from '@/lib/crypto';
import { serverEnv } from '@/lib/env';
import { syncShop } from '@/lib/prestashop/sync';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Scheduled synchronisation for every active shop.
 *
 * Point a scheduler at this endpoint (Vercel Cron, GitHub Actions, or a plain
 * cron job running curl) with the shared secret in the Authorization header:
 *
 *   curl -X POST https://your-app/api/cron/sync \
 *        -H "Authorization: Bearer $SYNC_CRON_SECRET"
 *
 * Shops are synced one at a time rather than in parallel, to avoid a burst of
 * concurrent requests against several shops and to keep memory flat.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Overlap re-read on each run, so records updated mid-sync are not missed. */
const OVERLAP_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const configuredSecret = serverEnv().SYNC_CRON_SECRET;

  // Without a configured secret the endpoint stays closed rather than open.
  if (!configuredSecret) {
    return NextResponse.json(
      { error: 'Scheduled sync is not configured. Set SYNC_CRON_SECRET to enable it.' },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!provided || !safeCompare(provided, configuredSecret)) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: shops, error } = await supabase
    .from('shops')
    .select('id, name, last_sync_at')
    .eq('is_active', true);

  if (error) {
    return NextResponse.json({ error: `Could not list shops: ${error.message}` }, { status: 500 });
  }

  const results = [];
  for (const shop of shops ?? []) {
    const since = shop.last_sync_at
      ? new Date(new Date(shop.last_sync_at).getTime() - OVERLAP_MS)
      : undefined;

    try {
      const result = await syncShop(shop.id, { since, triggerSource: 'scheduled' });
      results.push({
        shop: shop.name,
        status: result.status,
        orders: result.ordersSynced,
        customers: result.customersSynced,
      });
    } catch (syncError) {
      // One unreachable shop must not abandon the rest of the run.
      results.push({
        shop: shop.name,
        status: 'failed' as const,
        error: syncError instanceof Error ? syncError.message : 'Unknown error',
      });
    }
  }

  const failed = results.filter((result) => result.status === 'failed').length;

  return NextResponse.json(
    { synced: results.length, failed, results },
    { status: failed > 0 && failed === results.length && results.length > 0 ? 500 : 200 },
  );
}
