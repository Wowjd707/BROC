-- ============================================================
-- EHS Carbon Accounting Platform — Double Materiality
-- Migration 016
-- ============================================================
-- CSRD requires a double materiality assessment: every sustainability topic is
-- assessed both for the undertaking's impact on people and environment
-- ("inside-out") and for the effect of sustainability matters on the
-- undertaking's own value ("outside-in"). A topic is material if EITHER
-- dimension crosses the threshold.
--
-- This is the gating step for an ESRS report — it determines which topical
-- standards must be reported at all — so it links directly to the disclosure
-- catalog rather than sitting as a standalone exercise.
--
--   material_topics          — the topic catalog (ESRS sub-topics, seeded)
--   materiality_assessments  — one assessment per org per reporting year
--   topic_assessments        — the two-dimensional scores per topic
--   stakeholder_ratings      — stakeholder input, kept separate from the
--                              organization's own scores
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── Topic catalog (global reference) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS material_topics (
  code            TEXT PRIMARY KEY,
  esrs_standard   TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('environmental', 'social', 'governance')),
  name            TEXT NOT NULL,
  description     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE material_topics ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON material_topics TO authenticated;
DROP POLICY IF EXISTS "material_topics_read_authenticated" ON material_topics;
CREATE POLICY "material_topics_read_authenticated" ON material_topics
  FOR SELECT TO authenticated USING (true);

-- Topic list per ESRS 1 Application Requirement 16 (sustainability matters
-- covered by the topical standards). Sub-topic level, cited to the regulation.
INSERT INTO material_topics (code, esrs_standard, category, name, description, sort_order) VALUES
  ('E1',   'ESRS E1', 'environmental', 'Climate change',
   'Climate change mitigation, climate change adaptation, and energy.', 1),
  ('E2',   'ESRS E2', 'environmental', 'Pollution',
   'Pollution of air, water and soil; substances of concern; substances of very high concern.', 2),
  ('E3',   'ESRS E3', 'environmental', 'Water and marine resources',
   'Water consumption, withdrawals and discharges; impacts on marine resources.', 3),
  ('E4',   'ESRS E4', 'environmental', 'Biodiversity and ecosystems',
   'Direct impact drivers of biodiversity loss; impacts on species and ecosystem extent and condition.', 4),
  ('E5',   'ESRS E5', 'environmental', 'Resource use and circular economy',
   'Resource inflows and outflows, and waste.', 5),
  ('S1',   'ESRS S1', 'social', 'Own workforce',
   'Working conditions, equal treatment and opportunities, and other work-related rights.', 6),
  ('S2',   'ESRS S2', 'social', 'Workers in the value chain',
   'Working conditions and rights of workers in the upstream and downstream value chain.', 7),
  ('S3',   'ESRS S3', 'social', 'Affected communities',
   'Communities'' economic, social and cultural rights; civil and political rights; rights of indigenous peoples.', 8),
  ('S4',   'ESRS S4', 'social', 'Consumers and end-users',
   'Information-related impacts, personal safety, and social inclusion of consumers and end-users.', 9),
  ('G1',   'ESRS G1', 'governance', 'Business conduct',
   'Corporate culture, whistleblower protection, political engagement, payment practices, supplier relationships, corruption and bribery.', 10)
ON CONFLICT (code) DO NOTHING;

-- ─── Assessments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS materiality_assessments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  reporting_year   INTEGER NOT NULL,
  name             TEXT NOT NULL,
  -- Score at or above which a topic is material, on the 1-5 scale. Stored per
  -- assessment because the threshold is a judgement the undertaking must be
  -- able to state and defend, not a platform constant.
  threshold        NUMERIC(4, 2) NOT NULL DEFAULT 3,
  methodology      TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'in_review', 'final')),
  created_by       UUID DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, reporting_year, name)
);

CREATE INDEX IF NOT EXISTS idx_materiality_assessments_org
  ON materiality_assessments(organization_id, reporting_year);

DROP TRIGGER IF EXISTS trg_materiality_assessments_updated_at ON materiality_assessments;
CREATE TRIGGER trg_materiality_assessments_updated_at
  BEFORE UPDATE ON materiality_assessments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS topic_assessments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id    UUID NOT NULL REFERENCES materiality_assessments(id) ON DELETE CASCADE,
  topic_code       TEXT NOT NULL REFERENCES material_topics(code),

  -- Impact materiality (ESRS 1 §3): severity = scale + scope + irremediability.
  impact_scale            SMALLINT NOT NULL DEFAULT 0 CHECK (impact_scale BETWEEN 0 AND 5),
  impact_scope            SMALLINT NOT NULL DEFAULT 0 CHECK (impact_scope BETWEEN 0 AND 5),
  impact_irremediability  SMALLINT NOT NULL DEFAULT 0 CHECK (impact_irremediability BETWEEN 0 AND 5),
  impact_likelihood       SMALLINT NOT NULL DEFAULT 0 CHECK (impact_likelihood BETWEEN 0 AND 5),
  impact_is_actual        BOOLEAN NOT NULL DEFAULT TRUE,
  impact_is_negative      BOOLEAN NOT NULL DEFAULT TRUE,

  -- Financial materiality
  financial_magnitude     SMALLINT NOT NULL DEFAULT 0 CHECK (financial_magnitude BETWEEN 0 AND 5),
  financial_likelihood    SMALLINT NOT NULL DEFAULT 0 CHECK (financial_likelihood BETWEEN 0 AND 5),

  rationale        TEXT,
  updated_by       UUID DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assessment_id, topic_code)
);

DROP TRIGGER IF EXISTS trg_topic_assessments_updated_at ON topic_assessments;
CREATE TRIGGER trg_topic_assessments_updated_at
  BEFORE UPDATE ON topic_assessments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Stakeholder input is stored separately, never blended into the scores above:
-- an assessment that silently averaged the two could not show which drove a
-- conclusion, and ESRS expects stakeholder views to be evidenced.
CREATE TABLE IF NOT EXISTS stakeholder_ratings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id    UUID NOT NULL REFERENCES materiality_assessments(id) ON DELETE CASCADE,
  topic_code       TEXT NOT NULL REFERENCES material_topics(code),
  stakeholder_group TEXT NOT NULL,
  respondent_label TEXT,
  rating           SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  weight           NUMERIC(4, 2) NOT NULL DEFAULT 1,
  comment          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stakeholder_ratings_assessment
  ON stakeholder_ratings(assessment_id, topic_code);

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE materiality_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_assessments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakeholder_ratings     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "materiality_select_own_org" ON materiality_assessments;
CREATE POLICY "materiality_select_own_org" ON materiality_assessments
  FOR SELECT USING (organization_id = auth_org_id());
DROP POLICY IF EXISTS "materiality_insert_editor" ON materiality_assessments;
CREATE POLICY "materiality_insert_editor" ON materiality_assessments
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "materiality_update_editor" ON materiality_assessments;
CREATE POLICY "materiality_update_editor" ON materiality_assessments
  FOR UPDATE USING (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "materiality_delete_admin" ON materiality_assessments;
CREATE POLICY "materiality_delete_admin" ON materiality_assessments
  FOR DELETE USING (
    organization_id = auth_org_id() AND auth_user_role() = 'admin');

-- Child rows resolve scope through their assessment.
DROP POLICY IF EXISTS "topic_assessments_select_own_org" ON topic_assessments;
CREATE POLICY "topic_assessments_select_own_org" ON topic_assessments
  FOR SELECT USING (assessment_id IN (
    SELECT id FROM materiality_assessments WHERE organization_id = auth_org_id()));
DROP POLICY IF EXISTS "topic_assessments_write_editor" ON topic_assessments;
CREATE POLICY "topic_assessments_write_editor" ON topic_assessments
  FOR INSERT WITH CHECK (
    assessment_id IN (SELECT id FROM materiality_assessments WHERE organization_id = auth_org_id())
    AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "topic_assessments_update_editor" ON topic_assessments;
CREATE POLICY "topic_assessments_update_editor" ON topic_assessments
  FOR UPDATE USING (
    assessment_id IN (SELECT id FROM materiality_assessments WHERE organization_id = auth_org_id())
    AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "topic_assessments_delete_editor" ON topic_assessments;
CREATE POLICY "topic_assessments_delete_editor" ON topic_assessments
  FOR DELETE USING (
    assessment_id IN (SELECT id FROM materiality_assessments WHERE organization_id = auth_org_id())
    AND auth_user_role() IN ('admin', 'editor'));

DROP POLICY IF EXISTS "stakeholder_ratings_select_own_org" ON stakeholder_ratings;
CREATE POLICY "stakeholder_ratings_select_own_org" ON stakeholder_ratings
  FOR SELECT USING (assessment_id IN (
    SELECT id FROM materiality_assessments WHERE organization_id = auth_org_id()));
DROP POLICY IF EXISTS "stakeholder_ratings_write_editor" ON stakeholder_ratings;
CREATE POLICY "stakeholder_ratings_write_editor" ON stakeholder_ratings
  FOR INSERT WITH CHECK (
    assessment_id IN (SELECT id FROM materiality_assessments WHERE organization_id = auth_org_id())
    AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "stakeholder_ratings_delete_editor" ON stakeholder_ratings;
CREATE POLICY "stakeholder_ratings_delete_editor" ON stakeholder_ratings
  FOR DELETE USING (
    assessment_id IN (SELECT id FROM materiality_assessments WHERE organization_id = auth_org_id())
    AND auth_user_role() IN ('admin', 'editor'));

-- ─── Audit ───────────────────────────────────────────────────────────────────
-- A materiality conclusion determines what an undertaking reports at all, so
-- its history matters as much as the emissions data's.
DROP TRIGGER IF EXISTS trg_audit_materiality_assessments ON materiality_assessments;
CREATE TRIGGER trg_audit_materiality_assessments
  AFTER INSERT OR UPDATE OR DELETE ON materiality_assessments
  FOR EACH ROW EXECUTE FUNCTION record_audit();
