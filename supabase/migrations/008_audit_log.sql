-- ============================================================
-- EHS Carbon Accounting Platform — Audit Log
-- Migration 008
-- ============================================================
-- Assurance-grade change history. A generic trigger records every
-- insert/update/delete on the auditable tables into audit_log, capturing
-- who (auth.uid()), when, and the before/after row image. This is
-- independent of the application code path, so a change made by any client
-- — or directly in SQL by an authenticated role — is still recorded.
--
-- The log is append-only from the application's perspective: org members
-- can read their org's history, but there are no update/delete policies.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          UUID,                 -- auth.uid(); NULL for service-role/system writes
  table_name       TEXT NOT NULL,
  record_id        UUID NOT NULL,
  action           TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changes          JSONB NOT NULL,        -- INSERT/DELETE: the row; UPDATE: {old, new}
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org_created ON audit_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_record      ON audit_log(table_name, record_id);

-- ─── Generic audit trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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

  INSERT INTO audit_log (organization_id, user_id, table_name, record_id, action, changes)
  VALUES (v_org, auth.uid(), TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), LOWER(TG_OP), v_body);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ─── Attach to auditable tables ───────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_emission_entries ON emission_entries;
CREATE TRIGGER trg_audit_emission_entries
  AFTER INSERT OR UPDATE OR DELETE ON emission_entries
  FOR EACH ROW EXECUTE FUNCTION record_audit();

DROP TRIGGER IF EXISTS trg_audit_ehs_entries ON ehs_entries;
CREATE TRIGGER trg_audit_ehs_entries
  AFTER INSERT OR UPDATE OR DELETE ON ehs_entries
  FOR EACH ROW EXECUTE FUNCTION record_audit();

DROP TRIGGER IF EXISTS trg_audit_goals ON goals;
CREATE TRIGGER trg_audit_goals
  AFTER INSERT OR UPDATE OR DELETE ON goals
  FOR EACH ROW EXECUTE FUNCTION record_audit();

DROP TRIGGER IF EXISTS trg_audit_projects ON projects;
CREATE TRIGGER trg_audit_projects
  AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION record_audit();

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Org members may read their organization's audit history. No INSERT/UPDATE/
-- DELETE policies: the trigger runs SECURITY DEFINER (bypassing RLS) to write,
-- and nothing may mutate the log through the API.
DROP POLICY IF EXISTS "audit_log_select_own_org" ON audit_log;
CREATE POLICY "audit_log_select_own_org" ON audit_log
  FOR SELECT USING (organization_id = auth_org_id());
