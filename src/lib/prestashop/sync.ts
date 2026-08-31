import 'server-only';

import { PrestaShopClient, PrestaShopError } from '@/lib/prestashop/client';
import {
  CURRENCY_FIELDS,
  CUSTOMER_FIELDS,
  ORDER_FIELDS,
  ORDER_STATE_FIELDS,
  type RawCurrency,
  type RawCustomer,
  type RawOrder,
  type RawOrderState,
} from '@/lib/prestashop/resources';
import {
  localised,
  parseShopDate,
  toBoolean,
  toInteger,
  toNullableInteger,
  toNumber,
  toTrimmedString,
} from '@/lib/prestashop/normalize';
import { decryptSecret } from '@/lib/crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database, Shop } from '@/lib/supabase/types';

type OrderInsert = Database['public']['Tables']['ps_orders']['Insert'];
type CustomerInsert = Database['public']['Tables']['ps_customers']['Insert'];

export interface SyncOptions {
  /** Only fetch records changed since this instant. Omit for a full backfill. */
  since?: Date;
  triggerSource?: 'manual' | 'scheduled' | 'initial';
  triggeredBy?: string | null;
  /**
   * An already-recorded sync_runs row to report against, from
   * `claim_manual_sync`. The rate limit counts those rows, so a marketer's run
   * must reuse the row that was counted rather than insert a second one.
   */
  runId?: string;
}

export interface SyncResult {
  shopId: string;
  status: 'success' | 'partial' | 'failed';
  ordersSynced: number;
  customersSynced: number;
  durationMs: number;
  error?: string;
  warnings: string[];
}

/** Rows written per upsert call. Large enough to be fast, small enough to stay under payload limits. */
const WRITE_BATCH_SIZE = 500;

/** Records requested per webservice page. */
const READ_PAGE_SIZE = 200;

/**
 * Pulls a shop's order and customer facts into the warehouse.
 *
 * Runs with the service role, because it writes across tenants and reads
 * encrypted credentials. Callers are responsible for checking that the
 * requesting user is allowed to trigger a sync for this shop.
 */
export async function syncShop(shopId: string, options: SyncOptions = {}): Promise<SyncResult> {
  const startedAt = Date.now();
  const supabase = createAdminClient();
  const warnings: string[] = [];

  const { data: shop, error: shopError } = await supabase
    .from('shops')
    .select('*')
    .eq('id', shopId)
    .single();

  if (shopError || !shop) {
    throw new Error(`Shop ${shopId} was not found.`);
  }

  // A run reserved by claim_manual_sync is already recorded; anything else
  // opens its own row here.
  const runId = options.runId ?? (await startRun(shopId, options));

  const finish = async (result: Omit<SyncResult, 'shopId' | 'durationMs'>): Promise<SyncResult> => {
    const durationMs = Date.now() - startedAt;

    if (runId) {
      await supabase
        .from('sync_runs')
        .update({
          status: result.status,
          orders_synced: result.ordersSynced,
          customers_synced: result.customersSynced,
          error_message: result.error ?? null,
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
        })
        .eq('id', runId);
    }

    await supabase
      .from('shops')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: result.status,
        last_sync_error: result.error ?? null,
      })
      .eq('id', shopId);

    return { shopId, durationMs, ...result };
  };

  try {
    const client = await clientForShop(shop);

    // Detect and record the running PrestaShop version. Non-fatal on failure:
    // the sync itself does not depend on knowing the version.
    try {
      const { version } = await client.testConnection();
      if (version && version !== shop.detected_version) {
        await supabase.from('shops').update({ detected_version: version }).eq('id', shopId);
      }
    } catch {
      warnings.push('Could not read the shop version; continuing with the sync.');
    }

    // Reference data first, so order rows can resolve status names immediately.
    await syncOrderStates(client, shop, warnings);
    await syncCurrencies(client, shop, warnings);

    const currencyLookup = await buildCurrencyLookup(shopId);
    const ordersSynced = await syncOrders(client, shop, currencyLookup, options.since);
    const customersSynced = await syncCustomers(client, shop, options.since);

    return await finish({
      status: warnings.length > 0 ? 'partial' : 'success',
      ordersSynced,
      customersSynced,
      warnings,
    });
  } catch (error) {
    const message =
      error instanceof PrestaShopError
        ? [error.message, error.hint].filter(Boolean).join(' ')
        : error instanceof Error
          ? error.message
          : 'Unknown synchronisation error.';

    return await finish({
      status: 'failed',
      ordersSynced: 0,
      customersSynced: 0,
      error: message,
      warnings,
    });
  }
}

/** Opens a sync_runs row, or returns null if the audit write fails. */
async function startRun(shopId: string, options: SyncOptions): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('sync_runs')
    .insert({
      shop_id: shopId,
      status: 'running',
      trigger_source: options.triggerSource ?? 'manual',
      triggered_by: options.triggeredBy ?? null,
    })
    .select('id')
    .single();

  // A missing audit row must not stop the sync; the shop's own last_sync_*
  // columns are still updated when it finishes.
  return data?.id ?? null;
}

/** Builds an authenticated client from a shop's stored, encrypted key. */
export async function clientForShop(shop: Shop): Promise<PrestaShopClient> {
  const supabase = createAdminClient();
  const { data: credentials, error } = await supabase
    .from('shop_credentials')
    .select('api_key_cipher')
    .eq('shop_id', shop.id)
    .single();

  if (error || !credentials) {
    throw new Error('No webservice key is stored for this shop. Add one in the admin panel.');
  }

  return new PrestaShopClient({
    baseUrl: shop.base_url,
    apiKey: decryptSecret(credentials.api_key_cipher),
  });
}

async function syncOrders(
  client: PrestaShopClient,
  shop: Shop,
  currencyLookup: Map<number, string>,
  since?: Date,
): Promise<number> {
  const supabase = createAdminClient();
  const filters: Record<string, string> = {};

  if (since) {
    // PrestaShop compares date filters against the shop's local wall clock.
    filters.date_upd = `[${formatShopTimestamp(since, shop.timezone)},${formatShopTimestamp(new Date(), shop.timezone)}]`;
  }

  let total = 0;
  let batch: OrderInsert[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const { error } = await supabase
      .from('ps_orders')
      .upsert(batch, { onConflict: 'shop_id,ps_order_id' });
    if (error) throw new Error(`Could not store orders: ${error.message}`);
    total += batch.length;
    batch = [];
  };

  for await (const page of client.paginate<RawOrder>(
    'orders',
    {
      display: [...ORDER_FIELDS],
      filters,
      dateFilter: since !== undefined,
      sort: '[id_ASC]',
    },
    READ_PAGE_SIZE,
  )) {
    for (const raw of page) {
      const dateAdd = parseShopDate(raw.date_add, shop.timezone);
      // An order without a usable creation date cannot be placed on a timeline.
      if (!dateAdd) continue;

      const conversionRate = toNumber(raw.conversion_rate, 1) || 1;
      const totalPaid = toNumber(raw.total_paid);
      const currencyId = toInteger(raw.id_currency);

      batch.push({
        shop_id: shop.id,
        ps_order_id: toInteger(raw.id),
        reference: toTrimmedString(raw.reference),
        ps_customer_id: toNullableInteger(raw.id_customer),
        current_state: toNullableInteger(raw.current_state),
        payment_method: toTrimmedString(raw.payment),
        module: toTrimmedString(raw.module),
        is_valid: toBoolean(raw.valid),
        currency_code: currencyLookup.get(currencyId) ?? null,
        conversion_rate: conversionRate,
        total_paid: totalPaid,
        total_paid_real: toNumber(raw.total_paid_real),
        total_products: toNumber(raw.total_products),
        total_shipping: toNumber(raw.total_shipping_tax_incl),
        total_discounts: toNumber(raw.total_discounts_tax_incl),
        // Normalised into the shop's default currency so totals are comparable.
        total_paid_base: round2(totalPaid / conversionRate),
        date_add: dateAdd,
        date_upd: parseShopDate(raw.date_upd, shop.timezone),
        synced_at: new Date().toISOString(),
      });

      if (batch.length >= WRITE_BATCH_SIZE) await flush();
    }
  }

  await flush();
  return total;
}

async function syncCustomers(client: PrestaShopClient, shop: Shop, since?: Date): Promise<number> {
  const supabase = createAdminClient();
  const filters: Record<string, string> = {};

  if (since) {
    filters.date_add = `[${formatShopTimestamp(since, shop.timezone)},${formatShopTimestamp(new Date(), shop.timezone)}]`;
  }

  let total = 0;
  let batch: CustomerInsert[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const { error } = await supabase
      .from('ps_customers')
      .upsert(batch, { onConflict: 'shop_id,ps_customer_id' });
    if (error) throw new Error(`Could not store customers: ${error.message}`);
    total += batch.length;
    batch = [];
  };

  for await (const page of client.paginate<RawCustomer>(
    'customers',
    {
      display: [...CUSTOMER_FIELDS],
      filters,
      dateFilter: since !== undefined,
      sort: '[id_ASC]',
    },
    READ_PAGE_SIZE,
  )) {
    for (const raw of page) {
      const dateAdd = parseShopDate(raw.date_add, shop.timezone);
      if (!dateAdd) continue;

      batch.push({
        shop_id: shop.id,
        ps_customer_id: toInteger(raw.id),
        date_add: dateAdd,
        newsletter: toBoolean(raw.newsletter),
        optin: toBoolean(raw.optin),
        is_active: toBoolean(raw.active),
        is_guest: toBoolean(raw.is_guest),
        synced_at: new Date().toISOString(),
      });

      if (batch.length >= WRITE_BATCH_SIZE) await flush();
    }
  }

  await flush();
  return total;
}

async function syncOrderStates(
  client: PrestaShopClient,
  shop: Shop,
  warnings: string[],
): Promise<void> {
  try {
    const states = await client.list<RawOrderState>('order_states', {
      display: [...ORDER_STATE_FIELDS],
    });
    if (states.length === 0) return;

    const rows = states.map((state) => ({
      shop_id: shop.id,
      ps_state_id: toInteger(state.id),
      name: localised(state.name) ?? `Status ${toInteger(state.id)}`,
      color: toTrimmedString(state.color),
      is_paid: toBoolean(state.paid),
      is_shipped: toBoolean(state.shipped),
      is_deleted: toBoolean(state.deleted),
      synced_at: new Date().toISOString(),
    }));

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('ps_order_states')
      .upsert(rows, { onConflict: 'shop_id,ps_state_id' });
    if (error) throw new Error(error.message);
  } catch (error) {
    // Status names are cosmetic; the dashboard falls back to "Unknown status".
    warnings.push(
      `Order statuses could not be refreshed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}

async function syncCurrencies(
  client: PrestaShopClient,
  shop: Shop,
  warnings: string[],
): Promise<void> {
  try {
    const currencies = await client.list<RawCurrency>('currencies', {
      display: [...CURRENCY_FIELDS],
    });
    if (currencies.length === 0) return;

    const rows = currencies.map((currency) => ({
      shop_id: shop.id,
      ps_currency_id: toInteger(currency.id),
      iso_code: toTrimmedString(currency.iso_code) ?? 'UNK',
      conversion_rate: toNumber(currency.conversion_rate, 1) || 1,
      synced_at: new Date().toISOString(),
    }));

    const supabase = createAdminClient();
    const { error } = await supabase
      .from('ps_currencies')
      .upsert(rows, { onConflict: 'shop_id,ps_currency_id' });
    if (error) throw new Error(error.message);
  } catch (error) {
    warnings.push(
      `Currencies could not be refreshed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}

async function buildCurrencyLookup(shopId: string): Promise<Map<number, string>> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('ps_currencies')
    .select('ps_currency_id, iso_code')
    .eq('shop_id', shopId);

  return new Map((data ?? []).map((row) => [row.ps_currency_id, row.iso_code]));
}

/** Renders an instant as `YYYY-MM-DD HH:MM:SS` in the shop's local time. */
function formatShopTimestamp(instant: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);

    const read = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '00';

    // Intl renders midnight as "24" in some locales/runtimes.
    const hour = read('hour') === '24' ? '00' : read('hour');
    return `${read('year')}-${read('month')}-${read('day')} ${hour}:${read('minute')}:${read('second')}`;
  } catch {
    return instant.toISOString().slice(0, 19).replace('T', ' ');
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
