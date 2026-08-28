import 'server-only';

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/supabase/types';

/**
 * Session helpers.
 *
 * Always resolves the user through `getUser()`, which validates the JWT with
 * Supabase, rather than `getSession()`, which trusts whatever is in the cookie.
 */

export interface SessionUser {
  id: string;
  email: string;
  profile: Profile;
}

/** Returns the signed-in user, or null. Never throws. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  // A profile is created by a database trigger on sign-up. Its absence means
  // the account is not usable, so it is treated as signed out.
  if (!profile || !profile.is_active) return null;

  return { id: user.id, email: user.email ?? profile.email, profile };
}

/** Requires a signed-in user, redirecting to the login page otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/** Requires an admin, sending non-admins back to the dashboard. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.profile.role !== 'admin') redirect('/dashboard?error=admin-only');
  return user;
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.profile.role === 'admin';
}
