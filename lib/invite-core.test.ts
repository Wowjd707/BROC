import { describe, it, expect } from 'vitest';
import { parseInviteFragment, isInvitableRole, normaliseInviteEmail } from './invite-core';

describe('parseInviteFragment', () => {
  it('reads the session Supabase puts in the fragment', () => {
    expect(parseInviteFragment('#access_token=a.b.c&refresh_token=r1&type=invite&expires_in=3600'))
      .toEqual({ kind: 'session', accessToken: 'a.b.c', refreshToken: 'r1', type: 'invite' });
  });

  it('reports an expired or reused link as an error, not as no session', () => {
    expect(parseInviteFragment('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'))
      .toEqual({ kind: 'error', message: 'Email link is invalid or has expired' });
  });

  it('returns none for an empty fragment', () => {
    expect(parseInviteFragment('')).toEqual({ kind: 'none' });
    expect(parseInviteFragment('#')).toEqual({ kind: 'none' });
  });

  it('needs both tokens', () => {
    expect(parseInviteFragment('#access_token=a')).toEqual({ kind: 'none' });
  });
});

describe('isInvitableRole', () => {
  it('allows editor, viewer and auditor', () => {
    for (const r of ['editor', 'viewer', 'auditor']) expect(isInvitableRole(r)).toBe(true);
  });
  it('never allows admin', () => {
    expect(isInvitableRole('admin')).toBe(false);
    expect(isInvitableRole('')).toBe(false);
    expect(isInvitableRole(undefined)).toBe(false);
  });
});

describe('normaliseInviteEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseInviteEmail('  Ann.Lee@Example.COM ')).toBe('ann.lee@example.com');
  });
  it('rejects what is plainly not an address', () => {
    for (const bad of ['', 'ann', 'ann@', '@x.com', 'a b@x.com', 42, null]) {
      expect(normaliseInviteEmail(bad)).toBeNull();
    }
  });
});
