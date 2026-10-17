-- ============================================================
-- Regulatory Capability Map
-- Migration 026
-- ============================================================
-- The tracker says what each regime is and when it lands. It does not say what
-- to DO about it, and "what should I do about EUDR" is the question a
-- sustainability lead actually has.
--
-- This links each tracked regime to the parts of THIS platform that serve it,
-- so the answer can be computed from the organization's own data:
--
--     CBAM
--     ✅ CBAM calculator            2 calculations saved
--     ⚠️  Scope 1 & 2 inventory      3 of 5 sites have current-year data
--     ❌ Supplier CBAM questionnaires   0 sent
--     Biggest gap: supplier data. Certificate sales open 1 February 2027.
--
-- ─── Why this is a table and not a model call ───────────────────────────────
--
-- Every fact in that answer already exists in this database. Which capability
-- serves which regime is a judgement about this product, made once by a human
-- and stored here; how much data the organization has is arithmetic. Neither
-- needs a model, and asking one to guess which features address EUDR would be
-- exactly the confident-and-wrong failure the tracker exists to avoid.
--
-- It therefore works with the AI layer switched off, which is the default.
--
-- ─── The honest rows are the valuable ones ──────────────────────────────────
--
-- Two probe values record absence rather than readiness:
--
--   not_built  - this regime needs something this platform does not have.
--                EUDR needs plot-level geolocation. There is no Taxonomy
--                module. There is no land-sector accounting, and GHGP LSR is
--                effective 1 January 2027.
--   no_action  - nothing to do, and that is the correct answer. The SEC rule
--                never took effect and is proposed for rescission; telling a
--                user to prepare for it would waste their quarter.
--
-- A capability map that only listed strengths would be marketing. The gaps are
-- what make it worth opening, and they show where the platform stops.
--
-- ─── What this must never do ────────────────────────────────────────────────
--
-- It reports what data the organization holds against what this platform can
-- do. It does NOT assess compliance, and it does not assert that having the
-- data means the obligation is met. `necessity` describes how central a
-- capability is TO THIS PLATFORM'S coverage, not a legal requirement.
--
-- RE-RUNNABLE.
-- ============================================================

CREATE TABLE IF NOT EXISTS regulatory_capabilities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code       VARCHAR(40) NOT NULL REFERENCES regulatory_items(code) ON DELETE CASCADE,

  -- Stable key for the upsert, unique within a regime.
  capability_key  VARCHAR(60) NOT NULL,

  -- Null for not_built / no_action rows: there is no feature to name.
  label           TEXT,
  description     TEXT NOT NULL,
  route           TEXT,

  -- Which deterministic probe answers "how ready is this". Implemented in
  -- lib/capability-readiness-core.ts; a probe named here with no implementation
  -- renders as unknown rather than throwing.
  probe           VARCHAR(40) NOT NULL,
  probe_arg       TEXT,

  -- How central this capability is to the platform's coverage of the regime.
  -- Deliberately NOT a statement about what the law requires.
  necessity       VARCHAR(20) NOT NULL DEFAULT 'supporting'
                  CHECK (necessity IN ('required', 'supporting', 'informational')),

  display_order   INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (item_code, capability_key)
);

CREATE INDEX IF NOT EXISTS idx_regulatory_capabilities_item
  ON regulatory_capabilities(item_code, display_order) WHERE is_active;

DO $$
BEGIN
  -- A row that names a feature must say where it lives; a row that records an
  -- absence must not pretend to.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reg_capabilities_route_shape') THEN
    ALTER TABLE regulatory_capabilities ADD CONSTRAINT reg_capabilities_route_shape
      CHECK (
        (probe IN ('not_built', 'no_action') AND route IS NULL AND label IS NULL)
        OR (probe NOT IN ('not_built', 'no_action') AND route IS NOT NULL AND label IS NOT NULL)
      );
  END IF;
END $$;

COMMENT ON TABLE regulatory_capabilities IS
  'Curated map from a tracked regime to the platform features that serve it. Readiness is computed from the organization''s own data by the probe named on each row. Records absence (not_built) and deliberate inaction (no_action) as first-class answers.';
COMMENT ON COLUMN regulatory_capabilities.necessity IS
  'How central this capability is to THIS PLATFORM''S coverage of the regime. Not a statement about legal requirements.';

ALTER TABLE regulatory_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "regulatory_capabilities_read_authenticated" ON regulatory_capabilities;
CREATE POLICY "regulatory_capabilities_read_authenticated" ON regulatory_capabilities
  FOR SELECT TO authenticated USING (TRUE);

GRANT SELECT ON regulatory_capabilities TO authenticated;
-- No write policies: service role or migration only.

-- ─── Seed ────────────────────────────────────────────────────────────────────
-- Curated 2026-09-04 against what is actually in this codebase. Correct these
-- rows rather than rewriting them: this is product judgement, and it is the one
-- part of the feature that cannot be derived.

INSERT INTO regulatory_capabilities
  (item_code, capability_key, label, description, route, probe, probe_arg, necessity, display_order)
VALUES
  ('CBAM', 'cbam_calculator', 'CBAM embedded-emissions calculator', 'Computes embedded emissions per good for the quarterly declaration.', '/suppliers/cbam', 'cbam_calculations', NULL, 'required', 10),
  ('CBAM', 'cbam_supplier_data', 'Supplier CBAM questionnaires', 'Primary embedded-emissions data from producers. The one input you cannot compute your way out of.', '/suppliers', 'supplier_survey', 'cbam', 'required', 20),
  ('CBAM', 'cbam_scope12', 'Scope 1 & 2 inventory', 'Your own installation data, where you are the producer.', '/data', 'scope12_site_coverage', NULL, 'supporting', 30),
  ('EUDR', 'eudr_supplier_survey', 'Supplier EUDR questionnaires', 'Collects origin and legality declarations from suppliers of covered commodities.', '/suppliers', 'supplier_survey', 'eudr', 'required', 10),
  ('EUDR', 'eudr_supplier_registry', 'Supplier registry', 'The list of counterparties you must run due diligence on.', '/suppliers', 'suppliers_registered', NULL, 'required', 20),
  ('EUDR', 'eudr_geolocation', NULL, 'Plot-level geolocation capture and the due diligence statement itself are not built. EUDR requires geolocation coordinates per plot of land; this platform does not store them.', NULL, 'not_built', NULL, 'required', 30),
  ('PPWR', 'ppwr_supplier_survey', 'Supplier packaging questionnaires', 'Packaging composition and PFAS-in-food-contact declarations.', '/suppliers', 'supplier_survey', 'pfas', 'required', 10),
  ('PPWR', 'ppwr_waste', 'Waste stream data', 'Packaging waste tonnage by stream, for the reduction targets.', '/data', 'ehs_metric', 'waste', 'supporting', 20),
  ('EU-PFAS', 'eupfas_supplier_survey', 'Supplier PFAS questionnaires', 'Substance declarations from suppliers, ahead of any restriction taking effect.', '/suppliers', 'supplier_survey', 'pfas', 'supporting', 10),
  ('EPA-PFAS-TSCA', 'tsca_supplier_survey', 'Supplier PFAS questionnaires', 'Identifies PFAS in purchased articles and mixtures — the 2011-onward lookback is a supplier data problem.', '/suppliers', 'supplier_survey', 'pfas', 'required', 10),
  ('EPA-PFAS-TSCA', 'tsca_registry', NULL, 'Article-level import records and the 2011-2022 manufacture lookback are not modelled here. This is a purchasing-system question, not a sustainability-platform one.', NULL, 'not_built', NULL, 'required', 20),
  ('EPA-PFAS-NPDWR', 'npdwr_water', 'Water withdrawal and discharge data', 'Site water data, where drinking-water standards affect your own supply.', '/data', 'ehs_metric', 'water', 'informational', 10),
  ('CSRD-ESRS', 'csrd_framework', 'CSRD / ESRS disclosure workspace', 'Every ESRS requirement, with metrics auto-answered from your inventory.', '/disclosures', 'disclosure_coverage', 'CSRD', 'required', 10),
  ('CSRD-ESRS', 'csrd_materiality', 'Double materiality assessment', 'ESRS 1 §3 assessment. Gates which requirements you must answer at all.', '/materiality', 'materiality_assessment', NULL, 'required', 20),
  ('CSRD-ESRS', 'csrd_scope123', 'Scope 1, 2 and 3 inventory', 'The E1 numbers.', '/data', 'scope12_site_coverage', NULL, 'required', 30),
  ('CSRD-ESRS', 'csrd_scope3', 'Scope 3 by category', 'ESRS E1-6 requires material categories.', '/scope3', 'scope3_categories', NULL, 'required', 40),
  ('CSRD-ESRS', 'csrd_social', 'Social and governance metrics', 'S1 workforce and G1 conduct metrics.', '/social', 'sg_metric', 'safety:recordable_incidents', 'supporting', 50),
  ('CSRD-ESRS', 'csrd_evidence', 'Evidence attachments', 'Source documents behind reported figures, for limited assurance.', '/data', 'evidence_coverage', NULL, 'supporting', 60),
  ('CSDDD', 'csddd_suppliers', 'Supplier registry and questionnaires', 'The value-chain counterparties due diligence applies to.', '/suppliers', 'suppliers_registered', NULL, 'supporting', 10),
  ('CSDDD', 'csddd_risk', NULL, 'Risk-based supplier prioritisation, grievance-mechanism tracking and the due diligence policy itself are not built.', NULL, 'not_built', NULL, 'required', 20),
  ('EU-TAXONOMY', 'taxonomy_none', NULL, 'No Taxonomy module exists. Turnover, CapEx and OpEx alignment by economic activity, and the DNSH assessment, are not modelled.', NULL, 'not_built', NULL, 'required', 10),
  ('CA-SB253', 'sb253_scope12', 'Scope 1 & 2 inventory', 'The 2026 filing. Every site, current reporting year.', '/data', 'scope12_site_coverage', NULL, 'required', 10),
  ('CA-SB253', 'sb253_evidence', 'Evidence attachments', 'Limited assurance begins with the 2027 report; the documents are collected now.', '/data', 'evidence_coverage', NULL, 'supporting', 20),
  ('CA-SB253', 'sb253_scope3', 'Scope 3 — five categories from 2027', 'Purchased goods, fuel and energy, waste, business travel, commuting.', '/scope3', 'scope3_categories', NULL, 'supporting', 30),
  ('CA-SB253', 'sb253_report', 'Inventory report export', 'The assembled figure set with its basis of preparation.', '/reports', 'disclosure_coverage', 'CA_SB253', 'supporting', 40),
  ('CA-SB261', 'sb261_tcfd', 'TCFD disclosure workspace', 'SB 261 asks for a TCFD-aligned climate risk report.', '/disclosures', 'disclosure_coverage', 'TCFD', 'required', 10),
  ('SEC-CLIMATE', 'sec_none', NULL, 'Nothing to do. The rule was stayed, never took effect, and is proposed for rescission. Your California and CSRD work covers the same ground if it ever returns.', NULL, 'no_action', NULL, 'informational', 10),
  ('EPA-GHGRP', 'ghgrp_scope1', 'Scope 1 inventory by site', 'Facility-level combustion and process data feeds the subpart calculations.', '/data', 'scope12_site_coverage', NULL, 'supporting', 10),
  ('US-STATES', 'states_scope12', 'Scope 1 & 2 inventory', 'State regimes converge on the California design, so this readiness is portable.', '/data', 'scope12_site_coverage', NULL, 'supporting', 10),
  ('IFRS-S1S2', 'ifrs_framework', 'IFRS S2 disclosure workspace', 'Climate-related disclosures mapped to the same inventory.', '/disclosures', 'disclosure_coverage', 'IFRS_S2', 'required', 10),
  ('IFRS-S1S2', 'ifrs_scope3', 'Scope 3 by category', 'S2 requires Scope 3 where material.', '/scope3', 'scope3_categories', NULL, 'supporting', 20),
  ('SBTI-CNZS2', 'sbti_goals', 'Science-based targets', 'SBTi 1.5C pathway targets with tracked progress.', '/goals', 'goal_for_metric', 'ghg', 'required', 10),
  ('SBTI-CNZS2', 'sbti_scope3', 'Scope 3 coverage', 'V2 replaces the 67%/90% thresholds with a 5%-of-total significance test per category.', '/scope3', 'scope3_categories', NULL, 'required', 20),
  ('SBTI-CNZS2', 'sbti_scope2_split', 'Scope 1 and 2 reported separately', 'V2 requires separate Scope 1 and Scope 2 targets. The inventory already separates them.', '/kpis', 'scope12_site_coverage', NULL, 'supporting', 30),
  ('GHGP-S2', 'ghgps2_dual', 'Dual location and market-based Scope 2', 'Already reported both ways per entry, which is what the revision is arguing about.', '/kpis', 'scope12_site_coverage', NULL, 'informational', 10),
  ('GHGP-S3', 'ghgps3_categories', 'Scope 3 across 15 categories', 'A tighter 95% inclusion threshold is proposed; category coverage is what it will be measured against.', '/scope3', 'scope3_categories', NULL, 'informational', 10),
  ('GHGP-LSR', 'ghgplsr_none', NULL, 'No land-sector module. Land use change, livestock, fertiliser and biogenic accounting are not modelled, and this standard is effective 1 January 2027.', NULL, 'not_built', NULL, 'required', 10),
  ('GHGP-CORP', 'ghgpcorp_watch', NULL, 'Nothing to build yet. The consolidated standard is in drafting; the 2004 Corporate Standard remains operative and is what this platform implements.', NULL, 'no_action', NULL, 'informational', 10),
  ('ISO-14064', 'iso_watch', NULL, 'Nothing to build yet. The revision is folded into the consolidated standard due Q4 2028.', NULL, 'no_action', NULL, 'informational', 10)

ON CONFLICT (item_code, capability_key) DO UPDATE SET
  label         = EXCLUDED.label,
  description   = EXCLUDED.description,
  route         = EXCLUDED.route,
  probe         = EXCLUDED.probe,
  probe_arg     = EXCLUDED.probe_arg,
  necessity     = EXCLUDED.necessity,
  display_order = EXCLUDED.display_order;
