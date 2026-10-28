import { describe, it, expect } from 'vitest';
import { asConfirmType, safeNextPath, confirmMessage } from './auth-confirm-core';

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
});
