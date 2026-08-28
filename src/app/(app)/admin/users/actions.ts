'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth';
import { METRIC_KEYS, sanitiseMetrics } from '@/lib/permissions';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * User and access administration.
 *
 * Uses the service role because creating auth users and reading across every
 * profile are cross-tenant operations. Each action independently verifies the
 * caller is an admin first — a server action is a POST endpoint and is not
 * protected by the layout that rendered its form.
 */

export interface ActionState {
  error?: string;
  success?: string;
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  fullName: z.string().trim().max(120).optional(),
  role: z.enum(['admin', 'marketer']),
  password: z
    .string()
    .min(12, 'Use at least 12 characters.')
    .max(72, 'Passwords longer than 72 characters are not supported.'),
});

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    fullName: formData.get('fullName') ?? undefined,
    role: formData.get('role'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details you entered.' };
  }

  const { email, fullName, role, password } = parsed.data;
  const supabase = createAdminClient();

  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : {},
  });

  if (error || !created.user) {
    const message = error?.message ?? 'The account could not be created.';
    return {
      error: /already/i.test(message) ? 'An account with that email already exists.' : message,
    };
  }

  // The database trigger creates the profile with the default role; the role
  // requested here is applied separately so it can never be set at sign-up.
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ role, full_name: fullName ?? null })
    .eq('id', created.user.id);

  if (profileError) {
    return {
      error: `The account was created but its role could not be set: ${profileError.message}`,
    };
  }

  revalidatePath('/admin/users');
  return { success: `${email} can now sign in as ${role === 'admin' ? 'an admin' : 'a marketer'}.` };
}

export async function updateUserRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();

  const userId = String(formData.get('userId') ?? '');
  const role = formData.get('role');

  if (!userId) return { error: 'No user was specified.' };
  if (role !== 'admin' && role !== 'marketer') return { error: 'Unknown role.' };

  // Demoting yourself could leave the installation with no administrator.
  if (userId === admin.id && role !== 'admin') {
    return { error: 'You cannot remove your own admin role.' };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
  if (error) return { error: `The role could not be changed: ${error.message}` };

  revalidatePath('/admin/users');
  return { success: 'Role updated.' };
}

export async function setUserActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();

  const userId = String(formData.get('userId') ?? '');
  const isActive = formData.get('isActive') === 'true';

  if (!userId) return { error: 'No user was specified.' };
  if (userId === admin.id && !isActive) {
    return { error: 'You cannot deactivate your own account.' };
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('profiles').update({ is_active: isActive }).eq('id', userId);
  if (error) return { error: `The account could not be updated: ${error.message}` };

  revalidatePath('/admin/users');
  return { success: isActive ? 'Account reactivated.' : 'Account deactivated.' };
}

const assignmentSchema = z.object({
  userId: z.string().uuid('Unknown user.'),
  shopId: z.string().uuid('Unknown shop.'),
});

/**
 * Grants or revokes a shop, and sets which metrics the user may see there.
 *
 * Metrics arrive as repeated form fields. Anything unrecognised is discarded by
 * `sanitiseMetrics`, so a crafted request cannot store a key that later grants
 * more than intended.
 */
export async function saveAssignment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();

  const parsed = assignmentSchema.safeParse({
    userId: formData.get('userId'),
    shopId: formData.get('shopId'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the selection.' };
  }

  const { userId, shopId } = parsed.data;
  const hasAccess = formData.get('hasAccess') === 'on';
  const supabase = createAdminClient();

  if (!hasAccess) {
    const { error } = await supabase
      .from('shop_assignments')
      .delete()
      .eq('user_id', userId)
      .eq('shop_id', shopId);

    if (error) return { error: `Access could not be revoked: ${error.message}` };

    revalidatePath('/admin/users');
    return { success: 'Access revoked.' };
  }

  const requested = METRIC_KEYS.filter((key) => formData.get(`metric:${key}`) === 'on');
  const metrics = sanitiseMetrics(requested);

  const { error } = await supabase.from('shop_assignments').upsert(
    {
      user_id: userId,
      shop_id: shopId,
      metrics,
      granted_by: admin.id,
    },
    { onConflict: 'shop_id,user_id' },
  );

  if (error) return { error: `Access could not be saved: ${error.message}` };

  revalidatePath('/admin/users');
  revalidatePath('/dashboard');
  return {
    success:
      metrics.length === 0
        ? 'Shop assigned, but no metrics are shared yet.'
        : `Saved — ${metrics.length} of ${METRIC_KEYS.length} metrics shared.`,
  };
}
