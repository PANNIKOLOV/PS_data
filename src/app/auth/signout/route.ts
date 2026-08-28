import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Signs the user out.
 *
 * POST only: a GET would let any page trigger a sign-out with an image tag.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
