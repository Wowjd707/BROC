/**
 * Pure helpers for the team-invite flow.
 *
 * An invitation is sent with `auth.admin.inviteUserByEmail`, and Supabase's
 * verify endpoint returns the invitee to `/invite/accept` with the session in
 * the URL FRAGMENT (`#access_token=…&refresh_token=…&type=invite`). An
 * admin-issued invite cannot use PKCE — there is no code verifier in the
 * invitee's browser — and the app's browser client is configured for PKCE, so
 * it deliberately refuses to pick a fragment session up by itself. The accept
 * page therefore reads the fragment explicitly, with this function.
 */

export type InviteFragment =
  | { kind: 'session'; accessToken: string; refreshToken: string; type: string | null }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

export function parseInviteFragment(hash: string): InviteFragment {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

  const error = params.get('error_description') ?? params.get('error');
  if (error) {
    return { kind: 'error', message: error.replace(/\+/g, ' ') };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'session', accessToken, refreshToken, type: params.get('type') };
  }

  return { kind: 'none' };
}

/** The roles an administrator may invite someone into. Never `admin`. */
export const INVITABLE_ROLES = ['editor', 'viewer', 'auditor'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(value: unknown): value is InvitableRole {
  return typeof value === 'string' && (INVITABLE_ROLES as readonly string[]).includes(value);
}

/**
 * Normalise an email for an invitation. Lower-cased because users.email is
 * UNIQUE and case-sensitive in Postgres, so `Ann@x.com` and `ann@x.com` would
 * otherwise become two profiles for one mailbox.
 */
export function normaliseInviteEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254) return null;
  // Deliberately loose: Supabase validates the address properly. This only
  // turns away input that is plainly not one.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Minimum password length for an invitee setting their first password. */
export const MIN_PASSWORD_LENGTH = 8;
