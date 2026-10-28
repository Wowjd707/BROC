import { createServerClient } from '@supabase/ssr';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import type { Database } from './types';

/** The cookies `@supabase/ssr` stores the session in, chunk suffixes included. */
const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session — do not remove this line
  const { data: { user }, error } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public routes (no auth required). Matched as a whole path segment, so
  // '/survey' covers '/survey/<token>' but not '/surveys-admin'.
  //
  // Two entries were missing before the October 2026 release pass, and each
  // broke a whole flow for exactly the people it serves:
  //   /api/survey  — a supplier holds a token, never a session, so every save
  //                  and submit from the public survey page was redirected to
  //                  /login. It only worked when tested while signed in.
  //   /auth/callback — an SSO user arrives here before a session exists (that
  //                  is what the route creates), and was bounced to /login
  //                  before the code exchange could run.
  //   /auth/confirm  — the email-confirmation link, same reason.
  const publicRoutes = [
    '/login', '/signup', '/survey', '/invite',
    '/api/signup', '/api/survey', '/auth/callback', '/auth/confirm',
  ];
  const isPublic = publicRoutes.some((r) => pathname === r || pathname.startsWith(r + '/'));

  /*
   * "Could not reach the auth server" is not "not signed in". `getUser()`
   * reports both as a null user, and bouncing to /login on the first one
   * discards a valid session over a transient blip — the user sees a login
   * screen mid-task with no explanation, which is exactly what an expired
   * session looks like. Only a retryable transport failure gets this benefit,
   * and only when the request actually carries a session cookie; a rejected or
   * expired token still fails closed. Nothing is granted by letting the request
   * through either way, because the page's own `getUser()` guard and RLS both
   * still apply.
   */
  const unreachable =
    !user &&
    isAuthRetryableFetchError(error) &&
    request.cookies.getAll().some((c) => AUTH_COOKIE.test(c.name));

  if (!user && !isPublic && !unreachable) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
