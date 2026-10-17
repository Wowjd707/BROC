/**
 * Choosing between a user's two organizations.
 *
 * Split out of `lib/org-context.ts` because that module is `server-only` and
 * cannot be imported by a test. The rule it encodes is the one that was got
 * wrong, so it belongs somewhere it can be asserted — the same reason every
 * other `*-core.ts` module exists.
 *
 * `tests/sandbox-rls.test.ts` proves what the DATABASE demands: an insert from
 * inside the sandbox must carry the sandbox id. It cannot prove the
 * application supplies it, because it speaks SQL directly. This is the other
 * half, and between them the contract is pinned at both ends.
 */

export interface OrganizationIds {
  /** Where this session's data lives. Mirrors `auth_org_id()` exactly. */
  activeOrganizationId: string;
  /** The organization the user belongs to, whatever they are looking at. */
  homeOrganizationId: string;
  /** True when the session is pointed at a sandbox rather than live data. */
  inPracticeMode: boolean;
}

/**
 * Resolve both ids from a `users` row.
 *
 * The COALESCE direction is the whole point: `active_organization_id` wins when
 * it is set, exactly as `auth_org_id()` does. Reversing it, or reading only
 * `organization_id`, is the bug this function exists to make testable — it made
 * every write from inside a sandbox fail its policy check.
 */
export function resolveOrganizationIds(profile: {
  organization_id: string;
  active_organization_id: string | null;
}): OrganizationIds {
  return {
    activeOrganizationId: profile.active_organization_id ?? profile.organization_id,
    homeOrganizationId: profile.organization_id,
    inPracticeMode: profile.active_organization_id != null,
  };
}
