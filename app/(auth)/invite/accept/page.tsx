'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BRANDING } from '@/lib/branding';
import { createClient } from '@/lib/supabase/client';
import { parseInviteFragment, MIN_PASSWORD_LENGTH } from '@/lib/invite-core';

/**
 * Where a team invitation lands.
 *
 * Supabase returns the invitee here with their session in the URL fragment;
 * see `lib/invite-core.ts` for why it is read explicitly. The session is
 * established first, then the invitee sets a password — an invited account has
 * none, so without this step they could only ever get back in through another
 * emailed link.
 */
type Stage =
  | { kind: 'checking' }
  | { kind: 'set-password'; email: string | null }
  | { kind: 'failed'; message: string };

export default function AcceptInvitePage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [stage, setStage] = useState<Stage>({ kind: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fragment = parseInviteFragment(window.location.hash);

      // Take the tokens out of the address bar straight away, so they are not
      // left in browser history or copied along with the URL.
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname);
      }

      if (fragment.kind === 'error') {
        if (!cancelled) setStage({ kind: 'failed', message: fragment.message });
        return;
      }

      if (fragment.kind === 'session') {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: fragment.accessToken,
          refresh_token: fragment.refreshToken,
        });
        if (sessionError) {
          if (!cancelled) setStage({ kind: 'failed', message: sessionError.message });
          return;
        }
      }

      // Either the fragment just signed them in, or they reloaded the page
      // after it had. Both are fine; no session at all is not.
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setStage({
          kind: 'failed',
          message: 'This invitation link has expired or was already used. Ask your administrator to send a new one.',
        });
        return;
      }
      setStage({ kind: 'set-password', email: user.email ?? null });
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.replace('/dashboard');
    router.refresh();
  }

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-600 text-white font-bold text-xl mb-4">
            {BRANDING.mark}
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">{BRANDING.productName}</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {stage.kind === 'checking' && (
            <p className="text-sm text-gray-500 text-center">Checking your invitation…</p>
          )}

          {stage.kind === 'failed' && (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">This link did not work</h2>
              <p className="text-sm text-gray-600">{stage.message}</p>
              <Link href="/login" className="mt-6 inline-block text-sm font-medium text-emerald-700 hover:underline">
                Go to sign in
              </Link>
            </>
          )}

          {stage.kind === 'set-password' && (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Welcome — set your password</h2>
              {stage.email && (
                <p className="text-sm text-gray-500 mb-6">You&apos;ll sign in as {stage.email}.</p>
              )}
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
                    Confirm password
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
                  {saving ? 'Saving…' : 'Set password and continue'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
