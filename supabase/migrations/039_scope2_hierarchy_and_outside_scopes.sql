-- ============================================================
-- Migration 039: Scope 2 market-based hierarchy, Scope 2 lineage, and
-- emissions reported outside the scopes
-- ============================================================
--
-- Three corrections from the October 2026 independent review of the
-- calculation engine. Each column below is read and written by
-- lib/entries.ts; docs/DATA_MODEL.md describes them.
--
-- 1. Market-based Scope 2 for every row. The GHG Protocol Scope 2 Guidance
--    (2015, ch. 6-7) requires a market-based figure for every operation, not
--    only those with a contract: contractual instrument first, then the
--    residual mix for that market, then the grid average where no residual mix
--    exists, disclosed. Before this, a row saved without a contract stored only
--    the grid average, and every market-based total silently used it.
--    co2e_kg on a Scope 2 row now always holds the market-based figure;
--    co2e_kg_location_based the location-based one. scope2_market_basis
--    records which rung of the hierarchy produced the market figure, so the
--    report can disclose where grid average stood in for a residual mix.
--
-- 2. Scope 2 lineage. A market-based row stored the market factor only, so its
--    location-based figure could not be re-derived from the row.
--    location_factor_used / location_factor_source keep both.
--
-- 3. Emissions reported outside the scopes. The GHG Protocol Corporate
--    Standard (ch. 4 and 9) requires direct CO2 from burning biomass to be
--    reported separately from the scopes, and Montreal Protocol gases (HCFCs
--    such as R-22) are outside the Kyoto basket and reported separately too.
--    co2e_kg_outside_scopes carries those figures, so every total that sums
--    co2e_kg excludes them without a filter, and outside_scopes_basis says why.
--
-- Re-runnable. No BEGIN/COMMIT: the runner applies each migration in a single
-- transaction with its ledger row.

-- ── emission_entries ───────────────────────────────────────────────────────
ALTER TABLE emission_entries
  ADD COLUMN IF NOT EXISTS location_factor_used   NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS location_factor_source TEXT,
  ADD COLUMN IF NOT EXISTS scope2_market_basis    TEXT,
  ADD COLUMN IF NOT EXISTS co2e_kg_outside_scopes NUMERIC(15, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outside_scopes_basis   TEXT;

-- Factor sources now carry their basis ("eGRID2023 (ZIP 28202)", a custom
-- factor's citation, the grid-average disclosure). 100 characters truncated
-- them; nothing indexes or constrains the column's length.
ALTER TABLE emission_entries ALTER COLUMN emission_factor_source TYPE TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emission_entries_scope2_market_basis_allowed') THEN
    ALTER TABLE emission_entries ADD CONSTRAINT emission_entries_scope2_market_basis_allowed
      CHECK (scope2_market_basis IS NULL OR scope2_market_basis IN (
        'contractual',     -- supplier-specific factor or energy attribute certificate
        'residual_mix',    -- residual mix for the site's market
        'grid_average',    -- no residual mix for that market; grid average used and disclosed
        'self_generated',  -- on-site generation consumed on site: no Scope 2 emissions
        'heat_supplier',   -- purchased heat or steam at the supplier's factor
        'legacy'           -- saved before 039; see docs/FACTORS.md
      ));
  END IF;
END $$;

-- Backfill what can be stated about rows saved before this migration, without
-- recalculating them (entries keep the factor they were calculated with).
UPDATE emission_entries SET
  scope2_market_basis = CASE
    WHEN accounting_method = 'market_based' AND supplier_emission_factor IS NOT NULL THEN 'contractual'
    ELSE 'legacy'
  END
WHERE scope = 'scope2' AND scope2_market_basis IS NULL;

-- Location-based rows: the factor used IS the location factor.
UPDATE emission_entries SET
  location_factor_used = emission_factor_used,
  location_factor_source = emission_factor_source
WHERE scope = 'scope2' AND accounting_method = 'location_based' AND location_factor_used IS NULL;

-- Market-based rows stored the location figure but not its factor. It is
-- recoverable by division; the source was never recorded, and this says so.
UPDATE emission_entries SET
  location_factor_used = ROUND(co2e_kg_location_based / quantity_normalized, 6),
  location_factor_source = 'derived: co2e_kg_location_based / quantity_normalized (source not recorded before migration 039)'
WHERE scope = 'scope2' AND accounting_method = 'market_based' AND location_factor_used IS NULL
  AND co2e_kg_location_based IS NOT NULL AND quantity_normalized > 0;

-- ── Reference factors ──────────────────────────────────────────────────────
-- Biogenic CO2 per MMBtu, reported outside the scopes. EPA GHG Emission
-- Factors Hub (2024), Table 1: wood and wood residuals, 93.80 kg CO2/MMBtu.
ALTER TABLE scope1_emission_factors
  ADD COLUMN IF NOT EXISTS biogenic_co2_factor NUMERIC(12, 6);

UPDATE scope1_emission_factors SET biogenic_co2_factor = 93.80
WHERE fuel_type = 'wood_biomass' AND unit = 'MMBtu' AND biogenic_co2_factor IS NULL;

-- Montreal Protocol gases: HCFCs, regulated as ozone-depleting substances and
-- outside the Kyoto basket the scopes cover.
ALTER TABLE refrigerant_factors
  ADD COLUMN IF NOT EXISTS is_montreal_protocol BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE refrigerant_factors SET is_montreal_protocol = TRUE
WHERE refrigerant_code IN ('R-22', 'R-123', 'R-124') AND NOT is_montreal_protocol;

-- ── Custom factor categories ───────────────────────────────────────────────
-- scope2_residual: a residual mix for one site (key = site_id), e.g. the
--   Green-e residual mix for the site's eGRID subregion. Green-e publishes
--   residual mixes by subregion only, so none can ship as a national default.
-- scope2_heat: the heat or steam supplier's factor for one site (key =
--   site_id). Purchased heat cannot be priced with an electricity grid factor.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'public.custom_emission_factors'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%factor_category%'
    AND pg_get_constraintdef(oid) NOT LIKE '%scope2_heat%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE custom_emission_factors DROP CONSTRAINT %I', c);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.custom_emission_factors'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%scope2_heat%'
  ) THEN
    ALTER TABLE custom_emission_factors ADD CONSTRAINT custom_emission_factors_factor_category_check
      CHECK (factor_category IN ('scope1', 'scope2_location', 'scope2_residual', 'scope2_heat', 'refrigerant'));
  END IF;
END $$;
