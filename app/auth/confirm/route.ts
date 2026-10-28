import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { asConfirmType, safeNextPath } from '@/lib/auth-confirm-core';

/**
 * Where the confirmation email's button lands:
 *   /auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/dashboard
 *
 * Verifies the token server-side (lib/auth-confirm-core.ts says why that beats
 * the code flow), which also signs the user in, then continues to `next`. On
 * failure it goes to the login page with a reason the page explains. Nothing
 * from the query string is trusted except the token, which Supabase checks,
 * and `next`, which is held to a same-site path.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = asConfirmType(searchParams.get('type'));
  const next = safeNextPath(searchParams.get('next'));

  const toLogin = (code: string) => {
    const url = new URL('/login', request.url);
    url.searchParams.set('confirm', code);
    return NextResponse.redirect(url);
  };

  if (!tokenHash || !type) return toLogin('invalid');

  const supabase = await createServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    console.warn('[auth/confirm] verification failed:', error.message);
    return toLogin('expired');
  }

  // Signed in by the verification: go straight to where they were headed.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return toLogin('ok');
  return NextResponse.redirect(new URL(next, request.url));
}
