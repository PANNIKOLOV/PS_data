import { NextResponse, type NextRequest } from 'next/server';

import { safeCompare } from '@/lib/crypto';
import { serverEnv } from '@/lib/env';
import { syncShop } from '@/lib/prestashop/sync';
import { isSyncDue } from '@/lib/sync-schedule';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Scheduled synchronisation for the shops that are due.
 *
 * Point a scheduler at this endpoint (Vercel Cron, GitHub Actions, or a plain
 * cron job running curl) with the shared secret in the Authorization header:
 *
 *   curl -X POST https://your-app/api/cron/sync \
 *        -H "Authorization: Bearer $SYNC_CRON_SECRET"
 *
 * Run it often — hourly, or every fifteen minutes. Each shop carries its own
 * cadence (`shops.sync_interval_minutes`), and shops whose interval has not yet
 * elapsed are skipped, so a frequent tick costs nothing beyond one query. That
 * is what lets an admin choose hourly for one shop and weekly for another
 * against a single cron entry.
 *
 * Every tick is recorded in `scheduler_runs`, including ones with nothing to
 * do, so **Sync history** can tell a cron that is not running from one that
 * simply had no work.
 *
 * Shops are synced one at a time rather than in parallel, to avoid a burst of
 * concurrent requests against several shops and to keep memory flat.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Overlap re-read on each run, so records updated mid-sync are not missed. */
const OVERLAP_MS = 60 * 60 * 1000;

/** Ticks older than this are pruned, so the log stays a window not an archive. */
const TICK_RETENTION_DAYS = 30;

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

  // An unauthenticated caller is not recorded: the tick log is a record of the
  // real schedule, and anyone on the internet could otherwise fill it.
  if (!provided || !safeCompare(provided, configuredSecret)) {
    return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  }

  const startedAt = Date.now();
  const supabase = createAdminClient();

  const { data: shops, error } = await supabase
    .from('shops')
    .select('id, name, is_active, sync_interval_minutes, last_sync_at')
    .eq('is_active', true);

  if (error) {
    // Recorded too — a run that could not even list shops is exactly the kind
    // of failure that would otherwise be invisible.
    await recordTick({
      shops_considered: 0,
      shops_due: 0,
      shops_synced: 0,
      shops_failed: 0,
      duration_ms: Date.now() - startedAt,
      error_message: `Could not list shops: ${error.message}`,
    });
    return NextResponse.json({ error: `Could not list shops: ${error.message}` }, { status: 500 });
  }

  const now = new Date();
  const considered = shops ?? [];
  const due = considered.filter((shop) => isSyncDue(shop, now));

  const results = [];
  for (const shop of due) {
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

  await recordTick({
    shops_considered: considered.length,
    shops_due: due.length,
    shops_synced: results.length - failed,
    shops_failed: failed,
    duration_ms: Date.now() - startedAt,
    error_message:
      failed > 0
        ? results
            .filter((result) => result.status === 'failed')
            .map((result) => `${result.shop}: ${'error' in result ? result.error : 'failed'}`)
            .join(' · ')
        : null,
  });

  return NextResponse.json(
    { considered: considered.length, due: due.length, synced: results.length, failed, results },
    { status: failed > 0 && failed === results.length && results.length > 0 ? 500 : 200 },
  );
}

/**
 * Writes the tick, then trims the log.
 *
 * Never throws: a failure to record must not turn a successful sync into a 500,
 * because the figures are already in place by the time this runs.
 */
async function recordTick(row: {
  shops_considered: number;
  shops_due: number;
  shops_synced: number;
  shops_failed: number;
  duration_ms: number;
  error_message: string | null;
}): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from('scheduler_runs').insert(row);
    await supabase
      .from('scheduler_runs')
      .delete()
      .lt('ran_at', new Date(Date.now() - TICK_RETENTION_DAYS * 86_400_000).toISOString());
  } catch {
    // Nothing useful to do here; the response still reports the real outcome.
  }
}
