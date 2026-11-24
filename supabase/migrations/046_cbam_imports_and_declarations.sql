-- ============================================================
-- BROC — CBAM imports and annual declarations
-- Migration 046
-- ============================================================
-- Regulation (EU) 2023/956 as amended by Regulation (EU) 2025/2083 (in force
-- 20 October 2025; the definitive regime applies from 1 January 2026):
--
--   * Art. 2a and Annex VII point 1: an importer whose CBAM goods, other than
--     electricity and hydrogen, do not cumulatively exceed 50 tonnes of net
--     mass in a calendar year is exempt. Above it, every obligation applies to
--     the emissions embedded in all its goods.
--   * Art. 6: by 30 September each year (first in 2027, for 2026), the
--     authorised CBAM declarant submits a declaration of (a) the total quantity
--     of each type of goods imported in the preceding year, (b) their total
--     embedded emissions, (c) the number of CBAM certificates to surrender, and
--     (d) where applicable, the verification reports.
--   * Art. 9 (carbon price paid in the country of origin) and Implementing
--     Regulation (EU) 2025/2620 (free allocation adjustment) reduce the number
--     of certificates. BROC records both deductions as figures with their
--     source; it does not compute them, because the benchmarks and conversion
--     rules belong to the declarant's registry calculation.
--
--   cbam_imports       — one row per import of a CBAM good: the part, the
--                        quantity, the country and installation of origin,
--                        the embedded emissions per unit and where they came
--                        from (actual, with a verification report, or the
--                        Commission's default value, cited)
--   cbam_declarations  — one per calendar year: the authorised declarant
--                        number, the deductions, the quarterly certificate
--                        prices used for the cost estimate, and once
--                        submitted, the registry reference. Submitting it
--                        locks that year's imports.
--
-- The 50-tonne threshold value lives in lib/cbam-core.ts with its citation,
-- per year, because Art. 2a(3) lets the Commission change it annually.
--
-- Also moves the EUDR capability-map row to /products/eudr (the EUDR page now
-- sits under Products and Parts; /eudr redirects there) and the CBAM row from
-- the stand-alone calculator to the imports and declaration page.
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── Imports ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cbam_imports (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  -- NO ACTION: a part with imports on record cannot be deleted out from under
  -- them (deactivate it instead); deleting the organization still cascades.
  product_id             UUID NOT NULL REFERENCES products(id) ON DELETE NO ACTION,
  supplier_id            UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  -- Release for free circulation. Its calendar year decides which annual
  -- declaration, and which year's threshold, the import counts towards.
  import_date            DATE NOT NULL,
  customs_reference      TEXT,
  cn_code                TEXT NOT NULL CHECK (cn_code ~ '^[0-9]{4,10}$'),
  -- Net mass in tonnes, or MWh for electricity (Art. 6(2)(a)).
  quantity               NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
  unit                   TEXT NOT NULL DEFAULT 'tonne' CHECK (unit IN ('tonne', 'MWh')),
  country_of_origin      TEXT NOT NULL CHECK (country_of_origin ~ '^[A-Z]{2}$'),
  installation_name      TEXT,
  installation_id        TEXT,
  -- Specific embedded emissions, tCO2e per tonne (or per MWh). Empty until
  -- known; an import without them is reported as incomplete, never as zero.
  direct_emissions       NUMERIC(14, 6) CHECK (direct_emissions IS NULL OR direct_emissions >= 0),
  indirect_emissions     NUMERIC(14, 6) CHECK (indirect_emissions IS NULL OR indirect_emissions >= 0),
  emissions_basis        TEXT CHECK (emissions_basis IN ('actual', 'default')),
  -- Where the figures come from: the producer's communication, or the
  -- default-value publication and its date. Required once figures are given.
  emissions_source       TEXT,
  -- Actual values need a verifier's report (Art. 8, Annex VI); defaults do not.
  verification_report    TEXT,
  -- Carbon price effectively paid in the country of origin (Art. 9), in EUR,
  -- for the whole import, with its evidence.
  carbon_price_paid_eur  NUMERIC(18, 2) CHECK (carbon_price_paid_eur IS NULL OR carbon_price_paid_eur >= 0),
  carbon_price_evidence  TEXT,
  notes                  TEXT,
  created_by             UUID DEFAULT auth.uid(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cbam_imports_emissions_sourced CHECK (
    (direct_emissions IS NULL AND indirect_emissions IS NULL)
    OR (emissions_basis IS NOT NULL AND emissions_source IS NOT NULL AND btrim(emissions_source) <> '')
  )
);

CREATE INDEX IF NOT EXISTS idx_cbam_imports_org_date ON cbam_imports(organization_id, import_date);
CREATE INDEX IF NOT EXISTS idx_cbam_imports_product ON cbam_imports(product_id);

-- ─── Annual declarations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cbam_declarations (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  year                          INT NOT NULL CHECK (year >= 2026),
  authorised_declarant_number   TEXT,
  -- Certificates deducted for carbon price paid abroad (Art. 9) and for free
  -- allocation in the EU ETS (Implementing Regulation (EU) 2025/2620), as the
  -- registry calculates them. A deduction without its source is refused.
  carbon_price_deduction        NUMERIC(18, 3) CHECK (carbon_price_deduction IS NULL OR carbon_price_deduction >= 0),
  carbon_price_deduction_source TEXT,
  free_allocation_adjustment    NUMERIC(18, 3) CHECK (free_allocation_adjustment IS NULL OR free_allocation_adjustment >= 0),
  free_allocation_source        TEXT,
  -- For 2026 the certificate price is the quarterly average EU ETS auction
  -- price (Implementing Regulation (EU) 2025/2548); used for the estimate only.
  price_q1_eur                  NUMERIC(10, 2) CHECK (price_q1_eur IS NULL OR price_q1_eur >= 0),
  price_q2_eur                  NUMERIC(10, 2) CHECK (price_q2_eur IS NULL OR price_q2_eur >= 0),
  price_q3_eur                  NUMERIC(10, 2) CHECK (price_q3_eur IS NULL OR price_q3_eur >= 0),
  price_q4_eur                  NUMERIC(10, 2) CHECK (price_q4_eur IS NULL OR price_q4_eur >= 0),
  price_source                  TEXT,
  status                        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  submitted_on                  DATE,
  registry_reference            TEXT,
  notes                         TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, year),
  CONSTRAINT cbam_declarations_submitted_complete CHECK (
    status = 'draft' OR (submitted_on IS NOT NULL AND registry_reference IS NOT NULL AND btrim(registry_reference) <> '')
  ),
  CONSTRAINT cbam_declarations_deductions_sourced CHECK (
    (carbon_price_deduction IS NULL OR btrim(coalesce(carbon_price_deduction_source, '')) <> '')
    AND (free_allocation_adjustment IS NULL OR btrim(coalesce(free_allocation_source, '')) <> '')
  )
);

-- ─── Triggers ────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cbam_imports', 'cbam_declarations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$s FOR EACH ROW EXECUTE FUNCTION record_audit()', t);
  END LOOP;
END $$;

-- Once a year's declaration is submitted, the imports it declared are locked,
-- so the record keeps matching what went to the registry. To correct one, an
-- admin sets the declaration back to draft first (audited), then resubmits.
CREATE OR REPLACE FUNCTION cbam_imports_lock_declared()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  -- Deleting the whole organization removes everything.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id) THEN
    RETURN OLD;
  END IF;
  FOR r IN
    SELECT x.organization_id AS org, extract(year FROM x.import_date)::INT AS yr
      FROM (SELECT OLD.organization_id, OLD.import_date WHERE TG_OP <> 'INSERT'
            UNION ALL
            SELECT NEW.organization_id, NEW.import_date WHERE TG_OP <> 'DELETE') AS x(organization_id, import_date)
  LOOP
    IF EXISTS (SELECT 1 FROM cbam_declarations d
                WHERE d.organization_id = r.org AND d.year = r.yr AND d.status = 'submitted') THEN
      RAISE EXCEPTION 'The CBAM declaration for % has been submitted, so its imports are locked. Set the declaration back to draft to correct it.', r.yr
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_cbam_imports_lock_declared ON cbam_imports;
CREATE TRIGGER trg_cbam_imports_lock_declared
  BEFORE INSERT OR UPDATE OR DELETE ON cbam_imports
  FOR EACH ROW EXECUTE FUNCTION cbam_imports_lock_declared();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE cbam_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbam_declarations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cbam_imports', 'cbam_declarations'] LOOP
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

-- An import may only point at this organization's own part and supplier.
DROP POLICY IF EXISTS "cbam_imports_refs_own_org" ON cbam_imports;
CREATE POLICY "cbam_imports_refs_own_org" ON cbam_imports AS RESTRICTIVE
  FOR INSERT WITH CHECK (
    product_id IN (SELECT id FROM products WHERE organization_id = auth_org_id())
    AND (supplier_id IS NULL OR supplier_id IN (SELECT id FROM suppliers WHERE organization_id = auth_org_id())));

DROP POLICY IF EXISTS "cbam_imports_refs_own_org_update" ON cbam_imports;
CREATE POLICY "cbam_imports_refs_own_org_update" ON cbam_imports AS RESTRICTIVE
  FOR UPDATE USING (TRUE) WITH CHECK (
    product_id IN (SELECT id FROM products WHERE organization_id = auth_org_id())
    AND (supplier_id IS NULL OR supplier_id IN (SELECT id FROM suppliers WHERE organization_id = auth_org_id())));

-- Submitting a declaration, or reopening one, is an admin decision.
DROP POLICY IF EXISTS "cbam_declarations_status_admin" ON cbam_declarations;
CREATE POLICY "cbam_declarations_status_admin" ON cbam_declarations AS RESTRICTIVE
  FOR UPDATE USING (TRUE) WITH CHECK (status = 'draft' OR auth_user_role() = 'admin');

DROP POLICY IF EXISTS "cbam_declarations_insert_draft" ON cbam_declarations;
CREATE POLICY "cbam_declarations_insert_draft" ON cbam_declarations AS RESTRICTIVE
  FOR INSERT WITH CHECK (status = 'draft' OR auth_user_role() = 'admin');

-- ─── Capability map ──────────────────────────────────────────────────────────
-- Label, route and probe move together (reg_capabilities_route_shape).
UPDATE regulatory_capabilities
SET route = '/products/eudr'
WHERE item_code = 'EUDR' AND capability_key = 'eudr_geolocation' AND route = '/eudr';

UPDATE regulatory_capabilities
SET label = 'CBAM imports and annual declaration',
    description = 'Each import of a CBAM good with its embedded emissions and their source, the 50-tonne threshold for the year, and the annual declaration pack. The declaration itself is submitted in the CBAM registry.',
    route = '/products/cbam',
    probe = 'cbam_declaration',
    probe_arg = NULL
WHERE item_code = 'CBAM' AND capability_key = 'cbam_calculator';
