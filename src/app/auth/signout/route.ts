import { NextResponse } from 'next/server';

import { withBasePath } from '@/lib/base-path';
import { createClient } from '@/lib/supabase/server';

/**
 * Signs the user out.
 *
 * POST only: a GET would let any page trigger a sign-out with an image tag.
 */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  /*
   * A relative Location, deliberately.
   *
   * `NextResponse.redirect()` demands an absolute URL, which meant resolving
   * one against `request.url`. Behind a reverse proxy — Passenger under
   * Apache, say — Next cannot always recover the public origin from the
   * forwarded request, and falls back to localhost:3000. Signing out then sent
   * people to a host that does not exist outside the server.
   *
   * RFC 7231 allows a relative reference in Location, and browsers resolve it
   * against the request URL, so this reaches the right host whatever the proxy
   * did to the headers. The base path still has to be added by hand: Next only
   * prefixes it for navigations it builds itself.
   */
  return new NextResponse(null, {
    status: 303,
    headers: { Location: withBasePath('/login') },
  });
}
