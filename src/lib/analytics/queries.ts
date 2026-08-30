import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  sanitiseMetrics,
  shopsAllowingMetric,
  type MetricKeyName,
  type ViewerPermissions,
} from '@/lib/permissions';
import type { DateRange, Granularity } from '@/lib/analytics/periods';
import type { Shop } from '@/lib/supabase/types';

/**
 * Read model for the dashboard.
 *
 * Every call goes through the request-scoped Supabase client, so Row Level
 * Security scopes results to the caller. Permissions are additionally applied
 * here to narrow the shop list *before* querying, which keeps a withheld metric
 * from contributing to a total the viewer is allowed to see.
 */

export interface AnalyticsSummary {
  ordersCount: number;
  revenue: number;
  averageOrderValue: number;
  itemsTotal: number;
  shippingTotal: number;
  discountsTotal: number;
  uniqueCustomers: number;
  newRegistrations: number;
  currencyCount: number;
}

export interface TimeseriesPoint {
  bucket: string;
  ordersCount: number;
  revenue: number;
  newRegistrations: number;
}

export interface BreakdownRow {
  label: string;
  ordersCount: number;
  revenue: number;
  color?: string | null;
}

export interface ShopTotalRow {
  shopId: string;
  shopName: string;
  currencyCode: string;
  ordersCount: number;
  revenue: number;
  newRegistrations: number;
}

const EMPTY_SUMMARY: AnalyticsSummary = {
  ordersCount: 0,
  revenue: 0,
  averageOrderValue: 0,
  itemsTotal: 0,
  shippingTotal: 0,
  discountsTotal: 0,
  uniqueCustomers: 0,
  newRegistrations: 0,
  currencyCount: 0,
};

/** Shops the caller can see, with the metrics they are allowed to see per shop. */
export async function getViewerContext(): Promise<{
  shops: Shop[];
  permissions: ViewerPermissions;
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { shops: [], permissions: { role: 'marketer', metricsByShop: {} } };

  const [{ data: profile }, { data: shops }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    // RLS already restricts this to shops the caller may see.
    supabase.from('shops').select('*').order('name'),
  ]);

  const role = profile?.role === 'admin' ? 'admin' : 'marketer';
  const metricsByShop: Record<string, MetricKeyName[]> = {};

  if (role === 'marketer') {
    const { data: assignments } = await supabase
      .from('shop_assignments')
      .select('shop_id, metrics');

    for (const assignment of assignments ?? []) {
      metricsByShop[assignment.shop_id] = sanitiseMetrics(assignment.metrics ?? []);
    }
  }

  return { shops: shops ?? [], permissions: { role, metricsByShop } };
}

/**
 * Narrows a shop selection to those the viewer may see a metric for.
 * Returns null when no shop qualifies, so callers can skip the query entirely.
 */
function scopeToMetric(
  permissions: ViewerPermissions,
  shopIds: readonly string[],
  metric: MetricKeyName,
): string[] | null {
  const allowed = shopsAllowingMetric(permissions, shopIds, metric);
  return allowed.length > 0 ? allowed : null;
}

export async function fetchSummary(
  shopIds: readonly string[],
  range: DateRange,
  onlyValid: boolean,
): Promise<AnalyticsSummary> {
  if (shopIds.length === 0) return EMPTY_SUMMARY;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('analytics_summary', {
    p_shop_ids: [...shopIds],
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_only_valid: onlyValid,
  });

  if (error || !data || data.length === 0) return EMPTY_SUMMARY;

  const row = data[0]!;
  return {
    ordersCount: Number(row.orders_count ?? 0),
    revenue: Number(row.revenue ?? 0),
    averageOrderValue: Number(row.average_order_value ?? 0),
    itemsTotal: Number(row.items_total ?? 0),
    shippingTotal: Number(row.shipping_total ?? 0),
    discountsTotal: Number(row.discounts_total ?? 0),
    uniqueCustomers: Number(row.unique_customers ?? 0),
    newRegistrations: Number(row.new_registrations ?? 0),
    currencyCount: Number(row.currency_count ?? 0),
  };
}

export async function fetchTimeseries(
  shopIds: readonly string[],
  range: DateRange,
  granularity: Granularity,
  timezone: string,
  onlyValid: boolean,
): Promise<TimeseriesPoint[]> {
  if (shopIds.length === 0) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('analytics_timeseries', {
    p_shop_ids: [...shopIds],
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_granularity: granularity,
    p_timezone: timezone,
    p_only_valid: onlyValid,
  });

  if (error || !data) return [];

  return data.map((row) => ({
    bucket: row.bucket,
    ordersCount: Number(row.orders_count ?? 0),
    revenue: Number(row.revenue ?? 0),
    newRegistrations: Number(row.new_registrations ?? 0),
  }));
}

export async function fetchStatusBreakdown(
  permissions: ViewerPermissions,
  shopIds: readonly string[],
  range: DateRange,
): Promise<BreakdownRow[]> {
  const scoped = scopeToMetric(permissions, shopIds, 'status_breakdown');
  if (!scoped) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('analytics_status_breakdown', {
    p_shop_ids: scoped,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });

  if (error || !data) return [];

  return data.map((row) => ({
    label: row.state_name ?? 'Unknown status',
    ordersCount: Number(row.orders_count ?? 0),
    revenue: Number(row.revenue ?? 0),
    color: row.color,
  }));
}

export async function fetchPaymentBreakdown(
  permissions: ViewerPermissions,
  shopIds: readonly string[],
  range: DateRange,
  onlyValid: boolean,
): Promise<BreakdownRow[]> {
  const scoped = scopeToMetric(permissions, shopIds, 'payment_methods');
  if (!scoped) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('analytics_payment_breakdown', {
    p_shop_ids: scoped,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_only_valid: onlyValid,
  });

  if (error || !data) return [];

  return data.map((row) => ({
    label: row.payment_method ?? 'Unspecified',
    ordersCount: Number(row.orders_count ?? 0),
    revenue: Number(row.revenue ?? 0),
  }));
}

export async function fetchCustomerMix(
  permissions: ViewerPermissions,
  shopIds: readonly string[],
  range: DateRange,
  onlyValid: boolean,
): Promise<BreakdownRow[]> {
  const scoped = scopeToMetric(permissions, shopIds, 'returning');
  if (!scoped) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('analytics_customer_mix', {
    p_shop_ids: scoped,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_only_valid: onlyValid,
  });

  if (error || !data) return [];

  return data.map((row) => ({
    label: row.segment,
    ordersCount: Number(row.orders_count ?? 0),
    revenue: Number(row.revenue ?? 0),
  }));
}

export interface RecentOrder {
  id: number;
  reference: string | null;
  dateAdd: string;
  stateName: string | null;
  stateColor: string | null;
  paymentMethod: string | null;
  isValid: boolean;
  totalBase: number;
}

/**
 * The most recent orders in a period, for the shop's activity table.
 *
 * A plain select rather than an RPC: Row Level Security already confines
 * ps_orders to shops the caller may see, so no extra scoping is needed here.
 * Status names come from a second query because ps_order_states is keyed by
 * (shop_id, ps_state_id) and has no foreign key for PostgREST to embed.
 */
export async function fetchRecentOrders(
  shopId: string,
  range: DateRange,
  onlyValid: boolean,
  limit = 25,
): Promise<RecentOrder[]> {
  const supabase = await createClient();

  let query = supabase
    .from('ps_orders')
    .select(
      'id, reference, date_add, current_state, payment_method, is_valid, total_paid_base',
    )
    .eq('shop_id', shopId)
    .gte('date_add', range.from.toISOString())
    .lt('date_add', range.to.toISOString())
    .order('date_add', { ascending: false })
    .limit(limit);

  if (onlyValid) query = query.eq('is_valid', true);

  const [{ data: orders, error }, { data: states }] = await Promise.all([
    query,
    supabase
      .from('ps_order_states')
      .select('ps_state_id, name, color')
      .eq('shop_id', shopId),
  ]);

  if (error || !orders) return [];

  const stateById = new Map((states ?? []).map((state) => [state.ps_state_id, state]));

  return orders.map((order) => {
    const state = order.current_state === null ? undefined : stateById.get(order.current_state);
    return {
      id: order.id,
      reference: order.reference,
      dateAdd: order.date_add,
      stateName: state?.name ?? null,
      stateColor: state?.color ?? null,
      paymentMethod: order.payment_method,
      isValid: order.is_valid,
      totalBase: Number(order.total_paid_base ?? 0),
    };
  });
}

export async function fetchShopTotals(
  shopIds: readonly string[],
  range: DateRange,
  onlyValid: boolean,
): Promise<ShopTotalRow[]> {
  if (shopIds.length === 0) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('analytics_shop_totals', {
    p_shop_ids: [...shopIds],
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
    p_only_valid: onlyValid,
  });

  if (error || !data) return [];

  return data.map((row) => ({
    shopId: row.shop_id,
    shopName: row.shop_name,
    currencyCode: row.currency_code,
    ordersCount: Number(row.orders_count ?? 0),
    revenue: Number(row.revenue ?? 0),
    newRegistrations: Number(row.new_registrations ?? 0),
  }));
}
