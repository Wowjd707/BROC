-- ============================================================
-- EHS Carbon Accounting Platform — Scope 3 Value Chain Emissions
-- Migration 010
-- ============================================================
-- Implements the GHG Protocol Corporate Value Chain (Scope 3) Standard:
--   * scope3_categories — the 15 standard categories (definitional reference)
--   * scope3_factors    — the organization's emission-factor library
--   * scope3_entries    — activity data + full calculation lineage
--
-- FACTOR LIBRARY POLICY
-- scope3_factors ships EMPTY and is organization-scoped by design. Scope 3
-- factor sets (EPA Supply Chain / USEEIO spend-based factors, DEFRA travel and
-- freight factors, EPA WARM waste factors, ecoinvent, etc.) are large, revised
-- annually, and carry differing licence terms — so the platform does not bundle
-- them. Each organization loads the library they are licensed for and that matches
-- their reporting boundary, via the factor CSV import. Every row requires a
-- cited factor_source and data_year, exactly like the Scope 1/2 reference
-- tables, so no reported number can trace back to an uncited value.
-- ============================================================

-- RE-RUNNABLE: this migration is written to be safely re-applied. Deploying organizations
-- apply migrations by hand (SQL editor / psql) where there is no migration
-- bookkeeping, so a partially-applied script must be able to finish on a
-- second run rather than dead-ending on "already exists".

-- ─── 1. Categories (definitional reference data) ─────────────────────────────
CREATE TABLE IF NOT EXISTS scope3_categories (
  category_number  INTEGER PRIMARY KEY CHECK (category_number BETWEEN 1 AND 15),
  name             VARCHAR(120) NOT NULL,
  value_chain      VARCHAR(20)  NOT NULL CHECK (value_chain IN ('upstream', 'downstream')),
  description      TEXT NOT NULL,
  typical_methods  TEXT[] NOT NULL DEFAULT '{}'
);

COMMENT ON TABLE scope3_categories IS
  'The 15 Scope 3 categories defined by the GHG Protocol Corporate Value Chain (Scope 3) Accounting and Reporting Standard.';

INSERT INTO scope3_categories (category_number, name, value_chain, description, typical_methods) VALUES
  (1,  'Purchased goods and services', 'upstream',
       'Cradle-to-gate emissions of purchased goods and services not covered by categories 2-8.',
       '{supplier_specific,average_data,spend_based}'),
  (2,  'Capital goods', 'upstream',
       'Cradle-to-gate emissions of purchased capital goods (equipment, buildings, vehicles).',
       '{supplier_specific,average_data,spend_based}'),
  (3,  'Fuel- and energy-related activities', 'upstream',
       'Upstream extraction, production and transport of fuels and energy purchased, plus T&D losses, not already in Scope 1 or 2.',
       '{average_data,fuel_based}'),
  (4,  'Upstream transportation and distribution', 'upstream',
       'Transport and distribution of purchased products between suppliers and the reporting company, and paid-for outbound logistics.',
       '{distance_based,fuel_based,spend_based}'),
  (5,  'Waste generated in operations', 'upstream',
       'Disposal and treatment of waste generated in owned or controlled operations.',
       '{waste_type_specific,average_data}'),
  (6,  'Business travel', 'upstream',
       'Transport of employees for business activities in vehicles not owned or controlled by the reporting company.',
       '{distance_based,spend_based}'),
  (7,  'Employee commuting', 'upstream',
       'Transport of employees between home and work.',
       '{distance_based,average_data}'),
  (8,  'Upstream leased assets', 'upstream',
       'Operation of assets leased by the reporting company (lessee) not already in Scope 1 or 2.',
       '{asset_specific,average_data}'),
  (9,  'Downstream transportation and distribution', 'downstream',
       'Transport and distribution of sold products after the point of sale, not paid for by the reporting company.',
       '{distance_based,average_data}'),
  (10, 'Processing of sold products', 'downstream',
       'Processing of intermediate products sold, by downstream companies.',
       '{site_specific,average_data}'),
  (11, 'Use of sold products', 'downstream',
       'End use of goods and services sold in the reporting year.',
       '{direct_use_phase,indirect_use_phase}'),
  (12, 'End-of-life treatment of sold products', 'downstream',
       'Waste disposal and treatment of sold products at the end of their life.',
       '{waste_type_specific,average_data}'),
  (13, 'Downstream leased assets', 'downstream',
       'Operation of assets owned by the reporting company and leased to others (lessor), not already in Scope 1 or 2.',
       '{asset_specific,average_data}'),
  (14, 'Franchises', 'downstream',
       'Operation of franchises not already in Scope 1 or 2.',
       '{franchise_specific,average_data}'),
  (15, 'Investments', 'downstream',
       'Operation of investments (equity, debt, project finance) not already in Scope 1 or 2.',
       '{investment_specific,average_data}')
ON CONFLICT (category_number) DO NOTHING;

GRANT SELECT ON scope3_categories TO authenticated;

-- ─── 2. Factor library (organization-scoped, ships empty) ────────────────────
CREATE TABLE IF NOT EXISTS scope3_factors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  category_number  INTEGER NOT NULL REFERENCES scope3_categories(category_number),

  -- How this factor is meant to be applied (see lib/scope3.ts)
  method           TEXT NOT NULL,
  -- What the factor applies to: a NAICS/CPC code, travel mode, waste type,
  -- material, supplier product — whatever the chosen library keys on.
  activity_key     TEXT NOT NULL,
  label            TEXT,

  factor_value     NUMERIC(18, 8) NOT NULL,   -- kg CO2e per activity_unit
  activity_unit    TEXT NOT NULL,             -- 'USD' | 'kg' | 'tonne' | 'mile' | 'km' | 'passenger-mile' | 'tonne-km' | 'kWh' ...
  region           TEXT,                      -- ISO country / region the factor represents

  factor_source    VARCHAR(255) NOT NULL,     -- REQUIRED provenance, e.g. 'EPA Supply Chain GHG Factors v1.3'
  data_year        INTEGER NOT NULL,
  effective_from   DATE NOT NULL DEFAULT '1900-01-01',
  effective_to     DATE,
  notes            TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       UUID DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT scope3_factor_effective_order
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT scope3_factor_value_nonneg CHECK (factor_value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_scope3_factors_lookup
  ON scope3_factors(organization_id, category_number, method, activity_key, effective_from)
  WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_scope3_factors_updated_at ON scope3_factors;
CREATE TRIGGER trg_scope3_factors_updated_at
  BEFORE UPDATE ON scope3_factors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. Entries (activity data + lineage) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS scope3_entries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  site_id            UUID REFERENCES sites(id) ON DELETE SET NULL,   -- optional: many Scope 3 activities are org-wide
  supplier_id        UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  category_number    INTEGER NOT NULL REFERENCES scope3_categories(category_number),
  entry_date         DATE NOT NULL,

  description        TEXT,
  calculation_method TEXT NOT NULL,

  -- Raw activity data, as entered
  activity_value     NUMERIC(18, 6) NOT NULL CHECK (activity_value >= 0),
  activity_unit      TEXT NOT NULL,

  -- The factor actually applied, denormalized onto the entry for lineage.
  -- (A factor row can be edited or superseded later; the entry must remain
  -- reproducible exactly as reported.)
  factor_id          UUID REFERENCES scope3_factors(id) ON DELETE SET NULL,
  factor_value       NUMERIC(18, 8) NOT NULL,
  factor_unit        TEXT NOT NULL,
  factor_source      VARCHAR(255) NOT NULL,
  factor_data_year   INTEGER,

  co2e_kg            NUMERIC(18, 4) NOT NULL,

  -- GHG Protocol data-quality signalling, needed for assurance and for
  -- prioritising supplier engagement.
  data_quality       TEXT NOT NULL DEFAULT 'secondary'
                     CHECK (data_quality IN ('primary', 'secondary', 'estimated')),

  notes              TEXT,
  created_by         UUID DEFAULT auth.uid(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scope3_entries_org_date
  ON scope3_entries(organization_id, entry_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scope3_entries_category
  ON scope3_entries(organization_id, category_number, entry_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scope3_entries_supplier
  ON scope3_entries(supplier_id) WHERE deleted_at IS NULL;

-- ─── 4. Row Level Security ───────────────────────────────────────────────────
ALTER TABLE scope3_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE scope3_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scope3_factors_select_own_org" ON scope3_factors;
CREATE POLICY "scope3_factors_select_own_org" ON scope3_factors
  FOR SELECT USING (organization_id = auth_org_id());
DROP POLICY IF EXISTS "scope3_factors_insert_editor" ON scope3_factors;
CREATE POLICY "scope3_factors_insert_editor" ON scope3_factors
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "scope3_factors_update_editor" ON scope3_factors;
CREATE POLICY "scope3_factors_update_editor" ON scope3_factors
  FOR UPDATE USING (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "scope3_factors_delete_admin" ON scope3_factors;
CREATE POLICY "scope3_factors_delete_admin" ON scope3_factors
  FOR DELETE USING (
    organization_id = auth_org_id() AND auth_user_role() = 'admin');

DROP POLICY IF EXISTS "scope3_entries_select_own_org" ON scope3_entries;
CREATE POLICY "scope3_entries_select_own_org" ON scope3_entries
  FOR SELECT USING (organization_id = auth_org_id() AND deleted_at IS NULL);
DROP POLICY IF EXISTS "scope3_entries_insert_editor" ON scope3_entries;
CREATE POLICY "scope3_entries_insert_editor" ON scope3_entries
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "scope3_entries_update_editor" ON scope3_entries;
CREATE POLICY "scope3_entries_update_editor" ON scope3_entries
  FOR UPDATE USING (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
    AND deleted_at IS NULL);
-- Soft-delete only — no hard DELETE policy, matching emission_entries.

-- ─── 5. Audit ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_scope3_entries ON scope3_entries;
CREATE TRIGGER trg_audit_scope3_entries
  AFTER INSERT OR UPDATE OR DELETE ON scope3_entries
  FOR EACH ROW EXECUTE FUNCTION record_audit();

DROP TRIGGER IF EXISTS trg_audit_scope3_factors ON scope3_factors;
CREATE TRIGGER trg_audit_scope3_factors
  AFTER INSERT OR UPDATE OR DELETE ON scope3_factors
  FOR EACH ROW EXECUTE FUNCTION record_audit();
