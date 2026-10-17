/**
 * Single sign-on: domain validation and the just-in-time provisioning
 * decision. Pure and I/O-free so the decision that grants someone access to an
 * organization's data is testable directly.
 *
 * The provisioning decision is the whole point of this module. Supabase Auth
 * will happily federate a user from any identity provider you configure; it has
 * no opinion about which tenant that user belongs to. Getting this wrong in the
 * permissive direction admits a stranger to someone's emissions data. Getting
 * it wrong in the restrictive direction shows a confusing empty dashboard. Both
 * are handled explicitly below; neither is left to fall through.
 */

/** Roles a federated user may receive automatically. Never 'admin'. */
export const PROVISIONABLE_ROLES = ['viewer', 'editor', 'auditor'] as const;
export type ProvisionableRole = (typeof PROVISIONABLE_ROLES)[number];

/**
 * Consumer mail providers, refused as SSO domains.
 *
 * Mapping one of these would admit anyone who can register an address there —
 * which is everyone — to the organization. This mirrors the CHECK constraint in
 * migration 031 so the UI can refuse with a sentence instead of surfacing a
 * constraint violation. The database remains the enforcement point; this list
 * is a courtesy. Keep the two in sync when either changes.
 */
export const CONSUMER_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'mail.com', 'zoho.com',
  'yandex.com', 'yandex.ru', 'qq.com', '163.com', '126.com', 'naver.com', 'web.de',
  'fastmail.com', 'hey.com', 'tutanota.com', 'tuta.io', 'duck.com', 'mail.ru',
]);

/** Matches the CHECK in migration 031. Labels, dots, no leading/trailing hyphen. */
const DOMAIN_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * The domain part of an email address, lowercased and trimmed.
 *
 * Returns null rather than throwing or guessing: a malformed address must not
 * become a provisioning decision. Note the deliberate rejection of more than
 * one '@' — `a@b@acme.com` has no unambiguous domain and some parsers read it
 * as `acme.com`, which would be a way to smuggle a mapped domain past a naive
 * check upstream.
 */
export function emailDomain(email: string): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  const parts = trimmed.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || !domain) return null;
  if (!DOMAIN_SHAPE.test(domain)) return null;
  return domain;
}

export type DomainValidation =
  | { ok: true; domain: string }
  | { ok: false; error: string };

/**
 * Validate a domain an administrator typed into the settings panel.
 * Accepts `acme.com`, `@acme.com`, `ACME.com ` and `https://acme.com` — an
 * admin pasting a URL is a normal mistake, not a reason to make them retype.
 */
export function validateDomainInput(raw: string): DomainValidation {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Enter a domain, for example acme.com' };
  }

  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');   // pasted a URL
  d = d.replace(/^@/, '');             // pasted @acme.com
  d = d.replace(/\/.*$/, '');          // trailing path
  d = d.replace(/:\d+$/, '');          // trailing port
  d = d.replace(/\.$/, '');            // fully-qualified trailing dot

  if (d.includes('@')) {
    return { ok: false, error: 'Enter the domain only, not a full email address.' };
  }
  if (d.startsWith('*.') || d.includes('*')) {
    return {
      ok: false,
      error: 'Wildcards are not supported. Each domain must be listed exactly — ' +
        'acme.com does not include contractor.acme.com.',
    };
  }
  if (!DOMAIN_SHAPE.test(d)) {
    return { ok: false, error: `“${raw.trim()}” is not a valid domain.` };
  }
  if (CONSUMER_EMAIL_DOMAINS.has(d)) {
    return {
      ok: false,
      error: `${d} is a public email provider. Mapping it would let anyone with ` +
        `a ${d} address into this organization.`,
    };
  }
  return { ok: true, domain: d };
}

/** A row from sso_domains, narrowed to what the decision needs. */
export interface DomainMapping {
  organizationId: string;
  domain: string;
  defaultRole: string;
  isActive: boolean;
}

export type ProvisionDecision =
  | {
      action: 'provision';
      organizationId: string;
      role: ProvisionableRole;
      domain: string;
    }
  | {
      action: 'refuse';
      /** Stable code for the login page to render a message against. */
      reason:
        | 'no_email'
        | 'invalid_email'
        | 'no_mapping'
        | 'mapping_inactive'
        | 'ambiguous_mapping'
        | 'invalid_role';
      detail: string;
    };

/**
 * Decide whether a federated user with no profile row may be provisioned.
 *
 * Called only when the authenticated user has no `users` row. An existing
 * profile always wins: this function never moves someone between
 * organizations or changes a role, because a domain mapping edited later must
 * not silently re-tenant people who already have accounts.
 */
export function decideProvisioning(
  email: string | null | undefined,
  mappings: readonly DomainMapping[],
): ProvisionDecision {
  if (!email) {
    return {
      action: 'refuse',
      reason: 'no_email',
      detail: 'The identity provider did not supply an email address, so there is ' +
        'no way to tell which organization this account belongs to.',
    };
  }

  const domain = emailDomain(email);
  if (!domain) {
    return {
      action: 'refuse',
      reason: 'invalid_email',
      detail: `“${email}” is not a usable email address.`,
    };
  }

  // Exact match only. No subdomain walking — see migration 031, note 1.
  const matches = mappings.filter((m) => m.domain.trim().toLowerCase() === domain);

  if (matches.length === 0) {
    return {
      action: 'refuse',
      reason: 'no_mapping',
      detail: `No organization in this deployment is configured for ${domain}. ` +
        `An administrator adds it under Settings → Single sign-on.`,
    };
  }

  const active = matches.filter((m) => m.isActive);
  if (active.length === 0) {
    return {
      action: 'refuse',
      reason: 'mapping_inactive',
      detail: `Single sign-on for ${domain} is configured but currently disabled.`,
    };
  }

  // The unique index makes this unreachable through the application, but a
  // deployment that loaded rows by hand before the index existed could hit it.
  // Refusing beats picking one arbitrarily: an arbitrary choice here puts
  // someone in the wrong tenant.
  const orgs = new Set(active.map((m) => m.organizationId));
  if (orgs.size > 1) {
    return {
      action: 'refuse',
      reason: 'ambiguous_mapping',
      detail: `${domain} is mapped to more than one organization. An administrator ` +
        `must remove the duplicate before anyone from ${domain} can sign in.`,
    };
  }

  const mapping = active[0];
  if (!(PROVISIONABLE_ROLES as readonly string[]).includes(mapping.defaultRole)) {
    return {
      action: 'refuse',
      reason: 'invalid_role',
      detail: `The mapping for ${domain} requests the role “${mapping.defaultRole}”, ` +
        `which cannot be granted automatically.`,
    };
  }

  return {
    action: 'provision',
    organizationId: mapping.organizationId,
    role: mapping.defaultRole as ProvisionableRole,
    domain: mapping.domain.trim().toLowerCase(),
  };
}

/**
 * Split a federated display name into first and last.
 *
 * Deliberately simple: first token is the given name, the remainder is the
 * family name. This is wrong for plenty of names, which is why these fields
 * stay editable — a best guess that the user can correct beats an empty
 * profile, and beats pretending a parser can do this properly.
 */
export function splitDisplayName(
  fullName: string | null | undefined,
): { firstName: string | null; lastName: string | null } {
  if (!fullName || typeof fullName !== 'string') {
    return { firstName: null, lastName: null };
  }
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** Message for the login page, keyed by refusal reason. */
export function refusalMessage(reason: string): string {
  switch (reason) {
    case 'no_mapping':
      return 'Your email domain is not set up for single sign-on here. Ask an administrator to add it.';
    case 'mapping_inactive':
      return 'Single sign-on for your domain is currently disabled.';
    case 'ambiguous_mapping':
      return 'Your domain is configured more than once. An administrator needs to resolve it.';
    case 'no_email':
    case 'invalid_email':
      return 'Your identity provider did not supply a usable email address.';
    case 'invalid_role':
      return 'The single sign-on configuration for your domain is invalid. Ask an administrator to review it.';
    default:
      return 'Single sign-on could not complete. Ask an administrator to check the configuration.';
  }
}
