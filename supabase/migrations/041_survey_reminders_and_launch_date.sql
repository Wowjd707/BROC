-- ============================================================
-- Migration 041: automatic supplier-survey reminders, and when a survey
-- went live
-- ============================================================
--
-- 1. Reminders. A survey can now chase its own non-responders. Two columns
--    on supplier_surveys hold the schedule:
--      reminder_interval_days  days between reminders; NULL means automatic
--                              reminders are off (the default, so nothing
--                              starts emailing suppliers on upgrade)
--      reminder_max            the most reminders any one supplier gets
--    The clock for each supplier starts from their invitation (sent_at) and
--    restarts at each reminder (last_reminded_at, already present). A daily
--    job, /api/cron/survey-reminders, sends whatever is due; the rule lives
--    in lib/survey-reminder-core.ts.
--
-- 2. launched_at. The responses dashboard filters campaigns by when they
--    were launched, which created_at does not answer: a survey can sit as a
--    draft for weeks. launched_at is stamped the first time a survey becomes
--    active, by trigger, so no client can forget it or backdate it. Existing
--    active or closed surveys take their first invitation date, or their
--    creation date if nothing was ever sent.
--
-- Re-runnable: every statement is guarded.
-- ============================================================

ALTER TABLE supplier_surveys
  ADD COLUMN IF NOT EXISTS reminder_interval_days INTEGER,
  ADD COLUMN IF NOT EXISTS reminder_max INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_surveys_reminder_interval_check') THEN
    ALTER TABLE supplier_surveys ADD CONSTRAINT supplier_surveys_reminder_interval_check
      CHECK (reminder_interval_days IS NULL OR reminder_interval_days BETWEEN 1 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_surveys_reminder_max_check') THEN
    ALTER TABLE supplier_surveys ADD CONSTRAINT supplier_surveys_reminder_max_check
      CHECK (reminder_max BETWEEN 1 AND 20);
  END IF;
END $$;

COMMENT ON COLUMN supplier_surveys.reminder_interval_days IS
  'Days between automatic reminders to suppliers who have not submitted. NULL = automatic reminders off.';
COMMENT ON COLUMN supplier_surveys.reminder_max IS
  'Most automatic reminders sent to any one supplier for this survey.';
COMMENT ON COLUMN supplier_surveys.launched_at IS
  'When the survey first became active. Set by trigger; never moved once set.';

CREATE OR REPLACE FUNCTION stamp_survey_launched_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Once set, the launch date is history: re-opening or editing a survey does
  -- not move it, and no client can write or backdate it.
  IF TG_OP = 'UPDATE' AND OLD.launched_at IS NOT NULL THEN
    NEW.launched_at := OLD.launched_at;
  ELSIF NEW.status = 'draft' THEN
    NEW.launched_at := NULL;
  ELSE
    NEW.launched_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill launch dates for surveys that are already out, with the trigger
-- off so it cannot overwrite them with today's date on a re-run.
DROP TRIGGER IF EXISTS trg_stamp_survey_launched_at ON supplier_surveys;

UPDATE supplier_surveys s
SET launched_at = COALESCE(
  (SELECT MIN(i.sent_at) FROM supplier_survey_invitations i WHERE i.survey_id = s.id),
  s.created_at
)
WHERE s.launched_at IS NULL AND s.status IN ('active', 'closed');

CREATE TRIGGER trg_stamp_survey_launched_at
  BEFORE INSERT OR UPDATE ON supplier_surveys
  FOR EACH ROW EXECUTE FUNCTION stamp_survey_launched_at();

-- The reminder job looks for open invitations on active surveys.
CREATE INDEX IF NOT EXISTS idx_invitations_open_by_survey
  ON supplier_survey_invitations (survey_id)
  WHERE status IN ('sent', 'viewed');
