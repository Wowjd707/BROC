-- ============================================================
-- Regulatory Watch
-- Migration 025
-- ============================================================
-- Keeping the tracker current is the module's real cost. Re-reading twenty-one
-- source pages every month to find that nineteen are unchanged is exactly the
-- work nobody sustains, and an abandoned tracker is worse than no tracker: it
-- hands a reader a stale date wearing a confidence badge.
--
-- So this automates the part that is genuinely mechanical — noticing that a
-- page changed — and automates none of the part that is judgement.
--
--   regulatory_source_snapshots - what each source page looked like last time
--   regulatory_watch_runs       - one execution, and what it found
--   regulatory_change_proposals - a review queue. NOT applied changes.
--
-- ─── The line this migration exists to hold ─────────────────────────────────
--
-- `lib/ai/tasks.ts` states the rule the whole AI layer is built on: a model is
-- "never asked to recall a figure, an emission factor, or what a standard
-- requires", because "a model's recollection of them would be exactly the
-- fabricated regulatory content the project forbids".
--
-- An agent that woke on a timer and wrote regulatory status into
-- `regulatory_items` would invert that rule completely. This schema makes that
-- impossible rather than merely discouraged:
--
--   1. Change DETECTION is deterministic. A content hash is compared against
--      the last snapshot. No model is involved, and when nothing changed no
--      model is called at all — which is also why this is nearly free to run.
--   2. A model is only ever asked to SUMMARISE a diff it was handed, with the
--      fetched text supplied as data. It is never asked what the regulation
--      now says.
--   3. Nothing reaches `regulatory_items` without a human approving it. There
--      is no code path from a proposal to the tracker that does not pass
--      through a person.
--   4. A proposal may not touch `confidence`, `last_verified` or `sources`.
--      Those are the human's signature on the entry. On approval the reviewer
--      states the confidence themselves and `last_verified` is stamped with
--      the approval date - so the freshness signal keeps meaning "a person
--      checked this", which is the only thing that makes it worth showing.
--
-- The honest summary: this turns a two-hour monthly chore into a twenty-minute
-- review, and it does not remove the reviewer.
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── 1. What each source looked like last time ───────────────────────────────

CREATE TABLE IF NOT EXISTS regulatory_source_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code      VARCHAR(40) NOT NULL REFERENCES regulatory_items(code) ON DELETE CASCADE,
  source_url     TEXT NOT NULL,

  -- Hash of the NORMALISED text (see lib/regulatory-watch-core.ts). Raw HTML
  -- changes on every request on many government sites - session ids, rotating
  -- banners, build stamps - so hashing raw bytes would report a change every
  -- single run and train the reviewer to ignore the queue.
  content_hash   TEXT NOT NULL,
  content_length INTEGER NOT NULL DEFAULT 0,

  -- A bounded excerpt, kept so a later run can show a real before/after
  -- without re-fetching a page that may since have moved again.
  excerpt        TEXT,

  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_code, source_url)
);

CREATE INDEX IF NOT EXISTS idx_reg_snapshots_item ON regulatory_source_snapshots(item_code);

COMMENT ON TABLE regulatory_source_snapshots IS
  'Last-seen state of each tracked source URL. Detection compares a hash of normalised text, never raw HTML, so rotating banners and session ids do not read as regulatory change.';

-- ─── 2. One execution of the watch ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regulatory_watch_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at        TIMESTAMPTZ,
  status             VARCHAR(20) NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running', 'complete', 'failed')),

  sources_checked    INTEGER NOT NULL DEFAULT 0,
  sources_changed    INTEGER NOT NULL DEFAULT 0,
  -- Tracked as a first-class outcome, not swallowed. Several of the sources in
  -- the seed genuinely resist automated fetching: ECHA returns 403 and EUR-Lex
  -- serves metadata rather than article text. A run that silently reported
  -- "no changes" for a page it could not read would be actively misleading.
  sources_failed     INTEGER NOT NULL DEFAULT 0,
  proposals_created  INTEGER NOT NULL DEFAULT 0,

  ai_used            BOOLEAN NOT NULL DEFAULT FALSE,
  ai_provider        TEXT,
  ai_model           TEXT,

  triggered_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  trigger_kind       VARCHAR(20) NOT NULL DEFAULT 'manual'
                     CHECK (trigger_kind IN ('manual', 'scheduled')),
  error              TEXT
);

CREATE INDEX IF NOT EXISTS idx_reg_watch_runs_started ON regulatory_watch_runs(started_at DESC);

COMMENT ON COLUMN regulatory_watch_runs.sources_failed IS
  'Sources that could not be fetched. Surfaced rather than swallowed: a page we could not read is not a page that did not change.';

-- ─── 3. The review queue ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regulatory_change_proposals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES regulatory_watch_runs(id) ON DELETE CASCADE,
  item_code         VARCHAR(40) NOT NULL REFERENCES regulatory_items(code) ON DELETE CASCADE,
  source_url        TEXT NOT NULL,

  change_kind       VARCHAR(20) NOT NULL
                    CHECK (change_kind IN ('first_seen', 'changed', 'fetch_failed')),

  -- Produced by deterministic diffing. Always present, and always the thing a
  -- reviewer should read first, because it is the only part no model touched.
  detected_summary  TEXT NOT NULL,
  diff_excerpt      TEXT,

  -- Optional. Null when the AI layer is off, which is the default: the queue
  -- is fully usable with no model configured, just with more reading.
  ai_summary        TEXT,
  ai_provider       TEXT,
  ai_model          TEXT,
  -- Figures the model wrote that do not appear in the text it was given. Shown
  -- to the reviewer as "check these", never as errors - see lib/ai/grounding.ts.
  ai_ungrounded     JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- A suggested edit to regulatory_items, for the reviewer to accept or amend.
  -- Constrained by lib/regulatory-watch-core.ts to a fixed set of fields:
  -- confidence, last_verified and sources are NOT among them.
  proposed_patch    JSONB NOT NULL DEFAULT '{}'::jsonb,

  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  review_note       TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reg_proposals_pending
  ON regulatory_change_proposals(created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_reg_proposals_item
  ON regulatory_change_proposals(item_code, created_at DESC);

DO $$
BEGIN
  -- A reviewed proposal must say who reviewed it and when. Without this an
  -- approval leaves no trace of the human it depended on, and the entire
  -- point of the design is that a human was there.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reg_proposals_review_complete') THEN
    ALTER TABLE regulatory_change_proposals ADD CONSTRAINT reg_proposals_review_complete
      CHECK (
        status = 'pending'
        OR status = 'superseded'
        OR (reviewed_at IS NOT NULL)
      );
  END IF;

  -- A patch may never carry the reviewer's own signature fields.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reg_proposals_patch_scope') THEN
    ALTER TABLE regulatory_change_proposals ADD CONSTRAINT reg_proposals_patch_scope
      CHECK (
        jsonb_typeof(proposed_patch) = 'object'
        AND NOT (proposed_patch ? 'confidence')
        AND NOT (proposed_patch ? 'last_verified')
        AND NOT (proposed_patch ? 'sources')
        AND NOT (proposed_patch ? 'code')
      );
  END IF;
END $$;

COMMENT ON TABLE regulatory_change_proposals IS
  'Review queue. Rows here are SUGGESTIONS and are never applied automatically; approving one is what writes to regulatory_items, and the reviewer states the confidence themselves.';
COMMENT ON COLUMN regulatory_change_proposals.proposed_patch IS
  'Suggested edit to regulatory_items. A CHECK constraint forbids confidence, last_verified, sources and code - those are the reviewer''s signature, not the model''s output.';
COMMENT ON COLUMN regulatory_change_proposals.ai_ungrounded IS
  'Figures in ai_summary absent from the fetched text. A prompt to verify, not a fabrication detector: a correctly derived figure also lands here.';

-- ─── 4. RLS ──────────────────────────────────────────────────────────────────
-- These are reference-layer tables like regulatory_items: every authenticated
-- user may read them, and writes go through the service role from an API route
-- that has already checked the caller is an admin. Same posture as 013 and 024.

ALTER TABLE regulatory_source_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_watch_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_change_proposals  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reg_snapshots_read_authenticated" ON regulatory_source_snapshots;
CREATE POLICY "reg_snapshots_read_authenticated" ON regulatory_source_snapshots
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "reg_watch_runs_read_authenticated" ON regulatory_watch_runs;
CREATE POLICY "reg_watch_runs_read_authenticated" ON regulatory_watch_runs
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "reg_proposals_read_authenticated" ON regulatory_change_proposals;
CREATE POLICY "reg_proposals_read_authenticated" ON regulatory_change_proposals
  FOR SELECT TO authenticated USING (TRUE);

GRANT SELECT ON regulatory_source_snapshots, regulatory_watch_runs, regulatory_change_proposals
  TO authenticated;
-- No INSERT/UPDATE/DELETE policies: service role or migration only.

-- ─── 5. Why there is no audit trigger here ───────────────────────────────────
-- The generic `record_audit()` from 008 reads NEW.organization_id and writes it
-- to audit_log. These are reference-layer tables with no organization_id, so
-- attaching that trigger would raise on every insert. Do not "fix" this by
-- adding it.
--
-- Nor is one needed. This table IS the audit record: every row keeps the source
-- URL, the deterministic diff, any model output, who reviewed it, when, and
-- their note. Rows are never deleted on review - status moves to approved or
-- rejected and the evidence stays. If a tracker entry is ever wrong, the
-- question "who approved this change, against which source, and what did the
-- page say at the time" is answerable from this table alone.
