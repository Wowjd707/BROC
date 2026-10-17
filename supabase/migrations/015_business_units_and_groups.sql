-- ============================================================
-- EHS Carbon Accounting Platform — Business Units & Site Groups
-- Migration 015
-- ============================================================
-- Two independent ways to slice the organization:
--
--   business_units  — a strict hierarchy (division → region → …), where a site
--                     has exactly ONE parent unit. This is the reporting
--                     structure: roll-ups must not double-count, so a site
--                     belongs to one branch of the tree and nowhere else.
--
--   site_groups     — arbitrary named sets, MANY-TO-MANY with sites. This is
--                     for ad-hoc analysis ("EU manufacturing", "ISO 14001
--                     sites", "2026 audit scope") where overlap is the point.
--
-- Keeping them separate is deliberate: a single overloaded "group" concept
-- would either forbid the overlap analysts need or permit double-counting in
-- the reporting hierarchy. They answer different questions.
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── Business units ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_units (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  parent_id        UUID REFERENCES business_units(id) ON DELETE SET NULL,
  name             VARCHAR(255) NOT NULL,
  code             VARCHAR(50),
  description      TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_units_org    ON business_units(organization_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_business_units_parent ON business_units(parent_id);

DROP TRIGGER IF EXISTS trg_business_units_updated_at ON business_units;
CREATE TRIGGER trg_business_units_updated_at
  BEFORE UPDATE ON business_units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A self-referencing hierarchy can be corrupted into a cycle (A→B→A), which
-- would make any recursive roll-up hang. Enforce acyclicity in the database
-- rather than trusting every future write path to check.
CREATE OR REPLACE FUNCTION prevent_business_unit_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  ancestor UUID;
  parent_org UUID;
  depth INT := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'A business unit cannot be its own parent.';
  END IF;

  -- A parent in another organization would leak structure across tenants.
  SELECT organization_id INTO parent_org FROM business_units WHERE id = NEW.parent_id;
  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'Parent business unit does not exist.';
  END IF;
  IF parent_org <> NEW.organization_id THEN
    RAISE EXCEPTION 'Parent business unit belongs to a different organization.';
  END IF;

  ancestor := NEW.parent_id;
  WHILE ancestor IS NOT NULL LOOP
    depth := depth + 1;
    IF ancestor = NEW.id THEN
      RAISE EXCEPTION 'That parent would create a cycle in the business unit hierarchy.';
    END IF;
    IF depth > 50 THEN
      RAISE EXCEPTION 'Business unit hierarchy exceeds the maximum depth of 50.';
    END IF;
    SELECT parent_id INTO ancestor FROM business_units WHERE id = ancestor;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_units_no_cycle ON business_units;
CREATE TRIGGER trg_business_units_no_cycle
  BEFORE INSERT OR UPDATE OF parent_id, organization_id ON business_units
  FOR EACH ROW EXECUTE FUNCTION prevent_business_unit_cycle();

-- ─── Site → business unit (single parent) ────────────────────────────────────
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sites_business_unit ON sites(business_unit_id);

COMMENT ON COLUMN sites.business_unit_id IS
  'The single business unit this site reports into. NULL means unassigned — surfaced in the UI rather than hidden, since unassigned sites are excluded from unit roll-ups.';

-- Migration 001 gave sites a free-text `business_unit` column. Leaving it
-- alongside the FK would mean two competing answers to the same question, so
-- promote each distinct text value to a real unit and link the sites to it.
-- The text column is retained but marked deprecated: dropping it here would
-- discard data an organization may still be reading in their own queries.
DO $$
DECLARE
  r RECORD;
  v_unit UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sites' AND column_name = 'business_unit'
  ) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT DISTINCT organization_id, business_unit
    FROM sites
    WHERE business_unit IS NOT NULL
      AND btrim(business_unit) <> ''
      AND business_unit_id IS NULL
  LOOP
    SELECT id INTO v_unit
      FROM business_units
     WHERE organization_id = r.organization_id
       AND name = btrim(r.business_unit);

    IF v_unit IS NULL THEN
      INSERT INTO business_units (organization_id, name, description)
      VALUES (r.organization_id, btrim(r.business_unit),
              'Created automatically from the legacy sites.business_unit text field.')
      RETURNING id INTO v_unit;
    END IF;

    UPDATE sites
       SET business_unit_id = v_unit
     WHERE organization_id = r.organization_id
       AND btrim(business_unit) = btrim(r.business_unit)
       AND business_unit_id IS NULL;
  END LOOP;
END $$;

COMMENT ON COLUMN sites.business_unit IS
  'DEPRECATED — superseded by business_unit_id. Values were promoted to business_units rows in migration 015.';

-- ─── Site groups (many-to-many) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_groups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  name             VARCHAR(255) NOT NULL,
  description      TEXT,
  created_by       UUID DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

DROP TRIGGER IF EXISTS trg_site_groups_updated_at ON site_groups;
CREATE TRIGGER trg_site_groups_updated_at
  BEFORE UPDATE ON site_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS site_group_members (
  group_id  UUID NOT NULL REFERENCES site_groups(id) ON DELETE CASCADE,
  site_id   UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_site_group_members_site ON site_group_members(site_id);

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE business_units     ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business_units_select_own_org" ON business_units;
CREATE POLICY "business_units_select_own_org" ON business_units
  FOR SELECT USING (organization_id = auth_org_id());
DROP POLICY IF EXISTS "business_units_insert_editor" ON business_units;
CREATE POLICY "business_units_insert_editor" ON business_units
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "business_units_update_editor" ON business_units;
CREATE POLICY "business_units_update_editor" ON business_units
  FOR UPDATE USING (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "business_units_delete_admin" ON business_units;
CREATE POLICY "business_units_delete_admin" ON business_units
  FOR DELETE USING (
    organization_id = auth_org_id() AND auth_user_role() = 'admin');

DROP POLICY IF EXISTS "site_groups_select_own_org" ON site_groups;
CREATE POLICY "site_groups_select_own_org" ON site_groups
  FOR SELECT USING (organization_id = auth_org_id());
DROP POLICY IF EXISTS "site_groups_insert_editor" ON site_groups;
CREATE POLICY "site_groups_insert_editor" ON site_groups
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "site_groups_update_editor" ON site_groups;
CREATE POLICY "site_groups_update_editor" ON site_groups
  FOR UPDATE USING (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "site_groups_delete_editor" ON site_groups;
CREATE POLICY "site_groups_delete_editor" ON site_groups
  FOR DELETE USING (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));

-- Membership rows carry no organization_id of their own; they inherit scope
-- from the group, so every policy resolves through it.
DROP POLICY IF EXISTS "site_group_members_select_own_org" ON site_group_members;
CREATE POLICY "site_group_members_select_own_org" ON site_group_members
  FOR SELECT USING (
    group_id IN (SELECT id FROM site_groups WHERE organization_id = auth_org_id()));
DROP POLICY IF EXISTS "site_group_members_insert_editor" ON site_group_members;
CREATE POLICY "site_group_members_insert_editor" ON site_group_members
  FOR INSERT WITH CHECK (
    group_id IN (SELECT id FROM site_groups WHERE organization_id = auth_org_id())
    AND site_id IN (SELECT id FROM sites WHERE organization_id = auth_org_id())
    AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "site_group_members_delete_editor" ON site_group_members;
CREATE POLICY "site_group_members_delete_editor" ON site_group_members
  FOR DELETE USING (
    group_id IN (SELECT id FROM site_groups WHERE organization_id = auth_org_id())
    AND auth_user_role() IN ('admin', 'editor'));

-- ─── Audit ───────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_business_units ON business_units;
CREATE TRIGGER trg_audit_business_units
  AFTER INSERT OR UPDATE OR DELETE ON business_units
  FOR EACH ROW EXECUTE FUNCTION record_audit();
