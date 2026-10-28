/**
 * Pure helpers for the email-confirmation route (app/auth/confirm).
 *
 * The confirmation email links to /auth/confirm?token_hash=…&type=…, and the
 * route verifies the token on the server. That works whichever browser or
 * device the link is opened in — unlike the PKCE code flow, which needs the
 * code verifier left in the browser that signed up, so a link opened on a
 * phone after signing up on a laptop failed.
 */

/** The OTP types a link in our templates may carry. Never 'recovery' here. */
export const CONFIRM_TYPES = ['signup', 'email', 'email_change', 'magiclink', 'invite'] as const;
export type ConfirmType = (typeof CONFIRM_TYPES)[number];

export function asConfirmType(raw: string | null): ConfirmType | null {
  return raw && (CONFIRM_TYPES as readonly string[]).includes(raw) ? (raw as ConfirmType) : null;
}

/**
 * A same-site path to continue to, or the dashboard. Refuses anything that
 * could leave the site: an absolute URL, a protocol-relative `//host`, or a
 * backslash some browsers treat as a slash.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/dashboard';
  return raw;
}

/** What the login page says after a confirmation attempt (?confirm=<code>). */
export function confirmMessage(code: string): { tone: 'ok' | 'error'; text: string } {
  switch (code) {
    case 'ok':
      return { tone: 'ok', text: 'Your email is confirmed. Sign in to continue.' };
    case 'expired':
      return {
        tone: 'error',
        text: 'That confirmation link has expired or was already used. If you have confirmed already, sign in. If not, enter your email below and send a new link.',
      };
    default:
      return { tone: 'error', text: 'That confirmation link is not valid. Use the most recent email we sent.' };
  }
}
