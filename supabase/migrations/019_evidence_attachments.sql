-- ============================================================
-- EHS Carbon Accounting Platform — Evidence Attachments
-- Migration 019
-- ============================================================
-- Auditability is the platform's central claim: every reported number traces to
-- its source input, factor, and calculation. Until now the *source document*
-- behind that input — the utility bill, the fuel invoice, the supplier
-- certificate — lived outside the system. An assurance provider asking "show me
-- the invoice" had no answer here.
--
--   evidence_attachments — file metadata, attached polymorphically to any
--                          record type that can carry evidence
--   storage bucket        — the bytes, private, org-scoped by path prefix
--
-- Polymorphic by (record_type, record_id) with no foreign key, the same shape
-- audit_log uses: one attachment mechanism serves entries, factors, disclosures
-- and suppliers rather than six near-identical tables. The API verifies the
-- target exists in the caller's org before writing a row, since the database
-- cannot.
--
-- RE-RUNNABLE.
-- ============================================================

CREATE TABLE IF NOT EXISTS evidence_attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),

  -- What this evidences. Kept in sync with EVIDENCE_RECORD_TYPES in
  -- lib/evidence-core.ts; the API rejects anything not on that list.
  record_type      TEXT NOT NULL CHECK (record_type IN (
                     'emission_entry', 'ehs_entry', 'scope3_entry',
                     'custom_emission_factor', 'disclosure_response', 'supplier')),
  record_id        UUID NOT NULL,

  -- Path within the private 'evidence' bucket. UNIQUE so two rows can never
  -- claim the same object: deleting one would otherwise silently break the
  -- other's download while still showing it as attached.
  storage_path     TEXT NOT NULL UNIQUE,
  file_name        TEXT NOT NULL,           -- original name, for display
  content_type     TEXT,
  size_bytes       BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  description      TEXT,

  uploaded_by      UUID DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_attachments_record
  ON evidence_attachments(organization_id, record_type, record_id);

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE evidence_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evidence_select_own_org" ON evidence_attachments;
CREATE POLICY "evidence_select_own_org" ON evidence_attachments
  FOR SELECT USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "evidence_insert_editor" ON evidence_attachments;
CREATE POLICY "evidence_insert_editor" ON evidence_attachments
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "evidence_update_editor" ON evidence_attachments;
CREATE POLICY "evidence_update_editor" ON evidence_attachments
  FOR UPDATE USING (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "evidence_delete_editor" ON evidence_attachments;
CREATE POLICY "evidence_delete_editor" ON evidence_attachments
  FOR DELETE USING (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));

-- An attachment's IDENTITY is immutable: which file, where it lives, how big it
-- is, who uploaded it. Only the human description may be corrected. RLS cannot
-- express "these columns only", so this is a column-level grant — an UPDATE
-- touching anything else fails outright rather than quietly rewriting what a
-- filed report cited. Replacing evidence means delete + re-upload, which leaves
-- both events in audit_log.
REVOKE UPDATE ON evidence_attachments FROM authenticated;
GRANT UPDATE (description) ON evidence_attachments TO authenticated;

-- Removing evidence is exactly the act that most needs a trace, so the row
-- image (including storage_path and who uploaded it) lands in audit_log on
-- delete. Evidence cannot be made to disappear without a record that it existed.
DROP TRIGGER IF EXISTS trg_audit_evidence_attachments ON evidence_attachments;
CREATE TRIGGER trg_audit_evidence_attachments
  AFTER INSERT OR UPDATE OR DELETE ON evidence_attachments
  FOR EACH ROW EXECUTE FUNCTION record_audit();

-- ============================================================
-- STORAGE
-- ============================================================
-- Created here rather than by hand in the dashboard so a fresh deployment is
-- reproducible from the migrations alone — the same reason everything else in
-- this directory exists.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidence',
  'evidence',
  FALSE,                    -- private: reads go through a short-lived signed URL
  26214400,                 -- 25 MiB; a scanned invoice, not a video
  ARRAY[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic',
    'text/csv', 'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::TEXT[]
)
ON CONFLICT (id) DO NOTHING;

-- Objects are laid out as:  {organization_id}/{record_type}/{record_id}/{uuid}-{file}
-- The organization id leads so tenant isolation is a prefix comparison the
-- storage layer can enforce directly, exactly as auth_org_id() scopes every
-- other table. Functions are schema-qualified because storage RLS does not run
-- with public on the search path.
DROP POLICY IF EXISTS "evidence_objects_read_own_org" ON storage.objects;
CREATE POLICY "evidence_objects_read_own_org" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'evidence'
    AND (storage.foldername(name))[1] = public.auth_org_id()::TEXT
  );

DROP POLICY IF EXISTS "evidence_objects_insert_editor" ON storage.objects;
CREATE POLICY "evidence_objects_insert_editor" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'evidence'
    AND (storage.foldername(name))[1] = public.auth_org_id()::TEXT
    AND public.auth_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "evidence_objects_delete_editor" ON storage.objects;
CREATE POLICY "evidence_objects_delete_editor" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'evidence'
    AND (storage.foldername(name))[1] = public.auth_org_id()::TEXT
    AND public.auth_user_role() IN ('admin', 'editor')
  );

-- Deliberately NO update policy. Overwriting an object in place would leave the
-- attachment row — file name, size, uploader, timestamp — describing bytes that
-- are no longer there, and nothing would record the substitution. That is the
-- one change an evidence store must not permit silently.
