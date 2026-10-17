'use client';

import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * The way in. Lives in Settings rather than the main nav: entering practice
 * mode is a deliberate act, and a one-click switch next to "Dashboard" is one
 * mis-click away from someone entering their month-end figures into a sandbox.
 */
export function SandboxEntryCard({ seeded }: { seeded: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function enter() {
    setBusy(true); setError('');
    const res = await fetch('/api/sandbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'enter' }),
    });
    if (!res.ok) {
      const { error: message } = await res.json().catch(() => ({ error: 'Something went wrong.' }));
      setError(message);
      setBusy(false);
      return;
    }

    // Entering and seeding fail independently, and only the first of them is
    // an HTTP failure: the route returns 200 with the seed problems in the
    // body, so checking res.ok alone reported success for a workspace that
    // arrived empty. That is the exact failure the route's own comment warns
    // about — an empty sandbox and a broken one look identical — so the
    // problems have to be read out of the body and shown.
    const body = await res.json().catch(() => null);
    const problems: string[] = body?.seed?.problems ?? [];
    if (problems.length > 0) {
      setError(
        `The practice workspace was created, but the example data could not be added: ${problems[0]}`,
      );
      setBusy(false);
      return;
    }

    window.location.assign('/dashboard');
  }

  return (
    <Card>
      <CardContent className="py-6 space-y-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-amber-100 text-amber-700 p-2 shrink-0">
            <FlaskConical size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">Practice workspace</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-xl">
              A full copy of the system with invented data, kept in a separate organization of its
              own. Enter an invoice, run a data review, set a goal, assemble a disclosure — none of
              it can reach your live figures, because the database scopes it somewhere else
              entirely.
            </p>
            {!seeded && (
              <p className="text-xs text-gray-500 mt-2">
                First entry seeds three sites and eighteen months of energy, water and waste, so the
                charts have something to say. Takes a moment.
              </p>
            )}
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
          </div>
        </div>
        <div className="pl-12">
          <Button variant="outline" onClick={enter} disabled={busy}>
            {busy ? 'Setting up…' : 'Enter practice workspace'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
