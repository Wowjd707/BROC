-- ============================================================
-- BROC — PFAS declarations per part
-- Migration 048
-- ============================================================
-- PFAS rules come from several regimes that change often: Minnesota's
-- reporting and 2032 prohibition (Minn. Stat. § 116.943), Maine's 2032
-- prohibition (38 M.R.S. § 1614), US federal reporting under TSCA section
-- 8(a)(7) (40 CFR part 705), and in the EU the PFAS limits for food-contact
-- packaging (Regulation (EU) 2025/40, Art. 5(5), handled with packaging in
-- 047) and a universal restriction that is still a proposal.
--
-- They all need the same facts about a part, so those are what is stored
-- here; which regime they trigger is worked out in lib/pfas-core.ts, where
-- each rule carries its citation and the date it was last verified.
--
--   pfas_declarations  — one per part: whether it contains intentionally
--                        added PFAS, on what basis and evidence, when it was
--                        declared, and the markets the part is sold into
--   pfas_substances    — for a part that does: each substance, its CAS number,
--                        what it does, where it is, and how much
--
-- "Unknown" is a status of its own: a part with no answer is never reported as
-- PFAS-free.
--
-- RE-RUNNABLE.
-- ============================================================

CREATE TABLE IF NOT EXISTS pfas_declarations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE NO ACTION,
  status            TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'none', 'intentionally_added')),
  basis             TEXT CHECK (basis IN ('supplier_declaration', 'test_report', 'engineering_assessment', 'other')),
  -- The declaration, report or assessment relied on. Required for any answer
  -- other than unknown: an unsupported "no PFAS" is not an answer.
  evidence          TEXT,
  declared_on       DATE,
  supplier_id       UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  -- Where the part is sold, offered or distributed: ISO 3166-1 alpha-2 (DE)
  -- or ISO 3166-2 (US-MN). Drives which regime applies.
  markets           TEXT[] NOT NULL DEFAULT '{}',
  product_category  TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, product_id),
  CONSTRAINT pfas_declarations_answer_supported CHECK (
    status = 'unknown' OR (basis IS NOT NULL AND evidence IS NOT NULL AND btrim(evidence) <> '' AND declared_on IS NOT NULL)
  ),
  CONSTRAINT pfas_declarations_markets_shape CHECK (
    array_to_string(markets, ',') ~ '^([A-Z]{2}(-[A-Z0-9]{1,3})?(,[A-Z]{2}(-[A-Z0-9]{1,3})?)*)?$'
  )
);

CREATE TABLE IF NOT EXISTS pfas_substances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  declaration_id    UUID NOT NULL REFERENCES pfas_declarations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- Format here; the check digit is verified in lib/pfas-core.ts.
  cas_number        TEXT CHECK (cas_number IS NULL OR cas_number ~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$'),
  function          TEXT,
  component         TEXT,
  -- An exact amount (low = high) or a range, as reporting forms allow.
  amount_low        NUMERIC(18, 6) CHECK (amount_low IS NULL OR amount_low >= 0),
  amount_high       NUMERIC(18, 6) CHECK (amount_high IS NULL OR amount_high >= 0),
  amount_unit       TEXT CHECK (amount_unit IN ('ppm', 'percent', 'mg_per_unit')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pfas_substances_amount_shape CHECK (
    (amount_low IS NULL AND amount_high IS NULL) OR
    (amount_unit IS NOT NULL AND (amount_low IS NULL OR amount_high IS NULL OR amount_low <= amount_high))
  )
);
CREATE INDEX IF NOT EXISTS idx_pfas_substances_declaration ON pfas_substances(declaration_id);

-- ─── Triggers ────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pfas_declarations', 'pfas_substances'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$s FOR EACH ROW EXECUTE FUNCTION record_audit()', t);
  END LOOP;
END $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pfas_declarations', 'pfas_substances'] LOOP
    EXECUTE format('ALTER TABLE %1$s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select_own_org" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s_select_own_org" ON %1$s FOR SELECT USING (organization_id = auth_org_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_insert_editor" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s_insert_editor" ON %1$s FOR INSERT WITH CHECK (organization_id = auth_org_id() AND auth_user_role() IN (''admin'', ''editor''))', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_update_editor" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s_update_editor" ON %1$s FOR UPDATE USING (organization_id = auth_org_id() AND auth_user_role() IN (''admin'', ''editor'')) WITH CHECK (organization_id = auth_org_id())', t);
    -- Substances are edited as part of their declaration, so editors may
    -- remove one; a whole declaration is removed only by an admin.
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_delete_admin" ON %1$s', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "pfas_declarations_delete_admin" ON pfas_declarations;
CREATE POLICY "pfas_declarations_delete_admin" ON pfas_declarations
  FOR DELETE USING (organization_id = auth_org_id() AND auth_user_role() = 'admin');
DROP POLICY IF EXISTS "pfas_substances_delete_editor" ON pfas_substances;
CREATE POLICY "pfas_substances_delete_editor" ON pfas_substances
  FOR DELETE USING (organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));

-- References only to this organization's own rows.
DROP POLICY IF EXISTS "pfas_declarations_refs_own_org" ON pfas_declarations;
CREATE POLICY "pfas_declarations_refs_own_org" ON pfas_declarations AS RESTRICTIVE
  FOR INSERT WITH CHECK (
    product_id IN (SELECT id FROM products WHERE organization_id = auth_org_id())
    AND (supplier_id IS NULL OR supplier_id IN (SELECT id FROM suppliers WHERE organization_id = auth_org_id())));
DROP POLICY IF EXISTS "pfas_declarations_refs_own_org_update" ON pfas_declarations;
CREATE POLICY "pfas_declarations_refs_own_org_update" ON pfas_declarations AS RESTRICTIVE
  FOR UPDATE USING (TRUE) WITH CHECK (
    product_id IN (SELECT id FROM products WHERE organization_id = auth_org_id())
    AND (supplier_id IS NULL OR supplier_id IN (SELECT id FROM suppliers WHERE organization_id = auth_org_id())));
DROP POLICY IF EXISTS "pfas_substances_refs_own_org" ON pfas_substances;
CREATE POLICY "pfas_substances_refs_own_org" ON pfas_substances AS RESTRICTIVE
  FOR INSERT WITH CHECK (declaration_id IN (SELECT id FROM pfas_declarations WHERE organization_id = auth_org_id()));
DROP POLICY IF EXISTS "pfas_substances_refs_own_org_update" ON pfas_substances;
CREATE POLICY "pfas_substances_refs_own_org_update" ON pfas_substances AS RESTRICTIVE
  FOR UPDATE USING (TRUE) WITH CHECK (declaration_id IN (SELECT id FROM pfas_declarations WHERE organization_id = auth_org_id()));

-- ─── Capability map ──────────────────────────────────────────────────────────
-- A per-part PFAS record serves each PFAS regime the tracker follows.
INSERT INTO regulatory_capabilities
  (item_code, capability_key, label, description, route, probe, probe_arg, necessity, display_order)
SELECT r.code, 'pfas_declarations', 'PFAS declarations per part',
       'Whether each part contains intentionally added PFAS, the substances with CAS numbers, the evidence, and the markets it is sold into; the PFAS dashboard shows which parts each regime touches.',
       '/products/pfas', 'pfas_declarations', NULL, 'required', 5
FROM regulatory_items r
WHERE r.code IN ('EPA-PFAS-TSCA', 'EU-PFAS')
ON CONFLICT (item_code, capability_key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, route = EXCLUDED.route,
  probe = EXCLUDED.probe, probe_arg = EXCLUDED.probe_arg, necessity = EXCLUDED.necessity,
  display_order = EXCLUDED.display_order;
