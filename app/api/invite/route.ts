import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import { isInvitableRole, normaliseInviteEmail } from '@/lib/invite-core';

/**
 * Invite a colleague into the caller's organization.
 *
 * Before the October 2026 release pass this route could not produce a working
 * account, for two independent reasons:
 *
 *  1. The profile row was created without an `id`, so it took a random UUID
 *     from the column default. Every RLS policy resolves the caller through
 *     `users.id = auth.uid()`, so the invitee's real auth id matched no
 *     profile and they saw an empty application. Worse, the orphan row held
 *     their email under a UNIQUE constraint, so they could not sign up either.
 *  2. The invite link pointed at `/invite/accept`, which did not exist.
 *
 * Now the profile is created with the id Supabase returns for the invited
 * user, and `/invite/accept` establishes the session and has them set a
 * password.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // organization_id, NOT the active organization, and deliberately so. A
  // sandbox is a workspace rather than a tenant with members —
  // set_active_organization() refuses any target that is not the caller's own
  // home organization or their own sandbox — so inviting a colleague into one
  // would create a user belonging to a practice area. Membership outlives the
  // session; see lib/org-context.ts.
  const { data: inviter } = await supabase
    .from('users').select('organization_id, role, is_active').eq('id', user.id).single();
  if (!inviter || inviter.role !== 'admin' || !inviter.is_active) {
    return NextResponse.json({ error: 'Only admins can invite team members.' }, { status: 403 });
  }

  let body: { email?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const email = normaliseInviteEmail(body.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (!isInvitableRole(body.role)) {
    return NextResponse.json({ error: 'Role must be editor, viewer or auditor.' }, { status: 400 });
  }
  const role = body.role;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const service = createServiceClient();

  const { data: invited, error } = await service.auth.admin.inviteUserByEmail(email, {
    data: { organization_id: inviter.organization_id, role },
    redirectTo: `${appUrl.replace(/\/$/, '')}/invite/accept`,
  });

  if (error || !invited?.user) {
    // Supabase's message is specific and safe to show ("already registered").
    return NextResponse.json({ error: error?.message ?? 'The invitation could not be sent.' }, { status: 400 });
  }

  const { error: profileError } = await service.from('users').insert({
    id: invited.user.id,
    email,
    organization_id: inviter.organization_id,
    role,
    is_active: true,
  });

  if (profileError) {
    // Without a profile the invite link leads to an empty, unusable account.
    // Take the auth user back out so the admin can simply try again.
    await service.auth.admin.deleteUser(invited.user.id);
    const message = profileError.code === '23505'
      ? 'Someone with that email already has an account on this deployment.'
      : 'The invitation could not be completed.';
    console.error('[invite] profile insert failed:', profileError.message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
