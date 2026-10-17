-- ============================================================
-- BROC — Name the regulation a custom survey is about
-- Migration 036
-- ============================================================
-- `supplier_surveys.regulation_type` has accepted 'custom' since 001, and
-- migration 022 built the question builder around it. What was missing was the
-- front door: the New Survey form only ever offered the four named regimes, so
-- 'custom' was reachable from the database and from nowhere a user could get
-- to. A team wanting to survey suppliers about a regulation this platform has
-- never heard of — a state packaging law, a buyer's own code of conduct, the
-- next regime to appear — had no way to say so.
--
-- The obvious move is to let regulation_type hold free text. That is the wrong
-- one. It is the discriminator the rest of the system branches on:
-- SurveyQuestionBuilder asks whether it equals 'custom' to decide between a
-- seeded question set and a blank one, and lib/regulations resolves templates
-- by it. Opening it to arbitrary strings would turn every one of those
-- comparisons into a silent no-match, and the failure would look like a survey
-- that simply has no questions.
--
-- So the vocabulary stays closed and the NAME goes beside it. 'custom' remains
-- the discriminator; custom_regulation_name carries what to call it on screen.
--
-- RE-RUNNABLE.
-- ============================================================

ALTER TABLE supplier_surveys
  ADD COLUMN IF NOT EXISTS custom_regulation_name VARCHAR(120);

COMMENT ON COLUMN supplier_surveys.custom_regulation_name IS
  'What to call the regulation when regulation_type is ''custom''. The type stays a closed vocabulary because the application branches on it; this is the display name beside it.';

-- Backfill before constraining, or any existing custom survey fails the check.
-- The survey's own title is the honest default: it is what somebody already
-- chose to call this piece of work, rather than a label invented here.
UPDATE supplier_surveys
   SET custom_regulation_name = LEFT(title, 120)
 WHERE regulation_type = 'custom'
   AND (custom_regulation_name IS NULL OR btrim(custom_regulation_name) = '');

DO $$
BEGIN
  -- Both halves matter.
  --
  -- A custom survey with no name renders as "Custom", which tells a supplier
  -- nothing about what they are being asked to disclose — and the supplier is
  -- the one person in this flow who cannot ask a follow-up question.
  --
  -- A named survey that is NOT custom is worse: it would show one regulation in
  -- the badge and drive its question set from another. Requiring NULL there
  -- means switching the dropdown away from Custom has to clear the field rather
  -- than leave it lying around.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_surveys_custom_name'
  ) THEN
    ALTER TABLE supplier_surveys ADD CONSTRAINT supplier_surveys_custom_name
      CHECK (
        (regulation_type = 'custom'
          AND custom_regulation_name IS NOT NULL
          AND btrim(custom_regulation_name) <> '')
        OR
        (regulation_type <> 'custom' AND custom_regulation_name IS NULL)
      );
  END IF;
END $$;
