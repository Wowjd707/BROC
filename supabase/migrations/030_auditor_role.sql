-- ============================================================
-- Auditor Role
-- Migration 030
-- ============================================================
-- Roles were admin, editor and viewer. An assurance provider fits none of them
-- comfortably: `viewer` is the right permission set but the wrong label, and in
-- practice teams hand an auditor an `editor` login or email them PDFs - which
-- is precisely the moment the platform should be doing its best work.
--
-- This adds `auditor` as a first-class role. It needs almost no policy work,
-- and that is worth stating explicitly because it is a property of the existing
-- design rather than luck:
--
--   • Every SELECT policy in 002 gates on `organization_id = auth_org_id()`
--     and never on role, so a new role reads what its organization can read.
--   • Every INSERT/UPDATE policy gates on
--     `auth_user_role() IN ('admin', 'editor')`, an allowlist rather than a
--     denylist, so a new role is read-only by construction. Nothing had to be
--     revoked, and no future table can accidentally grant it write access by
--     forgetting to exclude it.
--
-- The distinction from `viewer` is meaning, not permission: it tells the
-- organization who is looking, and lets the UI address an auditor differently -
-- lead with lineage, evidence and the audit trail rather than with charts.
--
-- RE-RUNNABLE.
-- ============================================================

DO $$
BEGIN
  -- The CHECK was created inline in 001 and carries the Postgres default name.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_allowed') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_allowed
      CHECK (role IN ('admin', 'editor', 'viewer', 'auditor'));
  END IF;
END $$;

COMMENT ON COLUMN users.role IS
  'admin = full control including settings and approvals; editor = may enter and change data; viewer = read-only member; auditor = read-only external assurance provider. Write policies allowlist admin and editor, so viewer and auditor are read-only by construction.';
