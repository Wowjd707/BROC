'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BrandWordmark } from '@/components/layout/BrandWordmark';
import { BRANDING } from '@/lib/branding';
import { createClient } from '@/lib/supabase/client';
import { resetLinkMessage } from '@/lib/auth-confirm-core';

/**
 * Ask for a password-reset email.
 *
 * The email is Supabase's "Reset password" template
 * (supabase/email-templates/reset-password.html). Its link goes to
 * /auth/confirm?type=recovery, which verifies the token on the server, signs
 * the person in and sends them to /reset-password.
 *
 * The page says the same thing whether or not an account exists for the
 * address, so it cannot be used to find out who has one.
 */
function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const [supabase] = useState(() => createClient());
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  // A failed reset link lands here as ?reset=<code>.
  const resetCode = searchParams.get('reset');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setError(null);
    setState('sending');
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(address);
    if (sendError) {
      // In practice a rate limit or a mailer failure. Neither depends on
      // whether the account exists, so the message is safe to show.
      setError(sendError.message);
      setState('idle');
      return;
    }
    setState('sent');
  }

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <BrandWordmark className="h-9 mx-auto mb-3 text-emerald-600" />
          <p className="text-sm text-gray-500 mt-1">{BRANDING.tagline}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {state === 'sent' ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Check your inbox</h2>
              <p className="text-sm text-gray-600">
                If there is an account for <span className="font-medium text-gray-900">{email.trim()}</span>,
                a link to choose a new password is on its way. It works once and expires after a while.
              </p>
              <p className="text-sm text-gray-500 mt-4">
                Nothing after a few minutes? Check your spam folder, or{' '}
                <button
                  type="button"
                  onClick={() => setState('idle')}
                  className="font-medium text-emerald-700 hover:underline"
                >
                  try a different address
                </button>
                .
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Forgot your password?</h2>
              <p className="text-sm text-gray-500 mb-6">
                Enter the email you sign in with and we&apos;ll send you a link to choose a new one.
              </p>

              {resetCode && (
                <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
                  <p className="text-sm text-amber-900">{resetLinkMessage(resetCode)}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                    placeholder="you@company.com"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={state === 'sending'}
                  className="w-full bg-emerald-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {state === 'sending' ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-sm text-gray-500 mt-6">
          Remembered it?{' '}
          <Link href="/login" className="text-emerald-600 font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

/** useSearchParams needs a Suspense boundary; see the login page. */
export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
