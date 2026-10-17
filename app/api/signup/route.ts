import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import { isSignupOpen, SIGNUP_CLOSED_MESSAGE, MAX_ORG_NAME_LENGTH } from '@/lib/signup-core';

/** Real organizations on this deployment; practice sandboxes do not count. */
async function signupOpen(service: ReturnType<typeof createServiceClient>): Promise<boolean> {
  const { count, error } = await service
    .from('organizations')
    .select('id', { count: 'exact', head: true })
    .is('sandbox_of', null);
  // Fail closed: if the count cannot be read, do not hand out an organization.
  if (error) return false;
  return isSignupOpen({
    existingOrganizations: count ?? 0,
    allowPublicSignup: process.env.ALLOW_PUBLIC_SIGNUP,
  });
}

/**
 * Whether the signup form should be offered at all. Asked before the browser
 * creates an auth user, so a closed deployment does not leave behind accounts
 * that can never be given an organization.
 */
export async function GET() {
  return NextResponse.json({ open: await signupOpen(createServiceClient()) });
}

/**
 * Completes signup: creates the organization and the user profile row
 * for a freshly created auth user.
 *
 * Security: the caller must prove they are the auth user they claim to be.
 * We accept either the session cookie (normal flow — signUp sets a session)
 * or, when email confirmation is pending and no session exists yet, we
 * verify the auth user exists with a matching email and has no profile yet.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, email, firstName, lastName, orgName, industry, hqCountry } = body;

    if (!userId || !email || !orgName) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
    }
    if (typeof orgName !== 'string' || orgName.trim().length > MAX_ORG_NAME_LENGTH) {
      return NextResponse.json({ error: 'Organization name is too long.' }, { status: 400 });
    }

    const service = createServiceClient();

    // See lib/signup-core.ts: the first organization bootstraps the
    // deployment; after that, people join by invitation unless the operator
    // opted into a multi-organization deployment.
    if (!(await signupOpen(service))) {
      return NextResponse.json({ error: SIGNUP_CLOSED_MESSAGE }, { status: 403 });
    }

    // 1. If the request carries a session, it must belong to userId.
    const sessionClient = await createServerClient();
    const { data: { user: sessionUser } } = await sessionClient.auth.getUser();
    if (sessionUser && sessionUser.id !== userId) {
      return NextResponse.json({ error: 'Not authorized for this user.' }, { status: 403 });
    }

    // 2. The auth user must exist and the email must match what was registered.
    const { data: authUser, error: authError } = await service.auth.admin.getUserById(userId);
    if (authError || !authUser?.user) {
      return NextResponse.json({ error: 'Unknown user.' }, { status: 403 });
    }
    if ((authUser.user.email ?? '').toLowerCase() !== String(email).toLowerCase()) {
      return NextResponse.json({ error: 'Email does not match the registered account.' }, { status: 403 });
    }

    // 3. Refuse if a profile already exists — signup completion is one-shot.
    const { data: existingProfile } = await service
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (existingProfile) {
      return NextResponse.json({ error: 'Account is already set up.' }, { status: 409 });
    }

    // Create organization
    const { data: org, error: orgError } = await service
      .from('organizations')
      .insert({
        name: orgName.trim(),
        industry: industry || null,
        hq_country: hqCountry || 'USA',
      })
      .select('id')
      .single();

    if (orgError) {
      console.error('Error creating org:', orgError);
      return NextResponse.json({ error: orgError.message || 'Failed to create organization.' }, { status: 500 });
    }

    // Create user profile
    const { error: userError } = await service
      .from('users')
      .insert({
        id: userId,
        organization_id: org.id,
        email,
        first_name: firstName || null,
        last_name: lastName || null,
        role: 'admin',
      });

    if (userError) {
      console.error('Error creating user profile:', userError);
      // Attempt cleanup
      await service.from('organizations').delete().eq('id', org.id);
      return NextResponse.json({ error: userError.message || 'Failed to create user profile.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, orgId: org.id });
  } catch (err: unknown) {
    console.error('Signup route error:', err);
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
