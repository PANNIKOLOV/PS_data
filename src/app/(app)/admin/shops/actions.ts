'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth';
import { decryptSecret, encryptSecret, fingerprintSecret } from '@/lib/crypto';
import { PrestaShopClient, PrestaShopError } from '@/lib/prestashop/client';
import { syncShop } from '@/lib/prestashop/sync';
import {
  MAX_MANUAL_SYNC_LIMIT,
  MAX_SYNC_INTERVAL_MINUTES,
  MIN_SYNC_INTERVAL_MINUTES,
} from '@/lib/sync-schedule';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Shop administration.
 *
 * Every action re-checks that the caller is an admin. A server action is a POST
 * endpoint, so the admin layout guarding the page it was rendered on is not
 * sufficient protection on its own.
 */

export interface ActionState {
  error?: string;
  success?: string;
}

export interface DiagnosisState {
  status?: 'ok' | 'failed';
  message?: string;
  hint?: string;
  /** Raw facts about the attempt, shown verbatim so nothing is interpreted away. */
  report?: { label: string; value: string }[];
}

const REQUIRED_RESOURCES = ['orders', 'customers', 'order_states', 'currencies'] as const;

/**
 * Tests a connection from the values currently in the form, before anything is
 * saved, and reports exactly what happened: the URL that was requested, the
 * HTTP status, the shop's own response, and which resources the key can see.
 *
 * On the edit form an empty key field means "test with the stored key", the
 * same convention the save action uses.
 */
export async function diagnoseShopConnection(
  _prev: DiagnosisState,
  formData: FormData,
): Promise<DiagnosisState> {
  await requireAdmin();

  const rawUrl = String(formData.get('baseUrl') ?? '').trim();
  let apiKey = String(formData.get('apiKey') ?? '').trim();
  const shopId = String(formData.get('shopId') ?? '');

  if (!rawUrl) return { status: 'failed', message: 'Enter the shop URL first.' };

  if (!apiKey && shopId) {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from('shop_credentials')
      .select('api_key_cipher')
      .eq('shop_id', shopId)
      .single();
    if (data) apiKey = decryptSecret(data.api_key_cipher);
  }

  if (!apiKey) return { status: 'failed', message: 'Enter the webservice key first.' };

  let client: PrestaShopClient;
  try {
    client = new PrestaShopClient({ baseUrl: rawUrl, apiKey });
  } catch (error) {
    return { status: 'failed', message: describeConnectionError(error) };
  }

  const report: { label: string; value: string }[] = [
    { label: 'Requested URL', value: client.apiRoot },
  ];

  try {
    const { version, resources } = await client.testConnection();

    report.push({ label: 'HTTP status', value: '200 OK' });
    report.push({
      label: 'PrestaShop version (PSWS-Version header)',
      value: version ?? 'not reported',
    });
    report.push({
      label: 'Resources visible to this key',
      value: resources.length > 0 ? resources.join(', ') : 'none',
    });

    const missing = REQUIRED_RESOURCES.filter((resource) => !resources.includes(resource));
    if (missing.length > 0) {
      report.push({ label: 'Missing required resources', value: missing.join(', ') });
      return {
        status: 'failed',
        message: `Connected, but the key has no access to: ${missing.join(', ')}.`,
        hint: 'In the shop back office, grant the key GET permission on those resources under Advanced Parameters → Webservice.',
        report,
      };
    }

    return {
      status: 'ok',
      message: `Connected successfully${version ? ` to PrestaShop ${version}` : ''}.`,
      report,
    };
  } catch (error) {
    if (error instanceof PrestaShopError) {
      if (error.url) report[0] = { label: 'Requested URL', value: error.url };
      report.push({
        label: 'HTTP status',
        value: error.status ? String(error.status) : 'no HTTP response (network-level failure)',
      });
      if (error.bodySnippet) {
        report.push({ label: 'Server response (first 300 characters)', value: error.bodySnippet });
      }
      return { status: 'failed', message: error.message, hint: error.hint, report };
    }

    return { status: 'failed', message: describeConnectionError(error), report };
  }
}

const shopSchema = z.object({
  name: z.string().trim().min(1, 'Give the shop a name.').max(120),
  baseUrl: z
    .string()
    .trim()
    .min(1, 'Enter the shop URL.')
    .transform((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Enter a valid shop URL, for example https://shop.example.com'),
  psVersion: z.enum(['1.7', '8', '9']),
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code such as EUR.'),
  timezone: z.string().trim().min(1, 'Choose a timezone.'),
  // Bounds mirror the shops_sync_interval_range / shops_manual_sync_limit_range
  // check constraints, so a rejected value reads as a form error rather than a
  // database one.
  syncIntervalMinutes: z.coerce
    .number()
    .int('Choose a sync frequency.')
    .min(MIN_SYNC_INTERVAL_MINUTES, 'Choose a sync frequency.')
    .max(MAX_SYNC_INTERVAL_MINUTES, 'The longest supported interval is one week.'),
  manualSyncDailyLimit: z.coerce
    .number()
    .int('Choose a daily sync limit.')
    .min(0, 'A daily limit cannot be negative.')
    .max(MAX_MANUAL_SYNC_LIMIT, `The highest daily limit is ${MAX_MANUAL_SYNC_LIMIT}.`),
  apiKey: z.string().trim().optional(),
});

function readShopForm(formData: FormData) {
  return shopSchema.safeParse({
    name: formData.get('name'),
    baseUrl: formData.get('baseUrl'),
    psVersion: formData.get('psVersion'),
    currencyCode: formData.get('currencyCode'),
    timezone: formData.get('timezone'),
    syncIntervalMinutes: formData.get('syncIntervalMinutes') ?? 1440,
    manualSyncDailyLimit: formData.get('manualSyncDailyLimit') ?? 5,
    apiKey: formData.get('apiKey') ?? undefined,
  });
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export async function createShop(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();

  const parsed = readShopForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details you entered.' };
  }

  const {
    name,
    baseUrl,
    psVersion,
    currencyCode,
    timezone,
    apiKey,
    syncIntervalMinutes,
    manualSyncDailyLimit,
  } = parsed.data;

  if (!apiKey) return { error: 'Enter the webservice key for this shop.' };
  if (!isValidTimezone(timezone)) return { error: 'That timezone was not recognised.' };

  // Fail before storing anything if the shop is not actually reachable —
  // a saved-but-broken connection is harder to diagnose later.
  let detectedVersion: string | null = null;
  try {
    const client = new PrestaShopClient({ baseUrl, apiKey });
    const result = await client.testConnection();
    detectedVersion = result.version;
  } catch (error) {
    return { error: describeConnectionError(error) };
  }

  const supabase = createAdminClient();

  const { data: shop, error: insertError } = await supabase
    .from('shops')
    .insert({
      name,
      base_url: baseUrl,
      ps_version: psVersion,
      detected_version: detectedVersion,
      currency_code: currencyCode,
      timezone,
      sync_interval_minutes: syncIntervalMinutes,
      manual_sync_daily_limit: manualSyncDailyLimit,
      created_by: admin.id,
    })
    .select('id')
    .single();

  if (insertError || !shop) {
    return {
      error: `The shop could not be saved: ${describeDatabaseError(insertError?.message ?? 'unknown error')}`,
    };
  }

  const { error: credentialError } = await supabase.from('shop_credentials').insert({
    shop_id: shop.id,
    api_key_cipher: encryptSecret(apiKey),
    key_fingerprint: fingerprintSecret(apiKey),
  });

  if (credentialError) {
    // Without a key the shop can never sync, so do not leave a dead record behind.
    await supabase.from('shops').delete().eq('id', shop.id);
    return {
      error: `The webservice key could not be stored: ${describeDatabaseError(credentialError.message)}`,
    };
  }

  revalidatePath('/admin/shops');
  revalidatePath('/shops');
  redirect(`/admin/shops/${shop.id}?created=1`);
}

export async function updateShop(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();

  const shopId = String(formData.get('shopId') ?? '');
  if (!shopId) return { error: 'No shop was specified.' };

  const parsed = readShopForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details you entered.' };
  }

  const {
    name,
    baseUrl,
    psVersion,
    currencyCode,
    timezone,
    apiKey,
    syncIntervalMinutes,
    manualSyncDailyLimit,
  } = parsed.data;
  if (!isValidTimezone(timezone)) return { error: 'That timezone was not recognised.' };

  const supabase = createAdminClient();

  const { error } = await supabase
    .from('shops')
    .update({
      name,
      base_url: baseUrl,
      ps_version: psVersion,
      currency_code: currencyCode,
      timezone,
      sync_interval_minutes: syncIntervalMinutes,
      manual_sync_daily_limit: manualSyncDailyLimit,
      is_active: formData.get('isActive') === 'on',
    })
    .eq('id', shopId);

  if (error) return { error: `The shop could not be updated: ${error.message}` };

  // An empty key field means "leave the stored key alone".
  if (apiKey) {
    const { error: credentialError } = await supabase.from('shop_credentials').upsert(
      {
        shop_id: shopId,
        api_key_cipher: encryptSecret(apiKey),
        key_fingerprint: fingerprintSecret(apiKey),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id' },
    );

    if (credentialError) {
      return { error: `The webservice key could not be updated: ${credentialError.message}` };
    }
  }

  revalidatePath('/admin/shops');
  revalidatePath(`/admin/shops/${shopId}`);
  revalidatePath('/shops');
  return { success: 'Shop updated.' };
}

export async function testShopConnection(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const shopId = String(formData.get('shopId') ?? '');
  if (!shopId) return { error: 'No shop was specified.' };

  const supabase = createAdminClient();
  const { data: shop } = await supabase.from('shops').select('*').eq('id', shopId).single();
  if (!shop) return { error: 'That shop no longer exists.' };

  try {
    const { clientForShop } = await import('@/lib/prestashop/sync');
    const client = await clientForShop(shop);
    const { version, resources } = await client.testConnection();

    const required = ['orders', 'customers', 'order_states', 'currencies'];
    const missing = required.filter((resource) => !resources.includes(resource));

    if (missing.length > 0) {
      return {
        error: `Connected, but the key has no access to: ${missing.join(', ')}. Grant GET permission on those resources in the shop back office.`,
      };
    }

    if (version && version !== shop.detected_version) {
      await supabase.from('shops').update({ detected_version: version }).eq('id', shopId);
      revalidatePath(`/admin/shops/${shopId}`);
    }

    return { success: `Connected successfully${version ? ` to PrestaShop ${version}` : ''}.` };
  } catch (error) {
    return { error: describeConnectionError(error) };
  }
}

export async function triggerSync(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();

  const shopId = String(formData.get('shopId') ?? '');
  if (!shopId) return { error: 'No shop was specified.' };

  const mode = formData.get('mode') === 'full' ? 'full' : 'incremental';

  // Admins go through the same claim as marketers. The daily cap does not apply
  // to them, but the guard against two overlapping runs against one shop does,
  // and it keeps every manual run recorded the same way.
  const userClient = await createClient();
  const { data: runId, error: claimError } = await userClient.rpc('claim_manual_sync', {
    p_shop_id: shopId,
  });

  if (claimError || !runId) {
    return { error: claimError?.message ?? 'The sync could not be started.' };
  }

  const supabase = createAdminClient();
  const { data: shop } = await supabase
    .from('shops')
    .select('last_sync_at')
    .eq('id', shopId)
    .single();

  // An incremental run re-reads a short overlap so records updated during the
  // previous run are not missed.
  const since =
    mode === 'full' || !shop?.last_sync_at
      ? undefined
      : new Date(new Date(shop.last_sync_at).getTime() - 60 * 60 * 1000);

  const result = await syncShop(shopId, {
    since,
    triggerSource: 'manual',
    triggeredBy: admin.id,
    runId,
  });

  revalidatePath('/admin/shops');
  revalidatePath(`/admin/shops/${shopId}`);
  revalidatePath('/shops');
  revalidatePath('/dashboard');

  if (result.status === 'failed') {
    return { error: result.error ?? 'The synchronisation failed.' };
  }

  const summary = `Synced ${result.ordersSynced} orders and ${result.customersSynced} customers in ${(result.durationMs / 1000).toFixed(1)}s.`;
  return result.warnings.length > 0
    ? { success: `${summary} ${result.warnings.join(' ')}` }
    : { success: summary };
}

export async function deleteShop(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();

  const shopId = String(formData.get('shopId') ?? '');
  const confirmation = String(formData.get('confirmName') ?? '').trim();
  if (!shopId) return { error: 'No shop was specified.' };

  const supabase = createAdminClient();
  const { data: shop } = await supabase.from('shops').select('name').eq('id', shopId).single();
  if (!shop) return { error: 'That shop no longer exists.' };

  // Typing the name is the only guard against discarding a shop's whole history.
  if (confirmation !== shop.name) {
    return { error: 'Type the shop name exactly to confirm deletion.' };
  }

  const { error } = await supabase.from('shops').delete().eq('id', shopId);
  if (error) return { error: `The shop could not be deleted: ${error.message}` };

  revalidatePath('/admin/shops');
  revalidatePath('/shops');
  redirect('/admin/shops?deleted=1');
}

/**
 * Rewrites a Supabase failure so it cannot be mistaken for a PrestaShop one.
 *
 * Supabase answers a bad service-role key with "Invalid API key", which lands
 * in a form where the user has just typed a PrestaShop webservice key and
 * reads as a verdict on that.
 */
function describeDatabaseError(message: string): string {
  if (/invalid api key|jwt|not authorized|permission denied/i.test(message)) {
    return `The application could not authenticate with its own database (Supabase said: "${message}"). This is not about the shop's webservice key — check SUPABASE_SERVICE_ROLE_KEY in the server's environment, then restart the app.`;
  }
  return message;
}

function describeConnectionError(error: unknown): string {
  if (error instanceof PrestaShopError) {
    return [error.message, error.hint].filter(Boolean).join(' ');
  }
  return error instanceof Error ? error.message : 'Could not connect to the shop.';
}
