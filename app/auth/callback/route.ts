import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import { decideProvisioning, splitDisplayName, type DomainMapping } from '@/lib/sso-core';

/**
 * OAuth / OIDC / SAML callback.
 *
 * Supabase Auth has already authenticated the person by the time they arrive
 * here. What it has not done — and cannot do — is decide which organization
 * they belong to. That decision happens here, once, on first federated login.
 *
 * Why the service client: a freshly federated user has no `users` row, so no
 * organization_id, so every RLS policy returns nothing — including a lookup of
 * their own profile. The provisioning path therefore has to run above RLS.
 * That makes this the single most security-sensitive route in the application,
 * so it does exactly three privileged things and nothing else:
 *
 *   1. read the authenticated user's own profile row, if any
 *   2. read sso_domains
 *   3. insert one users row, for that same authenticated user, with the role
 *      the mapping specifies
 *
 * It never trusts anything from the query string except the code Supabase
 * issued and a relative redirect path. The email comes from the verified
 * session, never from a parameter — an email taken from the URL would let
 * anyone pick their own organization.
 */

/** Reject absolute URLs and protocol-relative paths: an open redirect is a phishing primitive. */
function safeRedirectPath(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/')) return '/dashboard';
  if (raw.startsWith('//')) return '/dashboard';
  if (raw.includes('\\')) return '/dashboard';
  return raw;
}

function refuse(request: NextRequest, reason: string): NextResponse {
  const url = new URL('/login', request.url);
  url.searchParams.set('sso_error', reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeRedirectPath(searchParams.get('next'));

  // The identity provider itself refused (consent declined, policy block).
  const providerError = searchParams.get('error');
  if (providerError) {
    console.warn('[sso] identity provider returned an error:', providerError);
    return refuse(request, 'provider_error');
  }

  if (!code) return refuse(request, 'missing_code');

  const supabase = await createServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    console.warn('[sso] code exchange failed:', exchangeError.message);
    return refuse(request, 'exchange_failed');
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return refuse(request, 'no_session');

  const service = createServiceClient();

  // ── 1. Already provisioned? ────────────────────────────────────────────────
  // An existing profile always wins. This route never moves someone between
  // organizations and never changes a role: an administrator editing a domain
  // mapping must not silently re-tenant people who already have accounts.
  const { data: existing, error: existingError } = await service
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (existingError) {
    console.error('[sso] could not read the profile row:', existingError.message);
    return refuse(request, 'lookup_failed');
  }
  if (existing) {
    return NextResponse.redirect(new URL(next, request.url));
  }

  // ── 2. Decide ──────────────────────────────────────────────────────────────
  const { data: rows, error: domainsError } = await service
    .from('sso_domains')
    .select('organization_id, domain, default_role, is_active');

  if (domainsError) {
    console.error('[sso] could not read sso_domains:', domainsError.message);
    return refuse(request, 'lookup_failed');
  }

  const mappings: DomainMapping[] = (rows ?? []).map((r) => ({
    organizationId: r.organization_id as string,
    domain: r.domain as string,
    defaultRole: r.default_role as string,
    isActive: r.is_active as boolean,
  }));

  const decision = decideProvisioning(user.email, mappings);

  if (decision.action === 'refuse') {
    // Do not leave a usable session behind for someone we are not admitting.
    // Without this they hold a valid Supabase session with no profile, which is
    // the broken-empty-dashboard state this whole route exists to prevent.
    await supabase.auth.signOut();
    console.warn(`[sso] refused ${user.email}: ${decision.reason} — ${decision.detail}`);
    return refuse(request, decision.reason);
  }

  // ── 3. Provision ───────────────────────────────────────────────────────────
  // Identity-provider claim names vary: Entra ID sends `name`, Google sends
  // `full_name`, some SAML setups send neither. Try the common ones and accept
  // that the fields may end up null — they are editable in Settings.
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    null;
  const { firstName, lastName } = splitDisplayName(displayName);

  const provider =
    typeof user.app_metadata?.provider === 'string' ? user.app_metadata.provider : 'sso';
  const authProvider = provider === 'saml' ? 'saml' : provider === 'email' ? 'password' : 'oidc';

  if (!user.email) {
    // Unreachable: decideProvisioning refuses with `no_email` above. Kept as a
    // real guard rather than a non-null assertion so that users.email (NOT NULL
    // since migration 001) cannot be reached without one if that order changes.
    await supabase.auth.signOut();
    return refuse(request, 'no_email');
  }

  const { error: insertError } = await service.from('users').insert({
    id: user.id,
    organization_id: decision.organizationId,
    email: user.email,
    first_name: firstName,
    last_name: lastName,
    role: decision.role,
    auth_provider: authProvider,
    provisioned_at: new Date().toISOString(),
    provisioned_via_domain: decision.domain,
  });

  if (insertError) {
    // A unique violation means two callbacks raced — the other one won, which
    // is a success from the user's point of view.
    if (insertError.code === '23505') {
      return NextResponse.redirect(new URL(next, request.url));
    }
    console.error('[sso] provisioning insert failed:', insertError.message);
    await supabase.auth.signOut();
    return refuse(request, 'provision_failed');
  }

  console.info(
    `[sso] provisioned ${user.email} into org ${decision.organizationId} ` +
    `as ${decision.role} via ${decision.domain}`,
  );

  return NextResponse.redirect(new URL(next, request.url));
}
