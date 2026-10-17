-- ============================================================
-- EHS Carbon Accounting Platform — Goals & Projects Reconciliation
-- Migration 007
-- ============================================================
-- Continuation of 006: the goals and projects UIs were also written
-- against a richer schema than migrations 001–005 created.
--
--   * goals gains scope / target_value / target_unit / current_value /
--     progress_pct / notes; the rigid NOT NULLs and goal_type CHECK are
--     relaxed to match the application's flexible goal model.
--   * projects gains *_per_year reduction columns, start/completion
--     dates and notes (backfilled from the old columns, which remain
--     for now and will be dropped once nothing reads them).
--   * organization_id gets a DEFAULT auth_org_id() on tenant tables the
--     browser inserts into directly, so client inserts satisfy both the
--     NOT NULL constraint and the RLS WITH CHECK without every form
--     having to thread the org id through.
-- ============================================================

-- ─── 1. goals ────────────────────────────────────────────────────────────────
ALTER TABLE goals
  ADD COLUMN scope         TEXT,
  ADD COLUMN target_value  NUMERIC(15, 4),
  ADD COLUMN target_unit   VARCHAR(50),
  ADD COLUMN current_value NUMERIC(15, 4),
  ADD COLUMN progress_pct  NUMERIC(6, 2),
  ADD COLUMN notes         TEXT;

-- The UI writes goal_type 'absolute'; keep the historical values valid too.
ALTER TABLE goals DROP CONSTRAINT goals_goal_type_check;
ALTER TABLE goals ADD CONSTRAINT goals_goal_type_check
  CHECK (goal_type IN ('absolute', 'absolute_reduction', 'intensity', 'net_zero', 'sbti_15c'));

-- Emissions baseline / computed targets are not always known at creation time.
ALTER TABLE goals
  ALTER COLUMN base_year_emissions_kg DROP NOT NULL,
  ALTER COLUMN target_emissions_kg    DROP NOT NULL,
  ALTER COLUMN target_reduction_pct   DROP NOT NULL;

-- Backfill the new generic target columns from the old specific ones
UPDATE goals
SET target_value = target_reduction_pct,
    target_unit  = 'pct_reduction'
WHERE target_value IS NULL AND target_reduction_pct IS NOT NULL;

-- ─── 2. projects ─────────────────────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN estimated_co2e_reduction_kg_per_year NUMERIC(15, 4),
  ADD COLUMN actual_co2e_reduction_kg_per_year    NUMERIC(15, 4),
  ADD COLUMN start_date      DATE,
  ADD COLUMN completion_date DATE,
  ADD COLUMN notes           TEXT;

-- Backfill from the deprecated columns
UPDATE projects SET
  estimated_co2e_reduction_kg_per_year = estimated_co2e_reduction_kg,
  actual_co2e_reduction_kg_per_year    = actual_co2e_reduction_kg,
  start_date      = NULL,
  completion_date = COALESCE(actual_completion_date, target_completion_date);

COMMENT ON COLUMN projects.estimated_co2e_reduction_kg IS
  'DEPRECATED — use estimated_co2e_reduction_kg_per_year';
COMMENT ON COLUMN projects.actual_co2e_reduction_kg IS
  'DEPRECATED — use actual_co2e_reduction_kg_per_year';

-- ─── 3. organization_id defaults for browser inserts ─────────────────────────
-- auth_org_id() is SECURITY DEFINER and resolves the caller's org from the
-- users table, so these defaults are safe and always match the RLS WITH CHECK.
ALTER TABLE suppliers         ALTER COLUMN organization_id SET DEFAULT auth_org_id();
ALTER TABLE supplier_surveys  ALTER COLUMN organization_id SET DEFAULT auth_org_id();
ALTER TABLE goals             ALTER COLUMN organization_id SET DEFAULT auth_org_id();
ALTER TABLE projects          ALTER COLUMN organization_id SET DEFAULT auth_org_id();
ALTER TABLE emission_entries  ALTER COLUMN organization_id SET DEFAULT auth_org_id();
ALTER TABLE ehs_entries       ALTER COLUMN organization_id SET DEFAULT auth_org_id();

-- created_by conveniences for the same reason
ALTER TABLE supplier_surveys  ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE projects          ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE emission_entries  ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE ehs_entries       ALTER COLUMN created_by SET DEFAULT auth.uid();
