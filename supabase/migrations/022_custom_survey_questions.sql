-- ============================================================
-- EHS Carbon Accounting Platform — Bespoke Survey Questionnaires
-- Migration 022
-- ============================================================
-- `supplier_surveys.regulation_type` has always accepted 'custom', and
-- REGULATION_LABELS has always rendered it as "Custom" — but lib/regulations
-- only ships question sets for cbam / eudr / pfas / general_carbon. A survey
-- created as 'custom' therefore reached the supplier as a page reading
-- "This survey has no questions configured." The option existed; the questions
-- behind it did not.
--
--   supplier_survey_questions — the per-survey question definitions that make
--                               a 'custom' survey answerable
--
-- Shape mirrors the SurveyQuestion interface in lib/regulations/index.ts so the
-- public survey form renders built-in and bespoke questions through one code
-- path. Built-in sets stay in TypeScript: they encode regulatory requirements
-- (CBAM, EUDR, PFAS) that must not drift per-tenant, and per CLAUDE.md
-- regulatory content is not something an organization edits by accident.
--
-- `question_key` is the join to supplier_survey_question_responses.question_id,
-- which is a bare TEXT column with no foreign key. That is deliberate — it lets
-- responses from built-in sets ('q3_co2e_intensity') and bespoke ones share one
-- table. The consequence is that renaming a key orphans prior answers, so the
-- key is written once at creation and never updated by the UI.
--
-- Also adds last_reminded_at. reminder_count already existed but was only ever
-- incremented inside the send-survey-email edge function, so the app could show
-- how many times a supplier had been chased but never when.
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── 1. Question definitions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_survey_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id     UUID NOT NULL REFERENCES supplier_surveys(id) ON DELETE CASCADE,

  -- Display order. Not unique: reordering swaps positions and a transient
  -- collision mid-swap is harmless. Ties break on created_at.
  position      INTEGER NOT NULL DEFAULT 0,

  -- Stable identifier stored in supplier_survey_question_responses.question_id.
  question_key  TEXT NOT NULL,

  label         TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'text',
  required      BOOLEAN NOT NULL DEFAULT FALSE,

  -- Display-only suffix (e.g. '%', 'kg'). The platform does not convert
  -- bespoke units — a supplier's free-text answer is not a calculated figure
  -- and must not be treated as one.
  unit          TEXT,

  -- [{ "value": "...", "label": "..." }] — required for 'select', empty
  -- otherwise. Matches SurveyQuestion.options.
  options       JSONB NOT NULL DEFAULT '[]'::jsonb,

  help_text     TEXT,

  -- Conditional display, mirroring SurveyQuestion.showWhen. References another
  -- question's question_key within the same survey. Not a foreign key: the
  -- target may be reordered or removed, and the form treats a dangling
  -- reference as "never show" rather than failing to render.
  show_when_question_key TEXT,
  show_when_answer       TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One answer per (invitation, question_key) is enforced downstream, so keys
  -- must not collide within a survey.
  UNIQUE (survey_id, question_key)
);

-- Kept in sync with the QuestionType union in lib/regulations/index.ts.
ALTER TABLE supplier_survey_questions
  DROP CONSTRAINT IF EXISTS supplier_survey_questions_type_check;
ALTER TABLE supplier_survey_questions
  ADD CONSTRAINT supplier_survey_questions_type_check
  CHECK (question_type IN ('text', 'number', 'select', 'yes_no', 'date', 'file_or_text'));

-- A 'select' with no options renders an empty dropdown the supplier cannot
-- answer, which is indistinguishable to them from a broken survey.
ALTER TABLE supplier_survey_questions
  DROP CONSTRAINT IF EXISTS supplier_survey_questions_options_check;
ALTER TABLE supplier_survey_questions
  ADD CONSTRAINT supplier_survey_questions_options_check
  CHECK (
    jsonb_typeof(options) = 'array'
    AND (question_type <> 'select' OR jsonb_array_length(options) > 0)
  );

-- A conditional question needs both halves of the condition or neither.
ALTER TABLE supplier_survey_questions
  DROP CONSTRAINT IF EXISTS supplier_survey_questions_show_when_check;
ALTER TABLE supplier_survey_questions
  ADD CONSTRAINT supplier_survey_questions_show_when_check
  CHECK (
    (show_when_question_key IS NULL AND show_when_answer IS NULL)
    OR (show_when_question_key IS NOT NULL AND show_when_answer IS NOT NULL)
  );

-- A question cannot be its own precondition — it would never be visible.
ALTER TABLE supplier_survey_questions
  DROP CONSTRAINT IF EXISTS supplier_survey_questions_show_when_self_check;
ALTER TABLE supplier_survey_questions
  ADD CONSTRAINT supplier_survey_questions_show_when_self_check
  CHECK (show_when_question_key IS DISTINCT FROM question_key);

CREATE INDEX IF NOT EXISTS idx_survey_questions_survey
  ON supplier_survey_questions(survey_id, position);

DROP TRIGGER IF EXISTS trg_survey_questions_updated_at ON supplier_survey_questions;
CREATE TRIGGER trg_survey_questions_updated_at
  BEFORE UPDATE ON supplier_survey_questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 2. RLS ─────────────────────────────────────────────────────────────────
-- Scoped through the parent survey rather than a denormalized organization_id.
-- A copied org id can drift out of sync with its survey and silently widen
-- access; a subquery cannot. Question counts are in the tens, so the join cost
-- is irrelevant here.
--
-- No policy grants the anon role read access. The public survey page loads
-- questions with the service client (which bypasses RLS) after resolving a
-- token, exactly as it already does for invitations — matching the correction
-- migration 006 made when it removed the over-permissive token policies.
ALTER TABLE supplier_survey_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survey_questions_select_own_org" ON supplier_survey_questions;
CREATE POLICY "survey_questions_select_own_org" ON supplier_survey_questions
  FOR SELECT USING (
    survey_id IN (SELECT id FROM supplier_surveys WHERE organization_id = auth_org_id())
  );

DROP POLICY IF EXISTS "survey_questions_insert_own_org" ON supplier_survey_questions;
CREATE POLICY "survey_questions_insert_own_org" ON supplier_survey_questions
  FOR INSERT WITH CHECK (
    survey_id IN (SELECT id FROM supplier_surveys WHERE organization_id = auth_org_id())
    AND auth_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "survey_questions_update_own_org" ON supplier_survey_questions;
CREATE POLICY "survey_questions_update_own_org" ON supplier_survey_questions
  FOR UPDATE USING (
    survey_id IN (SELECT id FROM supplier_surveys WHERE organization_id = auth_org_id())
    AND auth_user_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS "survey_questions_delete_own_org" ON supplier_survey_questions;
CREATE POLICY "survey_questions_delete_own_org" ON supplier_survey_questions
  FOR DELETE USING (
    survey_id IN (SELECT id FROM supplier_surveys WHERE organization_id = auth_org_id())
    AND auth_user_role() IN ('admin', 'editor')
  );

-- ─── 3. Contact tracking ────────────────────────────────────────────────────
-- sent_at records the first send. Chasing a supplier four times left no trace
-- of when the last chase happened, which is the thing a procurement lead
-- actually needs before escalating.
ALTER TABLE supplier_survey_invitations
  ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;

COMMENT ON COLUMN supplier_survey_invitations.last_reminded_at IS
  'When the most recent reminder email was accepted by the provider. NULL if never reminded. Written only after a confirmed send — never optimistically.';
