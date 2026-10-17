-- ============================================================
-- EHS Carbon Accounting Platform — CSRD + California Climate Disclosure
-- Migration 014
-- ============================================================
-- Adds three frameworks:
--   CSRD      — the full ESRS standard set adopted under the Corporate
--               Sustainability Reporting Directive
--   CA_SB253  — California Climate Corporate Data Accountability Act
--   CA_SB261  — California Climate-Related Financial Risk Act
--
-- SCOPE OF WHAT IS SEEDED
-- CSRD is seeded at STANDARD level for every ESRS topic, with full
-- disclosure-requirement detail for ESRS 2 (the cross-cutting general
-- disclosures). Titles are taken from Commission Delegated Regulation (EU)
-- 2023/2772. Detailed DR-level content for E2–E5, S1–S4 and G1 is NOT invented
-- here — ESRS runs to roughly a thousand datapoints and getting them wrong in a
-- compliance tool is worse than leaving them to be loaded deliberately. Use the
-- disclosure-requirement CSV import to add that detail. ESRS E1 already has
-- full DR-level detail as its own framework (migration 011).
--
-- ON DEADLINES
-- No filing dates are stored for the California frameworks. SB 253's first-year
-- deadline has been re-noticed by CARB, and SB 261 is subject to a Ninth
-- Circuit injunction with CARB stating it will not enforce the original
-- deadline pending appeal. Encoding a date here would bake in a moving target
-- and give false assurance. The platform tracks WHAT must be disclosed;
-- confirm WHEN against CARB's current rulemaking.
--
-- RE-RUNNABLE.
-- ============================================================

-- ─── Frameworks ──────────────────────────────────────────────────────────────
INSERT INTO disclosure_frameworks (code, name, issuer, version, description, source_ref, sort_order) VALUES
  ('CSRD', 'CSRD — European Sustainability Reporting Standards (ESRS)',
   'EFRAG / European Commission', '2023',
   'The full ESRS set adopted under the Corporate Sustainability Reporting Directive: cross-cutting ESRS 2 plus topical standards E1-E5, S1-S4 and G1. Seeded at standard level, with full disclosure-requirement detail for ESRS 2. ESRS E1 (Climate change) carries its own detailed requirements as a separate framework. Load DR-level detail for the remaining topics via the disclosure-requirement import.',
   'Commission Delegated Regulation (EU) 2023/2772, Annexes I and II', 5),

  ('CA_SB253', 'California SB 253 — Climate Corporate Data Accountability Act',
   'California Air Resources Board (CARB)', 'as amended by SB 219',
   'Requires US entities with more than $1bn annual revenue doing business in California to publicly report Scope 1, 2 and 3 greenhouse gas emissions measured in accordance with the GHG Protocol, with third-party assurance phasing in over time. Reporting deadlines and the assurance phase-in are set by CARB rulemaking and have been re-noticed — confirm current dates with CARB rather than relying on this catalog.',
   'California Health & Safety Code §38532 (SB 253, 2023; amended by SB 219, 2024); CARB implementing regulations', 6),

  ('CA_SB261', 'California SB 261 — Climate-Related Financial Risk Act',
   'California Air Resources Board (CARB)', 'as amended by SB 219',
   'Requires entities with more than $500m annual revenue doing business in California to publish a biennial climate-related financial risk report prepared in accordance with the TCFD recommendations (or IFRS S2), together with the measures adopted to reduce and adapt to the risks identified. NOTE: subject to ongoing litigation — a Ninth Circuit injunction is in effect and CARB has stated it will not enforce the original deadline pending appeal. Verify applicability and timing with counsel.',
   'California Health & Safety Code §38533 (SB 261, 2023; amended by SB 219, 2024)', 7)
ON CONFLICT (code) DO NOTHING;

-- ─── CSRD: ESRS standards (standard level) ───────────────────────────────────
-- Official titles per Reg (EU) 2023/2772.
INSERT INTO disclosure_requirements
  (framework_code, requirement_code, section, title, description, response_type, metric_key, sort_order) VALUES
  ('CSRD', 'ESRS 2', 'Cross-cutting', 'General disclosures',
   'Governance, strategy, impact/risk/opportunity management and metrics & targets disclosures required of every undertaking regardless of material topics.', 'narrative', NULL, 1),
  ('CSRD', 'ESRS E1', 'Environment', 'Climate change',
   'Climate change mitigation and adaptation, energy, GHG emissions and targets. Detailed disclosure requirements E1-1 to E1-9 are maintained in the ESRS E1 framework.', 'both', 'ghg_all_scopes', 2),
  ('CSRD', 'ESRS E2', 'Environment', 'Pollution',
   'Pollution of air, water and soil; substances of concern and of very high concern.', 'narrative', NULL, 3),
  ('CSRD', 'ESRS E3', 'Environment', 'Water and marine resources',
   'Water consumption, withdrawals and discharges, and impacts on marine resources.', 'both', 'water_consumption', 4),
  ('CSRD', 'ESRS E4', 'Environment', 'Biodiversity and ecosystems',
   'Impacts, dependencies, risks and opportunities relating to biodiversity and ecosystems.', 'narrative', NULL, 5),
  ('CSRD', 'ESRS E5', 'Environment', 'Resource use and circular economy',
   'Resource inflows and outflows, waste, and circular economy practices.', 'both', 'waste_total', 6),
  ('CSRD', 'ESRS S1', 'Social', 'Own workforce',
   'Working conditions, equal treatment and opportunities, and other work-related rights for the undertaking''s own workforce.', 'narrative', NULL, 7),
  ('CSRD', 'ESRS S2', 'Social', 'Workers in the value chain',
   'Working conditions and rights of workers in the upstream and downstream value chain.', 'narrative', NULL, 8),
  ('CSRD', 'ESRS S3', 'Social', 'Affected communities',
   'Impacts on communities affected by the undertaking''s operations and value chain.', 'narrative', NULL, 9),
  ('CSRD', 'ESRS S4', 'Social', 'Consumers and end-users',
   'Impacts on consumers and end-users of the undertaking''s products and services.', 'narrative', NULL, 10),
  ('CSRD', 'ESRS G1', 'Governance', 'Business conduct',
   'Corporate culture, protection of whistleblowers, political engagement, payment practices and management of relationships with suppliers.', 'narrative', NULL, 11)
ON CONFLICT (framework_code, requirement_code) DO NOTHING;

-- ─── CSRD: ESRS 2 disclosure requirements (detail) ───────────────────────────
INSERT INTO disclosure_requirements
  (framework_code, requirement_code, section, title, response_type, metric_key, sort_order) VALUES
  ('CSRD', 'BP-1',  'ESRS 2 — Basis for preparation',
   'General basis for preparation of the sustainability statement.', 'narrative', NULL, 20),
  ('CSRD', 'BP-2',  'ESRS 2 — Basis for preparation',
   'Disclosures in relation to specific circumstances.', 'narrative', NULL, 21),
  ('CSRD', 'GOV-1', 'ESRS 2 — Governance',
   'The role of the administrative, management and supervisory bodies.', 'narrative', NULL, 22),
  ('CSRD', 'GOV-2', 'ESRS 2 — Governance',
   'Information provided to and sustainability matters addressed by the administrative, management and supervisory bodies.', 'narrative', NULL, 23),
  ('CSRD', 'GOV-3', 'ESRS 2 — Governance',
   'Integration of sustainability-related performance in incentive schemes.', 'narrative', NULL, 24),
  ('CSRD', 'GOV-4', 'ESRS 2 — Governance',
   'Statement on due diligence.', 'narrative', NULL, 25),
  ('CSRD', 'GOV-5', 'ESRS 2 — Governance',
   'Risk management and internal controls over sustainability reporting.', 'narrative', NULL, 26),
  ('CSRD', 'SBM-1', 'ESRS 2 — Strategy',
   'Strategy, business model and value chain.', 'narrative', NULL, 27),
  ('CSRD', 'SBM-2', 'ESRS 2 — Strategy',
   'Interests and views of stakeholders.', 'narrative', NULL, 28),
  ('CSRD', 'SBM-3', 'ESRS 2 — Strategy',
   'Material impacts, risks and opportunities and their interaction with strategy and business model.', 'narrative', NULL, 29),
  ('CSRD', 'IRO-1', 'ESRS 2 — Impact, risk and opportunity management',
   'Description of the process to identify and assess material impacts, risks and opportunities.', 'narrative', NULL, 30),
  ('CSRD', 'IRO-2', 'ESRS 2 — Impact, risk and opportunity management',
   'Disclosure requirements in ESRS covered by the undertaking''s sustainability statement.', 'narrative', NULL, 31)
ON CONFLICT (framework_code, requirement_code) DO NOTHING;

-- ─── California SB 253 ───────────────────────────────────────────────────────
INSERT INTO disclosure_requirements
  (framework_code, requirement_code, section, title, description, response_type, metric_key, sort_order) VALUES
  ('CA_SB253', 'Scope 1', 'GHG emissions', 'Scope 1 greenhouse gas emissions.',
   'Direct emissions from sources the entity owns or controls, measured and reported in conformance with the GHG Protocol Corporate Standard.', 'both', 'scope1_total', 1),
  ('CA_SB253', 'Scope 2', 'GHG emissions', 'Scope 2 greenhouse gas emissions.',
   'Indirect emissions from purchased electricity, steam, heating and cooling, per the GHG Protocol Scope 2 Guidance.', 'both', 'scope2_both', 2),
  ('CA_SB253', 'Scope 3', 'GHG emissions', 'Scope 3 greenhouse gas emissions.',
   'Value-chain emissions per the GHG Protocol Corporate Value Chain (Scope 3) Standard. Phased in after the first Scope 1 and 2 reporting year.', 'both', 'scope3_total', 3),
  ('CA_SB253', 'Assurance', 'Assurance', 'Third-party assurance over reported emissions.',
   'Assurance obtained from an independent provider. The required level phases in over time under CARB rulemaking — confirm the level applicable to the reporting year.', 'narrative', NULL, 4),
  ('CA_SB253', 'Basis', 'Basis of preparation', 'Measurement basis, organizational boundary and methodology.',
   'Statement of the organizational boundary, consolidation approach, emission factors applied and their sources.', 'narrative', NULL, 5)
ON CONFLICT (framework_code, requirement_code) DO NOTHING;

-- ─── California SB 261 ───────────────────────────────────────────────────────
-- Structured on the TCFD pillars, which the statute names as the basis.
INSERT INTO disclosure_requirements
  (framework_code, requirement_code, section, title, description, response_type, metric_key, sort_order) VALUES
  ('CA_SB261', 'Governance', 'Climate-related financial risk', 'Governance of climate-related financial risks.',
   'Board and management oversight of climate-related financial risks, per the TCFD recommendations.', 'narrative', NULL, 1),
  ('CA_SB261', 'Strategy', 'Climate-related financial risk', 'Climate-related financial risks and their impact on the business.',
   'Material physical and transition risks over the short, medium and long term, and their effect on strategy and financial planning.', 'narrative', NULL, 2),
  ('CA_SB261', 'Risk Management', 'Climate-related financial risk', 'Processes for identifying, assessing and managing climate-related financial risks.',
   'How climate-related financial risks are identified, assessed and integrated into overall risk management.', 'narrative', NULL, 3),
  ('CA_SB261', 'Metrics and Targets', 'Climate-related financial risk', 'Metrics and targets used to assess and manage climate-related financial risks.',
   'Metrics and targets applied, including greenhouse gas emissions where used to assess risk.', 'both', 'ghg_all_scopes', 4),
  ('CA_SB261', 'Measures Adopted', 'Risk mitigation', 'Measures adopted to reduce and adapt to climate-related financial risk.',
   'Actions taken to mitigate and adapt to the risks identified, as required by the statute in addition to the TCFD-aligned disclosure.', 'narrative', NULL, 5)
ON CONFLICT (framework_code, requirement_code) DO NOTHING;
