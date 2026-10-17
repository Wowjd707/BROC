-- Migration 004: Add per-question survey responses table
-- The initial schema stored responses in a single JSONB blob.
-- We add a normalized per-question table used by the public survey API.

CREATE TABLE IF NOT EXISTS supplier_survey_question_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id   UUID NOT NULL REFERENCES supplier_survey_invitations(id) ON DELETE CASCADE,
  question_id     TEXT NOT NULL,
  answer          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invitation_id, question_id)
);

CREATE INDEX idx_survey_question_responses_invitation
  ON supplier_survey_question_responses(invitation_id);

-- RLS: allow service role only (public survey is called via API route with service client)
ALTER TABLE supplier_survey_question_responses ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users of the org to read responses for their surveys
CREATE POLICY "org members can read question responses"
  ON supplier_survey_question_responses FOR SELECT
  USING (
    invitation_id IN (
      SELECT id FROM supplier_survey_invitations inv
      WHERE inv.survey_id IN (
        SELECT id FROM supplier_surveys WHERE organization_id = auth_org_id()
      )
    )
  );
