-- ============================================================
-- Data Quality and Estimation on Scope 1 & 2
-- Migration 029
-- ============================================================
-- Scope 3 entries have carried a data_quality tier since migration 010
-- (primary / secondary / estimated). Scope 1 and 2 - the figures that get
-- assured first, and the ones a regulator reads - carried nothing.
--
-- So an entry keyed from a meter read and an entry somebody estimated because
-- a plant never sent its numbers were indistinguishable in the database, in
-- every report, and to an assurance provider. That is backwards, and it has two
-- practical consequences:
--
--   1. The estimated share of the inventory cannot be disclosed, which most
--      frameworks expect and every assurance engagement asks for.
--   2. There is no legitimate way to gap-fill, so a close stalls on one missing
--      site - or somebody types an estimate in as though it were measured,
--      which is worse and invisible.
--
--   emission_entries.data_quality      - measured / calculated / estimated
--   emission_entries.estimation_method - required when estimated
--
-- ─── Why "calculated" is the default ────────────────────────────────────────
--
-- Backfilling every existing row as `measured` would assert something nobody
-- verified. `calculated` is the honest description of what this platform
-- actually does with almost every entry: an activity figure from an invoice or
-- a meter, multiplied by a published factor. Rows that were in fact estimated
-- can be corrected; nothing is silently upgraded.
--
-- ─── The method is mandatory, not encouraged ────────────────────────────────
--
-- An estimate without its method is not assurable, so the CHECK requires one.
-- "Prior-year consumption scaled by production volume" is a defensible basis;
-- an unexplained number is a finding.
--
-- RE-RUNNABLE.
-- ============================================================

ALTER TABLE emission_entries
  ADD COLUMN IF NOT EXISTS data_quality      VARCHAR(20) NOT NULL DEFAULT 'calculated',
  ADD COLUMN IF NOT EXISTS estimation_method TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emission_entries_data_quality_check') THEN
    ALTER TABLE emission_entries ADD CONSTRAINT emission_entries_data_quality_check
      CHECK (data_quality IN ('measured', 'calculated', 'estimated'));
  END IF;

  -- An estimate must say how it was arrived at. Enforced here rather than in
  -- the API because this is the column an auditor will sample.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emission_entries_estimation_method_required') THEN
    ALTER TABLE emission_entries ADD CONSTRAINT emission_entries_estimation_method_required
      CHECK (
        data_quality <> 'estimated'
        OR (estimation_method IS NOT NULL AND length(btrim(estimation_method)) > 0)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_emission_entries_data_quality
  ON emission_entries(organization_id, data_quality) WHERE deleted_at IS NULL;

COMMENT ON COLUMN emission_entries.data_quality IS
  'measured = metered or directly read; calculated = activity data times a published factor (the normal case); estimated = gap-filled. Defaults to calculated because backfilling existing rows as measured would assert something nobody verified.';
COMMENT ON COLUMN emission_entries.estimation_method IS
  'How an estimate was arrived at. Required by CHECK when data_quality is estimated: an estimate without its basis is not assurable.';

-- The same distinction on the EHS side, where water and waste readings are just
-- as often estimated from a prior period.
ALTER TABLE ehs_entries
  ADD COLUMN IF NOT EXISTS data_quality      VARCHAR(20) NOT NULL DEFAULT 'calculated',
  ADD COLUMN IF NOT EXISTS estimation_method TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ehs_entries_data_quality_check') THEN
    ALTER TABLE ehs_entries ADD CONSTRAINT ehs_entries_data_quality_check
      CHECK (data_quality IN ('measured', 'calculated', 'estimated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ehs_entries_estimation_method_required') THEN
    ALTER TABLE ehs_entries ADD CONSTRAINT ehs_entries_estimation_method_required
      CHECK (
        data_quality <> 'estimated'
        OR (estimation_method IS NOT NULL AND length(btrim(estimation_method)) > 0)
      );
  END IF;
END $$;
