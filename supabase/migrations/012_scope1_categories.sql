-- ============================================================
-- EHS Carbon Accounting Platform — Scope 1 Source Categorisation
-- Migration 012
-- ============================================================
-- The GHG Protocol Corporate Standard requires Scope 1 to be reported by
-- source category — stationary combustion, mobile combustion, process
-- emissions, fugitive emissions — and every disclosure framework asks for the
-- split. It could not be derived from fuel type: diesel is legitimately both
-- stationary (standby generators) and mobile (fleet), so the distinction has
-- to be recorded at entry time.
--
-- RE-RUNNABLE.
-- ============================================================

ALTER TABLE emission_entries
  ADD COLUMN IF NOT EXISTS scope1_category TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'emission_entries_scope1_category_check'
  ) THEN
    ALTER TABLE emission_entries
      ADD CONSTRAINT emission_entries_scope1_category_check
      CHECK (scope1_category IS NULL OR scope1_category IN (
        'stationary_combustion', 'mobile_combustion', 'process_emissions', 'fugitive_emissions'
      ));
  END IF;
END $$;

COMMENT ON COLUMN emission_entries.scope1_category IS
  'GHG Protocol Scope 1 source category. NULL means unclassified — see migration 012.';

CREATE INDEX IF NOT EXISTS idx_emission_entries_scope1_category
  ON emission_entries(organization_id, scope1_category)
  WHERE scope = 'scope1' AND deleted_at IS NULL;

-- ─── Backfill ────────────────────────────────────────────────────────────────
-- Only refrigerants can be classified with certainty: leaked refrigerant is
-- fugitive by definition. Combustion fuels are deliberately LEFT NULL rather
-- than defaulted to stationary — a diesel entry may be fleet fuel, and writing
-- a guess into the inventory would fabricate a classification that an assurer
-- would later have to unpick. Unclassified entries surface in the UI as
-- "Unclassified" so the gap is visible and can be corrected deliberately.
UPDATE emission_entries
   SET scope1_category = 'fugitive_emissions'
 WHERE scope = 'scope1'
   AND source_type = 'refrigerants'
   AND scope1_category IS NULL;
