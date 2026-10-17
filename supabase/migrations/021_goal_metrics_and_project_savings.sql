-- ============================================================
-- EHS Carbon Accounting Platform — Goal Metrics & Project Savings
-- Migration 021
-- ============================================================
-- Goals could only ever be about greenhouse gas. Water and waste were tracked,
-- charted, and reported — but there was no way to state a target against them,
-- so the dashboard could show a water number and never say whether it was good.
--
--   goals.metric           — which family the target is about
--   goals.base_year_value  — the baseline, in that family's canonical unit
--   projects.*_reduction_* — a project's water and waste savings, so the
--                            reduction pipeline answers the same question for
--                            all three metrics
--
-- On units: values are stored in the SAME canonical unit the entries use —
-- carbon in kg CO₂e, water in US gallons, waste in kg (see lib/conversions.ts).
-- A goal is therefore directly comparable to a summed entry total with no
-- conversion step in between, which is the only way the two can be guaranteed
-- not to drift.
--
-- On base_year_emissions_kg: it stays. It is the GHG baseline and several
-- reports and the goal detail view read it. base_year_value generalises it; for
-- metric = 'ghg' the application writes both and they must agree. Dropping the
-- old column would rewrite history in filed reports for no gain.
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── 1. Goals gain a metric ──────────────────────────────────────────────────
ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS metric          VARCHAR(20) NOT NULL DEFAULT 'ghg',
  ADD COLUMN IF NOT EXISTS base_year_value NUMERIC(18, 4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'goals_metric_check'
  ) THEN
    ALTER TABLE goals ADD CONSTRAINT goals_metric_check
      CHECK (metric IN ('ghg', 'water', 'waste'));
  END IF;
END $$;

-- Every existing goal is a GHG goal — that was the only kind that could be
-- created — so the DEFAULT is correct for them and the backfill is exact.
UPDATE goals
SET base_year_value = base_year_emissions_kg
WHERE base_year_value IS NULL AND base_year_emissions_kg IS NOT NULL;

COMMENT ON COLUMN goals.metric IS
  'Which metric family the target is about: ghg (kg CO2e), water (US gallons), waste (kg). Canonical units match the entry tables so a goal and a summed total need no conversion between them.';
COMMENT ON COLUMN goals.base_year_value IS
  'Baseline in the metric family''s canonical unit. Generalises base_year_emissions_kg, which remains the GHG-only column; for metric = ''ghg'' the two are written together and must agree.';

-- The goal_type CHECK from 007 already allows the shapes water and waste need
-- ('absolute', 'intensity'). net_zero and sbti_15c stay valid values but are
-- offered only for GHG in the UI: an SBTi 1.5°C pathway is defined on emissions
-- and applying its 4.2%/yr to a water volume would be a fabricated methodology.

-- ─── 2. Projects gain water and waste savings ────────────────────────────────
-- Same shape as the CO2e columns from 007: an annualised rate, pro-rated by
-- in-service date in lib/pipeline.ts. Nullable — most projects save one thing.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS estimated_water_reduction_gal_per_year NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS actual_water_reduction_gal_per_year    NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS estimated_waste_reduction_kg_per_year  NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS actual_waste_reduction_kg_per_year     NUMERIC(18, 4);

COMMENT ON COLUMN projects.estimated_water_reduction_gal_per_year IS
  'Annualised water saving in US gallons per year — the same canonical unit ehs_entries normalises to.';
COMMENT ON COLUMN projects.estimated_waste_reduction_kg_per_year IS
  'Annualised waste reduction in kg per year — the same canonical unit ehs_entries normalises to.';
