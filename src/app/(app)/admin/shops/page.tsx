import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Store } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { createClient } from '@/lib/supabase/server';
import { formatRelativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Manage shops' };

export default async function AdminShopsPage() {
  const supabase = await createClient();

  const [{ data: shops }, { data: assignments }] = await Promise.all([
    supabase.from('shops').select('*').order('name'),
    supabase.from('shop_assignments').select('shop_id'),
  ]);

  const assignmentCounts = new Map<string, number>();
  for (const assignment of assignments ?? []) {
    assignmentCounts.set(assignment.shop_id, (assignmentCounts.get(assignment.shop_id) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        title="Manage shops"
        description="Connect PrestaShop stores and control how their data is collected."
        actions={
          <Link
            href="/admin/shops/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Connect shop
          </Link>
        }
      />

      <Card>
        {(shops ?? []).length === 0 ? (
          <EmptyState
            icon={<Store className="h-5 w-5" aria-hidden />}
            title="No shops connected yet"
            description="Connect your first PrestaShop store to begin collecting order figures."
            action={
              <Link
                href="/admin/shops/new"
                className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover"
              >
                Connect a shop
              </Link>
            }
          />
        ) : (
          <CardBody className="p-0 sm:p-0">
            {/* The table scrolls horizontally rather than the page body. */}
            <div className="scroll-x">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left">
                    <th scope="col" className="px-5 py-3 text-xs font-medium text-content-muted">
                      Shop
                    </th>
                    <th scope="col" className="px-4 py-3 text-xs font-medium text-content-muted">
                      Version
                    </th>
                    <th scope="col" className="px-4 py-3 text-xs font-medium text-content-muted">
                      Assigned to
                    </th>
                    <th scope="col" className="px-4 py-3 text-xs font-medium text-content-muted">
                      Last sync
                    </th>
                    <th scope="col" className="px-4 py-3 text-xs font-medium text-content-muted">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {(shops ?? []).map((shop) => {
                    const assigned = assignmentCounts.get(shop.id) ?? 0;

                    return (
                      <tr key={shop.id} className="transition-colors hover:bg-surface-hover">
                        <td className="px-5 py-3">
                          <p className="font-medium text-content-primary">{shop.name}</p>
                          <p className="text-xs text-content-muted">
                            {new URL(shop.base_url).hostname}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-xs text-content-secondary">
                          {shop.detected_version ?? `${shop.ps_version}.x`}
                        </td>
                        <td className="px-4 py-3 text-xs text-content-secondary">
                          {assigned === 0 ? (
                            <span className="text-content-muted">Admins only</span>
                          ) : (
                            `${assigned} ${assigned === 1 ? 'marketer' : 'marketers'}`
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-content-secondary">
                          {formatRelativeTime(shop.last_sync_at)}
                        </td>
                        <td className="px-4 py-3">
                          {!shop.is_active ? (
                            <Badge tone="neutral">Paused</Badge>
                          ) : shop.last_sync_status === 'success' ? (
                            <Badge tone="positive">Healthy</Badge>
                          ) : shop.last_sync_status === 'failed' ? (
                            <Badge tone="negative">Failed</Badge>
                          ) : shop.last_sync_status === 'partial' ? (
                            <Badge tone="warning">Partial</Badge>
                          ) : (
                            <Badge tone="neutral">Never synced</Badge>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Link
                            href={`/admin/shops/${shop.id}`}
                            className="text-xs font-medium text-accent-text hover:underline"
                          >
                            Manage
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        )}
      </Card>
    </>
  );
}
