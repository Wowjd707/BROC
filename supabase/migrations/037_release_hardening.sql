-- ============================================================
-- BROC — Release hardening, and evidence on every figure-bearing record
-- Migration 037
-- ============================================================
-- Found in the pre-release security and correctness pass (October 2026). Each
-- section below fixes one defect, and each was reproduced against a real
-- Postgres with the migrations applied before it was fixed. Nothing here
-- changes how a reported number is calculated.
--
--   1. Deactivating a user did not remove their access.
--   2. A deactivated user could reactivate themselves.
--   3. Resetting the practice workspace failed whenever it held any data.
--   4. Changes to the consolidation boundary were not in the audit log.
--   5. SECURITY DEFINER helpers ran with a caller-controlled search_path.
--   6. Evidence could not be attached to sites, goals, projects, business
--      metric values or materiality assessments.
--
-- RE-RUNNABLE.
-- ============================================================


-- ─── 1 + 5. The helpers every policy funnels through ───────────────────────
-- `users.is_active` has existed since 001 and Settings has a "Deactivate"
-- button that sets it — but nothing read it. auth_org_id() resolved a
-- deactivated user's organization exactly as before, so every RLS policy kept
-- handing them their organization's data. Deactivation was a label.
--
-- These now resolve to NULL for an inactive profile. A NULL organization id
-- matches no row in any policy, so a deactivated user can still authenticate
-- with Supabase but reads nothing and writes nothing. The dashboard layout
-- tells them so rather than rendering an empty application.
--
-- `SET search_path` is added at the same time. A SECURITY DEFINER function
-- without one resolves unqualified names through whatever search_path the
-- caller set, which is the standard way to hijack one; Supabase's own linter
-- flags it. Bodies are otherwise unchanged from 032.

CREATE OR REPLACE FUNCTION auth_org_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(active_organization_id, organization_id)
    FROM users WHERE id = auth.uid() AND is_active
$$;

CREATE OR REPLACE FUNCTION auth_home_org_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT organization_id FROM users WHERE id = auth.uid() AND is_active
$$;

CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS VARCHAR
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM users WHERE id = auth.uid() AND is_active
$$;

ALTER FUNCTION auth_in_sandbox() SET search_path = public, pg_temp;


-- ─── 2. Who may change is_active ────────────────────────────────────────────
-- `users_update_self` lets anyone update their own row, and 032's guard
-- trigger protected organization, role and active organization — but not
-- is_active. So a deactivated user, or one about to be, could set it back to
-- true. Same treatment as role: only an administrator, and never on yourself.
-- The self rule also stops the last administrator deactivating themselves and
-- orphaning the organization.

CREATE OR REPLACE FUNCTION guard_user_row_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'A user''s organization cannot be changed.';
  END IF;

  IF NEW.active_organization_id IS NOT NULL
     AND NEW.active_organization_id IS DISTINCT FROM OLD.active_organization_id
     AND COALESCE(current_setting('broc.switching_org', true), '') <> '1' THEN
    RAISE EXCEPTION 'Use set_active_organization() to change the active organization.';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF auth.uid() IS NOT NULL AND NEW.id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot change your own role.';
    END IF;
    IF auth.uid() IS NOT NULL AND COALESCE(auth_user_role(), '') <> 'admin' THEN
      RAISE EXCEPTION 'Only an administrator can change a role.';
    END IF;
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF auth.uid() IS NOT NULL AND NEW.id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot activate or deactivate your own account.';
    END IF;
    IF auth.uid() IS NOT NULL AND COALESCE(auth_user_role(), '') <> 'admin' THEN
      RAISE EXCEPTION 'Only an administrator can activate or deactivate a user.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ─── 3 + 5. The audit trigger ───────────────────────────────────────────────
-- Deleting an organization cascades to its rows, each cascaded delete fires
-- record_audit(), and record_audit() inserts an audit_log row pointing at the
-- organization being deleted — which audit_log's foreign key refuses. The
-- whole delete rolls back.
--
-- The visible symptom was the practice workspace: "Reset" deletes the sandbox
-- organization, and a sandbox always has entries in it because seeding creates
-- them, so reset failed every time it mattered. The same fault blocked an
-- operator deprovisioning a real organization.
--
-- When the organization itself is gone there is nowhere to file the row:
-- audit_log is ON DELETE CASCADE from organizations, so it would be deleted in
-- the same statement anyway. Skipping it loses nothing that would have
-- survived.

CREATE OR REPLACE FUNCTION record_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org  UUID;
  v_body JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_org  := OLD.organization_id;
    v_body := to_jsonb(OLD);
  ELSIF TG_OP = 'INSERT' THEN
    v_org  := NEW.organization_id;
    v_body := to_jsonb(NEW);
  ELSE -- UPDATE
    v_org  := NEW.organization_id;
    v_body := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = v_org) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO audit_log (organization_id, user_id, table_name, record_id, action, changes)
  VALUES (v_org, auth.uid(), TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), LOWER(TG_OP), v_body);

  RETURN COALESCE(NEW, OLD);
END;
$$;


-- ─── 4. The consolidation boundary is auditable ─────────────────────────────
-- Migration 028 made three columns change reported totals: the organization's
-- consolidation approach, and each site's ownership_percent and is_controlled.
-- A site's ZIP code picks its Scope 2 grid factor and its floor area is an
-- intensity denominator. None of those tables was audited, so a reported
-- figure could change with no record of why — while SECURITY.md told
-- deployers that the audit log records boundary changes.

DROP TRIGGER IF EXISTS trg_audit_sites ON sites;
CREATE TRIGGER trg_audit_sites
  AFTER INSERT OR UPDATE OR DELETE ON sites
  FOR EACH ROW EXECUTE FUNCTION record_audit();

-- organizations has no organization_id column (its id is the organization),
-- so it needs its own variant. INSERT and UPDATE only: a deleted
-- organization's audit log is deleted with it, for the reason given in §3.
CREATE OR REPLACE FUNCTION record_audit_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (organization_id, user_id, table_name, record_id, action, changes)
    VALUES (NEW.id, auth.uid(), TG_TABLE_NAME, NEW.id, 'insert', to_jsonb(NEW));
  ELSIF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    INSERT INTO audit_log (organization_id, user_id, table_name, record_id, action, changes)
    VALUES (NEW.id, auth.uid(), TG_TABLE_NAME, NEW.id, 'update',
            jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW)));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_organizations ON organizations;
CREATE TRIGGER trg_audit_organizations
  AFTER INSERT OR UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION record_audit_organization();


-- ─── 6. Evidence on every record that carries a reported figure ────────────
-- Migration 019 limited attachments to six record types. The figures that
-- most need a document behind them were left out: a site's ownership share
-- (the deed or JV agreement), a project's claimed savings (the M&V report), a
-- goal's validation (an SBTi letter), a business metric used as an intensity
-- denominator (the HR or finance extract) and a materiality assessment (the
-- stakeholder engagement record). Social and governance entries already live
-- in ehs_entries, which was always attachable.
--
-- Kept in sync with EVIDENCE_RECORD_TYPES in lib/evidence-core.ts. Every table
-- added here carries organization_id and RLS, which the evidence API relies on
-- for its existence check.

ALTER TABLE evidence_attachments
  DROP CONSTRAINT IF EXISTS evidence_attachments_record_type_check;
ALTER TABLE evidence_attachments
  DROP CONSTRAINT IF EXISTS evidence_attachments_record_type_allowed;
ALTER TABLE evidence_attachments
  ADD CONSTRAINT evidence_attachments_record_type_allowed CHECK (record_type IN (
    'emission_entry', 'ehs_entry', 'scope3_entry',
    'custom_emission_factor', 'disclosure_response', 'supplier',
    'site', 'goal', 'project', 'business_metric_value', 'materiality_assessment'));
