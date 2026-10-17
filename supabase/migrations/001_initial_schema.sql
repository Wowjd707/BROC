-- ============================================================
-- EHS Carbon Accounting Platform — Initial Schema
-- Migration 001
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ORGANIZATIONS
-- ============================================================
CREATE TABLE organizations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(255) NOT NULL,
  industry              VARCHAR(100),
  hq_country            VARCHAR(100) NOT NULL DEFAULT 'USA',
  subscription_tier     VARCHAR(50) NOT NULL DEFAULT 'standard',
  reporting_year_start  INTEGER NOT NULL DEFAULT 1 CHECK (reporting_year_start BETWEEN 1 AND 12),
  base_year             INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email             VARCHAR(255) NOT NULL UNIQUE,
  first_name        VARCHAR(100),
  last_name         VARCHAR(100),
  role              VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============================================================
-- SITES
-- ============================================================
CREATE TABLE sites (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              VARCHAR(255) NOT NULL,
  address           VARCHAR(255),
  city              VARCHAR(100),
  state             VARCHAR(100),
  zip_code          VARCHAR(20),
  country           VARCHAR(100) NOT NULL DEFAULT 'USA',
  site_type         VARCHAR(50) NOT NULL DEFAULT 'office' CHECK (site_type IN ('office', 'manufacturing', 'warehouse', 'data_center', 'other')),
  business_unit     VARCHAR(100),
  floor_area_sqft   NUMERIC(12, 2),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- EMISSION FACTORS — SCOPE 1 (reference, pre-seeded)
-- ============================================================
CREATE TABLE scope1_emission_factors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_type       VARCHAR(100) NOT NULL,
  unit            VARCHAR(50) NOT NULL,   -- normalized unit (MMBtu for combustion)
  co2e_factor     NUMERIC(12, 6) NOT NULL, -- kg CO2e per unit
  factor_source   VARCHAR(100) NOT NULL DEFAULT 'EPA_2024',
  data_year       INTEGER NOT NULL DEFAULT 2024
);

-- ============================================================
-- EMISSION FACTORS — SCOPE 2 (reference, pre-seeded)
-- ============================================================
CREATE TABLE scope2_emission_factors (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_type             VARCHAR(50) NOT NULL CHECK (factor_type IN ('electricity', 'residual_mix')),
  geographic_scope        VARCHAR(50) NOT NULL CHECK (geographic_scope IN ('egrid_subregion', 'zip_code', 'country', 'national_average')),
  geographic_identifier   VARCHAR(100) NOT NULL,  -- eGRID code, zip, country ISO, or 'US'
  co2e_factor             NUMERIC(12, 6) NOT NULL, -- kg CO2e per kWh
  data_year               INTEGER NOT NULL DEFAULT 2023,
  factor_source           VARCHAR(100) NOT NULL DEFAULT 'eGRID2023'
);

-- ============================================================
-- REFRIGERANT FACTORS (reference, pre-seeded)
-- ============================================================
CREATE TABLE refrigerant_factors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refrigerant_name  VARCHAR(100) NOT NULL,
  refrigerant_code  VARCHAR(50) NOT NULL UNIQUE,
  gwp_100_year      NUMERIC(10, 2) NOT NULL,  -- CO2e equivalent multiplier per kg
  data_year         INTEGER NOT NULL DEFAULT 2021,
  factor_source     VARCHAR(100) NOT NULL DEFAULT 'IPCC_AR6'
);

-- ============================================================
-- EMISSION ENTRIES
-- ============================================================
CREATE TABLE emission_entries (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id                   UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  entry_date                DATE NOT NULL,
  scope                     VARCHAR(20) NOT NULL CHECK (scope IN ('scope1', 'scope2')),
  source_type               VARCHAR(100) NOT NULL,
  source_detail             VARCHAR(100),
  quantity                  NUMERIC(15, 4) NOT NULL,
  unit                      VARCHAR(50) NOT NULL,
  quantity_normalized       NUMERIC(15, 6) NOT NULL,
  unit_normalized           VARCHAR(50) NOT NULL,
  co2e_kg                   NUMERIC(15, 4) NOT NULL,
  co2e_kg_location_based    NUMERIC(15, 4),       -- always populated; same as co2e_kg for location-based entries
  accounting_method         VARCHAR(30) NOT NULL DEFAULT 'location_based' CHECK (accounting_method IN ('location_based', 'market_based')),
  instrument_type           VARCHAR(50) CHECK (instrument_type IN ('rec', 'ppa', 'green_tariff', 'supplier_specific')),
  supplier_emission_factor  NUMERIC(12, 6),       -- contractual factor (kg CO2e/kWh), market-based only
  emission_factor_used      NUMERIC(12, 6) NOT NULL,
  emission_factor_source    VARCHAR(100) NOT NULL,
  notes                     TEXT,
  created_by                UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                TIMESTAMPTZ          -- soft delete
);

-- ============================================================
-- EHS ENTRIES (water, waste)
-- ============================================================
CREATE TABLE ehs_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id               UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  entry_date            DATE NOT NULL,
  metric_type           VARCHAR(20) NOT NULL CHECK (metric_type IN ('water', 'waste')),
  source_type           VARCHAR(100) NOT NULL,
  quantity              NUMERIC(15, 4) NOT NULL,
  unit                  VARCHAR(50) NOT NULL,
  quantity_normalized   NUMERIC(15, 6) NOT NULL,
  unit_normalized       VARCHAR(50) NOT NULL,
  notes                 TEXT,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ          -- soft delete
);

-- ============================================================
-- GOALS
-- ============================================================
CREATE TABLE goals (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                      VARCHAR(255) NOT NULL,
  goal_type                 VARCHAR(50) NOT NULL CHECK (goal_type IN ('absolute_reduction', 'intensity', 'net_zero', 'sbti_15c')),
  scope_coverage            TEXT[] NOT NULL DEFAULT '{scope1,scope2}',
  base_year                 INTEGER NOT NULL,
  base_year_emissions_kg    NUMERIC(15, 4) NOT NULL,
  target_year               INTEGER NOT NULL,
  target_emissions_kg       NUMERIC(15, 4) NOT NULL,
  target_reduction_pct      NUMERIC(6, 2) NOT NULL,
  scope2_accounting_method  VARCHAR(30) NOT NULL DEFAULT 'location_based' CHECK (scope2_accounting_method IN ('location_based', 'market_based')),
  status                    VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'archived')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PROJECTS
-- ============================================================
CREATE TABLE projects (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id                       UUID REFERENCES sites(id) ON DELETE SET NULL,
  goal_id                       UUID REFERENCES goals(id) ON DELETE SET NULL,
  name                          VARCHAR(255) NOT NULL,
  description                   TEXT,
  category                      VARCHAR(50) NOT NULL CHECK (category IN ('energy_efficiency', 'renewable_energy', 'fleet', 'refrigerants', 'waste', 'water', 'process', 'other')),
  status                        VARCHAR(30) NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'approved', 'in_progress', 'completed', 'cancelled')),
  estimated_co2e_reduction_kg   NUMERIC(15, 4),
  actual_co2e_reduction_kg      NUMERIC(15, 4),
  estimated_cost_usd            NUMERIC(15, 2),
  estimated_payback_months      INTEGER,
  target_completion_date        DATE,
  actual_completion_date        DATE,
  pipeline_inclusion_status     VARCHAR(20) NOT NULL DEFAULT 'excluded' CHECK (pipeline_inclusion_status IN ('excluded', 'forecasted', 'realized')),
  project_inputs                JSONB,
  created_by                    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SUPPLIERS
-- ============================================================
CREATE TABLE suppliers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  contact_name        VARCHAR(255),
  contact_email       VARCHAR(255),
  country             VARCHAR(100),
  commodity_category  VARCHAR(100),
  tier                INTEGER CHECK (tier IN (1, 2, 3)),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SUPPLIER SURVEYS
-- ============================================================
CREATE TABLE supplier_surveys (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  regulation_type  VARCHAR(30) NOT NULL CHECK (regulation_type IN ('cbam', 'eudr', 'pfas', 'general_carbon', 'custom')),
  status           VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  due_date         DATE,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SUPPLIER SURVEY INVITATIONS
-- ============================================================
CREATE TABLE supplier_survey_invitations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id      UUID NOT NULL REFERENCES supplier_surveys(id) ON DELETE CASCADE,
  supplier_id    UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  token          VARCHAR(255) NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status         VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'viewed', 'submitted')),
  sent_at        TIMESTAMPTZ,
  submitted_at   TIMESTAMPTZ,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (survey_id, supplier_id)
);

-- ============================================================
-- SUPPLIER SURVEY RESPONSES
-- ============================================================
CREATE TABLE supplier_survey_responses (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id             UUID NOT NULL REFERENCES supplier_survey_invitations(id) ON DELETE CASCADE,
  survey_id                 UUID NOT NULL REFERENCES supplier_surveys(id) ON DELETE CASCADE,
  supplier_id               UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  responses                 JSONB NOT NULL DEFAULT '{}',
  co2e_intensity_kg_per_unit NUMERIC(12, 6),
  submitted_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_complete               BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_emission_entries_org_date   ON emission_entries(organization_id, entry_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_emission_entries_site        ON emission_entries(site_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_emission_entries_scope       ON emission_entries(organization_id, scope, entry_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_ehs_entries_org_type_date    ON ehs_entries(organization_id, metric_type, entry_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_ehs_entries_site             ON ehs_entries(site_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_org                 ON projects(organization_id);
CREATE INDEX idx_projects_pipeline            ON projects(organization_id, pipeline_inclusion_status);
CREATE INDEX idx_suppliers_org                ON suppliers(organization_id) WHERE is_active = TRUE;
CREATE INDEX idx_invitations_token            ON supplier_survey_invitations(token);
CREATE INDEX idx_invitations_survey           ON supplier_survey_invitations(survey_id);
CREATE INDEX idx_scope2_factors_geo           ON scope2_emission_factors(geographic_identifier, factor_type);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
