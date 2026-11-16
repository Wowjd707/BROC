import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { asConfirmType, isRecoveryLink, safeNextPath, RESET_PASSWORD_PATH } from '@/lib/auth-confirm-core';

/**
 * Where the confirmation email's button lands:
 *   /auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/dashboard
 * and the password-reset email's:
 *   /auth/confirm?token_hash={{ .TokenHash }}&type=recovery
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

  // A reset link signs the person in, so it goes only to the page that sets a
  // new password, never to `next`. A failure goes back to the request form,
  // where asking for another link is one step.
  if (isRecoveryLink(searchParams.get('type'))) {
    const toForgot = (code: string) => {
      const url = new URL('/forgot-password', request.url);
      url.searchParams.set('reset', code);
      return NextResponse.redirect(url);
    };
    if (!tokenHash) return toForgot('invalid');
    const supabase = await createServerClient();
    const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    if (error) {
      console.warn('[auth/confirm] reset link failed:', error.message);
      return toForgot('expired');
    }
    return NextResponse.redirect(new URL(RESET_PASSWORD_PATH, request.url));
  }

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
