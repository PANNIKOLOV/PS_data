'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Granularity } from '@/lib/analytics/periods';
import type { AnalyticsSummary, BreakdownRow, TimeseriesPoint } from '@/lib/analytics/queries';
import { buildCsv } from '@/lib/utils';

/**
 * Downloads the figures currently on screen as CSV.
 *
 * Built in the browser from data already rendered, so it cannot expose anything
 * the viewer is not permitted to see: the server withholds restricted rows
 * before they ever reach this component.
 */
export function ExportButton({
  shopName,
  periodLabel,
  granularity,
  currency,
  timezone,
  summary,
  timeseries,
  statusRows,
  paymentRows,
}: {
  shopName: string;
  periodLabel: string;
  granularity: Granularity;
  currency: string;
  timezone: string;
  summary: AnalyticsSummary;
  timeseries: TimeseriesPoint[];
  statusRows: BreakdownRow[];
  paymentRows: BreakdownRow[];
}) {
  const [busy, setBusy] = useState(false);

  const download = () => {
    setBusy(true);
    try {
      const sections: string[] = [];

      sections.push(
        buildCsv(
          ['Report', 'Value'],
          [
            ['Shop', shopName],
            ['Period', periodLabel],
            ['Grouping', granularity],
            ['Timezone', timezone],
            ['Currency', currency],
            ['Generated', new Date().toISOString()],
          ],
        ),
      );

      sections.push(
        buildCsv(
          ['Metric', 'Value'],
          [
            ['Orders', summary.ordersCount],
            ['Revenue', summary.revenue.toFixed(2)],
            ['Average order value', summary.averageOrderValue.toFixed(2)],
            ['Product value', summary.itemsTotal.toFixed(2)],
            ['Shipping', summary.shippingTotal.toFixed(2)],
            ['Discounts', summary.discountsTotal.toFixed(2)],
            ['Unique buyers', summary.uniqueCustomers],
            ['Registered customers', summary.newRegistrations],
          ],
        ),
      );

      if (timeseries.length > 0) {
        sections.push(
          buildCsv(
            ['Period start', 'Orders', 'Revenue', 'Registrations'],
            timeseries.map((point) => [
              point.bucket,
              point.ordersCount,
              point.revenue.toFixed(2),
              point.newRegistrations,
            ]),
          ),
        );
      }

      if (statusRows.length > 0) {
        sections.push(
          buildCsv(
            ['Order status', 'Orders', 'Revenue'],
            statusRows.map((row) => [row.label, row.ordersCount, row.revenue.toFixed(2)]),
          ),
        );
      }

      if (paymentRows.length > 0) {
        sections.push(
          buildCsv(
            ['Payment method', 'Orders', 'Revenue'],
            paymentRows.map((row) => [row.label, row.ordersCount, row.revenue.toFixed(2)]),
          ),
        );
      }

      // A BOM makes Excel read the file as UTF-8 rather than the system codepage.
      const blob = new Blob(['﻿', sections.join('\r\n\r\n')], {
        type: 'text/csv;charset=utf-8;',
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${slugify(shopName)}-${slugify(periodLabel)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button onClick={download} size="sm" disabled={busy} className="h-9">
      <Download className="h-3.5 w-3.5" aria-hidden />
      Export CSV
    </Button>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
