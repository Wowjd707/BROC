-- ============================================================
-- EHS Carbon Accounting Platform — CBAM Calculator Tables
-- Migration 005
-- ============================================================
-- Two tables:
--   cbam_supplier_factors  — custom emission factors provided by suppliers
--   cbam_calculations      — saved CBAM cost estimates
-- ============================================================

-- ─── Supplier-provided emission factors ───────────────────────────────────────
-- Stores ad-hoc or supplier-specific emission factors that override the EU defaults.
CREATE TABLE IF NOT EXISTS cbam_supplier_factors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id           UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name         VARCHAR(255) NOT NULL,
  cn_code               VARCHAR(20)  NOT NULL,
  commodity_name        VARCHAR(255) NOT NULL,
  emission_factor       NUMERIC(14, 6) NOT NULL, -- tCO₂e per tonne (or per MWh for electricity)
  factor_unit           VARCHAR(20)  NOT NULL DEFAULT 'tonne', -- 'tonne' or 'MWh'
  factor_source         VARCHAR(500),            -- e.g. "Supplier declaration 2024-01-15"
  notes                 TEXT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cbam_supplier_factors_org
  ON cbam_supplier_factors(organization_id);

CREATE INDEX IF NOT EXISTS idx_cbam_supplier_factors_supplier
  ON cbam_supplier_factors(supplier_id);

-- ─── Saved CBAM calculations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cbam_calculations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id           UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name         VARCHAR(255),
  cn_code               VARCHAR(20)  NOT NULL,
  commodity_name        VARCHAR(255) NOT NULL,
  sector                VARCHAR(50),
  country_of_origin     VARCHAR(100) NOT NULL,
  quantity              NUMERIC(18, 4) NOT NULL, -- in mass_unit
  mass_unit             VARCHAR(20)  NOT NULL DEFAULT 'tonnes', -- 'kg', 'tonnes', or 'MWh'
  quantity_tonnes       NUMERIC(18, 6) NOT NULL, -- normalised to tonnes (or MWh)
  emission_factor       NUMERIC(14, 6) NOT NULL, -- tCO₂e per tonne
  factor_type           VARCHAR(30)  NOT NULL CHECK (factor_type IN ('eu_default', 'supplier_provided')),
  factor_source         VARCHAR(500),
  total_tco2e           NUMERIC(18, 6) NOT NULL,
  certificate_price_eur NUMERIC(10, 2) NOT NULL,
  estimated_cost_eur    NUMERIC(18, 2) NOT NULL,
  notes                 TEXT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cbam_calculations_org
  ON cbam_calculations(organization_id);

CREATE INDEX IF NOT EXISTS idx_cbam_calculations_created
  ON cbam_calculations(organization_id, created_at DESC);

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE cbam_supplier_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbam_calculations     ENABLE ROW LEVEL SECURITY;

-- cbam_supplier_factors: org members can read; admin/editor can write
CREATE POLICY "org members can read cbam supplier factors"
  ON cbam_supplier_factors FOR SELECT
  USING (organization_id = auth_org_id());

CREATE POLICY "admin and editor can insert cbam supplier factors"
  ON cbam_supplier_factors FOR INSERT
  WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "admin and editor can update cbam supplier factors"
  ON cbam_supplier_factors FOR UPDATE
  USING (organization_id = auth_org_id())
  WITH CHECK (auth_user_role() IN ('admin', 'editor'));

CREATE POLICY "admin and editor can delete cbam supplier factors"
  ON cbam_supplier_factors FOR DELETE
  USING (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

-- cbam_calculations: org members can read; admin/editor can write
CREATE POLICY "org members can read cbam calculations"
  ON cbam_calculations FOR SELECT
  USING (organization_id = auth_org_id());

CREATE POLICY "admin and editor can insert cbam calculations"
  ON cbam_calculations FOR INSERT
  WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );

CREATE POLICY "admin and editor can delete cbam calculations"
  ON cbam_calculations FOR DELETE
  USING (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
  );
