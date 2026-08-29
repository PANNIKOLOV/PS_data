'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
  next: z.string().optional(),
});

export interface LoginState {
  error?: string;
}

/**
 * Routes a successful sign-in may land on.
 *
 * A path matches when it equals an entry or is nested beneath one.
 */
const SIGN_IN_DESTINATIONS = [
  '/dashboard',
  '/shops',
  '/settings',
  '/admin/shops',
  '/admin/users',
  '/admin/sync',
] as const;

/**
 * Resolves the post-login destination.
 *
 * `next` arrives from the query string, so it is checked against the routes
 * this application actually serves rather than merely being confirmed as
 * same-origin. That blocks the open redirect, and also stops a stale link —
 * a bookmark from an older deployment, say, or browser autocomplete — from
 * stranding someone on a path that does not exist here after they have
 * successfully signed in.
 */
function safeRedirectPath(value: string | undefined): string {
  if (!value) return '/dashboard';

  // Reject protocol-relative and absolute URLs outright.
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard';

  const [pathname] = value.split(/[?#]/) as [string];
  const allowed = SIGN_IN_DESTINATIONS.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  return allowed ? value : '/dashboard';
}

export async function signIn(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details you entered.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately vague: distinguishing "no such user" from "wrong password"
    // would let an attacker enumerate accounts.
    return { error: 'Those credentials were not recognised.' };
  }

  revalidatePath('/', 'layout');
  redirect(safeRedirectPath(parsed.data.next));
}
