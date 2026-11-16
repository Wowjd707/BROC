'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BrandWordmark } from '@/components/layout/BrandWordmark';
import { BRANDING } from '@/lib/branding';
import { createClient } from '@/lib/supabase/client';
import { newPasswordProblem } from '@/lib/auth-confirm-core';

/**
 * Choose a new password.
 *
 * Reached two ways, both already signed in: from a password-reset email, via
 * /auth/confirm, which verifies the link and creates the session; or from
 * "Change password" in the profile menu. The middleware sends anyone without
 * a session to /login, so this page only has to handle the session expiring
 * while it is open.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled) setEmail(user?.email ?? null);
    });
    return () => { cancelled = true; };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = newPasswordProblem(password, confirm);
    if (problem) { setError(problem); return; }
    setError(null);
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      // e.g. "New password should be different from the old password", or a
      // session that expired while the page was open.
      setError(updateError.message);
      return;
    }
    setDone(true);
  }

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <BrandWordmark className="h-9 mx-auto mb-2 text-emerald-600" />
          <p className="text-sm text-gray-500">{BRANDING.tagline}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {done ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Password changed</h2>
              <p className="text-sm text-gray-600">Use your new password the next time you sign in.</p>
              <button
                type="button"
                onClick={() => { router.replace('/dashboard'); router.refresh(); }}
                className="mt-6 w-full bg-emerald-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors"
              >
                Continue to the dashboard
              </button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Choose a new password</h2>
              <p className="text-sm text-gray-500 mb-6">
                {email ? <>For {email}.</> : <>For your account.</>}
              </p>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                    New password
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Confirm new password
                  </label>
                  <input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={inputClass}
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full bg-emerald-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'Saving…' : 'Save new password'}
                </button>
              </form>
            </>
          )}
        </div>

        {!done && (
          <p className="text-center text-sm text-gray-500 mt-6">
            <Link href="/dashboard" className="text-emerald-600 font-medium hover:underline">
              Cancel
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
