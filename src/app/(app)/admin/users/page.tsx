import type { Metadata } from 'next';
import { ShieldCheck, Users } from 'lucide-react';

import {
  ActiveControl,
  CreateUserForm,
  RoleControl,
  ShopAccessEditor,
} from '@/app/(app)/admin/users/user-controls';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { requireAdmin } from '@/lib/auth';
import { sanitiseMetrics } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { formatRelativeTime, initialsFrom } from '@/lib/utils';

export const metadata: Metadata = { title: 'Users & access' };

export default async function AdminUsersPage() {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const [{ data: profiles }, { data: shops }, { data: assignments }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at'),
    supabase.from('shops').select('*').order('name'),
    supabase.from('shop_assignments').select('*'),
  ]);

  const assignmentsByUser = new Map<string, Map<string, string[]>>();
  for (const assignment of assignments ?? []) {
    const perUser = assignmentsByUser.get(assignment.user_id) ?? new Map<string, string[]>();
    perUser.set(assignment.shop_id, assignment.metrics ?? []);
    assignmentsByUser.set(assignment.user_id, perUser);
  }

  const marketers = (profiles ?? []).filter((profile) => profile.role === 'marketer');
  const admins = (profiles ?? []).filter((profile) => profile.role === 'admin');

  return (
    <>
      <PageHeader
        title="Users & access"
        description="Create accounts, set roles, and choose exactly what each marketer can see."
        actions={<CreateUserForm />}
      />

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Administrators"
            description="Admins see every shop and every figure, and manage this panel."
          />
          <CardBody className="p-0 sm:p-0">
            <ul className="divide-y divide-border-subtle">
              {admins.map((profile) => (
                <li
                  key={profile.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
                >
                  <Avatar name={profile.full_name} email={profile.email} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-content-primary">
                      {profile.full_name || profile.email}
                      {profile.id === admin.id ? (
                        <span className="ml-2 text-xs font-normal text-content-muted">(you)</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-content-muted">{profile.email}</p>
                  </div>
                  <Badge tone="accent">
                    <ShieldCheck className="h-3 w-3" aria-hidden />
                    Admin
                  </Badge>
                  <RoleControl
                    userId={profile.id}
                    role={profile.role}
                    isSelf={profile.id === admin.id}
                  />
                  <ActiveControl
                    userId={profile.id}
                    isActive={profile.is_active}
                    isSelf={profile.id === admin.id}
                  />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Marketers"
            description="Each marketer sees only the shops assigned below, and only the figures ticked."
          />
          <CardBody className="p-0 sm:p-0">
            {marketers.length === 0 ? (
              <EmptyState
                icon={<Users className="h-5 w-5" aria-hidden />}
                title="No marketers yet"
                description="Add a user with the Marketer role, then assign them a shop."
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {marketers.map((profile) => {
                  const perShop = assignmentsByUser.get(profile.id) ?? new Map<string, string[]>();

                  return (
                    <li key={profile.id} className="px-4 py-4 sm:px-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <Avatar name={profile.full_name} email={profile.email} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-content-primary">
                            {profile.full_name || profile.email}
                          </p>
                          <p className="truncate text-xs text-content-muted">
                            {profile.email} · joined {formatRelativeTime(profile.created_at)}
                          </p>
                        </div>
                        {profile.is_active ? (
                          <Badge tone="neutral">
                            {perShop.size} {perShop.size === 1 ? 'shop' : 'shops'}
                          </Badge>
                        ) : (
                          <Badge tone="negative">Deactivated</Badge>
                        )}
                        <RoleControl userId={profile.id} role={profile.role} isSelf={false} />
                        <ActiveControl
                          userId={profile.id}
                          isActive={profile.is_active}
                          isSelf={false}
                        />
                      </div>

                      {(shops ?? []).length === 0 ? (
                        <p className="mt-3 text-xs text-content-muted">
                          Connect a shop before assigning access.
                        </p>
                      ) : (
                        <div className="mt-3 space-y-2.5">
                          {(shops ?? []).map((shop) => (
                            <ShopAccessEditor
                              key={shop.id}
                              userId={profile.id}
                              shop={shop}
                              hasAccess={perShop.has(shop.id)}
                              metrics={sanitiseMetrics(perShop.get(shop.id) ?? [])}
                            />
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Avatar({ name, email }: { name: string | null; email: string }) {
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text"
    >
      {initialsFrom(name, email)}
    </span>
  );
}
