'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** users.first_name and users.last_name are VARCHAR(100). */
const MAX_NAME = 100;

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Edit your own display name. The name shows in the sidebar, on the team list
 * and against import adjustments, so it is how colleagues and an assurance
 * provider see who did what.
 *
 * Writes only first_name and last_name on the caller's own row. RLS
 * (users_update_self) and the guard trigger from migration 032 already allow
 * exactly that and nothing more: role, organization and active status cannot
 * be changed this way.
 */
export function ProfileDialog({ open, onClose, userId, email, firstName, lastName }: Props) {
  const router = useRouter();
  const [first, setFirst] = useState(firstName ?? '');
  const [last, setLast] = useState(lastName ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() {
    setFirst(firstName ?? '');
    setLast(lastName ?? '');
    setError('');
  }

  async function save() {
    const f = first.trim();
    const l = last.trim();
    if (!f && !l) { setError('Enter a first or last name.'); return; }
    if (f.length > MAX_NAME || l.length > MAX_NAME) {
      setError(`Each name can be at most ${MAX_NAME} characters.`);
      return;
    }
    setSaving(true);
    setError('');
    // .select() so an update RLS filtered out (zero rows) reads as a refusal,
    // not a success: Supabase reports both the same way otherwise.
    const { data, error: err } = await createClient()
      .from('users')
      .update({ first_name: f || null, last_name: l || null })
      .eq('id', userId)
      .select('id');
    setSaving(false);
    if (err || !data || data.length === 0) {
      setError(err?.message ?? 'Your name could not be saved. Try signing out and back in.');
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Your profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First name</Label>
              <Input value={first} maxLength={MAX_NAME} onChange={(e) => setFirst(e.target.value)} autoFocus />
            </div>
            <div>
              <Label>Last name</Label>
              <Input value={last} maxLength={MAX_NAME} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Email</Label>
            <p className="text-sm text-gray-600">{email}</p>
            <p className="text-xs text-gray-400 mt-0.5">Your sign-in email is managed by your administrator.</p>
          </div>
          <p className="text-xs text-gray-400">
            Shown in the sidebar, on the team list and against changes you make. A role title
            (&ldquo;Sustainability Lead&rdquo;) works if you would rather not show your name.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
