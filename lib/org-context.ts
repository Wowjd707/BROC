import 'server-only';
import { createServerClient } from './supabase/server';
import { resolveOrganizationIds } from './org-context-core';

/**
 * Which organization a server-side write belongs to.
 *
 * Since migration 032 a user has two, and they are not interchangeable:
 *
 *   organization_id         the organization they belong to — permanent
 *   active_organization_id  the workspace this session is pointed at, which is
 *                           their sandbox in practice mode and NULL otherwise
 *
 * Every RLS policy funnels through `auth_org_id()`, defined as
 * `COALESCE(active_organization_id, organization_id)`. So a write that supplies
 * the home id while the session is in practice mode hands the policy a value
 * its `WITH CHECK` rejects, and the operation fails for a reason nothing on
 * screen explains.
 *
 * That is not hypothetical. Before this module existed, `lib/entries.ts` wrote
 * `organization_id` from the home org, so **no entry of any kind could be
 * created while in practice mode** — in the sandbox that exists precisely so
 * people can practise entering data. Confirmed against a real Postgres with the
 * migrations applied: in practice mode the home id is refused by RLS on
 * emission_entries, ehs_entries and scope3_entries, the active id is accepted,
 * and in the live workspace the home id still works.
 *
 * Seeding was broken by the same fault, not exempt from it. `seedSandbox()`
 * calls `createEmissionEntry` and `createEhsEntry` through the ordinary
 * RLS-enforced client — deliberately, so practice figures carry real lineage —
 * and it only runs once the session is already in the sandbox. So every seeded
 * entry was refused too, while the three seed *sites*, inserted directly with
 * the sandbox id, went in fine. The failures were collected into
 * `SeedResult.problems` and returned with HTTP 200, and the client checked only
 * the HTTP status, so a new practice workspace arrived empty with no error.
 * Fixing the id therefore fixes seeding as well.
 *
 * `lib/active-org.ts` already documented this hazard for the read path, and
 * every dashboard page resolves through it. This module is the write-side
 * counterpart; `entries.ts` was simply one of the places that had not been
 * brought in line.
 *
 * This module exists so the choice is explicit at every call site. Both ids are
 * returned and neither is named `organizationId`, because the bug was a caller
 * reading an ambiguous name and assuming the one it wanted.
 *
 * **Which to use.** If the row is data the sandbox should be able to hold —
 * entries, evidence, imports, anything scoped by `auth_org_id()` — use
 * `activeOrganizationId`. If it concerns who the user permanently is —
 * invitations, membership, billing — use `homeOrganizationId`. A sandbox is a
 * workspace, not a tenant with members: `set_active_organization()` refuses any
 * target that is not the caller's own home organization or their own sandbox,
 * so inviting a colleague into one would be meaningless.
 */
export interface OrgContext {
  userId: string;
  role: string;

  /**
   * Where this session's data lives. Matches `auth_org_id()` exactly, so a row
   * written with this id satisfies every policy that checks it.
   */
  activeOrganizationId: string;

  /**
   * The organization the user belongs to, regardless of what they are currently
   * looking at. For membership and anything that outlives a session.
   */
  homeOrganizationId: string;

  /** True when the session is pointed at a sandbox rather than live data. */
  inPracticeMode: boolean;
}

export type OrgContextResult =
  | { ok: true; data: OrgContext }
  | { ok: false; status: number; error: string };

/**
 * Resolve the caller's organizations, optionally requiring a writing role.
 *
 * `requireRole` defaults to undefined, meaning any authenticated member. Pass
 * the roles a write needs and the refusal comes back as a 403 rather than as an
 * empty RLS result, which is the difference between "you may not" and a screen
 * that looks broken.
 */
export async function resolveOrgContext(
  requireRole?: readonly string[],
): Promise<OrgContextResult> {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: 'Not authenticated.' };

  const { data: profile } = await supabase
    .from('users')
    .select('organization_id, active_organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile) return { ok: false, status: 403, error: 'No user profile.' };

  if (requireRole && !requireRole.includes(profile.role)) {
    return { ok: false, status: 403, error: 'Insufficient role for this action.' };
  }

  return {
    ok: true,
    data: {
      userId: user.id,
      role: profile.role,
      // The rule lives in org-context-core so it can be unit-tested; this
      // module is server-only and a test cannot import it. Calling auth_org_id()
      // over the wire would cost a round trip on every write, and the two
      // definitions must agree or the WITH CHECK fails.
      ...resolveOrganizationIds(profile),
    },
  };
}
