-- ============================================================
-- BROC — EUDR due diligence: plots, risk assessments, shipments
-- Migration 045
-- ============================================================
-- Regulation (EU) 2023/1115 asks an operator, for each placing on the market
-- or export, for: the product (HS code, description, net mass); the country of
-- production and the geolocation of every plot it came from (Art. 9, Annex
-- II); any upstream due diligence statement it relies on; a risk assessment
-- against the criteria of Art. 10(2) with mitigation under Art. 11 — or the
-- simplified route of Art. 13 when every country of production is low risk;
-- and a due diligence statement filed in the EU information system (TRACES).
--
--   eudr_plots               — plots of land, as GeoJSON geometries in WGS 84,
--                              with the producer and country; validated in
--                              lib/eudr-core.ts before they are stored
--   eudr_risk_assessments    — per supplier, country and commodity: country
--                              risk with its basis, the Art. 10(2) criteria,
--                              the conclusion and any mitigation
--   eudr_shipments           — one placing on the market or export: the facts
--                              of Annex II, the risk assessment relied on, and
--                              once filed, the statement's reference and
--                              verification numbers
--   eudr_shipment_plots      — which plots a shipment came from
--
-- BROC does not file the statement: the filing pack it builds (GeoJSON plus
-- the statement's fields) is uploaded to TRACES by the operator, and the
-- reference TRACES returns is recorded here.
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── The operator's details (Annex II, point 1) ───────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS eori_number TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS legal_address TEXT;
COMMENT ON COLUMN organizations.eori_number IS 'EORI number, for EUDR statements on goods entering or leaving the EU market.';
COMMENT ON COLUMN organizations.legal_address IS 'Registered address, as it should appear on regulatory statements.';

-- ─── Plots ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eudr_plots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  supplier_id      UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  -- TRACES property ProductionPlace.
  name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
  -- TRACES property ProducerName.
  producer_name    TEXT,
  -- ISO 3166-1 alpha-2, TRACES property ProducerCountry.
  country_code     TEXT NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  commodity        TEXT,
  -- A GeoJSON geometry (Point, MultiPoint, Polygon or MultiPolygon), WGS 84,
  -- longitude first, at most six decimals. Shape rules are checked in code.
  geometry         JSONB NOT NULL CHECK (geometry ->> 'type' IN ('Point', 'MultiPoint', 'Polygon', 'MultiPolygon')),
  -- Hectares: as declared for a point, computed for a polygon.
  area_ha          NUMERIC CHECK (area_ha IS NULL OR area_ha > 0),
  source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'survey')),
  -- The collected value it was read from, when it came from a survey answer.
  source_value_id  UUID REFERENCES product_compliance_values(id) ON DELETE SET NULL,
  notes            TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eudr_plots_org_supplier ON eudr_plots(organization_id, supplier_id);

-- ─── Risk assessments ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eudr_risk_assessments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  supplier_id         UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  country_code        TEXT NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  commodity           TEXT NOT NULL,
  -- The Commission's classification of the country (Art. 29), and where it
  -- was read from. BROC holds no country list: the assessor records it.
  country_risk        TEXT NOT NULL CHECK (country_risk IN ('low', 'standard', 'high')),
  country_risk_basis  TEXT NOT NULL CHECK (length(trim(country_risk_basis)) > 0),
  -- Art. 10(2) criteria, keyed a–n: { "a": { "finding": "...", "concern": false }, ... }
  criteria            JSONB NOT NULL DEFAULT '{}'::jsonb,
  conclusion          TEXT NOT NULL CHECK (conclusion IN ('negligible', 'not_negligible')),
  -- Art. 11 measures taken, and why the risk is now negligible.
  mitigation          TEXT,
  assessed_by         UUID DEFAULT auth.uid(),
  assessed_at         DATE NOT NULL DEFAULT CURRENT_DATE,
  -- When it should be reviewed. A working default of a year is set in the app.
  review_by           DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eudr_risk_org_supplier ON eudr_risk_assessments(organization_id, supplier_id, country_code);

-- ─── Shipments ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eudr_shipments (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  -- NO ACTION, not RESTRICT: checked at the end of the statement, so deleting a
  -- whole organization (which cascades to both) succeeds, while deleting a
  -- product a shipment still uses does not.
  product_id                 UUID NOT NULL REFERENCES products(id) ON DELETE NO ACTION,
  supplier_id                UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  -- PO, customs entry or internal reference: whatever ties it to the goods.
  reference                  TEXT NOT NULL CHECK (length(trim(reference)) > 0),
  activity                   TEXT NOT NULL DEFAULT 'import' CHECK (activity IN ('import', 'export', 'domestic')),
  -- Annex II point 2, as at the time of the shipment.
  hs_code                    TEXT CHECK (hs_code IS NULL OR hs_code ~ '^[0-9]{4,10}$'),
  description                TEXT,
  net_mass_kg                NUMERIC CHECK (net_mass_kg IS NULL OR net_mass_kg > 0),
  supplementary_quantity     NUMERIC CHECK (supplementary_quantity IS NULL OR supplementary_quantity > 0),
  supplementary_unit         TEXT,
  -- Annex II point 3.
  countries_of_production    TEXT[] NOT NULL DEFAULT '{}',
  production_from            DATE,
  production_to              DATE,
  -- Annex II point 4: [{ "reference": "...", "verification": "..." }]
  upstream_references        JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_assessment_id         UUID REFERENCES eudr_risk_assessments(id) ON DELETE SET NULL,
  status                     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'filed', 'withdrawn')),
  dds_reference              TEXT,
  dds_verification_number    TEXT,
  filed_at                   DATE,
  filed_by                   UUID REFERENCES users(id) ON DELETE SET NULL,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (production_to IS NULL OR production_from IS NULL OR production_to >= production_from),
  -- A filed shipment carries what TRACES returned.
  CHECK (status <> 'filed' OR (dds_reference IS NOT NULL AND filed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_eudr_shipments_org ON eudr_shipments(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_eudr_shipments_product ON eudr_shipments(product_id);

CREATE TABLE IF NOT EXISTS eudr_shipment_plots (
  -- Its own id so the audit trail (record_audit) can name the row.
  id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  shipment_id      UUID NOT NULL REFERENCES eudr_shipments(id) ON DELETE CASCADE,
  plot_id          UUID NOT NULL REFERENCES eudr_plots(id) ON DELETE NO ACTION,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  PRIMARY KEY (shipment_id, plot_id)
);

CREATE INDEX IF NOT EXISTS idx_eudr_shipment_plots_plot ON eudr_shipment_plots(plot_id);

-- ─── Triggers ────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['eudr_plots', 'eudr_risk_assessments', 'eudr_shipments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['eudr_plots', 'eudr_risk_assessments', 'eudr_shipments', 'eudr_shipment_plots'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$s FOR EACH ROW EXECUTE FUNCTION record_audit()', t);
  END LOOP;
END $$;

-- A filed statement is a record of what was declared. Once filed, the facts
-- it declared cannot change; only withdrawing it (with TRACES) can.
CREATE OR REPLACE FUNCTION eudr_shipment_freeze_filed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'filed' AND (
       NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.hs_code IS DISTINCT FROM OLD.hs_code
    OR NEW.net_mass_kg IS DISTINCT FROM OLD.net_mass_kg
    OR NEW.supplementary_quantity IS DISTINCT FROM OLD.supplementary_quantity
    OR NEW.countries_of_production IS DISTINCT FROM OLD.countries_of_production
    OR NEW.production_from IS DISTINCT FROM OLD.production_from
    OR NEW.production_to IS DISTINCT FROM OLD.production_to
    OR NEW.upstream_references IS DISTINCT FROM OLD.upstream_references
    OR NEW.dds_reference IS DISTINCT FROM OLD.dds_reference
    OR NEW.dds_verification_number IS DISTINCT FROM OLD.dds_verification_number
    OR NEW.filed_at IS DISTINCT FROM OLD.filed_at
    OR NEW.status NOT IN ('filed', 'withdrawn')
  ) THEN
    RAISE EXCEPTION 'This shipment''s due diligence statement has been filed; its declared facts cannot be changed. Withdraw it first.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_eudr_shipment_freeze_filed ON eudr_shipments;
CREATE TRIGGER trg_eudr_shipment_freeze_filed
  BEFORE UPDATE ON eudr_shipments
  FOR EACH ROW EXECUTE FUNCTION eudr_shipment_freeze_filed();

-- A statement that was filed (even if later withdrawn) is kept: the record of
-- what was declared outlives the declaration.
CREATE OR REPLACE FUNCTION eudr_shipment_keep_filed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Deleting the whole organization (a practice-workspace reset, or an
  -- operator leaving) removes it all; only a shipment on its own is kept.
  IF OLD.status IN ('filed', 'withdrawn')
     AND EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id) THEN
    RAISE EXCEPTION 'This shipment''s due diligence statement has been filed, so the shipment is kept as a record and cannot be deleted.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_eudr_shipment_keep_filed ON eudr_shipments;
CREATE TRIGGER trg_eudr_shipment_keep_filed
  BEFORE DELETE ON eudr_shipments
  FOR EACH ROW EXECUTE FUNCTION eudr_shipment_keep_filed();

-- Plots of a filed shipment cannot be swapped out either.
CREATE OR REPLACE FUNCTION eudr_shipment_plots_freeze_filed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM eudr_shipments
   WHERE id = COALESCE(NEW.shipment_id, OLD.shipment_id);
  IF v_status = 'filed' THEN
    RAISE EXCEPTION 'This shipment''s due diligence statement has been filed; its plots cannot be changed.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_eudr_shipment_plots_freeze ON eudr_shipment_plots;
CREATE TRIGGER trg_eudr_shipment_plots_freeze
  BEFORE INSERT OR DELETE ON eudr_shipment_plots
  FOR EACH ROW EXECUTE FUNCTION eudr_shipment_plots_freeze_filed();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE eudr_plots ENABLE ROW LEVEL SECURITY;
ALTER TABLE eudr_risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE eudr_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE eudr_shipment_plots ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['eudr_plots', 'eudr_risk_assessments', 'eudr_shipments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select_own_org" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s_select_own_org" ON %1$s FOR SELECT USING (organization_id = auth_org_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_insert_editor" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s_insert_editor" ON %1$s FOR INSERT WITH CHECK (organization_id = auth_org_id() AND auth_user_role() IN (''admin'', ''editor''))', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_update_editor" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s_update_editor" ON %1$s FOR UPDATE USING (organization_id = auth_org_id() AND auth_user_role() IN (''admin'', ''editor'')) WITH CHECK (organization_id = auth_org_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_delete_admin" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s_delete_admin" ON %1$s FOR DELETE USING (organization_id = auth_org_id() AND auth_user_role() = ''admin'')', t);
  END LOOP;
END $$;

-- Foreign keys to another organization's rows are refused, not just hidden.
DROP POLICY IF EXISTS "eudr_shipments_refs_own_org" ON eudr_shipments;
CREATE POLICY "eudr_shipments_refs_own_org" ON eudr_shipments AS RESTRICTIVE
  FOR INSERT WITH CHECK (
    product_id IN (SELECT id FROM products WHERE organization_id = auth_org_id())
    AND (risk_assessment_id IS NULL OR risk_assessment_id IN (SELECT id FROM eudr_risk_assessments WHERE organization_id = auth_org_id())));

DROP POLICY IF EXISTS "eudr_shipments_refs_own_org_update" ON eudr_shipments;
CREATE POLICY "eudr_shipments_refs_own_org_update" ON eudr_shipments AS RESTRICTIVE
  FOR UPDATE USING (TRUE) WITH CHECK (
    product_id IN (SELECT id FROM products WHERE organization_id = auth_org_id())
    AND (risk_assessment_id IS NULL OR risk_assessment_id IN (SELECT id FROM eudr_risk_assessments WHERE organization_id = auth_org_id())));

DROP POLICY IF EXISTS "eudr_shipment_plots_select_own_org" ON eudr_shipment_plots;
CREATE POLICY "eudr_shipment_plots_select_own_org" ON eudr_shipment_plots
  FOR SELECT USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "eudr_shipment_plots_write_editor" ON eudr_shipment_plots;
CREATE POLICY "eudr_shipment_plots_write_editor" ON eudr_shipment_plots
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
    AND shipment_id IN (SELECT id FROM eudr_shipments WHERE organization_id = auth_org_id())
    AND plot_id IN (SELECT id FROM eudr_plots WHERE organization_id = auth_org_id()));

DROP POLICY IF EXISTS "eudr_shipment_plots_delete_editor" ON eudr_shipment_plots;
CREATE POLICY "eudr_shipment_plots_delete_editor" ON eudr_shipment_plots
  FOR DELETE USING (organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));

-- ─── Capability map ──────────────────────────────────────────────────────────
-- Migration 026 recorded plot geolocation and the due diligence statement as
-- "not built". They now are, so the row points at /eudr and is read by the
-- eudr_due_diligence probe (lib/capability-readiness-core.ts). One UPDATE,
-- because reg_capabilities_route_shape needs label, route and probe to move
-- together. Re-running it changes nothing.
UPDATE regulatory_capabilities
SET label = 'EUDR due diligence',
    description = 'Plots of land with their geolocation, risk assessments under Articles 10 and 11, and a record per shipment that produces the due diligence statement and GeoJSON file for TRACES. The statement itself is submitted in TRACES.',
    route = '/eudr',
    probe = 'eudr_due_diligence',
    probe_arg = NULL
WHERE item_code = 'EUDR' AND capability_key = 'eudr_geolocation';
