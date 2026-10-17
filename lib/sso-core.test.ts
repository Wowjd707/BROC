import { describe, it, expect } from 'vitest';
import {
  emailDomain, validateDomainInput, decideProvisioning, splitDisplayName,
  CONSUMER_EMAIL_DOMAINS, PROVISIONABLE_ROLES, refusalMessage,
  type DomainMapping,
} from './sso-core';

const mapping = (over: Partial<DomainMapping> = {}): DomainMapping => ({
  organizationId: 'org-1', domain: 'acme.com', defaultRole: 'viewer', isActive: true, ...over,
});

describe('emailDomain', () => {
  it('extracts and lowercases', () => {
    expect(emailDomain('Dana@Acme.COM')).toBe('acme.com');
    expect(emailDomain('  a@acme.co.uk  ')).toBe('acme.co.uk');
  });

  it('rejects malformed addresses rather than guessing', () => {
    for (const bad of ['', 'nope', '@acme.com', 'a@', 'a@@acme.com', 'a@b@acme.com', 'a@localhost', 'a@-acme.com', 'a@acme-.com']) {
      expect(emailDomain(bad)).toBeNull();
    }
  });

  it('rejects non-strings', () => {
    expect(emailDomain(undefined as unknown as string)).toBeNull();
    expect(emailDomain(null as unknown as string)).toBeNull();
  });
});

describe('validateDomainInput', () => {
  it('accepts a plain domain', () => {
    expect(validateDomainInput('acme.com')).toEqual({ ok: true, domain: 'acme.com' });
  });

  it('forgives the normal paste mistakes', () => {
    for (const raw of ['@acme.com', ' ACME.com ', 'https://acme.com', 'http://acme.com/path', 'acme.com:443', 'acme.com.']) {
      expect(validateDomainInput(raw)).toEqual({ ok: true, domain: 'acme.com' });
    }
  });

  it('refuses a full email address with a useful message', () => {
    const r = validateDomainInput('dana@acme.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/domain only/i);
  });

  it('refuses wildcards and says why', () => {
    const r = validateDomainInput('*.acme.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/contractor\.acme\.com/);
  });

  it('refuses every consumer provider in the list', () => {
    for (const d of CONSUMER_EMAIL_DOMAINS) {
      const r = validateDomainInput(d);
      expect(r.ok, `${d} should be refused`).toBe(false);
    }
  });

  it('refuses junk', () => {
    for (const bad of ['', '   ', 'localhost', 'acme', '-acme.com', 'acme-.com', '...']) {
      expect(validateDomainInput(bad).ok, bad).toBe(false);
    }
  });
});

describe('decideProvisioning', () => {
  it('provisions an exact domain match', () => {
    const d = decideProvisioning('dana@acme.com', [mapping()]);
    expect(d).toEqual({ action: 'provision', organizationId: 'org-1', role: 'viewer', domain: 'acme.com' });
  });

  it('matches case-insensitively on both sides', () => {
    const d = decideProvisioning('Dana@ACME.com', [mapping({ domain: 'Acme.Com ' })]);
    expect(d.action).toBe('provision');
  });

  it('does NOT walk subdomains — the tenancy hole', () => {
    const d = decideProvisioning('contractor@vendor.acme.com', [mapping({ domain: 'acme.com' })]);
    expect(d.action).toBe('refuse');
    if (d.action === 'refuse') expect(d.reason).toBe('no_mapping');
  });

  it('does not match a domain that merely ends with the mapping', () => {
    const d = decideProvisioning('a@notacme.com', [mapping({ domain: 'acme.com' })]);
    expect(d.action).toBe('refuse');
  });

  it('refuses when there is no mapping at all', () => {
    const d = decideProvisioning('a@other.com', [mapping()]);
    expect(d.action).toBe('refuse');
    if (d.action === 'refuse') {
      expect(d.reason).toBe('no_mapping');
      expect(d.detail).toContain('other.com');
    }
  });

  it('refuses an inactive mapping distinctly from a missing one', () => {
    const d = decideProvisioning('a@acme.com', [mapping({ isActive: false })]);
    expect(d.action).toBe('refuse');
    if (d.action === 'refuse') expect(d.reason).toBe('mapping_inactive');
  });

  it('prefers an active mapping when one of each exists', () => {
    const d = decideProvisioning('a@acme.com', [
      mapping({ isActive: false, organizationId: 'org-dead' }),
      mapping({ isActive: true, organizationId: 'org-live' }),
    ]);
    expect(d.action).toBe('provision');
    if (d.action === 'provision') expect(d.organizationId).toBe('org-live');
  });

  it('refuses rather than guessing when two orgs claim one domain', () => {
    const d = decideProvisioning('a@acme.com', [
      mapping({ organizationId: 'org-1' }),
      mapping({ organizationId: 'org-2' }),
    ]);
    expect(d.action).toBe('refuse');
    if (d.action === 'refuse') expect(d.reason).toBe('ambiguous_mapping');
  });

  it('accepts duplicates that agree on the organization', () => {
    const d = decideProvisioning('a@acme.com', [mapping(), mapping()]);
    expect(d.action).toBe('provision');
  });

  it('never provisions admin, even if a row somehow says so', () => {
    const d = decideProvisioning('a@acme.com', [mapping({ defaultRole: 'admin' })]);
    expect(d.action).toBe('refuse');
    if (d.action === 'refuse') expect(d.reason).toBe('invalid_role');
  });

  it('refuses an unknown role', () => {
    const d = decideProvisioning('a@acme.com', [mapping({ defaultRole: 'superuser' })]);
    expect(d.action).toBe('refuse');
  });

  it('allows every provisionable role', () => {
    for (const role of PROVISIONABLE_ROLES) {
      const d = decideProvisioning('a@acme.com', [mapping({ defaultRole: role })]);
      expect(d.action, role).toBe('provision');
      if (d.action === 'provision') expect(d.role).toBe(role);
    }
  });

  it('refuses a missing or malformed email', () => {
    expect(decideProvisioning(null, [mapping()]).action).toBe('refuse');
    expect(decideProvisioning('', [mapping()]).action).toBe('refuse');
    const d = decideProvisioning('garbage', [mapping()]);
    if (d.action === 'refuse') expect(d.reason).toBe('invalid_email');
  });

  it('refuses against an empty mapping table', () => {
    expect(decideProvisioning('a@acme.com', []).action).toBe('refuse');
  });
});

describe('splitDisplayName', () => {
  it('splits on the first token', () => {
    expect(splitDisplayName('Dana Whitfield')).toEqual({ firstName: 'Dana', lastName: 'Whitfield' });
    expect(splitDisplayName('Ana Maria de Souza')).toEqual({ firstName: 'Ana', lastName: 'Maria de Souza' });
  });

  it('handles one name, blanks and nulls', () => {
    expect(splitDisplayName('Cher')).toEqual({ firstName: 'Cher', lastName: null });
    expect(splitDisplayName('   ')).toEqual({ firstName: null, lastName: null });
    expect(splitDisplayName(null)).toEqual({ firstName: null, lastName: null });
    expect(splitDisplayName(undefined)).toEqual({ firstName: null, lastName: null });
  });

  it('collapses runs of whitespace', () => {
    expect(splitDisplayName('  Dana   Whitfield ')).toEqual({ firstName: 'Dana', lastName: 'Whitfield' });
  });
});

describe('refusalMessage', () => {
  it('has a message for every refusal reason the decision can emit', () => {
    for (const reason of ['no_email', 'invalid_email', 'no_mapping', 'mapping_inactive', 'ambiguous_mapping', 'invalid_role']) {
      const m = refusalMessage(reason);
      expect(m.length, reason).toBeGreaterThan(10);
      expect(m, reason).not.toMatch(/could not complete/); // must not fall to the default
    }
  });

  it('falls back safely on an unknown reason', () => {
    expect(refusalMessage('what')).toMatch(/could not complete/);
  });
});
