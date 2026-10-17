'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, ArrowLeft, RotateCcw } from 'lucide-react';

interface Props {
  homeOrgName: string | null;
  canReset: boolean;
}

/**
 * Persistent bar shown while the session is in the practice workspace.
 *
 * Deliberately loud, deliberately fixed, and deliberately not dismissible. The
 * failure this exists to prevent is someone assembling a disclosure from
 * practice figures and sending it — so the cost of a slightly ugly band across
 * the top is nothing against the cost of that happening once.
 *
 * The exported reports carry the same signal without any extra code: the
 * sandbox organization is named "<Company> — Practice", and every report puts
 * the organization name in its header.
 */
export function SandboxBanner({ homeOrgName, canReset }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  async function act(action: 'leave' | 'reset') {
    setBusy(action);
    const res = await fetch('/api/sandbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    setConfirmReset(false);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Something went wrong.' }));
      alert(error);
      return;
    }
    // A full reload, not router.refresh(): the whole session now resolves to a
    // different organization, so every cached server component is stale.
    window.location.assign('/dashboard');
  }

  return (
    <div className="sticky top-0 z-50 bg-amber-500 text-amber-950 border-b border-amber-600">
      <div className="px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <FlaskConical size={16} className="shrink-0" />
          <p className="text-sm font-semibold">Practice workspace</p>
          <p className="text-sm hidden sm:block opacity-90 truncate">
            Nothing here affects {homeOrgName ?? 'your live data'}. Do not report from these figures.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canReset && (
            confirmReset ? (
              <>
                <span className="text-xs font-medium">Delete all practice data?</span>
                <button
                  onClick={() => act('reset')}
                  disabled={busy !== null}
                  className="text-xs font-semibold rounded-md bg-amber-950 text-amber-50 px-2.5 py-1 hover:bg-amber-900 disabled:opacity-50"
                >
                  {busy === 'reset' ? 'Resetting…' : 'Yes, reset'}
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="text-xs font-medium rounded-md px-2 py-1 hover:bg-amber-400"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmReset(true)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-amber-700/40 px-2.5 py-1 hover:bg-amber-400 disabled:opacity-50"
              >
                <RotateCcw size={13} /> Reset
              </button>
            )
          )}
          <button
            onClick={() => act('leave')}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md bg-amber-950 text-amber-50 px-3 py-1.5 hover:bg-amber-900 disabled:opacity-50"
          >
            <ArrowLeft size={13} />
            {busy === 'leave' ? 'Leaving…' : 'Back to live data'}
          </button>
        </div>
      </div>
    </div>
  );
}
