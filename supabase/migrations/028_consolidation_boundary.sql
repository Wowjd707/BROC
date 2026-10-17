-- ============================================================
-- Organizational Boundary and Consolidation Approach
-- Migration 028
-- ============================================================
-- The GHG Protocol makes an organization choose how it consolidates: equity
-- share, financial control, or operational control. The choice decides which
-- emissions are yours and in what proportion, and it is the first thing an
-- assurance provider asks about.
--
-- This platform could not express it. There was no ownership percentage on a
-- site and no consolidation setting on an organization, so every inventory was
-- implicitly 100% of everything - correct for a wholly-owned group, wrong for
-- anyone with a joint venture, which is most large manufacturers.
--
-- The irony worth recording: migration 014 already seeds a CSRD requirement
-- asking the user to state "the organizational boundary, consolidation approach
-- and emission factors applied". The platform was asking for a narrative
-- account of something it had no way to represent.
--
--   organizations.consolidation_approach
--   sites.ownership_percent
--   sites.is_controlled
--
-- ─── How the three approaches differ ────────────────────────────────────────
--
--   equity_share        - account for emissions in proportion to your equity
--                         stake. A 50% JV contributes 50%.
--   financial_control   - 100% of what you financially control, 0% of what you
--   operational_control   do not. A 50% JV contributes either everything or
--                         nothing, depending on whether you run it.
--
-- Which is why BOTH columns are needed: a percentage alone cannot express the
-- control approaches, and a boolean alone cannot express equity share.
--
-- ─── Nothing moves for an existing deployment ───────────────────────────────
--
-- Defaults are operational_control, 100% ownership, controlled = true, which
-- makes the multiplier exactly 1 for every existing site. Any organization that
-- was implicitly reporting 100% of everything carries on doing so, and now
-- says so explicitly. The share is applied in lib/consolidation-core.ts.
--
-- RE-RUNNABLE.
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS consolidation_approach VARCHAR(30)
    NOT NULL DEFAULT 'operational_control';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_consolidation_approach_check') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_consolidation_approach_check
      CHECK (consolidation_approach IN ('equity_share', 'financial_control', 'operational_control'));
  END IF;
END $$;

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS ownership_percent NUMERIC(5, 2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_controlled     BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sites_ownership_percent_range') THEN
    ALTER TABLE sites ADD CONSTRAINT sites_ownership_percent_range
      CHECK (ownership_percent >= 0 AND ownership_percent <= 100);
  END IF;
END $$;

COMMENT ON COLUMN organizations.consolidation_approach IS
  'GHG Protocol consolidation approach. Decides whether sites are included by equity stake or by control. Defaults to operational_control at 100%, which reproduces the behaviour before this migration.';
COMMENT ON COLUMN sites.ownership_percent IS
  'Equity stake in this site, 0-100. Used only under the equity_share approach; ignored under the control approaches, where is_controlled decides inclusion.';
COMMENT ON COLUMN sites.is_controlled IS
  'Whether the organization has financial/operational control of this site. Used only under the control approaches; ignored under equity_share, where the percentage decides. A 50/50 JV nobody controls is typically FALSE.';
