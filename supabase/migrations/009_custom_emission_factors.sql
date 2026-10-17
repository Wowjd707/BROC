-- ============================================================
-- EHS Carbon Accounting Platform — Custom Emission Factors
-- Migration 009
-- ============================================================
-- Config-over-hardcoding: lets an organization override the global reference
-- factors (EPA Scope 1, eGRID Scope 2, IPCC refrigerant GWPs) with its own
-- measured or supplier-specific values, without a code change.
--
-- Factors are versioned by effective date so historical entries keep using the
-- factor that was in force when the activity occurred — essential for
-- auditability. Every custom factor carries a cited source and data year, same
-- as the reference tables.
--
-- Resolution (see lib/custom-factors.ts): for a given category + key + date,
-- the active row whose [effective_from, effective_to) window contains the date
-- wins; otherwise the platform falls back to the global reference factor.
-- ============================================================

CREATE TABLE IF NOT EXISTS custom_emission_factors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),

  -- What kind of factor this overrides, and the key it applies to:
  --   'scope1'          → key = fuel_type          (kg CO₂e / MMBtu)
  --   'scope2_location' → key = site_id            (kg CO₂e / kWh)
  --   'refrigerant'     → key = refrigerant_code   (kg CO₂e / kg, i.e. GWP)
  factor_category  TEXT NOT NULL CHECK (factor_category IN ('scope1', 'scope2_location', 'refrigerant')),
  factor_key       TEXT NOT NULL,
  label            TEXT,                 -- human-friendly description for the UI

  co2e_factor      NUMERIC(14, 6) NOT NULL,   -- per the normalized denominator below
  unit             TEXT NOT NULL,             -- 'MMBtu' | 'kWh' | 'kg' (normalized denominator)
  factor_source    VARCHAR(255) NOT NULL,     -- provenance, cited (required)
  data_year        INTEGER NOT NULL,

  effective_from   DATE NOT NULL DEFAULT '1900-01-01',
  effective_to     DATE,                 -- NULL = still in force
  notes            TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       UUID DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT custom_factor_effective_order
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS idx_custom_factors_lookup
  ON custom_emission_factors(organization_id, factor_category, factor_key, effective_from)
  WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_custom_factors_updated_at ON custom_emission_factors;
CREATE TRIGGER trg_custom_factors_updated_at
  BEFORE UPDATE ON custom_emission_factors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE custom_emission_factors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_factors_select_own_org" ON custom_emission_factors;
CREATE POLICY "custom_factors_select_own_org" ON custom_emission_factors
  FOR SELECT USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "custom_factors_insert_editor" ON custom_emission_factors;
CREATE POLICY "custom_factors_insert_editor" ON custom_emission_factors
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "custom_factors_update_editor" ON custom_emission_factors;
CREATE POLICY "custom_factors_update_editor" ON custom_emission_factors
  FOR UPDATE USING (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "custom_factors_delete_admin" ON custom_emission_factors;
CREATE POLICY "custom_factors_delete_admin" ON custom_emission_factors
  FOR DELETE USING (
    organization_id = auth_org_id()
    AND auth_user_role() = 'admin'
  );

-- Audit the factor table too — factor changes are high-stakes for reported numbers.
DROP TRIGGER IF EXISTS trg_audit_custom_factors ON custom_emission_factors;
CREATE TRIGGER trg_audit_custom_factors
  AFTER INSERT OR UPDATE OR DELETE ON custom_emission_factors
  FOR EACH ROW EXECUTE FUNCTION record_audit();
