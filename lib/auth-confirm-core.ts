import { MIN_PASSWORD_LENGTH } from './invite-core';

/**
 * Pure helpers for the email-confirmation route (app/auth/confirm).
 *
 * The confirmation email links to /auth/confirm?token_hash=…&type=…, and the
 * route verifies the token on the server. That works whichever browser or
 * device the link is opened in — unlike the PKCE code flow, which needs the
 * code verifier left in the browser that signed up, so a link opened on a
 * phone after signing up on a laptop failed.
 */

/**
 * The OTP types a confirmation link may carry. 'recovery' is deliberately not
 * one of them: a password-reset link signs the person in, so it is handled on
 * its own path (isRecoveryLink) that always ends on RESET_PASSWORD_PATH and
 * ignores `next`. Letting it through here would make a reset link a general
 * sign-in link to any page.
 */
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

/** Where a verified password-reset link always lands, whatever `next` says. */
export const RESET_PASSWORD_PATH = '/reset-password';

/** A password-reset link, as the "Reset password" email template builds it. */
export function isRecoveryLink(rawType: string | null): boolean {
  return rawType === 'recovery';
}

/** What the forgot-password page says after a failed reset link (?reset=<code>). */
export function resetLinkMessage(code: string): string {
  return code === 'expired'
    ? 'That reset link has expired or was already used. Enter your email to get a new one.'
    : 'That reset link is not valid. Use the most recent email we sent, or ask for a new one.';
}

/**
 * Why a new password cannot be saved yet, or null if it can. The same rule as
 * the invitation page, so a password is never acceptable in one place and
 * refused in the other.
 */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}
