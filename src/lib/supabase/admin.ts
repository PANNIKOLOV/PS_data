import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { publicEnv, serverEnv } from '@/lib/env';
import type { Database } from '@/lib/supabase/types';

/**
 * Service-role client. Bypasses Row Level Security entirely.
 *
 * Only for trusted server-side work that legitimately spans tenants: the sync
 * engine writing order facts, reading encrypted shop credentials, and admin
 * user provisioning. Never expose the result of a call made with this client
 * without first checking the caller's own permissions.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
