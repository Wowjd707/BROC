-- ============================================================
-- BROC — PPWR packaging and extended producer responsibility
-- Migration 047
-- ============================================================
-- Regulation (EU) 2025/40 (PPWR), applying from 12 August 2026:
--
--   * Art. 5(4): lead, cadmium, mercury and hexavalent chromium together
--     shall not exceed 100 mg/kg in packaging.
--   * Art. 5(5): from 12 August 2026, food-contact packaging shall not be
--     placed on the market if it contains PFAS at or above 25 ppb for any
--     PFAS, 250 ppb for the sum of PFAS, or 50 ppm total PFAS.
--   * Art. 7: minimum recycled content in plastic packaging from 2030.
--   * Art. 15(3): technical documentation and the EU declaration of
--     conformity are kept 5 years (single-use) or 10 years (reusable).
--   * Art. 44: producers register in each Member State where they first make
--     packaging available (Annex IX Part A) and report by 1 June for the
--     preceding calendar year (Annex IX Part B): quantities by weight, with
--     the materials glass, plastic, paper/cardboard, ferrous metal,
--     aluminium, wood and other.
--   * Art. 45: extended producer responsibility; an authorised representative
--     where the producer is not established in that Member State.
--
--   packaging_components   — the packaging of a part: material, function,
--                            weight, how many units it holds, reusable,
--                            food contact, recycled content, and the evidence
--                            for each substance limit
--   packaging_placements   — units of a part made available, per country
--                            (or US state, for state EPR laws) and period;
--                            packaging tonnes are computed from these and the
--                            components, in lib/ppwr-core.ts
--   epr_registrations      — the producer's registration in each country's
--                            register, and its scheme or representative
--   epr_reports            — one per country and year; submitting it locks
--                            that country-year's placements
--
-- Jurisdiction codes are ISO 3166-1 alpha-2 (DE) or ISO 3166-2 (US-OR), so
-- the same tables carry US state packaging EPR. BROC states the EU rules only
-- for EU Member States; a scheme's own rules elsewhere are the user's to add.
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── Packaging components ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS packaging_components (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  product_id             UUID NOT NULL REFERENCES products(id) ON DELETE NO ACTION,
  name                   TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- The material columns of Annex IX, Part B, point 2.
  material               TEXT NOT NULL CHECK (material IN ('glass', 'plastic', 'paper_cardboard', 'ferrous_metal', 'aluminium', 'wood', 'other')),
  material_detail        TEXT,
  function               TEXT NOT NULL CHECK (function IN ('sales', 'grouped', 'transport')),
  -- Weight of one piece of packaging, and how many units of the part it holds:
  -- a pallet wrap of 400 g around 200 units is 2 g per unit.
  weight_g               NUMERIC(14, 3) NOT NULL CHECK (weight_g > 0),
  units_per_packaging    NUMERIC(14, 3) NOT NULL DEFAULT 1 CHECK (units_per_packaging > 0),
  reusable               BOOLEAN NOT NULL DEFAULT FALSE,
  food_contact           BOOLEAN NOT NULL DEFAULT FALSE,
  recycled_content_pct   NUMERIC(5, 2) CHECK (recycled_content_pct IS NULL OR (recycled_content_pct >= 0 AND recycled_content_pct <= 100)),
  supplier_id            UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  -- Evidence for Art. 5(4), Art. 5(5) and Art. 39: a declaration, test report
  -- or document reference. Empty means not yet held, and is reported so.
  heavy_metals_evidence  TEXT,
  pfas_evidence          TEXT,
  conformity_reference   TEXT,
  notes                  TEXT,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_packaging_components_product ON packaging_components(product_id);

-- ─── Placements ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS packaging_placements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE NO ACTION,
  jurisdiction     TEXT NOT NULL CHECK (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
  year             INT NOT NULL CHECK (year >= 2000 AND year <= 2100),
  -- NULL is the whole year; 1-4 where a scheme asks for quarters (Art. 44(9)).
  quarter          INT CHECK (quarter IS NULL OR quarter BETWEEN 1 AND 4),
  units            NUMERIC(18, 3) NOT NULL CHECK (units > 0),
  source           TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_packaging_placements_org ON packaging_placements(organization_id, jurisdiction, year);
CREATE UNIQUE INDEX IF NOT EXISTS uq_packaging_placements_period
  ON packaging_placements(organization_id, product_id, jurisdiction, year, coalesce(quarter, 0));

-- ─── EPR registrations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS epr_registrations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  jurisdiction                TEXT NOT NULL CHECK (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
  register_name               TEXT,
  registration_number         TEXT,
  -- Who meets the obligations: the producer itself, a producer responsibility
  -- organisation (Art. 46), or an authorised representative (Art. 45(3)).
  fulfilment                  TEXT NOT NULL DEFAULT 'pro' CHECK (fulfilment IN ('own', 'pro', 'authorised_representative')),
  pro_name                    TEXT,
  authorised_representative   TEXT,
  registered_on               DATE,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, jurisdiction)
);

-- ─── EPR reports ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS epr_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  jurisdiction     TEXT NOT NULL CHECK (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
  year             INT NOT NULL CHECK (year >= 2000 AND year <= 2100),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  submitted_on     DATE,
  reference        TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, jurisdiction, year),
  CONSTRAINT epr_reports_submitted_complete CHECK (
    status = 'draft' OR (submitted_on IS NOT NULL AND reference IS NOT NULL AND btrim(reference) <> '')
  )
);

-- ─── Triggers ────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['packaging_components', 'packaging_placements', 'epr_registrations', 'epr_reports'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$s FOR EACH ROW EXECUTE FUNCTION record_audit()', t);
  END LOOP;
END $$;

-- A submitted report is a record of what was declared: the placements behind
-- it are locked until an admin reopens the report.
CREATE OR REPLACE FUNCTION packaging_placements_lock_reported()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id) THEN
    RETURN OLD;
  END IF;
  FOR r IN
    SELECT x.org, x.j, x.y
      FROM (SELECT OLD.organization_id, OLD.jurisdiction, OLD.year WHERE TG_OP <> 'INSERT'
            UNION ALL
            SELECT NEW.organization_id, NEW.jurisdiction, NEW.year WHERE TG_OP <> 'DELETE') AS x(org, j, y)
  LOOP
    IF EXISTS (SELECT 1 FROM epr_reports e
                WHERE e.organization_id = r.org AND e.jurisdiction = r.j AND e.year = r.y AND e.status = 'submitted') THEN
      RAISE EXCEPTION 'The % packaging report for % has been submitted, so its quantities are locked. Reopen the report to correct it.', r.j, r.y
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_packaging_placements_lock_reported ON packaging_placements;
CREATE TRIGGER trg_packaging_placements_lock_reported
  BEFORE INSERT OR UPDATE OR DELETE ON packaging_placements
  FOR EACH ROW EXECUTE FUNCTION packaging_placements_lock_reported();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['packaging_components', 'packaging_placements', 'epr_registrations', 'epr_reports'] LOOP
    EXECUTE format('ALTER TABLE %1$s ENABLE ROW LEVEL SECURITY', t);
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

-- Components and placements may only point at this organization's own rows.
DROP POLICY IF EXISTS "packaging_components_refs_own_org" ON packaging_components;
CREATE POLICY "packaging_components_refs_own_org" ON packaging_components AS RESTRICTIVE
  FOR INSERT WITH CHECK (
    product_id IN (SELECT id FROM products WHERE organization_id = auth_org_id())
    AND (supplier_id IS NULL OR supplier_id IN (SELECT id FROM suppliers WHERE organization_id = auth_org_id())));
DROP POLICY IF EXISTS "packaging_components_refs_own_org_update" ON packaging_components;
CREATE POLICY "packaging_components_refs_own_org_update" ON packaging_components AS RESTRICTIVE
  FOR UPDATE USING (TRUE) WITH CHECK (
    product_id IN (SELECT id FROM products WHERE organization_id = auth_org_id())
    AND (supplier_id IS NULL OR supplier_id IN (SELECT id FROM suppliers WHERE organization_id = auth_org_id())));

DROP POLICY IF EXISTS "packaging_placements_refs_own_org" ON packaging_placements;
CREATE POLICY "packaging_placements_refs_own_org" ON packaging_placements AS RESTRICTIVE
  FOR INSERT WITH CHECK (product_id IN (SELECT id FROM products WHERE organization_id = auth_org_id()));
DROP POLICY IF EXISTS "packaging_placements_refs_own_org_update" ON packaging_placements;
CREATE POLICY "packaging_placements_refs_own_org_update" ON packaging_placements AS RESTRICTIVE
  FOR UPDATE USING (TRUE) WITH CHECK (product_id IN (SELECT id FROM products WHERE organization_id = auth_org_id()));

-- Submitting a report, or reopening one, is an admin decision.
DROP POLICY IF EXISTS "epr_reports_status_admin" ON epr_reports;
CREATE POLICY "epr_reports_status_admin" ON epr_reports AS RESTRICTIVE
  FOR UPDATE USING (TRUE) WITH CHECK (status = 'draft' OR auth_user_role() = 'admin');
DROP POLICY IF EXISTS "epr_reports_insert_draft" ON epr_reports;
CREATE POLICY "epr_reports_insert_draft" ON epr_reports AS RESTRICTIVE
  FOR INSERT WITH CHECK (status = 'draft' OR auth_user_role() = 'admin');

-- ─── Capability map ──────────────────────────────────────────────────────────
-- A new row for the packaging and EPR records; the supplier-questionnaire row
-- stays, since packaging data still often starts as a supplier's answer.
-- Inserted only where the PPWR tracker item exists (it is seeded by 024).
INSERT INTO regulatory_capabilities
  (item_code, capability_key, label, description, route, probe, probe_arg, necessity, display_order)
SELECT 'PPWR', 'ppwr_packaging', 'PPWR packaging and EPR',
       'Packaging per part with its material, weight and substance evidence; quantities by country; EPR registrations; and the report pack per country and year. Reports are filed with each register or scheme.',
       '/products/ppwr', 'ppwr_packaging', NULL, 'required', 5
WHERE EXISTS (SELECT 1 FROM regulatory_items WHERE code = 'PPWR')
ON CONFLICT (item_code, capability_key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, route = EXCLUDED.route,
  probe = EXCLUDED.probe, probe_arg = EXCLUDED.probe_arg, necessity = EXCLUDED.necessity,
  display_order = EXCLUDED.display_order;
