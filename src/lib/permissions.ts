/**
 * Metric-level permissions.
 *
 * An admin sees everything. A marketer sees a shop only when it has been
 * assigned to them, and within that shop only the metrics the admin ticked.
 *
 * These helpers drive what the interface renders. They are a usability layer,
 * not the security boundary — that is enforced in the database by Row Level
 * Security, so hiding a widget here and forgetting a policy there cannot leak
 * data.
 */

export const METRIC_KEYS = [
  'revenue',
  'orders',
  'customers',
  'aov',
  'trends',
  'status_breakdown',
  'payment_methods',
  'returning',
  'export',
] as const;

export type MetricKeyName = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS: Record<MetricKeyName, string> = {
  revenue: 'Revenue',
  orders: 'Orders',
  customers: 'Registered customers',
  aov: 'Average order value',
  trends: 'Trend charts',
  status_breakdown: 'Order statuses',
  payment_methods: 'Payment methods',
  returning: 'New vs returning',
  export: 'CSV export',
};

export const METRIC_DESCRIPTIONS: Record<MetricKeyName, string> = {
  revenue: 'Total order value over the selected period.',
  orders: 'Number of orders placed.',
  customers: 'Customer registrations over the period.',
  aov: 'Revenue divided by order count.',
  trends: 'Time-series charts for revenue and order volume.',
  status_breakdown: 'Distribution of orders across PrestaShop statuses.',
  payment_methods: 'Distribution of orders across payment modules.',
  returning: 'Split of orders from first-time and repeat buyers.',
  export: 'Permission to download the aggregated figures.',
};

/** Sensible starting point when an admin assigns a new shop to a marketer. */
export const DEFAULT_METRICS: MetricKeyName[] = [
  'revenue',
  'orders',
  'customers',
  'aov',
  'trends',
  'status_breakdown',
  'payment_methods',
  'returning',
];

export function isMetricKey(value: string): value is MetricKeyName {
  return (METRIC_KEYS as readonly string[]).includes(value);
}

/** Drops anything unrecognised, so a stale key in the database cannot grant access. */
export function sanitiseMetrics(values: readonly string[]): MetricKeyName[] {
  return METRIC_KEYS.filter((key) => values.includes(key));
}

export interface ViewerPermissions {
  role: 'admin' | 'marketer';
  /** Metrics per shop id. Ignored for admins, who see everything. */
  metricsByShop: Record<string, MetricKeyName[]>;
}

export function canViewMetric(
  permissions: ViewerPermissions,
  shopId: string,
  metric: MetricKeyName,
): boolean {
  if (permissions.role === 'admin') return true;
  return permissions.metricsByShop[shopId]?.includes(metric) ?? false;
}

/**
 * Whether a metric is visible for *any* of the shops in view.
 *
 * Used by the multi-shop overview: a widget appears when at least one selected
 * shop permits it, and the figures behind it only ever include permitted shops.
 */
export function canViewMetricForAny(
  permissions: ViewerPermissions,
  shopIds: readonly string[],
  metric: MetricKeyName,
): boolean {
  if (permissions.role === 'admin') return true;
  return shopIds.some((shopId) => canViewMetric(permissions, shopId, metric));
}

/** Shop ids, out of those requested, for which the viewer may see the metric. */
export function shopsAllowingMetric(
  permissions: ViewerPermissions,
  shopIds: readonly string[],
  metric: MetricKeyName,
): string[] {
  if (permissions.role === 'admin') return [...shopIds];
  return shopIds.filter((shopId) => canViewMetric(permissions, shopId, metric));
}
