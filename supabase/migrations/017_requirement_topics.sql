-- ============================================================
-- EHS Carbon Accounting Platform — Materiality → disclosure linkage
-- Migration 017
-- ============================================================
-- Closes the loop between the double materiality assessment (016) and the
-- disclosure catalog (011/014).
--
-- Under CSRD/ESRS the materiality assessment is a GATING step: an undertaking
-- reports the topical standards it concluded are material, and states which it
-- concluded are not. Without this link the platform demands every ESRS topic of
-- every organization, which overstates the obligation and buries the topics
-- that actually matter.
--
--   requirement_topics — which material topic(s) a disclosure requirement
--                        belongs to. A requirement with NO row here is
--                        unconditional.
--
-- Three deliberate choices:
--
-- 1. Absence of a link means "always required", not "never required". ESRS 2
--    (BP-*, GOV-*, SBM-*, IRO-*) applies regardless of which topics are
--    material, and TCFD / IFRS S2 / GRI / the California statutes are not
--    scoped by an ESRS double materiality assessment at all. Those are left
--    unlinked so nothing gates them.
--
-- 2. The link is many-to-many. A datapoint can sit under more than one topic,
--    and a requirement is demanded if ANY topic it maps to is material —
--    dropping it because one of two topics was immaterial would be an omission.
--
-- 3. Requirements loaded later through the requirement importer are ungated
--    unless the import supplies topic_codes. Erring toward "demanded" is the
--    safe direction: an over-demanded requirement is visible, a silently
--    dropped one is a reporting omission nobody sees.
--
-- Global reference data, same treatment as the catalog it extends: RLS on with
-- an authenticated read policy and no write policies (writes go through the
-- service role behind the admin-only importer — see migration 013 for why RLS
-- is stated explicitly rather than left disabled).
--
-- RE-RUNNABLE.
-- ============================================================

CREATE TABLE IF NOT EXISTS requirement_topics (
  requirement_id  UUID NOT NULL REFERENCES disclosure_requirements(id) ON DELETE CASCADE,
  topic_code      TEXT NOT NULL REFERENCES material_topics(code) ON DELETE CASCADE,
  PRIMARY KEY (requirement_id, topic_code)
);

CREATE INDEX IF NOT EXISTS idx_requirement_topics_topic
  ON requirement_topics(topic_code);

ALTER TABLE requirement_topics ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON requirement_topics TO authenticated;
DROP POLICY IF EXISTS "requirement_topics_read_authenticated" ON requirement_topics;
CREATE POLICY "requirement_topics_read_authenticated" ON requirement_topics
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- SEED: links for the ESRS-derived catalog
-- ============================================================
-- Requirement ids are generated, so the seed resolves them by their natural key
-- (framework_code + requirement_code) rather than hard-coding UUIDs.

-- CSRD topical standards. The seeded requirement_code for each is literally
-- 'ESRS ' || the topic code ('ESRS E1' … 'ESRS G1'), so the join is exact and
-- adds nothing that is not already asserted in migration 014.
--
-- 'ESRS 2' (cross-cutting) matches no topic and is therefore left unlinked —
-- which is correct: ESRS 2 is required of every undertaking irrespective of the
-- materiality outcome. Same for the BP-*/GOV-*/SBM-*/IRO-* detail rows.
INSERT INTO requirement_topics (requirement_id, topic_code)
SELECT r.id, m.code
FROM disclosure_requirements r
JOIN material_topics m ON r.requirement_code = 'ESRS ' || m.code
WHERE r.framework_code = 'CSRD'
ON CONFLICT DO NOTHING;

-- The standalone ESRS E1 framework is the climate topical standard in full
-- (E1-1 … E1-9), so every one of its requirements belongs to topic E1.
INSERT INTO requirement_topics (requirement_id, topic_code)
SELECT r.id, 'E1'
FROM disclosure_requirements r
WHERE r.framework_code = 'ESRS_E1'
ON CONFLICT DO NOTHING;

-- Deliberately NOT linked: TCFD, IFRS_S2, GRI_305, CA_SB253, CA_SB261.
-- None of them is scoped by an ESRS double materiality assessment. TCFD and
-- IFRS S2 are climate-only by construction; GRI runs its own materiality
-- process on different criteria; the California statutes are mandatory for
-- entities in scope regardless of any materiality judgement. Gating them off an
-- ESRS conclusion would be a misstatement of the obligation.
