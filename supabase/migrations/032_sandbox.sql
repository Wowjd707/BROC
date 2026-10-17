-- ============================================================
-- BROC — Sandbox practice workspace
-- Migration 032
-- ============================================================
-- A place for people to learn the system end to end — enter an invoice, run a
-- data review, set a goal, assemble a disclosure — without any chance of it
-- touching what the organization actually reports.
--
-- The obvious implementation is an `is_sandbox` flag on every tenant table,
-- filtered everywhere. That is the wrong one. It puts the isolation guarantee
-- in application code, in every query, forever, and the first forgotten filter
-- silently mixes practice figures into a disclosure. This codebase already has
-- a tenancy boundary the database enforces and nobody can forget: RLS, scoped
-- through auth_org_id().
--
-- So a sandbox is simply ANOTHER ORGANIZATION, and "practice mode" means your
-- session resolves to it. Every existing policy keeps working, unchanged and
-- unreviewed, because they all funnel through one function:
--
--     organizations.sandbox_of      a sandbox points at the org it belongs to
--     users.active_organization_id  which org THIS session resolves to
--     auth_org_id()                 now returns the active org
--
-- Nothing else in the schema changes. No per-table flags, no query rewrites,
-- and the isolation is exactly as strong as the tenancy isolation already
-- trusted for separating organizations.
--
-- The privilege question this raises is handled deliberately: users do NOT get
-- an UPDATE policy letting them set active_organization_id. A user who could
-- write their own users row could also rewrite organization_id or role. The
-- switch goes through set_active_organization(), a SECURITY DEFINER function
-- that touches exactly one column and refuses any target that is not the
-- caller's own home org or its own sandbox.
--
-- RE-RUNNABLE.
-- ============================================================

-- auth_home_org_id() is defined properly further down with its siblings; it is
-- created here first because PART 0's policy references it.
CREATE OR REPLACE FUNCTION auth_home_org_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT organization_id FROM users WHERE id = auth.uid()
$$;

-- ============================================================
-- PART 0 — A pre-existing privilege escalation, fixed here first
-- ============================================================
-- Migration 002 created:
--
--     CREATE POLICY "users_update_self" ON users
--       FOR UPDATE USING (id = auth.uid());
--
-- An UPDATE policy with no WITH CHECK reuses its USING expression as the
-- check, and `id = auth.uid()` stays true no matter which OTHER columns the
-- statement sets. So any authenticated user could run:
--
--     UPDATE users SET role = 'admin'          WHERE id = auth.uid();
--     UPDATE users SET organization_id = '...' WHERE id = auth.uid();
--
-- and become an administrator, or move their own row into another
-- organization in the same deployment — at which point every RLS policy
-- cheerfully hands them that organization's data. Verified by reproduction,
-- not by reading: an 'editor' promoted itself and read another tenant's sites.
--
-- This predates the sandbox, but the sandbox cannot be built on top of it:
-- active_organization_id would be directly writable to any value, making
-- set_active_organization()'s validation decorative.
--
-- RLS policies cannot compare OLD and NEW, so the column rules go in a
-- trigger. The policy is narrowed as well, so the two have to agree.
-- ============================================================

CREATE OR REPLACE FUNCTION guard_user_row_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A user never moves between organizations through the API. Deprovision and
  -- reprovision instead, so the audit trail shows it happened.
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'A user''s organization cannot be changed.';
  END IF;

  -- active_organization_id may only be SET by set_active_organization(), which
  -- raises this transaction-local flag immediately before its UPDATE.
  --
  -- CLEARING it is always allowed, deliberately. Returning someone to their
  -- home organization can never be an escalation, and the cascade fired by
  -- reset_sandbox() (active_organization_id is ON DELETE SET NULL) arrives
  -- here as exactly that. Guarding the null case broke resetting the sandbox,
  -- which is how this rule was found: the safe direction to fail is out of
  -- practice mode, never into it.
  IF NEW.active_organization_id IS NOT NULL
     AND NEW.active_organization_id IS DISTINCT FROM OLD.active_organization_id
     AND COALESCE(current_setting('broc.switching_org', true), '') <> '1' THEN
    RAISE EXCEPTION 'Use set_active_organization() to change the active organization.';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- auth.uid() is NULL for the service role acting outside a user session,
    -- so backend administration and the signup path are unaffected. Both
    -- checks below apply only to a real signed-in user.
    IF auth.uid() IS NOT NULL AND NEW.id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot change your own role.';
    END IF;
    IF auth.uid() IS NOT NULL AND COALESCE(auth_user_role(), '') <> 'admin' THEN
      RAISE EXCEPTION 'Only an administrator can change a role.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_users_update ON users;
CREATE TRIGGER guard_users_update
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION guard_user_row_changes();

-- Narrow the policy too. Defence in depth: if someone later drops the trigger
-- while "tidying up", this still refuses to let a row leave its organization.
DROP POLICY IF EXISTS "users_update_self" ON users;
CREATE POLICY "users_update_self" ON users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND organization_id = auth_home_org_id());

COMMENT ON FUNCTION guard_user_row_changes() IS
  'Blocks the column changes an "update your own row" policy would otherwise permit: moving organization, self-promotion, and direct writes to active_organization_id.';

-- ── Schema ──────────────────────────────────────────────────────────────────

-- Null for a real organization. Set on a sandbox, pointing at its parent.
-- CASCADE so deleting an organization takes their sandbox with it.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sandbox_of UUID
  REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sandbox_seeded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_organizations_sandbox_of ON organizations(sandbox_of);

-- One sandbox per organization. Without this, "enter the sandbox" has no single
-- answer and provisioning twice silently creates a second one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_one_sandbox
  ON organizations(sandbox_of) WHERE sandbox_of IS NOT NULL;

-- No nesting. A sandbox of a sandbox has no meaning and would make the
-- "is this real?" question recursive.
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_sandbox_not_self;
ALTER TABLE organizations ADD CONSTRAINT organizations_sandbox_not_self
  CHECK (sandbox_of IS NULL OR sandbox_of <> id);

-- Which organization this user's session currently resolves to.
-- NULL means their home organization, which is the default and the safe state:
-- an unmigrated or unexpected row behaves exactly as it did before this
-- migration existed.
-- SET NULL on delete so resetting a sandbox ejects whoever was in it rather
-- than leaving a dangling pointer or blocking the delete.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_organization_id UUID
  REFERENCES organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN organizations.sandbox_of IS
  'Set on a sandbox organization, pointing at the real organization it belongs to. NULL for real organizations.';
COMMENT ON COLUMN users.active_organization_id IS
  'Which organization this session resolves to. NULL = home organization. Only ever written by set_active_organization().';

-- ── The one function everything funnels through ─────────────────────────────

-- Unchanged in shape, so every policy in 002 and after keeps working. The only
-- difference is that a session can be pointed at the caller's own sandbox.
CREATE OR REPLACE FUNCTION auth_org_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(active_organization_id, organization_id) FROM users WHERE id = auth.uid()
$$;

-- The user's real organization, regardless of where the session is pointed.
-- Needed so the UI can say "you are practising; your live workspace is X" and
-- so the switch function can validate a target.
CREATE OR REPLACE FUNCTION auth_home_org_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT organization_id FROM users WHERE id = auth.uid()
$$;

-- True when the session is currently pointed at a sandbox. Cheap for the UI to
-- ask, and usable inside a policy if one ever needs to refuse something in
-- practice mode.
CREATE OR REPLACE FUNCTION auth_in_sandbox()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = auth_org_id() AND o.sandbox_of IS NOT NULL
  )
$$;

-- ── Two policies have to widen ──────────────────────────────────────────────

-- organizations: while in the sandbox, `id = auth_org_id()` shows the sandbox
-- and hides home — so the UI could not name the workspace to return to, and
-- before entering it could not tell whether a sandbox exists at all.
-- This exposes exactly three rows and no more: the active org, the home org,
-- and the home org's own sandbox.
DROP POLICY IF EXISTS "org_select_own" ON organizations;
DROP POLICY IF EXISTS "organizations_select_own" ON organizations;
DROP POLICY IF EXISTS "organizations_select_own_or_sandbox" ON organizations;
CREATE POLICY "organizations_select_own_or_sandbox" ON organizations
  FOR SELECT
  USING (
    id = auth_org_id()
    OR id = auth_home_org_id()
    OR sandbox_of = auth_home_org_id()
  );

-- users: this one is load-bearing and its absence is a hard failure, not a
-- cosmetic one. The dashboard layout reads the signed-in user's own profile
-- row. While the session points at the sandbox, `organization_id = auth_org_id()`
-- matches nothing — the user's row still lives in the home org — so the profile
-- comes back null and the whole app renders as though nobody is signed in.
-- Letting someone always see their own row is correct regardless of sandboxes.
DROP POLICY IF EXISTS "users_select_own_org" ON users;
DROP POLICY IF EXISTS "users_select_same_org" ON users;
DROP POLICY IF EXISTS "users_select_org_or_self" ON users;
CREATE POLICY "users_select_org_or_self" ON users
  FOR SELECT
  USING (organization_id = auth_org_id() OR id = auth.uid());

-- ── Switching ───────────────────────────────────────────────────────────────

/**
 * Point the caller's session at their home organization or their own sandbox.
 *
 * SECURITY DEFINER, and it writes exactly one column. This is why users get no
 * UPDATE policy on their own row: an UPDATE policy scoped to "your own row"
 * would also let someone rewrite organization_id (join another tenant) or role
 * (make themselves an admin). Narrowing the write to a function keeps that
 * impossible.
 *
 * NULL returns the session to the home organization.
 */
CREATE OR REPLACE FUNCTION set_active_organization(target UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  home UUID;
BEGIN
  SELECT organization_id INTO home FROM users WHERE id = auth.uid();
  IF home IS NULL THEN
    RAISE EXCEPTION 'No profile for the current user.';
  END IF;

  -- Transaction-local, so it cannot leak past this statement. The trigger in
  -- PART 0 refuses a write to active_organization_id without it.
  PERFORM set_config('broc.switching_org', '1', true);

  IF target IS NULL OR target = home THEN
    UPDATE users SET active_organization_id = NULL WHERE id = auth.uid();
    RETURN home;
  END IF;

  -- The only other permitted destination is this organization's own sandbox.
  IF NOT EXISTS (
    SELECT 1 FROM organizations WHERE id = target AND sandbox_of = home
  ) THEN
    RAISE EXCEPTION 'Not permitted to switch to that organization.';
  END IF;

  UPDATE users SET active_organization_id = target WHERE id = auth.uid();
  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION set_active_organization(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_active_organization(UUID) TO authenticated;

-- ── Provisioning ────────────────────────────────────────────────────────────

/**
 * Create the caller's sandbox organization if it does not exist, and return it.
 *
 * Only the shell is created here — name, fiscal year, boundary defaults. The
 * practice CONTENT is written by the application through the same
 * createEmissionEntry path real data uses, so factors are resolved server-side
 * and lineage is recorded exactly as it would be in the live workspace. Seeding
 * with hand-written INSERTs would produce practice data that no real code path
 * could have produced, which makes it useless for learning and dangerous as a
 * test of the system.
 */
CREATE OR REPLACE FUNCTION provision_sandbox()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  home     UUID;
  existing UUID;
  fresh    UUID;
  home_name TEXT;
  fy_start  INT;
BEGIN
  SELECT organization_id INTO home FROM users WHERE id = auth.uid();
  IF home IS NULL THEN
    RAISE EXCEPTION 'No profile for the current user.';
  END IF;

  -- Nesting is impossible by construction rather than by check: this function
  -- always works from users.organization_id, the HOME organization, which a
  -- sandbox never is (sandboxes have no users of their own). Calling this from
  -- inside the sandbox therefore returns the same sandbox, which is what a
  -- caller would want anyway. An earlier version tested `id = home AND
  -- sandbox_of IS NOT NULL` here; that condition can never be true and the
  -- check did nothing.

  SELECT id INTO existing FROM organizations WHERE sandbox_of = home;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  SELECT name, COALESCE(reporting_year_start, 1) INTO home_name, fy_start
  FROM organizations WHERE id = home;

  INSERT INTO organizations (name, reporting_year_start, sandbox_of)
  VALUES (LEFT(COALESCE(home_name, 'Organization'), 60) || ' — Practice', fy_start, home)
  RETURNING id INTO fresh;

  RETURN fresh;
END;
$$;

REVOKE ALL ON FUNCTION provision_sandbox() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_sandbox() TO authenticated;

/**
 * Throw the sandbox away and hand back a clean empty one.
 *
 * Implemented as a delete of the sandbox ORGANISATION row, not a table-by-table
 * sweep. Every tenant table references organizations(id) ON DELETE CASCADE, so
 * one delete removes everything and — more importantly — a table added later
 * that forgot the cascade makes this fail loudly rather than leaving practice
 * rows behind for the next person to find.
 *
 * Admin only. Resetting discards whatever a colleague was midway through.
 *
 * Anyone whose session was pointed at the old sandbox lands back in the live
 * workspace, because users.active_organization_id is ON DELETE SET NULL. That
 * is the right direction to fail: out of practice mode, never into it.
 */
CREATE OR REPLACE FUNCTION reset_sandbox()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  home     UUID;
  caller_role TEXT;
  doomed   UUID;
BEGIN
  SELECT organization_id, role INTO home, caller_role FROM users WHERE id = auth.uid();
  IF home IS NULL THEN
    RAISE EXCEPTION 'No profile for the current user.';
  END IF;
  IF caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can reset the practice workspace.';
  END IF;

  SELECT id INTO doomed FROM organizations WHERE sandbox_of = home;
  IF doomed IS NULL THEN
    RAISE EXCEPTION 'No practice workspace to reset.';
  END IF;

  -- Deleting the sandbox cascades a SET NULL onto every users row pointed at
  -- it, which reaches guard_user_row_changes(). Raise the flag so this does
  -- not depend on that trigger's null-clearing rule staying permissive.
  PERFORM set_config('broc.switching_org', '1', true);

  -- Belt and braces. reset_sandbox() is the one function in this file that
  -- destroys data, so it re-checks what it is about to delete rather than
  -- trusting the lookup above.
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = doomed AND sandbox_of IS NOT NULL) THEN
    RAISE EXCEPTION 'Refusing to delete an organization that is not a sandbox.';
  END IF;

  DELETE FROM organizations WHERE id = doomed;

  RETURN provision_sandbox();
END;
$$;

REVOKE ALL ON FUNCTION reset_sandbox() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_sandbox() TO authenticated;

COMMENT ON FUNCTION set_active_organization(UUID) IS
  'Point the caller''s session at their home organization (NULL) or their own sandbox. Refuses any other target.';
COMMENT ON FUNCTION provision_sandbox() IS
  'Create the caller''s sandbox organization if absent and return its id. Content is seeded by the application through the normal write paths.';
COMMENT ON FUNCTION reset_sandbox() IS
  'Admin only. Delete the sandbox organization (cascading all its data) and return a fresh empty one.';
