-- ============================================================
-- BROC — Products, regulation scope, and structured compliance data
-- Migration 043
-- ============================================================
-- CBAM, EUDR, PPWR and EPR all ask the same questions underneath: what did
-- you buy, import or place on the market (a part, with a customs code and an
-- origin); what does the supplier say about it; and how long is that answer
-- good for. This migration is the shared foundation for all of them.
--
--   products                    — the part / SKU / packaging list, loaded from
--                                 an ERP or customs-broker export
--   compliance_scope_rules      — which CN codes a regulation covers, kept as
--                                 the organization's own cited data (the same
--                                 stance as the regulatory tracker: never
--                                 shipped from memory)
--   product_compliance_values   — every value collected for a product, with
--                                 where it came from and how long it is valid.
--                                 Append-only: the current value is the latest
--                                 row, and the history is the audit trail.
--   supplier_survey_invitation_products
--                               — which products a survey invitation asks
--                                 about, so the supplier's answers land on
--                                 those products
--   supplier_survey_questions.maps_to
--                               — which compliance field a custom question
--                                 fills
--
-- The fields themselves (what "eudr.geolocation" means, its type, how long it
-- stays valid) are defined in code, in lib/compliance-catalog.ts, the same way
-- the built-in survey question sets are. Adding a field is a code change with
-- a test, not a schema change.
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── Products ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  part_number       TEXT NOT NULL,
  description       TEXT,
  -- Combined Nomenclature code, digits only (spaces and dots stripped on the
  -- way in). Two to ten digits: a chapter-level code is still useful for
  -- scoping, and TARIC extends CN to ten.
  cn_code           TEXT CHECK (cn_code IS NULL OR cn_code ~ '^[0-9]{2,10}$'),
  supplier_id       UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  country_of_origin TEXT,
  business_unit_id  UUID REFERENCES business_units(id) ON DELETE SET NULL,
  site_id           UUID REFERENCES sites(id) ON DELETE SET NULL,
  -- Who collects this product's data. Sustainability sets the standard; the
  -- buyer or site that knows the supplier does the asking.
  owner_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  notes             TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per part number per organization, so an ERP export can be
-- re-imported to refresh the list without doubling it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_org_part
  ON products(organization_id, lower(part_number));
CREATE INDEX IF NOT EXISTS idx_products_org_cn ON products(organization_id, cn_code);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_products ON products;
CREATE TRIGGER trg_audit_products
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION record_audit();

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select_own_org" ON products;
CREATE POLICY "products_select_own_org" ON products
  FOR SELECT USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "products_insert_editor" ON products;
CREATE POLICY "products_insert_editor" ON products
  FOR INSERT WITH CHECK (organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "products_update_editor" ON products;
CREATE POLICY "products_update_editor" ON products
  FOR UPDATE USING (organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'))
  WITH CHECK (organization_id = auth_org_id());

DROP POLICY IF EXISTS "products_delete_admin" ON products;
CREATE POLICY "products_delete_admin" ON products
  FOR DELETE USING (organization_id = auth_org_id() AND auth_user_role() = 'admin');

-- ─── Which CN codes each regulation covers ───────────────────────────────────
-- The organization's own list, each line cited. A product is in scope of a
-- regulation when its CN code starts with one of these prefixes.
CREATE TABLE IF NOT EXISTS compliance_scope_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  regulation       TEXT NOT NULL CHECK (regulation ~ '^[a-z][a-z0-9_]{1,30}$'),
  cn_prefix        TEXT NOT NULL CHECK (cn_prefix ~ '^[0-9]{2,10}$'),
  label            TEXT,
  -- Never optional: a scope list nobody can trace back to the legal text is
  -- how a part quietly drops out of a filing.
  source_citation  TEXT NOT NULL CHECK (length(trim(source_citation)) > 0),
  source_url       TEXT,
  last_verified    DATE NOT NULL,
  created_by       UUID DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, regulation, cn_prefix)
);

DROP TRIGGER IF EXISTS trg_audit_compliance_scope_rules ON compliance_scope_rules;
CREATE TRIGGER trg_audit_compliance_scope_rules
  AFTER INSERT OR UPDATE OR DELETE ON compliance_scope_rules
  FOR EACH ROW EXECUTE FUNCTION record_audit();

ALTER TABLE compliance_scope_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scope_rules_select_own_org" ON compliance_scope_rules;
CREATE POLICY "scope_rules_select_own_org" ON compliance_scope_rules
  FOR SELECT USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "scope_rules_write_admin" ON compliance_scope_rules;
CREATE POLICY "scope_rules_write_admin" ON compliance_scope_rules
  FOR ALL USING (organization_id = auth_org_id() AND auth_user_role() = 'admin')
  WITH CHECK (organization_id = auth_org_id() AND auth_user_role() = 'admin');

-- ─── Collected values, with history ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_compliance_values (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  product_id            UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- A key from lib/compliance-catalog.ts, e.g. 'eudr.geolocation'.
  field_key             TEXT NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  value                 TEXT NOT NULL,
  unit                  TEXT,
  valid_from            DATE NOT NULL DEFAULT CURRENT_DATE,
  -- NULL means it does not expire.
  valid_to              DATE,
  source                TEXT NOT NULL CHECK (source IN ('survey', 'import', 'manual', 'document')),
  source_invitation_id  UUID REFERENCES supplier_survey_invitations(id) ON DELETE SET NULL,
  note                  TEXT,
  recorded_by           UUID DEFAULT auth.uid(),
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_pcv_product_field
  ON product_compliance_values(product_id, field_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcv_org ON product_compliance_values(organization_id);

ALTER TABLE product_compliance_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pcv_select_own_org" ON product_compliance_values;
CREATE POLICY "pcv_select_own_org" ON product_compliance_values
  FOR SELECT USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "pcv_insert_editor" ON product_compliance_values;
CREATE POLICY "pcv_insert_editor" ON product_compliance_values
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
    AND product_id IN (SELECT id FROM products WHERE organization_id = auth_org_id()));

-- Append-only: a correction is a new row. Survey answers are written by the
-- service role on submission (the supplier has no session), which bypasses RLS
-- and sets organization_id explicitly.
REVOKE UPDATE, DELETE ON product_compliance_values FROM authenticated;

-- ─── Which products an invitation asks about ─────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_survey_invitation_products (
  invitation_id    UUID NOT NULL REFERENCES supplier_survey_invitations(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  PRIMARY KEY (invitation_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_sip_product ON supplier_survey_invitation_products(product_id);

ALTER TABLE supplier_survey_invitation_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sip_select_own_org" ON supplier_survey_invitation_products;
CREATE POLICY "sip_select_own_org" ON supplier_survey_invitation_products
  FOR SELECT USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "sip_insert_editor" ON supplier_survey_invitation_products;
CREATE POLICY "sip_insert_editor" ON supplier_survey_invitation_products
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
    AND product_id IN (SELECT id FROM products WHERE organization_id = auth_org_id())
    AND invitation_id IN (
      SELECT i.id FROM supplier_survey_invitations i
      JOIN supplier_surveys s ON s.id = i.survey_id
      WHERE s.organization_id = auth_org_id()));

-- ─── Custom questions can fill a compliance field ────────────────────────────
ALTER TABLE supplier_survey_questions ADD COLUMN IF NOT EXISTS maps_to TEXT;

ALTER TABLE supplier_survey_questions
  DROP CONSTRAINT IF EXISTS supplier_survey_questions_maps_to_check;
ALTER TABLE supplier_survey_questions
  ADD CONSTRAINT supplier_survey_questions_maps_to_check
  CHECK (maps_to IS NULL OR maps_to ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$');

COMMENT ON COLUMN supplier_survey_questions.maps_to IS
  'Compliance field this answer fills on every product the invitation asks about (lib/compliance-catalog.ts).';
