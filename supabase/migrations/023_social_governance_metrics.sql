-- ============================================================
-- Social & Governance Metrics
-- Migration 023
-- ============================================================
-- The platform could account for the E and almost nothing else. Water and waste
-- were the only non-carbon streams, and `ehs_entries.metric_type` was closed to
-- ('water','waste'). Everything "ESG" covers outside carbon — injury
-- rates, hours worked, turnover, training, board composition, corruption cases
-- — had no home, so that data had to live in a separate system.
--
-- This migration does NOT add a module. The entry shape ehs_entries already has
-- (org, site, date, metric_type, source_type, quantity, unit, normalized
-- quantity + unit) is the correct shape for these metrics too, and it already
-- carries RLS, the append-only audit trigger, soft deletes, and evidence
-- attachments. Adding tables would duplicate all of that.
--
--   sustainability_metrics   — reference catalog: what each metric IS, its
--                              canonical unit, and how it may be aggregated
--   ehs_entries.metric_type  — opened to the social and governance families
--   ehs_entries.site_id      — now nullable, for genuinely org-level metrics
--
-- ─── The two traps this schema is shaped to avoid ────────────────────────────
--
-- 1. MIXED UNITS INSIDE ONE FAMILY. Water is all gallons and waste is all kg,
--    so summing by metric_type alone was safe. It is NOT safe here: 'safety'
--    holds both incident counts and hours worked, and adding those produces a
--    number that means nothing. The canonical unit is therefore a property of
--    the METRIC, not of the family, and every aggregate must group by
--    (metric_type, source_type) or filter on unit_normalized. The energy figure
--    in lib/disclosure-metrics.ts already does exactly this and is the
--    precedent.
--
-- 2. NON-ADDITIVE METRICS. Headcount is a stock, not a flow: summing twelve
--    monthly headcounts reports twelve times the workforce. `aggregation`
--    records which metrics may be summed over a period and which may not, so a
--    reporting query cannot get this wrong by default.
--
-- ─── Rates are derived, never stored ─────────────────────────────────────────
--
-- No rate (TRIR, DART, turnover %, board independence %) is an enterable
-- metric. Only its raw inputs are stored, and the rate is computed in
-- lib/social-metrics-core.ts. This follows the standing decisions in
-- DECISIONS.md: the same reason stakeholder ratings are never blended into a
-- materiality score, and Scope 3 is never folded into a Scope 1+2 total. A
-- stored rate cannot be traced to the numerator and denominator that produced
-- it, cannot be recomputed on a different hours basis, and cannot be assured.
--
-- ─── On framework references ─────────────────────────────────────────────────
--
-- `framework_reference` is a human-readable NOTE naming the disclosure a metric
-- typically serves. It is deliberately NOT the answering mechanism. Disclosure
-- requirements are answered through `disclosure_requirements.metric_key`,
-- loaded via the requirement importer, exactly as the E metrics already are.
-- Asserting a binding framework mapping in seed data would be the same class of
-- error as seeding ESRS datapoint codes from memory, which DECISIONS.md records
-- as a decision already taken and not to be reversed.
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── 1. The metric catalog ───────────────────────────────────────────────────
-- A reference table, not tenant data: it defines what a metric means, the same
-- way scope3_categories defines the fifteen categories. Deploying organizations extend it
-- with their own rows via the service role; nothing here is org-scoped.

CREATE TABLE IF NOT EXISTS sustainability_metrics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Matches ehs_entries.(metric_type, source_type). Kept in sync with
  -- SUSTAINABILITY_METRICS in lib/social-metrics-core.ts; the API rejects an
  -- entry whose pair is not on that list, the same contract
  -- evidence_attachments has with EVIDENCE_RECORD_TYPES.
  metric_type         VARCHAR(30) NOT NULL,
  source_type         VARCHAR(100) NOT NULL,

  pillar              VARCHAR(20) NOT NULL CHECK (pillar IN ('environmental', 'social', 'governance')),
  label               TEXT NOT NULL,
  description         TEXT,

  -- The unit every entry of this metric is normalized TO. Never assume this
  -- from metric_type; see trap 1 in the header.
  canonical_unit      VARCHAR(30) NOT NULL,

  -- sum          — a flow; addition over a period is meaningful (incidents, hours)
  -- point_in_time— a stock; take the latest value in the period, never a sum (headcount)
  -- average      — meaningful only as a period mean (rarely used; no seeded metric uses it)
  aggregation         VARCHAR(20) NOT NULL DEFAULT 'sum'
                      CHECK (aggregation IN ('sum', 'point_in_time', 'average')),

  -- True when this metric is only ever an input to a derived rate and should
  -- not be presented as a headline figure on its own.
  is_rate_input       BOOLEAN NOT NULL DEFAULT FALSE,

  -- Indicative only. Not the answering mechanism — see the header.
  framework_reference TEXT,

  display_order       INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One definition per (family, metric). ON CONFLICT in the seed below depends on
-- this, which is what makes the seed re-runnable.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sustainability_metrics_key
  ON sustainability_metrics(metric_type, source_type);

CREATE INDEX IF NOT EXISTS idx_sustainability_metrics_pillar
  ON sustainability_metrics(pillar, display_order) WHERE is_active;

COMMENT ON TABLE sustainability_metrics IS
  'Reference catalog of every non-carbon metric the platform can hold, keyed to ehs_entries.(metric_type, source_type). Carries the canonical unit and the aggregation rule, because neither can be inferred from the family: safety holds both counts and hours, and headcount must never be summed.';
COMMENT ON COLUMN sustainability_metrics.canonical_unit IS
  'The unit entries of this metric are normalized to. Aggregate by (metric_type, source_type) or filter on unit_normalized — never sum a whole metric_type.';
COMMENT ON COLUMN sustainability_metrics.aggregation IS
  'sum = flow, addable over a period. point_in_time = stock, take the latest reading; summing twelve monthly headcounts reports twelve workforces. average = period mean.';
COMMENT ON COLUMN sustainability_metrics.framework_reference IS
  'Indicative note naming the disclosure this metric typically serves. NOT the answering mechanism — disclosures resolve through disclosure_requirements.metric_key, loaded by the requirement importer.';

-- ─── 2. Reference-table RLS, following migration 013 ─────────────────────────
-- Published reference data every tenant reads. Explicit policy rather than
-- disabled RLS: 013 records why the absence of a policy is the dangerous state
-- (RLS on with no policy returns zero rows and logs nothing).

ALTER TABLE sustainability_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sustainability_metrics_read_authenticated" ON sustainability_metrics;
CREATE POLICY "sustainability_metrics_read_authenticated" ON sustainability_metrics
  FOR SELECT TO authenticated USING (TRUE);

GRANT SELECT ON sustainability_metrics TO authenticated;
-- No INSERT/UPDATE/DELETE policy: writes are service-role or migration only.

-- ─── 3. Open ehs_entries to the new families ─────────────────────────────────

DO $$
BEGIN
  -- The original CHECK was created inline in 001 and is named by Postgres
  -- convention. Drop by that name if present, then add the widened one under an
  -- explicit name so this block is idempotent from either starting state.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ehs_entries_metric_type_check') THEN
    ALTER TABLE ehs_entries DROP CONSTRAINT ehs_entries_metric_type_check;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ehs_entries_metric_type_families') THEN
    ALTER TABLE ehs_entries ADD CONSTRAINT ehs_entries_metric_type_families
      CHECK (metric_type IN (
        -- environmental (unchanged)
        'water', 'waste',
        -- social
        'safety', 'workforce', 'training',
        -- governance
        'governance'
      ));
  END IF;
END $$;

-- metric_type was VARCHAR(20); the values above fit, but widen it so an organization
-- adding a family of their own is not blocked by a length nobody chose.
ALTER TABLE ehs_entries ALTER COLUMN metric_type TYPE VARCHAR(30);

-- ─── 4. Org-level metrics need a nullable site ───────────────────────────────
-- Board seats and confirmed corruption cases are properties of the entity, not
-- of a plant. scope3_entries already models an org-level record this way, so
-- this follows an existing pattern rather than inventing one. RLS on
-- ehs_entries scopes by organization_id and never by site, so nothing in the
-- security model depends on this column being present (see 002).

ALTER TABLE ehs_entries ALTER COLUMN site_id DROP NOT NULL;

COMMENT ON COLUMN ehs_entries.site_id IS
  'The site this reading belongs to. NULL for genuinely entity-level metrics (board composition, confirmed corruption incidents). Site-level metrics must still supply it; the API enforces that per metric.';

-- ─── 5. Seed the catalog ─────────────────────────────────────────────────────
-- Water and waste are seeded alongside the new families so the catalog is the
-- single description of every metric, not a second list that covers only half.
--
-- ON CONFLICT DO UPDATE rather than DO NOTHING: a re-run should correct a label
-- or a unit, which is reference data. It deliberately does not touch is_active,
-- so an operator who retires a metric locally does not have it resurrected by a
-- later re-run.

INSERT INTO sustainability_metrics
  (metric_type, source_type, pillar, label, description, canonical_unit, aggregation, is_rate_input, framework_reference, display_order)
VALUES
  -- ── Environmental (existing streams, catalogued for completeness) ──
  ('water', 'municipal_consumption', 'environmental', 'Municipal water withdrawn', NULL, 'gallons', 'sum', FALSE, 'GRI 303-3; ESRS E3', 10),
  ('waste', 'non_hazardous_landfilled', 'environmental', 'Non-hazardous waste landfilled', NULL, 'kg', 'sum', FALSE, 'GRI 306-5; ESRS E5', 20),

  -- ── Social — safety (GRI 403, ESRS S1-14) ──
  ('safety', 'hours_worked', 'social', 'Hours worked',
   'Denominator for every injury rate. Without it no rate can be computed, so it is collected on the same cadence as the incident counts.',
   'hours', 'sum', TRUE, 'GRI 403-9 (rate denominator)', 100),
  ('safety', 'recordable_incidents', 'social', 'Recordable work-related injuries',
   'Cases meeting the recordability criteria the organization reports under (e.g. 29 CFR 1904 for US OSHA reporters). The criteria in force are a basis-of-preparation disclosure, not a platform assumption.',
   'count', 'sum', TRUE, 'GRI 403-9; ESRS S1-14', 110),
  ('safety', 'lost_time_incidents', 'social', 'Lost-time injuries',
   'Recordable cases involving days away from work.',
   'count', 'sum', TRUE, 'GRI 403-9; ESRS S1-14', 120),
  ('safety', 'restricted_duty_incidents', 'social', 'Restricted-duty or job-transfer cases',
   'Recordable cases resulting in restricted work or job transfer, without days away. With lost-time cases this gives the DART numerator.',
   'count', 'sum', TRUE, 'GRI 403-9', 130),
  ('safety', 'lost_days', 'social', 'Days away from work',
   'Calendar or scheduled days away, counted on the basis the organization discloses.',
   'days', 'sum', TRUE, 'GRI 403-9', 140),
  ('safety', 'high_consequence_incidents', 'social', 'High-consequence work-related injuries',
   'Injuries from which the worker cannot, does not, or is not expected to recover fully to pre-injury health status within six months. Reported separately from fatalities.',
   'count', 'sum', TRUE, 'GRI 403-9; ESRS S1-14', 150),
  ('safety', 'fatalities', 'social', 'Work-related fatalities',
   'Always disclosed as a count, never rolled into a rate on its own.',
   'count', 'sum', FALSE, 'GRI 403-9; ESRS S1-14', 160),
  ('safety', 'near_misses', 'social', 'Near misses reported',
   'A leading indicator. Rising counts commonly signal improving reporting culture rather than worsening safety, so it is never presented as a performance decline.',
   'count', 'sum', FALSE, NULL, 170),

  -- ── Social — workforce (GRI 401/405, ESRS S1-6) ──
  ('workforce', 'headcount', 'social', 'Headcount',
   'A stock, not a flow. Aggregation is point_in_time: the latest reading in the period, never a sum.',
   'count', 'point_in_time', TRUE, 'GRI 2-7; ESRS S1-6', 200),
  ('workforce', 'new_hires', 'social', 'New employee hires', NULL, 'count', 'sum', FALSE, 'GRI 401-1', 210),
  ('workforce', 'separations_voluntary', 'social', 'Voluntary separations',
   'Split from involuntary because blending them makes a turnover figure impossible to interpret: the same total can mean a retention problem or a restructuring.',
   'count', 'sum', TRUE, 'GRI 401-1', 220),
  ('workforce', 'separations_involuntary', 'social', 'Involuntary separations', NULL, 'count', 'sum', TRUE, 'GRI 401-1', 230),

  -- ── Social — training (GRI 404, ESRS S1-13) ──
  ('training', 'training_hours', 'social', 'Training hours delivered',
   'All employee training. Divided by headcount for the average-hours-per-employee disclosure.',
   'hours', 'sum', TRUE, 'GRI 404-1; ESRS S1-13', 300),
  ('training', 'ehs_training_hours', 'social', 'Health and safety training hours',
   'Tracked separately from general training: GRI 403-5 is a distinct disclosure and a combined figure cannot answer it.',
   'hours', 'sum', FALSE, 'GRI 403-5', 310),

  -- ── Governance (GRI 2/205, ESRS G1) ──
  ('governance', 'board_seats', 'governance', 'Board seats',
   'Entity-level: entered with no site.',
   'count', 'point_in_time', TRUE, 'GRI 2-9', 400),
  ('governance', 'independent_board_seats', 'governance', 'Independent board seats',
   'Independence is determined under the definition the organization discloses; the platform stores the count, not the test.',
   'count', 'point_in_time', TRUE, 'GRI 2-9', 410),
  ('governance', 'corruption_incidents_confirmed', 'governance', 'Confirmed incidents of corruption',
   'Confirmed only. An allegation under investigation is not a confirmed incident and reporting it as one would misstate the disclosure.',
   'count', 'sum', FALSE, 'GRI 205-3; ESRS G1-4', 420),
  ('governance', 'whistleblower_reports', 'governance', 'Reports received through grievance channels', NULL, 'count', 'sum', TRUE, 'GRI 2-26; ESRS G1-3', 430),
  ('governance', 'whistleblower_reports_substantiated', 'governance', 'Reports substantiated after investigation', NULL, 'count', 'sum', TRUE, 'GRI 2-26; ESRS G1-3', 440),
  ('governance', 'policy_training_completions', 'governance', 'Anti-corruption training completions',
   'Completions, not enrolments.',
   'count', 'sum', TRUE, 'GRI 205-2; ESRS G1-3', 450)

ON CONFLICT (metric_type, source_type) DO UPDATE SET
  pillar              = EXCLUDED.pillar,
  label               = EXCLUDED.label,
  description         = EXCLUDED.description,
  canonical_unit      = EXCLUDED.canonical_unit,
  aggregation         = EXCLUDED.aggregation,
  is_rate_input       = EXCLUDED.is_rate_input,
  framework_reference = EXCLUDED.framework_reference,
  display_order       = EXCLUDED.display_order;

-- ─── 6. Evidence attachments already cover these ─────────────────────────────
-- ehs_entries is already on the evidence_attachments record_type allowlist
-- (019), so an OSHA 300A log or a board charter attaches to a social or
-- governance entry with no further schema change. Noted because it is the kind
-- of thing that gets rebuilt by someone who did not check.
