-- ============================================================
-- Install verification
-- ============================================================
-- Run this in the Supabase SQL editor after applying every migration (001–040). It answers one
-- question: did the install actually produce a working database?
--
-- Reads only. Safe to run at any time, on any environment, as often as you like.
-- Every row comes back PASS or FAIL; a FAIL row names what to do about it.
--
-- The checks are ordered by how badly a failure hurts. The RLS ones are not
-- ceremony: migration 013 records that a table with RLS ENABLED and NO POLICY
-- returns zero rows with no error and nothing in the logs, which presents as
-- "the app loads but every page is empty" and is close to undiagnosable from
-- the front end.
-- ============================================================

WITH
expected_tables(name) AS (VALUES
  ('organizations'), ('users'), ('sites'), ('business_units'), ('site_groups'),
  ('site_group_members'), ('site_equipment'),
  ('emission_entries'), ('ehs_entries'), ('scope3_entries'),
  ('scope1_emission_factors'), ('scope2_emission_factors'), ('refrigerant_factors'),
  ('custom_emission_factors'), ('scope3_categories'), ('scope3_factors'),
  ('goals'), ('projects'),
  ('suppliers'), ('supplier_surveys'), ('supplier_survey_invitations'),
  ('supplier_survey_responses'), ('supplier_survey_questions'),
  ('supplier_survey_question_responses'),
  ('cbam_calculations'), ('cbam_supplier_factors'),
  ('disclosure_frameworks'), ('disclosure_requirements'), ('disclosure_responses'),
  ('materiality_assessments'), ('material_topics'), ('topic_assessments'),
  ('stakeholder_ratings'), ('requirement_topics'),
  ('audit_log'), ('evidence_attachments'), ('sustainability_metrics'),
  ('regulatory_items'), ('regulatory_updates'),
  ('regulatory_source_snapshots'), ('regulatory_watch_runs'),
  ('regulatory_change_proposals'), ('regulatory_capabilities'),
  ('regulatory_frameworks'), ('regulatory_relationships'), ('regulatory_glossary'),
  ('business_metrics'), ('business_metric_values'),
  ('import_batches'), ('import_batch_rows'), ('import_row_adjustments')
),

-- 1. Every table the application expects exists.
missing_tables AS (
  SELECT e.name FROM expected_tables e
  WHERE to_regclass('public.' || e.name) IS NULL
),

-- 2. Tables with RLS on but no policy — the silent-empty-page failure.
rls_no_policy AS (
  SELECT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
),

-- 3. Tenant tables that should have RLS but do not.
tenant_no_rls AS (
  SELECT c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND a.attnum > 0
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
),

-- 4. Crosswalk edges pointing at a code that does not exist.
-- Either end of a relationship may name a framework or a single workstream, so
-- neither column can be a foreign key and nothing in the schema catches a typo.
-- An edge with a dangling end renders as a bare code string next to a claim
-- that two regimes conflict, which reads as a fact about a rule the reader has
-- never heard of rather than as the data error it is.
dangling_edges AS (
  SELECT r.from_code, r.to_code, r.relation
  FROM regulatory_relationships r
  WHERE r.is_active
    AND (
      (    NOT EXISTS (SELECT 1 FROM regulatory_frameworks f WHERE f.code = r.from_code)
       AND NOT EXISTS (SELECT 1 FROM regulatory_items      i WHERE i.code = r.from_code))
      OR
      (    NOT EXISTS (SELECT 1 FROM regulatory_frameworks f WHERE f.code = r.to_code)
       AND NOT EXISTS (SELECT 1 FROM regulatory_items      i WHERE i.code = r.to_code))
    )
),

-- 6. Supporting documents whose record no longer exists. The attachment is
-- polymorphic with no foreign key, so a hard delete cannot cascade to it; the
-- application removes them after each delete, and Settings → Organization →
-- "Remove unlinked documents" sweeps up any left behind (a delete in SQL, say).
orphan_evidence AS (
  SELECT e.id
  FROM evidence_attachments e
  WHERE NOT CASE e.record_type
    WHEN 'emission_entry'         THEN EXISTS (SELECT 1 FROM emission_entries        t WHERE t.id = e.record_id)
    WHEN 'ehs_entry'              THEN EXISTS (SELECT 1 FROM ehs_entries             t WHERE t.id = e.record_id)
    WHEN 'scope3_entry'           THEN EXISTS (SELECT 1 FROM scope3_entries          t WHERE t.id = e.record_id)
    WHEN 'custom_emission_factor' THEN EXISTS (SELECT 1 FROM custom_emission_factors t WHERE t.id = e.record_id)
    WHEN 'disclosure_response'    THEN EXISTS (SELECT 1 FROM disclosure_responses    t WHERE t.id = e.record_id)
    WHEN 'supplier'               THEN EXISTS (SELECT 1 FROM suppliers               t WHERE t.id = e.record_id)
    WHEN 'site'                   THEN EXISTS (SELECT 1 FROM sites                   t WHERE t.id = e.record_id)
    WHEN 'goal'                   THEN EXISTS (SELECT 1 FROM goals                   t WHERE t.id = e.record_id)
    WHEN 'project'                THEN EXISTS (SELECT 1 FROM projects                t WHERE t.id = e.record_id)
    WHEN 'business_metric_value'  THEN EXISTS (SELECT 1 FROM business_metric_values  t WHERE t.id = e.record_id)
    WHEN 'materiality_assessment' THEN EXISTS (SELECT 1 FROM materiality_assessments t WHERE t.id = e.record_id)
    ELSE TRUE
  END
),

-- 5. Committed import rows whose entry no longer exists.
-- created_entry_table names emission_entries or ehs_entries and cannot be a
-- foreign key, because one column cannot reference two tables. A committed row
-- pointing at a deleted entry breaks the lineage the staged importer exists to
-- provide: the reviewer's decision survives while the number it produced does
-- not, which reads as a record of something that never happened.
orphan_import_rows AS (
  SELECT r.id, r.line_number, r.created_entry_table
  FROM import_batch_rows r
  WHERE r.status = 'committed'
    AND (
      (r.created_entry_table = 'emission_entries'
       AND NOT EXISTS (SELECT 1 FROM emission_entries e WHERE e.id = r.created_entry_id))
      OR
      (r.created_entry_table = 'ehs_entries'
       AND NOT EXISTS (SELECT 1 FROM ehs_entries e WHERE e.id = r.created_entry_id))
    )
),

checks(sort_key, check_name, status, detail) AS (

  SELECT 1, 'Schema — all expected tables present',
    CASE WHEN (SELECT count(*) FROM missing_tables) = 0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN (SELECT count(*) FROM missing_tables) = 0
      THEN (SELECT count(*)::text FROM expected_tables) || ' tables found'
      ELSE 'Missing: ' || (SELECT string_agg(name, ', ' ORDER BY name) FROM missing_tables)
        || '. Re-apply the migration that creates them; migrations 008+ are safe to re-run.'
    END

  UNION ALL SELECT 2, 'Security — no table has RLS enabled without a policy',
    CASE WHEN (SELECT count(*) FROM rls_no_policy) = 0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN (SELECT count(*) FROM rls_no_policy) = 0
      THEN 'None. (This is the failure that shows as empty pages with no error.)'
      ELSE 'RLS on, zero policies: ' || (SELECT string_agg(relname, ', ' ORDER BY relname) FROM rls_no_policy)
        || '. Re-apply 002 and 013.'
    END

  UNION ALL SELECT 3, 'Security — every tenant table has RLS enabled',
    CASE WHEN (SELECT count(*) FROM tenant_no_rls) = 0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN (SELECT count(*) FROM tenant_no_rls) = 0
      THEN 'All organization_id tables are protected'
      ELSE 'Unprotected: ' || (SELECT string_agg(relname, ', ' ORDER BY relname) FROM tenant_no_rls)
        || '. This is a tenant data leak. Re-apply 002 before going further.'
    END

  UNION ALL SELECT 4, 'Reference data — Scope 1 emission factors seeded',
    CASE WHEN (SELECT count(*) FROM scope1_emission_factors) > 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM scope1_emission_factors) || ' factors. Re-apply 003 if zero.'

  UNION ALL SELECT 5, 'Reference data — Scope 2 grid factors seeded',
    CASE WHEN (SELECT count(*) FROM scope2_emission_factors) > 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM scope2_emission_factors) || ' factors. Re-apply 003 if zero.'

  UNION ALL SELECT 6, 'Reference data — refrigerant GWP values seeded',
    CASE WHEN (SELECT count(*) FROM refrigerant_factors) > 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM refrigerant_factors) || ' refrigerants. Re-apply 003 if zero.'

  UNION ALL SELECT 7, 'Reference data — all 15 Scope 3 categories present',
    CASE WHEN (SELECT count(*) FROM scope3_categories) = 15 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM scope3_categories) || ' of 15. Re-apply 010 if short.'

  UNION ALL SELECT 8, 'Reference data — disclosure frameworks loaded',
    CASE WHEN (SELECT count(*) FROM disclosure_frameworks) > 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM disclosure_frameworks) || ' frameworks, '
      || (SELECT count(*)::text FROM disclosure_requirements) || ' requirements. Re-apply 011 and 014 if zero.'

  UNION ALL SELECT 9, 'Reference data — sustainability metric catalog seeded',
    CASE WHEN (SELECT count(*) FROM sustainability_metrics) > 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM sustainability_metrics) || ' metrics ('
      || (SELECT count(*)::text FROM sustainability_metrics WHERE pillar='social') || ' social, '
      || (SELECT count(*)::text FROM sustainability_metrics WHERE pillar='governance') || ' governance). Re-apply 023 if zero.'

  UNION ALL SELECT 10, 'Schema — ehs_entries accepts the social and governance families',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'ehs_entries_metric_type_families'
        AND pg_get_constraintdef(oid) LIKE '%governance%'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Without this, only water and waste can be entered. Re-apply 023.'

  UNION ALL SELECT 11, 'Schema — ehs_entries.site_id is nullable for entity-level metrics',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ehs_entries'
        AND column_name='site_id' AND is_nullable='YES'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Board composition and corruption cases belong to the org, not a site. Re-apply 023.'

  UNION ALL SELECT 12, 'Auditability — append-only audit triggers installed',
    CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_audit_%' AND NOT tgisinternal) > 0
      THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM pg_trigger WHERE tgname LIKE 'trg_audit_%' AND NOT tgisinternal)
      || ' audit triggers. Re-apply 008 and 019 if zero.'

  UNION ALL SELECT 13, 'Auditability — evidence storage bucket exists',
    CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'evidence') THEN 'PASS' ELSE 'FAIL' END,
    'Private bucket for source documents. Re-apply 019 if missing.'

  UNION ALL SELECT 14, 'Reference data — regulatory tracker seeded',
    CASE WHEN (SELECT count(*) FROM regulatory_items) > 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM regulatory_items) || ' regimes tracked, oldest verification '
      || COALESCE((SELECT min(last_verified)::text FROM regulatory_items), 'n/a')
      || '. Re-apply 024 if zero.'

  UNION ALL SELECT 15, 'Integrity — every tracked regime carries at least one source',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM regulatory_items WHERE jsonb_array_length(sources) = 0
    ) THEN 'PASS' ELSE 'FAIL' END,
    'An unsourced regulatory claim is not storable by design (024). A failure here means the constraint was dropped.'

  UNION ALL SELECT 16, 'Integrity — a watch proposal cannot carry the reviewer''s signature fields',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'reg_proposals_patch_scope'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Stops an automated proposal setting confidence or last_verified — the fields that make the freshness badge mean a human checked. Re-apply 025.'

  UNION ALL SELECT 17, 'Reference data — regulatory capability map seeded',
    CASE WHEN (SELECT count(*) FROM regulatory_capabilities) > 0 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM regulatory_capabilities) || ' capability links across '
      || (SELECT count(DISTINCT item_code)::text FROM regulatory_capabilities) || ' regimes ('
      || (SELECT count(*)::text FROM regulatory_capabilities WHERE probe = 'not_built')
      || ' recorded gaps). Re-apply 026 if zero.'

  UNION ALL SELECT 18, 'Flexibility — intensity denominators available',
    CASE WHEN (SELECT count(*) FROM business_metrics WHERE organization_id IS NULL) > 0
      THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM business_metrics WHERE organization_id IS NULL)
      || ' starter metrics (revenue, FTE, production volume and so on). Without these the only possible intensity is per square foot. Re-apply 027 if zero.'

  UNION ALL SELECT 19, 'Boundary — consolidation approach recorded',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='organizations' AND column_name='consolidation_approach'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='sites' AND column_name='ownership_percent'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Equity share vs control, with per-site ownership. Without it every inventory is implicitly 100% of everything. Re-apply 028.'

  UNION ALL SELECT 20, 'Integrity — an estimate must state its method',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'emission_entries_estimation_method_required'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'An estimate without its basis is not assurable. Re-apply 029.'

  UNION ALL SELECT 21, 'Access — auditor role available',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'users_role_allowed'
        AND pg_get_constraintdef(oid) LIKE '%auditor%'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Read-only role for assurance providers; writes allowlist admin and editor only. Re-apply 030.'

  UNION ALL SELECT 22, 'Integrity — custom factor window uniqueness enforced',
    CASE WHEN EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='custom_emission_factors'
        AND indexdef LIKE '%UNIQUE%'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Stops two factors claiming the same effective window. Re-apply 018.'

  UNION ALL SELECT 23, 'Integrity — every crosswalk edge names a code that exists',
    CASE WHEN (SELECT count(*) FROM dangling_edges) = 0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN (SELECT count(*) FROM dangling_edges) = 0
      THEN (SELECT count(*)::text FROM regulatory_relationships WHERE is_active)
        || ' relationships, both ends resolving to a framework or a workstream'
      ELSE (SELECT count(*)::text FROM dangling_edges) || ' edge(s) point at an unknown code: '
        || (SELECT string_agg(from_code || ' → ' || to_code || ' (' || relation || ')', ', '
              ORDER BY from_code, to_code) FROM dangling_edges)
        || '. Neither end can be a foreign key — either end may name a framework or a '
        || 'workstream — so nothing in the schema catches this. Fix the content pack and re-apply it.'
    END

  UNION ALL SELECT 24, 'Schema — regulatory frameworks, crosswalk and glossary tables present',
    CASE WHEN to_regclass('public.regulatory_frameworks') IS NOT NULL
      AND to_regclass('public.regulatory_relationships') IS NOT NULL
      AND to_regclass('public.regulatory_glossary') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM regulatory_frameworks) || ' frameworks, '
      || (SELECT count(*)::text FROM regulatory_relationships) || ' relationships, '
      || (SELECT count(*)::text FROM regulatory_glossary) || ' glossary terms. '
      || 'These ship empty; load content with regulatory-packs/ or by hand '
      || '(docs/REGULATORY_CONTENT.md). Re-apply 033 if the tables are missing.'

  UNION ALL SELECT 25, 'Integrity — every committed import row still has its entry',
    CASE WHEN (SELECT count(*) FROM orphan_import_rows) = 0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN (SELECT count(*) FROM orphan_import_rows) = 0
      THEN (SELECT count(*)::text FROM import_batch_rows WHERE status = 'committed')
        || ' committed rows, each still resolving to the entry it created'
      ELSE (SELECT count(*)::text FROM orphan_import_rows) || ' committed row(s) point at an entry '
        || 'that no longer exists. created_entry_table cannot be a foreign key — one column '
        || 'cannot reference both entry tables — so nothing in the schema catches this. '
        || 'The adjustment trail survives while the number it produced does not.'
    END

  UNION ALL SELECT 26, 'Integrity — every human import adjustment names its author',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM import_row_adjustments WHERE origin = 'user' AND adjusted_by IS NULL
    ) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT count(*)::text FROM import_row_adjustments WHERE origin = 'user')
      || ' human adjustments, '
      || (SELECT count(*)::text FROM import_row_adjustments WHERE origin = 'auto')
      || ' machine-proposed and unconfirmed. A CHECK enforces the author; a FAIL here means '
      || 'it was dropped, and "who changed this" is the half an assurance provider asks about.'

  UNION ALL SELECT 27, 'Access — a deactivated user resolves to no organization',
    CASE WHEN pg_get_functiondef('public.auth_org_id()'::regprocedure) ILIKE '%is_active%'
      AND pg_get_functiondef('public.auth_user_role()'::regprocedure) ILIKE '%is_active%'
      THEN 'PASS' ELSE 'FAIL' END,
    'Without this, Settings → Deactivate only relabels a user: every RLS policy keeps '
      || 'handing them their organization''s data. Re-apply 037.'

  UNION ALL SELECT 28, 'Auditability — boundary changes are audited',
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_sites')
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_organizations')
      THEN 'PASS' ELSE 'FAIL' END,
    'Ownership share, control, ZIP (the Scope 2 grid factor) and the consolidation approach '
      || 'all change reported totals. Re-apply 037 if missing.'

  UNION ALL SELECT 29, 'Auditability — evidence attaches to every figure-bearing record',
    CASE WHEN pg_get_constraintdef((SELECT oid FROM pg_constraint
           WHERE conname = 'evidence_attachments_record_type_allowed')) LIKE '%materiality_assessment%'
      THEN 'PASS' ELSE 'FAIL' END,
    'Sites, goals, projects, business metric values and materiality assessments can carry '
      || 'supporting documents. Re-apply 037 if this fails.'

  UNION ALL SELECT 30, 'Integrity — every supporting document belongs to a record',
    CASE WHEN (SELECT count(*) FROM orphan_evidence) = 0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN (SELECT count(*) FROM orphan_evidence) = 0
      THEN (SELECT count(*)::text FROM evidence_attachments) || ' attachments, each linked to an existing record'
      ELSE (SELECT count(*)::text FROM orphan_evidence) || ' attachment(s) point at a deleted record. '
        || 'Settings → Organization → Remove unlinked documents removes them and their files.'
    END

  UNION ALL SELECT 31, 'Factors — reference factors corrected to their cited sources',
    CASE WHEN EXISTS (
      SELECT 1 FROM scope1_emission_factors WHERE fuel_type = 'natural_gas' AND factor_source = 'EPA_2024_AR6'
    ) AND NOT EXISTS (
      SELECT 1 FROM scope2_emission_factors WHERE factor_source = 'M-RETS_Greene_2023'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'EPA 2024 fuel factors as CO2e at AR6, eGRID2023 rev. 2 grid rates, AIB 2023 residual mixes, '
      || 'AR6 refrigerant blends. Re-apply 038 if this fails.'

  UNION ALL SELECT 32, 'Scope 2 — market-based figure and lineage on every row',
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='emission_entries' AND column_name='scope2_market_basis'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='emission_entries' AND column_name='co2e_kg_outside_scopes'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Residual mix or disclosed grid average for every Scope 2 row, both factors stored, and biogenic '
      || 'CO2 and Montreal gases kept outside the scopes. Re-apply 039 if this fails.'

  UNION ALL SELECT 33, 'Pipeline — projects count unless marked not counted',
    CASE WHEN (
      SELECT column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='projects' AND column_name='pipeline_inclusion_status'
    ) LIKE '%forecasted%' THEN 'PASS' ELSE 'FAIL' END,
    'Without 040, every project created in the app is stored as excluded and the pipeline '
      || 'now honours that, so coverage reads zero. Re-apply 040.'
)

SELECT
  CASE status WHEN 'PASS' THEN 'PASS' ELSE '>> FAIL' END AS result,
  check_name,
  detail
FROM checks
ORDER BY (status = 'PASS'), sort_key;
