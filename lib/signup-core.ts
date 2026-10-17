/**
 * Who may create a new organization through /signup.
 *
 * Self-service signup creates an organization and makes its creator the
 * admin. On a single-company deployment that is exactly right for the FIRST
 * account and wrong for every one after it: anyone who can reach the URL gets
 * a tenant on your database, can run the AI-backed features on your
 * deployment's API key, and — because disclosure requirements and the
 * regulatory tracker are shared reference data — can edit content every other
 * organization on the deployment reads.
 *
 * So signup bootstraps the first organization and then closes, unless the
 * operator deliberately runs a multi-organization deployment and sets
 * ALLOW_PUBLIC_SIGNUP=true. Everyone after the first admin joins by
 * invitation (Settings → Team).
 */

export function isSignupOpen(input: {
  /** Real (non-sandbox) organizations already on this deployment. */
  existingOrganizations: number;
  /** The raw ALLOW_PUBLIC_SIGNUP environment value. */
  allowPublicSignup: string | undefined;
}): boolean {
  if (input.allowPublicSignup?.trim().toLowerCase() === 'true') return true;
  return input.existingOrganizations === 0;
}

export const SIGNUP_CLOSED_MESSAGE =
  'Sign-up is closed on this deployment. Ask an administrator to invite you from Settings → Team.';

/** organizations.name is VARCHAR(255). */
export const MAX_ORG_NAME_LENGTH = 255;
