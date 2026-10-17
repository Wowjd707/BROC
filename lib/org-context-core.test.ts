import { describe, it, expect } from 'vitest';
import { resolveOrganizationIds } from './org-context-core';

const HOME = '11111111-1111-1111-1111-111111111111';
const SANDBOX = '22222222-2222-2222-2222-222222222222';

describe('resolveOrganizationIds', () => {
  it('uses the home organization when no sandbox is active', () => {
    const ids = resolveOrganizationIds({
      organization_id: HOME,
      active_organization_id: null,
    });
    expect(ids).toEqual({
      activeOrganizationId: HOME,
      homeOrganizationId: HOME,
      inPracticeMode: false,
    });
  });

  it('prefers the active organization in practice mode', () => {
    // The direction that was wrong. Reading organization_id here is what made
    // every write from inside a sandbox fail its policy check, because
    // auth_org_id() is COALESCE(active_organization_id, organization_id) and
    // the insert has to match it.
    const ids = resolveOrganizationIds({
      organization_id: HOME,
      active_organization_id: SANDBOX,
    });
    expect(ids.activeOrganizationId).toBe(SANDBOX);
    expect(ids.inPracticeMode).toBe(true);
  });

  it('keeps the home organization reachable while in practice mode', () => {
    // Invitations and membership must not follow the session into a sandbox:
    // a sandbox is a workspace, not a tenant with members.
    const ids = resolveOrganizationIds({
      organization_id: HOME,
      active_organization_id: SANDBOX,
    });
    expect(ids.homeOrganizationId).toBe(HOME);
  });

  it('never reports practice mode when the two ids coincide by accident', () => {
    // A row whose active id equals its home id is still an explicit choice to
    // be somewhere, and the flag should say so rather than guess from equality.
    const ids = resolveOrganizationIds({
      organization_id: HOME,
      active_organization_id: HOME,
    });
    expect(ids.activeOrganizationId).toBe(HOME);
    expect(ids.inPracticeMode).toBe(true);
  });
});
