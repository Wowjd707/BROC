import 'server-only';
import { cache } from 'react';
import { createServerClient as createSupabaseServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from './types';

/**
 * The request-scoped Supabase client. `cache()` makes this one instance per
 * request, shared by the layout, the page, and every `lib/` helper it calls.
 *
 * That sharing is load-bearing, not an optimization. Every PostgREST call goes
 * through `auth.getSession()`, which refreshes the session when the access
 * token has expired. Refresh tokens rotate: the first refresh invalidates the
 * token the others are still holding. A single client serializes that behind
 * one internal lock and refreshes once. Separate instances cannot see each
 * other's lock, so they race — and because a Server Component cannot write
 * cookies (see `setAll` below), no winner's tokens reach the browser. The next
 * request then arrives with a spent refresh token, `getUser()` returns null,
 * and the user lands on the login screen mid-session.
 *
 * The pages that built a client per helper — `resolveScope()`,
 * `getSupplierDataOverview()`, and the page itself — were the ones that lost
 * that race, which is why Scope 3 tripped it first.
 */
export const createServerClient = cache(async function createServerClient() {
  const cookieStore = await cookies();

  return createSupabaseServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Component — cookie writes ignored; proxy.ts handles refresh
          }
        },
      },
    },
  );
});

/** Service-role client for admin operations. Never expose to the client. */
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
