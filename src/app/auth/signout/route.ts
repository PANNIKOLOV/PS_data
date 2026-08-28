import { NextResponse, type NextRequest } from 'next/server';

import { withBasePath } from '@/lib/base-path';
import { createClient } from '@/lib/supabase/server';

/**
 * Signs the user out.
 *
 * POST only: a GET would let any page trigger a sign-out with an image tag.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Built by hand, so the base path has to be added explicitly.
  return NextResponse.redirect(new URL(withBasePath('/login'), request.url), { status: 303 });
}
