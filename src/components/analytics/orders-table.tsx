import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/states';
import type { RecentOrder } from '@/lib/analytics/queries';
import { formatCurrency } from '@/lib/utils';

/**
 * The most recent orders in the period.
 *
 * Order-level detail without any personal data: a reference, when it was
 * placed, its status, how it was paid and what it came to. There is
 * deliberately no customer column — names and emails are never collected.
 */
export function OrdersTable({
  orders,
  currency,
  timezone,
}: {
  orders: RecentOrder[];
  currency: string;
  timezone: string;
}) {
  if (orders.length === 0) {
    return <EmptyState title="No orders in this period" />;
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="scroll-x">
      <table className="w-full min-w-[38rem] text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left">
            <th scope="col" className="px-4 py-2.5 text-xs font-medium text-content-muted sm:px-5">
              Reference
            </th>
            <th scope="col" className="px-4 py-2.5 text-xs font-medium text-content-muted">
              Placed
            </th>
            <th scope="col" className="px-4 py-2.5 text-xs font-medium text-content-muted">
              Status
            </th>
            <th scope="col" className="px-4 py-2.5 text-xs font-medium text-content-muted">
              Payment
            </th>
            <th
              scope="col"
              className="px-4 py-2.5 text-right text-xs font-medium text-content-muted sm:px-5"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {orders.map((order) => (
            <tr key={order.id} className="transition-colors hover:bg-surface-hover">
              <td className="px-4 py-2.5 font-mono text-xs text-content-primary sm:px-5">
                {order.reference ?? '—'}
              </td>
              <td className="px-4 py-2.5 text-xs whitespace-nowrap text-content-secondary">
                {formatDate(order.dateAdd)}
              </td>
              <td className="px-4 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-xs text-content-secondary">
                  {/* The shop's own status colour, so it reads as it does in PrestaShop. */}
                  {order.stateColor ? (
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: order.stateColor }}
                    />
                  ) : null}
                  {order.stateName ?? 'Unknown'}
                </span>
              </td>
              <td className="px-4 py-2.5 text-xs text-content-secondary">
                {order.paymentMethod ?? 'Unspecified'}
              </td>
              <td className="tabular px-4 py-2.5 text-right text-xs font-medium text-content-primary sm:px-5">
                <span className="inline-flex items-center justify-end gap-2">
                  {!order.isValid ? <Badge tone="warning">unpaid</Badge> : null}
                  {formatCurrency(order.totalBase, currency)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
