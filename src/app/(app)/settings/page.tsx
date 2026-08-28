import type { Metadata } from 'next';
import { ShieldCheck, Store } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { requireUser } from '@/lib/auth';
import { METRIC_LABELS, sanitiseMetrics, type MetricKeyName } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { formatRelativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const isAdmin = user.profile.role === 'admin';

  const [{ data: shops }, { data: assignments }] = await Promise.all([
    supabase.from('shops').select('id, name'),
    supabase.from('shop_assignments').select('shop_id, metrics').eq('user_id', user.id),
  ]);

  const shopNames = new Map((shops ?? []).map((shop) => [shop.id, shop.name]));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Your account and what you can see." />

      <div className="space-y-4">
        <Card>
          <CardHeader title="Account" />
          <CardBody>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-content-muted">Name</dt>
                <dd className="mt-1 text-sm font-medium text-content-primary">
                  {user.profile.full_name || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-content-muted">Email</dt>
                <dd className="mt-1 truncate text-sm font-medium text-content-primary">
                  {user.email}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-content-muted">Role</dt>
                <dd className="mt-1">
                  <Badge tone={isAdmin ? 'accent' : 'neutral'}>
                    {isAdmin ? (
                      <>
                        <ShieldCheck className="h-3 w-3" aria-hidden />
                        Admin
                      </>
                    ) : (
                      'Marketer'
                    )}
                  </Badge>
                </dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-border-subtle pt-3 text-xs text-content-muted">
              Roles and shop access are managed by an administrator. Member since{' '}
              {formatRelativeTime(user.profile.created_at)}.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Your access"
            description={
              isAdmin
                ? 'Admins see every shop and every figure.'
                : 'The shops and figures an administrator has shared with you.'
            }
          />
          <CardBody>
            {isAdmin ? (
              <p className="text-sm text-content-secondary">
                You have full access to all {(shops ?? []).length} connected{' '}
                {(shops ?? []).length === 1 ? 'shop' : 'shops'}, including shop configuration and
                user management.
              </p>
            ) : (assignments ?? []).length === 0 ? (
              <p className="text-sm text-content-secondary">
                No shops have been assigned to you yet. An administrator needs to grant access
                before any figures appear.
              </p>
            ) : (
              <ul className="space-y-3">
                {(assignments ?? []).map((assignment) => {
                  const metrics = sanitiseMetrics(assignment.metrics ?? []);

                  return (
                    <li
                      key={assignment.shop_id}
                      className="rounded-lg border border-border-subtle p-3.5"
                    >
                      <div className="flex items-center gap-2">
                        <Store className="h-4 w-4 text-content-muted" aria-hidden />
                        <span className="text-sm font-medium text-content-primary">
                          {shopNames.get(assignment.shop_id) ?? 'Unavailable shop'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {metrics.length === 0 ? (
                          <span className="text-xs text-content-muted">
                            No figures are shared for this shop yet.
                          </span>
                        ) : (
                          metrics.map((metric) => (
                            <Badge key={metric} tone="neutral">
                              {METRIC_LABELS[metric as MetricKeyName]}
                            </Badge>
                          ))
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Data & privacy" />
          <CardBody className="space-y-2 text-xs text-content-secondary">
            <p>
              This platform reads order totals, dates, statuses and payment modules from each
              connected PrestaShop store, plus the date each customer account was created.
            </p>
            <p>
              Customer names, email addresses, phone numbers and postal addresses are never
              requested from the shop and are not stored here.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
