-- ============================================================
-- EHS Carbon Accounting Platform — Reference Table RLS
-- Migration 013
-- ============================================================
-- The global reference tables (emission factors, Scope 3 categories, the
-- disclosure framework catalog) were created with a GRANT but no RLS policy,
-- on the assumption RLS would stay disabled for them. That assumption is
-- fragile: Supabase surfaces a "RLS disabled" security warning for every table
-- in the public schema, and enabling it from that prompt leaves the table with
-- RLS ON and NO policies — which makes reads return ZERO ROWS WITHOUT AN
-- ERROR. The application then renders an empty page and there is nothing in
-- the logs to explain it.
--
-- This migration makes the intent explicit and self-healing: RLS on, with a
-- read policy for authenticated users. These tables hold published reference
-- data (EPA/eGRID/IPCC factors, GHG Protocol categories, framework structures)
-- that every tenant is meant to read, so an unrestricted SELECT is correct —
-- but it is now stated in the schema rather than implied by its absence.
--
-- Writes remain closed: no INSERT/UPDATE/DELETE policies, so these tables can
-- only be modified by the service role or a migration.
--
-- RE-RUNNABLE.
-- ============================================================

DO $$
DECLARE
  t TEXT;
  reference_tables TEXT[] := ARRAY[
    'scope1_emission_factors',
    'scope2_emission_factors',
    'refrigerant_factors',
    'scope3_categories',
    'disclosure_frameworks',
    'disclosure_requirements'
  ];
BEGIN
  FOREACH t IN ARRAY reference_tables LOOP
    -- Skip tables that do not exist yet (e.g. 010/011 not applied).
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Skipping % — table not present.', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read_authenticated', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      t || '_read_authenticated', t
    );

    RAISE NOTICE 'Reference table % — RLS enabled with authenticated read policy.', t;
  END LOOP;
END $$;
