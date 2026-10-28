-- ============================================================
-- Migration 040: keep existing projects in the pipeline, and restate stored
-- SBTi targets on the linear basis
-- ============================================================
--
-- Two follow-ups to the October 2026 calculation fixes, found when those
-- fixes were themselves reviewed.
--
-- 1. projects.pipeline_inclusion_status defaulted to 'excluded', and until
--    now the project form never set it, so every project created in the app
--    was stored as excluded. The pipeline used to ignore the column, so they
--    all counted. The pipeline now honours it (an excluded project counts for
--    nothing, as the project import documents), which would have silently
--    removed every form-created project from every pipeline and coverage
--    figure on upgrade.
--
--    So, once, on the first application of this migration: every project
--    still marked 'excluded' that is not an idea or cancelled becomes
--    'forecasted'. That reproduces exactly what the pipeline counted before
--    the change, so no reported figure moves. The default becomes
--    'forecasted' to match the form. Mark a project "Not counted" on the
--    Projects page to exclude it from here on. A project imported with an
--    explicit 'excluded' is restored to the pipeline too; before this change
--    that exclusion was not honoured either.
--
-- 2. SBTi 1.5 °C goals stored a compounded percentage (34.89% for 2020→2030).
--    The app now derives the target linearly (42%), so the stored figure no
--    longer matched the one the Goals page shows, and the disclosure
--    targets block printed the old one. The stored target is restated from
--    the goal's own base and target years: 4.2% of base-year emissions per
--    year, capped at 100%.
--
-- Re-runnable: part 1 runs only while the column default is still
-- 'excluded', so a deliberate exclusion made after the first run is never
-- undone; part 2 is a deterministic restatement.

DO $$
DECLARE d text;
BEGIN
  SELECT column_default INTO d FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'pipeline_inclusion_status';

  IF d IS NULL OR d LIKE '%excluded%' THEN
    UPDATE projects SET pipeline_inclusion_status = 'forecasted'
    WHERE pipeline_inclusion_status = 'excluded'
      AND status NOT IN ('idea', 'cancelled');

    ALTER TABLE projects ALTER COLUMN pipeline_inclusion_status SET DEFAULT 'forecasted';
  END IF;
END $$;

UPDATE goals SET
  target_value         = LEAST(100, ROUND(4.2 * (target_year - base_year), 2)),
  target_unit          = 'pct_reduction',
  target_reduction_pct = LEAST(100, ROUND(4.2 * (target_year - base_year), 2)),
  target_emissions_kg  = CASE
    WHEN base_year_emissions_kg IS NULL THEN target_emissions_kg
    ELSE ROUND(base_year_emissions_kg * (1 - LEAST(100, 4.2 * (target_year - base_year)) / 100.0))
  END
WHERE goal_type = 'sbti_15c'
  AND target_year > base_year;
