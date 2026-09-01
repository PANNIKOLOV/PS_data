import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env';

/**
 * Refreshes the Supabase session on every navigation and keeps unauthenticated
 * visitors out of the application shell.
 *
 * This is a redirect for user experience, not an access control boundary. Each
 * page independently resolves the user, and the database enforces Row Level
 * Security regardless of how a request arrives.
 *
 * It deliberately does not run for /api (see the matcher below). A machine
 * client sent an HTML login page instead of its answer has no way to act on it:
 * the scheduled sync job was redirected to /login with a 307 and silently did
 * nothing, for as long as this middleware has existed. Route handlers under
 * /api authenticate themselves — `/api/cron/sync` checks a bearer token — and
 * answer with a status their caller can read.
 */

const PUBLIC_PATHS = [
  '/login',
  '/auth/callback',
  '/auth/confirm',
  // Signing out must work even when the session has already expired, which is
  // exactly when a redirect to /login would strand the cookies in place.
  '/auth/signout',
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Validates the token with Supabase and rotates it when needed. Must be called
  // before any early return, or the refreshed cookie is never written back.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    // Preserve the destination so sign-in can return the user to it.
    if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === '/login') {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    dashboardUrl.search = '';
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api           — route handlers do their own authentication and must be
     *                   able to answer a machine caller with a real status.
     *   _next/static,
     *   _next/image,
     *   favicon.ico,
     *   image files   — never carry a session, so checking one only adds latency.
     */
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
