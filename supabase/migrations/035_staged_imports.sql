-- ============================================================
-- BROC — Staged imports with a review step and an adjustment trail
-- Migration 035
-- ============================================================
-- Importing used to be one shot: upload a CSV, and every row that validated
-- was written. Rows that failed came back as a list of line numbers, and the
-- operator fixed the spreadsheet and uploaded again.
--
-- That is survivable for a file somebody wrote by hand against the template.
-- It is not survivable for a file exported from a utility portal or an ERP,
-- where the columns nearly match and the vocabulary does not: "Diesel Fuel"
-- instead of diesel, a site called "Plant 3 (Toledo)", a scope column that is
-- blank because the source system has no concept of scope. Those rows are not
-- wrong, they are unmapped, and the one-shot importer has nowhere to put them
-- except an error list.
--
-- So an upload now lands in a batch that nobody has committed yet:
--
--     import_batches        one upload, owned by whoever uploaded it
--       └── import_batch_rows      one line, as received and as resolved
--             └── import_row_adjustments   every change, and who made it
--
-- ─── Why the adjustment trail is a table and not audit_log ───────────────────
--
-- audit_log (008) already records the INSERT when a row is finally committed,
-- with the user and the full row. What it cannot record is the part an
-- assurance provider actually asks about: the file said scope2, the system
-- proposed scope1, and a named person chose scope1 on a given date. By the time
-- audit_log sees an entry, those three facts have collapsed into one value.
--
-- Keeping `raw` immutable alongside `resolved` is what makes that question
-- answerable. `raw` is the bytes as received, never updated after insert;
-- `resolved` is what the row currently says. The difference between them is
-- always explained by the adjustment rows, and that invariant is the point of
-- the whole design.
--
-- ─── On the Scope 3 hazard ───────────────────────────────────────────────────
--
-- lib/import-cascade-core.ts will suggest Scope 1 for a combustion fuel and
-- flag it as needing confirmation, because fuel burned on your behalf by a
-- third party is Scope 3 and must not enter a Scope 1+2 total. `origin` exists
-- so that a value which was never confirmed by a human is distinguishable
-- afterwards. A machine-set scope that nobody looked at is a different kind of
-- number from one a person approved, and a reviewer should be able to find all
-- of them later.
--
-- RE-RUNNABLE.
-- ============================================================


-- ─── PART 1. The batch ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS import_batches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Which entry family this file is destined for. Chosen by the operator at
  -- upload, because no file reliably says: an export named "utilities.csv"
  -- could be electricity or water, and guessing wrong silently files a water
  -- reading as an emission.
  family           VARCHAR(20) NOT NULL CHECK (family IN (
                     'emissions', 'water', 'waste', 'social', 'governance')),

  filename         TEXT,

  -- draft      — staged, nothing written to the entry tables yet
  -- committed  — rows written; the batch is now a historical record
  -- discarded  — abandoned; kept, because "we uploaded it and backed out" is
  --              itself worth being able to show
  status           VARCHAR(20) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'committed', 'discarded')),

  row_count        INTEGER NOT NULL DEFAULT 0,
  committed_count  INTEGER NOT NULL DEFAULT 0,

  uploaded_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at     TIMESTAMPTZ
);

DO $$
BEGIN
  -- A committed batch must say when. Without this, a batch could be marked
  -- committed by a partial failure and carry no timestamp, and the reporting
  -- question "what was loaded in Q3" would quietly miss it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batches_committed_at') THEN
    ALTER TABLE import_batches ADD CONSTRAINT import_batches_committed_at
      CHECK (status <> 'committed' OR committed_at IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_import_batches_org
  ON import_batches(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_draft
  ON import_batches(organization_id, created_at DESC) WHERE status = 'draft';

COMMENT ON TABLE import_batches IS
  'One uploaded file, staged for review. Nothing reaches the entry tables until the batch is committed, so an operator can correct vocabulary mismatches in place rather than re-exporting from the source system.';
COMMENT ON COLUMN import_batches.status IS
  'draft = staged only. committed = rows written. discarded = abandoned but retained, because an upload that was backed out is itself a fact worth keeping.';


-- ─── PART 2. The staged row ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS import_batch_rows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,

  -- Denormalized from the batch so the RLS policy is a column comparison
  -- rather than a subquery on every row of a thousand-row file. audit_log
  -- carries organization_id for the same reason. Set from the parent at
  -- insert; nothing updates it afterwards.
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- 1-based, excluding the header, so it matches what the operator sees in
  -- their spreadsheet when they go looking for the row being complained about.
  line_number      INTEGER NOT NULL,

  -- The file as received. NEVER updated after insert. This is the anchor the
  -- whole audit trail hangs from: `resolved` minus `raw` must always be
  -- explained by this row's adjustments.
  raw              JSONB NOT NULL,

  -- What the row currently says, after the cascade and any human edits.
  resolved         JSONB NOT NULL,

  -- needs_review — a proposed value is unconfirmed, or a field is missing
  -- valid        — would commit cleanly right now
  -- error        — cannot commit; `error` says why
  -- committed    — written; created_entry_id points at the result
  -- skipped      — deliberately excluded by the reviewer
  status           VARCHAR(20) NOT NULL DEFAULT 'needs_review'
                   CHECK (status IN ('needs_review', 'valid', 'error', 'committed', 'skipped')),
  error            TEXT,

  created_entry_id    UUID,
  -- Which table the entry landed in. Not a foreign key: emissions and the
  -- non-carbon families live in different tables, and a single FK cannot point
  -- at both. verify_install.sql checks these resolve.
  created_entry_table VARCHAR(40),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (batch_id, line_number)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batch_rows_error_text') THEN
    ALTER TABLE import_batch_rows ADD CONSTRAINT import_batch_rows_error_text
      CHECK (status <> 'error' OR (error IS NOT NULL AND length(btrim(error)) > 0));
  END IF;

  -- A committed row must say what it became, or the lineage this table exists
  -- to provide has a hole in exactly the rows that matter.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batch_rows_committed_target') THEN
    ALTER TABLE import_batch_rows ADD CONSTRAINT import_batch_rows_committed_target
      CHECK (status <> 'committed'
             OR (created_entry_id IS NOT NULL AND created_entry_table IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_batch_rows_entry_table') THEN
    ALTER TABLE import_batch_rows ADD CONSTRAINT import_batch_rows_entry_table
      CHECK (created_entry_table IS NULL
             OR created_entry_table IN ('emission_entries', 'ehs_entries'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_import_batch_rows_batch
  ON import_batch_rows(batch_id, line_number);
CREATE INDEX IF NOT EXISTS idx_import_batch_rows_review
  ON import_batch_rows(batch_id) WHERE status IN ('needs_review', 'error');
CREATE INDEX IF NOT EXISTS idx_import_batch_rows_entry
  ON import_batch_rows(created_entry_table, created_entry_id)
  WHERE created_entry_id IS NOT NULL;

COMMENT ON COLUMN import_batch_rows.raw IS
  'The file as received, never updated. resolved minus raw is always explained by this row''s adjustments — that invariant is what makes the trail auditable.';
COMMENT ON COLUMN import_batch_rows.created_entry_table IS
  'Which entry table the committed row landed in. Deliberately not an FK: emissions and non-carbon entries live in different tables and one column cannot reference both.';


-- ─── PART 3. The adjustment trail ────────────────────────────────────────────
-- Append-only. There is a SELECT policy and an INSERT policy and deliberately
-- no UPDATE or DELETE, for the same reason audit_log has none: a correction
-- record that can be corrected is not a record.

CREATE TABLE IF NOT EXISTS import_row_adjustments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id           UUID NOT NULL REFERENCES import_batch_rows(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- The resolved-object key that changed, e.g. 'scope', 'scope1Category'.
  field            VARCHAR(60) NOT NULL,
  old_value        TEXT,
  new_value        TEXT,

  -- auto — proposed by the cascade, not yet judged by a person
  -- user — a named human chose this value
  --
  -- The distinction is the point. A scope the machine set and nobody confirmed
  -- is a different kind of number from one a person approved, and after the
  -- fact there is otherwise no way to tell them apart.
  origin           VARCHAR(10) NOT NULL CHECK (origin IN ('auto', 'user')),

  -- Why, in the words shown to the reviewer at the time. Stored rather than
  -- recomputed: the rule may be edited later, and this has to remain what the
  -- person was actually told.
  reason           TEXT,

  adjusted_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  adjusted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  -- A human change must name the human. Without this the table would accept an
  -- anonymous 'user' row, which answers "what changed" while silently losing
  -- "who" — the half an assurance provider cares about most.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_row_adjustments_user_named') THEN
    ALTER TABLE import_row_adjustments ADD CONSTRAINT import_row_adjustments_user_named
      CHECK (origin <> 'user' OR adjusted_by IS NOT NULL);
  END IF;

  -- A no-op is not an adjustment, and a trail full of them hides the real ones.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_row_adjustments_changes_something') THEN
    ALTER TABLE import_row_adjustments ADD CONSTRAINT import_row_adjustments_changes_something
      CHECK (old_value IS DISTINCT FROM new_value);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_import_row_adjustments_row
  ON import_row_adjustments(row_id, adjusted_at);
CREATE INDEX IF NOT EXISTS idx_import_row_adjustments_unconfirmed
  ON import_row_adjustments(organization_id, adjusted_at DESC) WHERE origin = 'auto';

COMMENT ON TABLE import_row_adjustments IS
  'Every change made to a staged row between upload and commit, with who made it and why. Append-only. audit_log records the resulting INSERT; this records the decision that produced it.';
COMMENT ON COLUMN import_row_adjustments.origin IS
  'auto = proposed by the cascade and not confirmed by anyone. user = a named person chose it. Keeping these apart is what lets a reviewer find every machine-set value later.';


-- ─── PART 4. RLS ─────────────────────────────────────────────────────────────
-- Tenant data, scoped by organization_id like every other tenant table.
-- auth_org_id() resolves the active organization, so a user in practice mode
-- stages into the sandbox rather than into live data — no extra handling
-- needed here, which is the whole reason 032 routed everything through it.

ALTER TABLE import_batches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batch_rows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_row_adjustments  ENABLE ROW LEVEL SECURITY;

-- Batches: full lifecycle within your own organization.
DROP POLICY IF EXISTS "import_batches_select_own_org" ON import_batches;
CREATE POLICY "import_batches_select_own_org" ON import_batches
  FOR SELECT TO authenticated USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "import_batches_insert_own_org" ON import_batches;
CREATE POLICY "import_batches_insert_own_org" ON import_batches
  FOR INSERT TO authenticated WITH CHECK (organization_id = auth_org_id());

-- WITH CHECK as well as USING, deliberately. USING alone gates which rows may
-- be touched, not what they may be set to, so without this a user could move a
-- batch into another organization by updating organization_id — the same shape
-- of hole 032 fixed in users_update_self.
DROP POLICY IF EXISTS "import_batches_update_own_org" ON import_batches;
CREATE POLICY "import_batches_update_own_org" ON import_batches
  FOR UPDATE TO authenticated
  USING (organization_id = auth_org_id())
  WITH CHECK (organization_id = auth_org_id());

DROP POLICY IF EXISTS "import_batches_delete_own_org" ON import_batches;
CREATE POLICY "import_batches_delete_own_org" ON import_batches
  FOR DELETE TO authenticated USING (organization_id = auth_org_id());

-- Rows: same scoping. Editing a staged row is the normal activity here.
DROP POLICY IF EXISTS "import_batch_rows_select_own_org" ON import_batch_rows;
CREATE POLICY "import_batch_rows_select_own_org" ON import_batch_rows
  FOR SELECT TO authenticated USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "import_batch_rows_insert_own_org" ON import_batch_rows;
CREATE POLICY "import_batch_rows_insert_own_org" ON import_batch_rows
  FOR INSERT TO authenticated WITH CHECK (organization_id = auth_org_id());

DROP POLICY IF EXISTS "import_batch_rows_update_own_org" ON import_batch_rows;
CREATE POLICY "import_batch_rows_update_own_org" ON import_batch_rows
  FOR UPDATE TO authenticated
  USING (organization_id = auth_org_id())
  WITH CHECK (organization_id = auth_org_id());

DROP POLICY IF EXISTS "import_batch_rows_delete_own_org" ON import_batch_rows;
CREATE POLICY "import_batch_rows_delete_own_org" ON import_batch_rows
  FOR DELETE TO authenticated USING (organization_id = auth_org_id());

-- Adjustments: readable and insertable, never updatable or deletable.
-- Omitting those two policies is the enforcement — with RLS enabled and no
-- policy for a command, that command matches no rows.
DROP POLICY IF EXISTS "import_row_adjustments_select_own_org" ON import_row_adjustments;
CREATE POLICY "import_row_adjustments_select_own_org" ON import_row_adjustments
  FOR SELECT TO authenticated USING (organization_id = auth_org_id());

DROP POLICY IF EXISTS "import_row_adjustments_insert_own_org" ON import_row_adjustments;
CREATE POLICY "import_row_adjustments_insert_own_org" ON import_row_adjustments
  FOR INSERT TO authenticated WITH CHECK (organization_id = auth_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON import_batches, import_batch_rows TO authenticated;
GRANT SELECT, INSERT ON import_row_adjustments TO authenticated;
