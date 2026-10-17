'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BRANDING } from '@/lib/branding';

/**
 * Shown instead of the application when a signed-in user has no readable
 * profile — in practice, an account an administrator has deactivated.
 *
 * Since migration 037 a deactivated profile resolves to no organization, so
 * every query returns nothing. Rendering the dashboard anyway would show an
 * empty, apparently broken application; this says what actually happened and
 * offers the one useful action.
 */
export function NoProfileNotice({ email }: { email: string | null }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await createClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
          {BRANDING.productName}
        </p>
        <h1 className="text-lg font-semibold text-gray-900 mb-2">This account is not active</h1>
        <p className="text-sm text-gray-600">
          {email ? <><span className="font-medium">{email}</span> is </> : 'You are '}
          signed in, but not an active member of an organization on this deployment. If you
          think that is a mistake, ask one of your organization&apos;s administrators to
          reactivate you from Settings → Team.
        </p>
        <button
          onClick={signOut}
          disabled={signingOut}
          className="mt-6 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
