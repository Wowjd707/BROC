-- ============================================================
-- BROC — A record of every entry checked against its document
-- Migration 042
-- ============================================================
-- Data Review can ask the configured AI model to read the bill or invoice
-- attached to an entry, and the platform then compares what the document says
-- with what was entered (lib/evidence-check-core.ts). An assurance provider
-- sampling entries wants to know which were checked, when, by whom, against
-- which file, and what was found — so every check is kept.
--
-- Append-only. There is no UPDATE or DELETE policy: a check that turned out to
-- be wrong is answered by checking again, and both rows stay. The entry
-- snapshot records what was entered AT THE TIME, so a later correction to the
-- entry does not make an old "differs from document" row look like a false
-- alarm.
--
-- The model's reading is stored as it was parsed, beside the comparison the
-- platform made from it, so anyone can see both what the document was read as
-- saying and how the match was decided.
--
-- RE-RUNNABLE.
-- ============================================================

CREATE TABLE IF NOT EXISTS evidence_checks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),

  -- The entry checked. Polymorphic like evidence_attachments; only the two
  -- activity-data tables are checked today.
  record_type      TEXT NOT NULL CHECK (record_type IN ('emission_entry', 'ehs_entry')),
  record_id        UUID NOT NULL,

  -- The file read. Kept by name as well, because evidence can be removed (that
  -- removal is itself audited) and the check should still say what it read.
  attachment_id    UUID REFERENCES evidence_attachments(id) ON DELETE SET NULL,
  file_name        TEXT NOT NULL,

  outcome          TEXT NOT NULL CHECK (outcome IN ('match', 'mismatch', 'unit_slip', 'needs_review', 'unreadable')),
  summary          TEXT NOT NULL,

  -- {quantity, unit, entry_date} as entered when checked.
  entry_snapshot   JSONB NOT NULL,
  -- The model's reading, after sanitising (lib/ai/tasks.ts parseDocumentReading).
  document_reading JSONB NOT NULL,
  -- The platform's comparison (lib/evidence-check-core.ts compareEvidence).
  comparison       JSONB NOT NULL,

  provider         TEXT NOT NULL,
  model            TEXT NOT NULL,
  checked_by       UUID DEFAULT auth.uid(),
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE evidence_checks IS
  'Append-only record of entries checked against their supporting documents. A model reads the document; the platform compares. See lib/evidence-check-core.ts.';

CREATE INDEX IF NOT EXISTS idx_evidence_checks_record
  ON evidence_checks(organization_id, record_type, record_id, checked_at DESC);

ALTER TABLE evidence_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evidence_checks_select_own_org" ON evidence_checks;
CREATE POLICY "evidence_checks_select_own_org" ON evidence_checks
  FOR SELECT USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "evidence_checks_insert_editor" ON evidence_checks;
CREATE POLICY "evidence_checks_insert_editor" ON evidence_checks
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id()
    AND auth_user_role() IN ('admin', 'editor')
    AND checked_by = auth.uid());

-- No UPDATE or DELETE policy, and no grant either: belt and braces for
-- append-only, the same way evidence_attachments locks its identity columns.
REVOKE UPDATE, DELETE ON evidence_checks FROM authenticated;
