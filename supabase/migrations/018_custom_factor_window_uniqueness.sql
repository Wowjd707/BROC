-- ============================================================
-- EHS Carbon Accounting Platform — Custom factor window uniqueness
-- Migration 018
-- ============================================================
-- Two active custom factors for the same category + key opening on the same
-- effective_from date are genuinely ambiguous.
--
-- `pickEffectiveFactor` (lib/custom-factors-core.ts) resolves overlapping
-- windows by taking the latest `effective_from`. That is deterministic for the
-- intended workflow — supersede a vintage by loading the next one with a later
-- start date — but with two windows opening on the SAME date the winner falls
-- out of row order. The same database could then produce different reported
-- numbers on different days, with nothing in the data to explain why.
--
-- This makes that state unrepresentable rather than relying on every write path
-- to check for it. Deactivated rows (is_active = FALSE) are excluded: soft
-- deletion must stay able to make room for a replacement.
--
-- Overlapping windows with DIFFERENT start dates remain allowed — that is the
-- documented supersession workflow, not a defect.
--
-- RE-RUNNABLE.
-- ============================================================

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_factors_active_window
    ON custom_emission_factors (organization_id, factor_category, factor_key, effective_from)
    WHERE is_active = TRUE;

EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION USING
    MESSAGE = 'Cannot create uq_custom_factors_active_window: this database already holds two or more active custom emission factors sharing an organization, category, key and effective_from date.',
    HINT    = 'List them with:  SELECT organization_id, factor_category, factor_key, effective_from, count(*) FROM custom_emission_factors WHERE is_active = TRUE GROUP BY 1,2,3,4 HAVING count(*) > 1;  Then, for each group, keep the factor that should apply and either set a different effective_from on the others or deactivate them (is_active = FALSE). Re-run this migration afterwards.';
END $$;

COMMENT ON INDEX uq_custom_factors_active_window IS
  'One active custom factor per (org, category, key) may open on any given date. Prevents an order-dependent tie in pickEffectiveFactor.';
