-- ============================================================
-- EHS Carbon Accounting Platform — Site Profile & Equipment Inventory
-- Migration 020
-- ============================================================
-- A site was an address with a floor area. That is enough to allocate a utility
-- bill and not much else. Three questions come up in every inventory review and
-- none of them could be answered from this schema:
--
--   * Where does the water come from? Withdrawal source drives whether a volume
--     is a municipal purchase, a permitted groundwater draw, or reclaimed — and
--     CDP Water, ESRS E3 and GRI 303 all ask for the split.
--   * Does the site burn natural gas, and does it have standby generation?
--     Both are Scope 1 stationary combustion. A site marked "no natural gas"
--     with gas entries against it is a data-review finding; a site with
--     generators and no diesel entries is the more common one.
--   * How many people work there? Per-FTE intensity is the second-most
--     requested denominator after floor area.
--
--   site_equipment — a basic asset register: what at this location consumes
--                    energy. Deliberately shallow. This is not a CMMS; it is
--                    enough to know that a 500-ton chiller exists, what it
--                    burns, and how much refrigerant it holds.
--
-- The refrigerant columns matter more than they look: a chiller's charge is the
-- input to fugitive-emission screening, and today that number lives in a
-- spreadsheet on someone's desktop.
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── 1. Site sustainability profile ──────────────────────────────────────────
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS water_source              VARCHAR(40),
  ADD COLUMN IF NOT EXISTS water_source_notes        TEXT,
  ADD COLUMN IF NOT EXISTS wastewater_discharge      VARCHAR(40),
  ADD COLUMN IF NOT EXISTS uses_natural_gas          BOOLEAN,
  ADD COLUMN IF NOT EXISTS natural_gas_utility       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS electric_utility          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS employee_count            INTEGER,
  ADD COLUMN IF NOT EXISTS operating_hours_per_week  NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS has_backup_generators     BOOLEAN,
  ADD COLUMN IF NOT EXISTS backup_generator_count    INTEGER,
  ADD COLUMN IF NOT EXISTS backup_generator_fuel     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS backup_generator_kw       NUMERIC(12, 2);

-- Nullable throughout and no defaults: an unanswered profile question must read
-- as "not recorded", never as "no". A site defaulted to uses_natural_gas = FALSE
-- would look deliberately excluded from stationary combustion when nobody had
-- actually looked.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sites_water_source_check'
  ) THEN
    ALTER TABLE sites ADD CONSTRAINT sites_water_source_check
      CHECK (water_source IS NULL OR water_source IN (
        'municipal', 'groundwater_well', 'surface_water', 'rainwater',
        'reclaimed', 'purchased_third_party', 'mixed', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sites_wastewater_discharge_check'
  ) THEN
    ALTER TABLE sites ADD CONSTRAINT sites_wastewater_discharge_check
      CHECK (wastewater_discharge IS NULL OR wastewater_discharge IN (
        'municipal_sewer', 'septic', 'surface_water', 'onsite_treatment',
        'evaporation', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sites_backup_generator_fuel_check'
  ) THEN
    ALTER TABLE sites ADD CONSTRAINT sites_backup_generator_fuel_check
      CHECK (backup_generator_fuel IS NULL OR backup_generator_fuel IN (
        'diesel', 'natural_gas', 'propane', 'gasoline', 'dual_fuel', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sites_employee_count_check'
  ) THEN
    ALTER TABLE sites ADD CONSTRAINT sites_employee_count_check
      CHECK (employee_count IS NULL OR employee_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sites_backup_generator_count_check'
  ) THEN
    ALTER TABLE sites ADD CONSTRAINT sites_backup_generator_count_check
      CHECK (backup_generator_count IS NULL OR backup_generator_count >= 0);
  END IF;
END $$;

COMMENT ON COLUMN sites.water_source IS
  'Primary withdrawal source. Drives the withdrawal-by-source breakdown in CDP Water, ESRS E3 and GRI 303. NULL means not recorded, not "municipal".';
COMMENT ON COLUMN sites.uses_natural_gas IS
  'Whether the site burns natural gas on site. NULL means not recorded — only an explicit FALSE asserts the absence, which data review can then test against actual gas entries.';
COMMENT ON COLUMN sites.employee_count IS
  'Headcount at this location, for per-FTE intensity denominators.';
COMMENT ON COLUMN sites.has_backup_generators IS
  'Site-level summary. Individual gensets belong in site_equipment with equipment_type = emergency_generator; this flag exists so the question can be answered before anyone builds the asset register.';

-- ─── 2. Equipment inventory ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_equipment (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  site_id              UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,

  name                 VARCHAR(255) NOT NULL,   -- as tagged on the floor: "Chiller #2"
  equipment_type       VARCHAR(50)  NOT NULL,
  quantity             INTEGER      NOT NULL DEFAULT 1 CHECK (quantity > 0),

  manufacturer         VARCHAR(255),
  model                VARCHAR(255),
  asset_tag            VARCHAR(100),            -- organization's own asset/serial identifier

  -- What it consumes. 'electricity' is the common case and the reason this
  -- table exists, but a boiler is gas and a genset is diesel, and knowing which
  -- is what decides whether it lands in Scope 1 or Scope 2.
  energy_source        VARCHAR(40),

  -- Nameplate. rated_capacity is domain-specific (tons of refrigeration, HP,
  -- BTU/hr) so it carries its own unit; rated_power_kw is the normalised
  -- electrical draw and is what any load estimate should read.
  rated_capacity       NUMERIC(14, 3),
  capacity_unit        VARCHAR(30),
  rated_power_kw       NUMERIC(12, 3),

  install_year         INTEGER CHECK (install_year IS NULL OR (install_year BETWEEN 1900 AND 2200)),
  operating_hours_per_year NUMERIC(8, 2) CHECK (operating_hours_per_year IS NULL OR operating_hours_per_year >= 0),

  -- Refrigerant charge feeds fugitive-emission screening. The code is matched
  -- against refrigerant_factors by the application; no FK, because an organization
  -- may hold a blend the reference table does not carry yet and losing the
  -- record entirely is worse than an unmatched code.
  refrigerant_code     VARCHAR(50),
  refrigerant_charge_kg NUMERIC(12, 3) CHECK (refrigerant_charge_kg IS NULL OR refrigerant_charge_kg >= 0),

  status               VARCHAR(20) NOT NULL DEFAULT 'operating'
                         CHECK (status IN ('operating', 'standby', 'idle', 'retired')),
  notes                TEXT,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,

  created_by           UUID REFERENCES users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The type list is a starting vocabulary, not a closed taxonomy — 'other' plus
-- a name covers what it misses. Kept in sync with EQUIPMENT_TYPES in
-- lib/site-equipment.ts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'site_equipment_type_check'
  ) THEN
    ALTER TABLE site_equipment ADD CONSTRAINT site_equipment_type_check
      CHECK (equipment_type IN (
        'chiller', 'boiler', 'furnace', 'air_handler', 'rooftop_unit',
        'cooling_tower', 'air_compressor', 'pump', 'fan_blower', 'motor_drive',
        'refrigeration', 'water_heater', 'oven_dryer', 'kiln_furnace',
        'cnc_machine', 'injection_molding', 'press_stamping', 'welding',
        'conveyor', 'dust_collector', 'paint_booth', 'lighting',
        'server_room', 'ev_charger', 'emergency_generator', 'process_other',
        'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'site_equipment_energy_source_check'
  ) THEN
    ALTER TABLE site_equipment ADD CONSTRAINT site_equipment_energy_source_check
      CHECK (energy_source IS NULL OR energy_source IN (
        'electricity', 'natural_gas', 'diesel', 'propane', 'fuel_oil',
        'steam', 'chilled_water', 'compressed_air', 'multiple', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_site_equipment_site ON site_equipment(site_id);
CREATE INDEX IF NOT EXISTS idx_site_equipment_org  ON site_equipment(organization_id);

COMMENT ON TABLE site_equipment IS
  'Basic asset register of energy-consuming equipment per site. Intentionally shallow — enough to know what draws power and what refrigerant it holds, not a maintenance system.';
COMMENT ON COLUMN site_equipment.rated_power_kw IS
  'Normalised electrical draw in kW. rated_capacity/capacity_unit hold the domain nameplate (tons, HP, BTU/hr); any load calculation should read this column, not that one.';
COMMENT ON COLUMN site_equipment.refrigerant_code IS
  'Matched against refrigerant_factors by the application. No FK: an unrecognised blend is recorded and flagged rather than rejected.';

-- ─── 3. Row Level Security ───────────────────────────────────────────────────
ALTER TABLE site_equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_equipment_select_own_org" ON site_equipment;
CREATE POLICY "site_equipment_select_own_org" ON site_equipment
  FOR SELECT USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "site_equipment_insert_editor" ON site_equipment;
CREATE POLICY "site_equipment_insert_editor" ON site_equipment
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND site_id IN (SELECT id FROM sites WHERE organization_id = auth_org_id())
    AND auth_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "site_equipment_update_editor" ON site_equipment;
CREATE POLICY "site_equipment_update_editor" ON site_equipment
  FOR UPDATE USING (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "site_equipment_delete_editor" ON site_equipment;
CREATE POLICY "site_equipment_delete_editor" ON site_equipment
  FOR DELETE USING (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));

-- ─── 4. Audit ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_site_equipment ON site_equipment;
CREATE TRIGGER trg_audit_site_equipment
  AFTER INSERT OR UPDATE OR DELETE ON site_equipment
  FOR EACH ROW EXECUTE FUNCTION record_audit();

DROP TRIGGER IF EXISTS trg_site_equipment_updated_at ON site_equipment;
CREATE TRIGGER trg_site_equipment_updated_at
  BEFORE UPDATE ON site_equipment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
