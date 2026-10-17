import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Runs before every matched request: refreshes the Supabase auth session and
 * redirects unauthenticated users away from protected routes.
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy`. The helper it
 * calls is still `lib/supabase/middleware.ts` — that is a plain module, not a
 * Next convention file, and keeping the name matches Supabase's own documented
 * SSR setup so your team can follow upstream docs.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - _next/static (static files)
     * - _next/image  (image optimization)
     * - favicon.ico
     * - public assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
