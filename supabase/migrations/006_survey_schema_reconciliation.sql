-- ============================================================
-- EHS Carbon Accounting Platform — Survey Schema Reconciliation
-- Migration 006
-- ============================================================
-- The supplier-survey UI was written against a richer schema than
-- migrations 001–005 created. This migration moves the database to
-- the shape the application actually uses:
--   * supplier_surveys.name → title, plus a notes field
--   * invitations carry their own email/supplier_name so surveys can
--     be sent ad hoc (supplier_id becomes optional)
--   * suppliers gain industry / spend_usd / notes
--     (commodity_category is migrated into industry and dropped)
-- It also removes two over-permissive RLS policies. The public survey
-- flow runs entirely through the service role (page + API routes),
-- which bypasses RLS, so no permissive policy is needed for it.
-- ============================================================

-- ─── 1. supplier_surveys ─────────────────────────────────────────────────────
ALTER TABLE supplier_surveys RENAME COLUMN name TO title;
ALTER TABLE supplier_surveys ADD COLUMN notes TEXT;

-- ─── 2. supplier_survey_invitations ──────────────────────────────────────────
-- Invitations are addressed to an email; linking to a supplier record is
-- optional (ad-hoc invitations have supplier_id = NULL).
ALTER TABLE supplier_survey_invitations
  ADD COLUMN supplier_name VARCHAR(255),
  ADD COLUMN email         VARCHAR(255);

ALTER TABLE supplier_survey_invitations
  ALTER COLUMN supplier_id DROP NOT NULL;

-- Backfill contact details from the linked supplier record
UPDATE supplier_survey_invitations inv
SET supplier_name = s.name,
    email         = s.contact_email
FROM suppliers s
WHERE inv.supplier_id = s.id
  AND inv.email IS NULL;

-- ─── 3. suppliers ────────────────────────────────────────────────────────────
ALTER TABLE suppliers
  ADD COLUMN industry  VARCHAR(100),
  ADD COLUMN spend_usd NUMERIC(15, 2),
  ADD COLUMN notes     TEXT;

-- commodity_category held the same concept the UI calls "industry"
UPDATE suppliers SET industry = commodity_category WHERE industry IS NULL;
ALTER TABLE suppliers DROP COLUMN commodity_category;

-- ─── 4. RLS corrections ──────────────────────────────────────────────────────
-- "invitations_public_token_select" was USING (true): any authenticated user
-- could read every organization's invitations, including their access tokens.
-- The public survey page looks invitations up with the service role, which
-- bypasses RLS — the policy was never needed.
DROP POLICY IF EXISTS "invitations_public_token_select" ON supplier_survey_invitations;

-- "responses_insert_service" was WITH CHECK (true): any authenticated user
-- could insert survey responses for any org. Responses are inserted by the
-- service role only (public survey API), which bypasses RLS.
DROP POLICY IF EXISTS "responses_insert_service" ON supplier_survey_responses;

-- ─── 5. Missing updated_at trigger ───────────────────────────────────────────
CREATE TRIGGER trg_survey_question_responses_updated_at
  BEFORE UPDATE ON supplier_survey_question_responses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
