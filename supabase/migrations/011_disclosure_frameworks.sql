-- ============================================================
-- EHS Carbon Accounting Platform — Disclosure Frameworks
-- Migration 011
-- ============================================================
-- The same underlying inventory must be reportable against multiple
-- frameworks. This models frameworks and their disclosure requirements as
-- DATA, not code, so an organization can add or amend requirements (frameworks are
-- revised regularly) without touching the application.
--
--   disclosure_frameworks   — the standards themselves, with issuer + source
--   disclosure_requirements — individual disclosures, each optionally linked
--                             to a platform metric that can satisfy it
--   disclosure_responses    — the organization's narrative + status per
--                             requirement, per reporting year
--
-- SEEDING POLICY
-- Seeded below are the requirement STRUCTURES of TCFD, GRI 305, IFRS S2 and
-- ESRS E1 — these are published, definitional, and cited to their issuing
-- standard. Nothing here interprets or invents a regulatory obligation.
-- SASB (industry-specific) and CDP (questionnaire revised annually) are
-- deliberately NOT seeded: their content is industry- or year-dependent and
-- inventing it would be worse than leaving it to the deploying organization to load.
-- ============================================================

-- RE-RUNNABLE: safe to apply more than once (see 010 for the rationale).

CREATE TABLE IF NOT EXISTS disclosure_frameworks (
  code         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  issuer       TEXT NOT NULL,
  version      TEXT,
  description  TEXT,
  source_ref   TEXT NOT NULL,          -- citation for the requirement structure
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS disclosure_requirements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_code    TEXT NOT NULL REFERENCES disclosure_frameworks(code) ON DELETE CASCADE,
  requirement_code  TEXT NOT NULL,      -- 'Governance a)', '305-1', 'E1-6'
  section           TEXT,               -- pillar / topic grouping
  title             TEXT NOT NULL,
  description       TEXT,
  response_type     TEXT NOT NULL DEFAULT 'narrative'
                    CHECK (response_type IN ('narrative', 'metric', 'both')),
  -- Platform metric that can satisfy this requirement (see lib/disclosure-metrics.ts).
  metric_key        TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (framework_code, requirement_code)
);

CREATE INDEX IF NOT EXISTS idx_disclosure_requirements_framework
  ON disclosure_requirements(framework_code, sort_order);

GRANT SELECT ON disclosure_frameworks   TO authenticated;
GRANT SELECT ON disclosure_requirements TO authenticated;

CREATE TABLE IF NOT EXISTS disclosure_responses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT auth_org_id(),
  requirement_id   UUID NOT NULL REFERENCES disclosure_requirements(id) ON DELETE CASCADE,
  reporting_year   INTEGER NOT NULL,
  narrative        TEXT,
  status           TEXT NOT NULL DEFAULT 'not_started'
                   CHECK (status IN ('not_started', 'in_progress', 'complete', 'not_material')),
  updated_by       UUID DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, requirement_id, reporting_year)
);

CREATE INDEX IF NOT EXISTS idx_disclosure_responses_org_year
  ON disclosure_responses(organization_id, reporting_year);

DROP TRIGGER IF EXISTS trg_disclosure_responses_updated_at ON disclosure_responses;
CREATE TRIGGER trg_disclosure_responses_updated_at
  BEFORE UPDATE ON disclosure_responses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE disclosure_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "disclosure_responses_select_own_org" ON disclosure_responses;
CREATE POLICY "disclosure_responses_select_own_org" ON disclosure_responses
  FOR SELECT USING (organization_id = auth_org_id());
DROP POLICY IF EXISTS "disclosure_responses_insert_editor" ON disclosure_responses;
CREATE POLICY "disclosure_responses_insert_editor" ON disclosure_responses
  FOR INSERT WITH CHECK (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "disclosure_responses_update_editor" ON disclosure_responses;
CREATE POLICY "disclosure_responses_update_editor" ON disclosure_responses
  FOR UPDATE USING (
    organization_id = auth_org_id() AND auth_user_role() IN ('admin', 'editor'));
DROP POLICY IF EXISTS "disclosure_responses_delete_admin" ON disclosure_responses;
CREATE POLICY "disclosure_responses_delete_admin" ON disclosure_responses
  FOR DELETE USING (
    organization_id = auth_org_id() AND auth_user_role() = 'admin');

DROP TRIGGER IF EXISTS trg_audit_disclosure_responses ON disclosure_responses;
CREATE TRIGGER trg_audit_disclosure_responses
  AFTER INSERT OR UPDATE OR DELETE ON disclosure_responses
  FOR EACH ROW EXECUTE FUNCTION record_audit();

-- ============================================================
-- SEED: frameworks
-- ============================================================
INSERT INTO disclosure_frameworks (code, name, issuer, version, description, source_ref, sort_order) VALUES
  ('TCFD', 'Task Force on Climate-related Financial Disclosures', 'TCFD / FSB', '2017 (2021 Annex)',
   'Eleven recommended disclosures across four pillars: Governance, Strategy, Risk Management, and Metrics & Targets.',
   'TCFD, Recommendations of the Task Force on Climate-related Financial Disclosures (June 2017); Implementing Guidance (Oct 2021)', 1),
  ('IFRS_S2', 'IFRS S2 Climate-related Disclosures', 'ISSB / IFRS Foundation', '2023',
   'ISSB climate standard. Core content mirrors the TCFD four-pillar structure, with cross-industry metric categories.',
   'IFRS S2 Climate-related Disclosures (ISSB, June 2023)', 2),
  ('ESRS_E1', 'ESRS E1 Climate change', 'EFRAG / European Commission', '2023',
   'Climate change topical standard under CSRD. Disclosure Requirements E1-1 to E1-9.',
   'Commission Delegated Regulation (EU) 2023/2772, Annex I, ESRS E1', 3),
  ('GRI_305', 'GRI 305: Emissions', 'Global Reporting Initiative', '2016',
   'Emissions topic standard, disclosures 305-1 to 305-7.',
   'GRI 305: Emissions 2016', 4)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- SEED: TCFD — 11 recommended disclosures across 4 pillars
-- ============================================================
INSERT INTO disclosure_requirements
  (framework_code, requirement_code, section, title, response_type, metric_key, sort_order) VALUES
  ('TCFD', 'Governance a)', 'Governance',
   'Describe the board''s oversight of climate-related risks and opportunities.', 'narrative', NULL, 1),
  ('TCFD', 'Governance b)', 'Governance',
   'Describe management''s role in assessing and managing climate-related risks and opportunities.', 'narrative', NULL, 2),
  ('TCFD', 'Strategy a)', 'Strategy',
   'Describe the climate-related risks and opportunities the organization has identified over the short, medium, and long term.', 'narrative', NULL, 3),
  ('TCFD', 'Strategy b)', 'Strategy',
   'Describe the impact of climate-related risks and opportunities on the organization''s businesses, strategy, and financial planning.', 'narrative', NULL, 4),
  ('TCFD', 'Strategy c)', 'Strategy',
   'Describe the resilience of the organization''s strategy, taking into consideration different climate-related scenarios, including a 2°C or lower scenario.', 'narrative', NULL, 5),
  ('TCFD', 'Risk Management a)', 'Risk Management',
   'Describe the organization''s processes for identifying and assessing climate-related risks.', 'narrative', NULL, 6),
  ('TCFD', 'Risk Management b)', 'Risk Management',
   'Describe the organization''s processes for managing climate-related risks.', 'narrative', NULL, 7),
  ('TCFD', 'Risk Management c)', 'Risk Management',
   'Describe how processes for identifying, assessing, and managing climate-related risks are integrated into the organization''s overall risk management.', 'narrative', NULL, 8),
  ('TCFD', 'Metrics and Targets a)', 'Metrics and Targets',
   'Disclose the metrics used by the organization to assess climate-related risks and opportunities in line with its strategy and risk management process.', 'both', 'ghg_intensity', 9),
  ('TCFD', 'Metrics and Targets b)', 'Metrics and Targets',
   'Disclose Scope 1, Scope 2, and, if appropriate, Scope 3 greenhouse gas (GHG) emissions, and the related risks.', 'both', 'ghg_all_scopes', 10),
  ('TCFD', 'Metrics and Targets c)', 'Metrics and Targets',
   'Describe the targets used by the organization to manage climate-related risks and opportunities and performance against targets.', 'both', 'targets', 11)
ON CONFLICT (framework_code, requirement_code) DO NOTHING;

-- ============================================================
-- SEED: IFRS S2 — core content areas
-- ============================================================
INSERT INTO disclosure_requirements
  (framework_code, requirement_code, section, title, response_type, metric_key, sort_order) VALUES
  ('IFRS_S2', 'Governance', 'Governance',
   'Disclose the governance processes, controls and procedures used to monitor, manage and oversee climate-related risks and opportunities.', 'narrative', NULL, 1),
  ('IFRS_S2', 'Strategy — business model and value chain', 'Strategy',
   'Disclose the current and anticipated effects of climate-related risks and opportunities on the business model and value chain.', 'narrative', NULL, 2),
  ('IFRS_S2', 'Strategy — strategy and decision-making', 'Strategy',
   'Disclose the effects of climate-related risks and opportunities on strategy and decision-making, including transition plans.', 'narrative', NULL, 3),
  ('IFRS_S2', 'Strategy — financial position and performance', 'Strategy',
   'Disclose the effects of climate-related risks and opportunities on financial position, financial performance and cash flows for the reporting period and their anticipated effects.', 'narrative', NULL, 4),
  ('IFRS_S2', 'Strategy — climate resilience', 'Strategy',
   'Disclose the climate resilience of the strategy and business model, including a climate-related scenario analysis.', 'narrative', NULL, 5),
  ('IFRS_S2', 'Risk management', 'Risk management',
   'Disclose the processes used to identify, assess, prioritise and monitor climate-related risks and opportunities, and their integration into overall risk management.', 'narrative', NULL, 6),
  ('IFRS_S2', 'Metrics — GHG emissions', 'Metrics and targets',
   'Disclose absolute gross Scope 1, Scope 2 and Scope 3 greenhouse gas emissions, measured in accordance with the GHG Protocol Corporate Standard.', 'both', 'ghg_all_scopes', 7),
  ('IFRS_S2', 'Metrics — cross-industry categories', 'Metrics and targets',
   'Disclose cross-industry metric categories: transition risks, physical risks, climate-related opportunities, capital deployment, internal carbon prices and remuneration.', 'narrative', NULL, 8),
  ('IFRS_S2', 'Targets', 'Metrics and targets',
   'Disclose climate-related targets set, and any targets required to be met by law or regulation, and performance against them.', 'both', 'targets', 9)
ON CONFLICT (framework_code, requirement_code) DO NOTHING;

-- ============================================================
-- SEED: ESRS E1 — Disclosure Requirements E1-1 to E1-9
-- ============================================================
INSERT INTO disclosure_requirements
  (framework_code, requirement_code, section, title, response_type, metric_key, sort_order) VALUES
  ('ESRS_E1', 'E1-1', 'Strategy',
   'Transition plan for climate change mitigation.', 'narrative', NULL, 1),
  ('ESRS_E1', 'E1-2', 'Impact, risk and opportunity management',
   'Policies related to climate change mitigation and adaptation.', 'narrative', NULL, 2),
  ('ESRS_E1', 'E1-3', 'Impact, risk and opportunity management',
   'Actions and resources in relation to climate change policies.', 'narrative', NULL, 3),
  ('ESRS_E1', 'E1-4', 'Metrics and targets',
   'Targets related to climate change mitigation and adaptation.', 'both', 'targets', 4),
  ('ESRS_E1', 'E1-5', 'Metrics and targets',
   'Energy consumption and mix.', 'both', 'energy_consumption', 5),
  ('ESRS_E1', 'E1-6', 'Metrics and targets',
   'Gross Scopes 1, 2, 3 and total GHG emissions.', 'both', 'ghg_all_scopes', 6),
  ('ESRS_E1', 'E1-7', 'Metrics and targets',
   'GHG removals and GHG mitigation projects financed through carbon credits.', 'narrative', NULL, 7),
  ('ESRS_E1', 'E1-8', 'Metrics and targets',
   'Internal carbon pricing.', 'narrative', NULL, 8),
  ('ESRS_E1', 'E1-9', 'Metrics and targets',
   'Anticipated financial effects from material physical and transition risks and potential climate-related opportunities.', 'narrative', NULL, 9)
ON CONFLICT (framework_code, requirement_code) DO NOTHING;

-- ============================================================
-- SEED: GRI 305 — Emissions
-- ============================================================
INSERT INTO disclosure_requirements
  (framework_code, requirement_code, section, title, response_type, metric_key, sort_order) VALUES
  ('GRI_305', '305-1', 'Emissions', 'Direct (Scope 1) GHG emissions.', 'both', 'scope1_total', 1),
  ('GRI_305', '305-2', 'Emissions', 'Energy indirect (Scope 2) GHG emissions.', 'both', 'scope2_both', 2),
  ('GRI_305', '305-3', 'Emissions', 'Other indirect (Scope 3) GHG emissions.', 'both', 'scope3_total', 3),
  ('GRI_305', '305-4', 'Emissions', 'GHG emissions intensity.', 'both', 'ghg_intensity', 4),
  ('GRI_305', '305-5', 'Emissions', 'Reduction of GHG emissions.', 'both', 'targets', 5),
  ('GRI_305', '305-6', 'Emissions', 'Emissions of ozone-depleting substances (ODS).', 'narrative', NULL, 6),
  ('GRI_305', '305-7', 'Emissions', 'Nitrogen oxides (NOx), sulfur oxides (SOx), and other significant air emissions.', 'narrative', NULL, 7)
ON CONFLICT (framework_code, requirement_code) DO NOTHING;
