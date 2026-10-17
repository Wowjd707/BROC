import { describe, it, expect } from 'vitest';
import { isSignupOpen } from './signup-core';

describe('isSignupOpen', () => {
  it('is open on an empty deployment, so the first admin can bootstrap it', () => {
    expect(isSignupOpen({ existingOrganizations: 0, allowPublicSignup: undefined })).toBe(true);
  });

  it('closes once an organization exists', () => {
    expect(isSignupOpen({ existingOrganizations: 1, allowPublicSignup: undefined })).toBe(false);
    expect(isSignupOpen({ existingOrganizations: 1, allowPublicSignup: '' })).toBe(false);
    expect(isSignupOpen({ existingOrganizations: 1, allowPublicSignup: 'false' })).toBe(false);
  });

  it('stays open when the operator opts in', () => {
    expect(isSignupOpen({ existingOrganizations: 5, allowPublicSignup: 'true' })).toBe(true);
    expect(isSignupOpen({ existingOrganizations: 5, allowPublicSignup: ' TRUE ' })).toBe(true);
  });

  it('does not treat other truthy-looking values as consent', () => {
    expect(isSignupOpen({ existingOrganizations: 5, allowPublicSignup: '1' })).toBe(false);
    expect(isSignupOpen({ existingOrganizations: 5, allowPublicSignup: 'yes' })).toBe(false);
  });
});
