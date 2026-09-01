'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import type { RecentOrder } from '@/lib/analytics/queries';
import { formatCurrency, formatNumber } from '@/lib/utils';

/**
 * The most recent orders in the period, a page at a time.
 *
 * Order-level detail without any personal data: a reference, when it was
 * placed, its status, how it was paid and what it came to. There is
 * deliberately no customer column — names and emails are never collected.
 *
 * Paging happens here rather than through the URL because the whole set is
 * already on the page: turning a page costs nothing, and it leaves the period
 * filters as the only thing the query string carries.
 */

const PAGE_SIZE = 25;

export function OrdersTable({
  orders,
  currency,
  timezone,
}: {
  orders: RecentOrder[];
  currency: string;
  timezone: string;
}) {
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  // The period filter can shrink the list under the current page; clamping on
  // read avoids rendering an empty table while an effect catches up.
  const current = Math.min(page, pageCount - 1);
  const start = current * PAGE_SIZE;

  const visible = useMemo(
    () => orders.slice(start, start + PAGE_SIZE),
    [orders, start],
  );

  const formatDate = useMemo(
    () => (iso: string) =>
      new Date(iso).toLocaleString('en-GB', {
        timeZone: timezone,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [timezone],
  );

  if (orders.length === 0) {
    return <EmptyState title="No orders in this period" />;
  }

  return (
    <>
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
            {visible.map((order) => (
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

      {pageCount > 1 ? (
        <nav
          aria-label="Order pages"
          className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
        >
          <p aria-live="polite" className="tabular text-xs text-content-muted">
            Showing {formatNumber(start + 1)}–{formatNumber(start + visible.length)} of{' '}
            {formatNumber(orders.length)}
          </p>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
              aria-label="Previous page of orders"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              Previous
            </Button>
            <span className="tabular px-1 text-xs text-content-secondary">
              Page {current + 1} of {pageCount}
            </span>
            <Button
              size="sm"
              onClick={() => setPage(current + 1)}
              disabled={current >= pageCount - 1}
              aria-label="Next page of orders"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </nav>
      ) : null}
    </>
  );
}
