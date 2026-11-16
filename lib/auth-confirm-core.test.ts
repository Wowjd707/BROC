import { describe, it, expect } from 'vitest';
import { asConfirmType, safeNextPath, confirmMessage, isRecoveryLink, newPasswordProblem, resetLinkMessage } from './auth-confirm-core';

describe('auth confirm helpers', () => {
  it('accepts only the link types our templates send', () => {
    expect(asConfirmType('signup')).toBe('signup');
    expect(asConfirmType('email')).toBe('email');
    expect(asConfirmType('recovery')).toBeNull();
    expect(asConfirmType(null)).toBeNull();
  });
  it('never redirects off the site', () => {
    expect(safeNextPath('/goals')).toBe('/goals');
    expect(safeNextPath('https://evil.example')).toBe('/dashboard');
    expect(safeNextPath('//evil.example')).toBe('/dashboard');
    expect(safeNextPath('/\\evil.example')).toBe('/dashboard');
    expect(safeNextPath(null)).toBe('/dashboard');
  });
  it('explains each outcome', () => {
    expect(confirmMessage('ok').tone).toBe('ok');
    expect(confirmMessage('expired').text).toMatch(/expired/);
    expect(confirmMessage('anything').tone).toBe('error');
  });
  it('treats only type=recovery as a reset link', () => {
    expect(isRecoveryLink('recovery')).toBe(true);
    expect(isRecoveryLink('signup')).toBe(false);
    expect(isRecoveryLink(null)).toBe(false);
  });
  it('holds a new password to the same rule as an invitation', () => {
    expect(newPasswordProblem('short', 'short')).toMatch(/at least 8/);
    expect(newPasswordProblem('longenough1', 'longenough2')).toMatch(/do not match/);
    expect(newPasswordProblem('longenough1', 'longenough1')).toBeNull();
  });
  it('explains a failed reset link', () => {
    expect(resetLinkMessage('expired')).toMatch(/expired/);
    expect(resetLinkMessage('invalid')).toMatch(/not valid/);
  });
});
