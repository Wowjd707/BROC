-- ============================================================
-- DEMO DATA — loads into YOUR existing organization
-- ============================================================
-- Unlike seed.sql (which builds a standalone demo org with its own auth
-- users), this script attaches demo data to the organization that already
-- exists in this database — the one you created by signing up. That matters
-- because RLS scopes everything to your org: data seeded into a different org
-- would be invisible in the app.
--
-- Run it in the Supabase SQL editor AFTER migrations 001-035.
-- Safe to re-run: every row is tagged and existing demo rows are cleared first.
--
-- WHAT IS AND ISN'T REAL
--   * Scope 1/2 emission factors are the REAL seeded reference factors
--     (EPA 2024, eGRID2023, IPCC AR6) — the calculations are genuine and
--     traceable.
--   * Activity quantities are synthetic.
--   * Scope 3 factors are INVENTED and labelled 'DEMO DATA — not for
--     reporting'. Do not use them for anything real; load a licensed library
--     (EPA USEEIO / DEFRA / WARM) for actual reporting.
--
-- TO REMOVE ALL DEMO DATA: see the purge block at the bottom of this file.
-- ============================================================

DO $$
DECLARE
  v_org        UUID;
  v_user       UUID;
  v_hq         UUID;
  v_plant      UUID;
  v_dc         UUID;
  v_goal       UUID;
  v_sup_steel  UUID;
  v_sup_pack   UUID;
  v_sup_elec   UUID;
  v_survey     UUID;
  v_inv        UUID;
  v_req        UUID;
  d            DATE;
  m            INT;
  yr           INT;
  seasonal     NUMERIC;
  trend        NUMERIC;
  kwh          NUMERIC;
  therms       NUMERIC;
  gal          NUMERIC;
  v_site       UUID;
  v_assess     UUID;
BEGIN
  -- ── Resolve target org + a user to attribute rows to ──────────────────────
  SELECT id INTO v_org FROM organizations ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization found. Sign up in the app first, then re-run this script.';
  END IF;
  SELECT id INTO v_user FROM users WHERE organization_id = v_org ORDER BY created_at LIMIT 1;

  RAISE NOTICE 'Seeding demo data into organization %', v_org;

  -- ── Clear any previous demo rows (idempotent re-run) ──────────────────────
  DELETE FROM scope3_entries  WHERE organization_id = v_org AND notes = '[DEMO]';
  DELETE FROM scope3_factors  WHERE organization_id = v_org AND notes = '[DEMO]';
  DELETE FROM emission_entries WHERE organization_id = v_org AND notes LIKE '[DEMO]%';
  DELETE FROM ehs_entries      WHERE organization_id = v_org AND notes LIKE '[DEMO]%';
  DELETE FROM cbam_supplier_factors WHERE organization_id = v_org AND notes = '[DEMO]';
  DELETE FROM projects         WHERE organization_id = v_org AND notes = '[DEMO]';
  DELETE FROM goals            WHERE organization_id = v_org AND notes = '[DEMO]';
  DELETE FROM business_metric_values WHERE organization_id = v_org AND notes = '[DEMO]';
  DELETE FROM site_equipment   WHERE organization_id = v_org AND notes = '[DEMO]';
  DELETE FROM custom_emission_factors WHERE organization_id = v_org AND notes = '[DEMO]';
  DELETE FROM materiality_assessments WHERE organization_id = v_org AND methodology = '[DEMO]';

  -- ── Organization defaults ─────────────────────────────────────────────────
  UPDATE organizations
     SET industry = COALESCE(industry, 'Manufacturing'),
         base_year = COALESCE(base_year, 2025)
   WHERE id = v_org;

  -- ── Sites ─────────────────────────────────────────────────────────────────
  -- ZIPs match rows seeded in 003 so Scope 2 factors resolve properly.
  SELECT id INTO v_hq FROM sites WHERE organization_id = v_org AND name = 'HQ Office';
  IF v_hq IS NULL THEN
    INSERT INTO sites (organization_id, name, site_type, address, city, state, zip_code, country, floor_area_sqft)
    VALUES (v_org, 'HQ Office', 'office', '200 S Tryon St', 'Charlotte', 'NC', '28202', 'USA', 45000)
    RETURNING id INTO v_hq;
  END IF;

  SELECT id INTO v_plant FROM sites WHERE organization_id = v_org AND name = 'Main Plant';
  IF v_plant IS NULL THEN
    INSERT INTO sites (organization_id, name, site_type, address, city, state, zip_code, country, floor_area_sqft)
    VALUES (v_org, 'Main Plant', 'manufacturing', '1400 W Randolph St', 'Chicago', 'IL', '60601', 'USA', 180000)
    RETURNING id INTO v_plant;
  END IF;

  SELECT id INTO v_dc FROM sites WHERE organization_id = v_org AND name = 'Distribution Center';
  IF v_dc IS NULL THEN
    INSERT INTO sites (organization_id, name, site_type, address, city, state, zip_code, country, floor_area_sqft)
    VALUES (v_org, 'Distribution Center', 'warehouse', '500 E 5th St', 'Austin', 'TX', '78701', 'USA', 95000)
    RETURNING id INTO v_dc;
  END IF;

  -- ── Emission + EHS entries: Jan 2025 → Jul 2026 ───────────────────────────
  -- 2025 is a full prior year; 2026 runs to the current month so the dashboard
  -- shows a live year-over-year comparison.
  FOR d IN
    SELECT generate_series(DATE '2025-01-01', DATE '2026-07-01', INTERVAL '1 month')::date
  LOOP
    m  := EXTRACT(MONTH FROM d);
    yr := EXTRACT(YEAR  FROM d);
    -- Heating/cooling seasonality, and a gentle downward trend year over year.
    seasonal := 1 + 0.18 * COS(2 * PI() * (m - 1) / 12.0);
    trend    := CASE WHEN yr = 2026 THEN 0.94 ELSE 1.0 END;

    -- ── Electricity (Scope 2, location-based) ──
    -- HQ Office · Charlotte 28202 → SRVC 0.2870 kg/kWh (eGRID2023)
    kwh := ROUND(58000 * seasonal * trend);
    INSERT INTO emission_entries (organization_id, site_id, entry_date, scope, source_type,
      quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based,
      accounting_method, emission_factor_used, emission_factor_source, notes, created_by)
    VALUES (v_org, v_hq, d + 27, 'scope2', 'electricity',
      kwh, 'kWh', kwh, 'kWh', kwh * 0.2870, kwh * 0.2870,
      'location_based', 0.2870, 'eGRID2023', '[DEMO] Monthly utility bill', v_user);

    -- Main Plant · Chicago 60601 → RFCW 0.5423 kg/kWh
    kwh := ROUND(410000 * seasonal * trend);
    INSERT INTO emission_entries (organization_id, site_id, entry_date, scope, source_type,
      quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based,
      accounting_method, emission_factor_used, emission_factor_source, notes, created_by)
    VALUES (v_org, v_plant, d + 27, 'scope2', 'electricity',
      kwh, 'kWh', kwh, 'kWh', kwh * 0.5423, kwh * 0.5423,
      'location_based', 0.5423, 'eGRID2023', '[DEMO] Monthly utility bill', v_user);

    -- Distribution Center · Austin 78701 → ERCT 0.3618 kg/kWh
    kwh := ROUND(96000 * seasonal * trend);
    INSERT INTO emission_entries (organization_id, site_id, entry_date, scope, source_type,
      quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based,
      accounting_method, emission_factor_used, emission_factor_source, notes, created_by)
    VALUES (v_org, v_dc, d + 27, 'scope2', 'electricity',
      kwh, 'kWh', kwh, 'kWh', kwh * 0.3618, kwh * 0.3618,
      'location_based', 0.3618, 'eGRID2023', '[DEMO] Monthly utility bill', v_user);

    -- ── Natural gas (Scope 1) — therms → MMBtu × 53.06 kg/MMBtu (EPA_2024) ──
    therms := ROUND(14500 * (1 + 0.55 * COS(2 * PI() * (m - 1) / 12.0)) * trend);
    INSERT INTO emission_entries (organization_id, site_id, entry_date, scope, source_type, scope1_category,
      quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based,
      accounting_method, emission_factor_used, emission_factor_source, notes, created_by)
    VALUES (v_org, v_plant, d + 27, 'scope1', 'natural_gas', 'stationary_combustion',
      therms, 'therms', therms * 0.1, 'MMBtu', therms * 0.1 * 53.06, therms * 0.1 * 53.06,
      'location_based', 53.06, 'EPA_2024', '[DEMO] Process heat + building heating', v_user);

    -- Smaller gas load at HQ
    therms := ROUND(1800 * (1 + 0.7 * COS(2 * PI() * (m - 1) / 12.0)) * trend);
    IF therms > 0 THEN
      INSERT INTO emission_entries (organization_id, site_id, entry_date, scope, source_type, scope1_category,
        quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based,
        accounting_method, emission_factor_used, emission_factor_source, notes, created_by)
      VALUES (v_org, v_hq, d + 27, 'scope1', 'natural_gas', 'stationary_combustion',
        therms, 'therms', therms * 0.1, 'MMBtu', therms * 0.1 * 53.06, therms * 0.1 * 53.06,
        'location_based', 53.06, 'EPA_2024', '[DEMO] Building heating', v_user);
    END IF;

    -- ── Fleet diesel (Scope 1) — gal × 0.13756 MMBtu × 73.96 kg/MMBtu ──
    gal := ROUND(3200 * trend);
    INSERT INTO emission_entries (organization_id, site_id, entry_date, scope, source_type, scope1_category,
      quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based,
      accounting_method, emission_factor_used, emission_factor_source, notes, created_by)
    VALUES (v_org, v_dc, d + 27, 'scope1', 'diesel', 'mobile_combustion',
      gal, 'gallons', gal * 0.13756, 'MMBtu', gal * 0.13756 * 73.96, gal * 0.13756 * 73.96,
      'location_based', 73.96, 'EPA_2024', '[DEMO] Delivery fleet fuel card', v_user);

    -- ── Water + waste ──
    INSERT INTO ehs_entries (organization_id, site_id, entry_date, metric_type, source_type,
      quantity, unit, quantity_normalized, unit_normalized, notes, created_by)
    VALUES
      (v_org, v_plant, d + 27, 'water', 'municipal_consumption',
       ROUND(185000 * seasonal * trend), 'gallons', ROUND(185000 * seasonal * trend), 'gallons',
       '[DEMO] Plant process + sanitary water', v_user),
      (v_org, v_hq, d + 27, 'water', 'municipal_consumption',
       ROUND(24000 * seasonal * trend), 'gallons', ROUND(24000 * seasonal * trend), 'gallons',
       '[DEMO] Office water', v_user),
      (v_org, v_plant, d + 27, 'waste', 'non_hazardous_recycled',
       ROUND(9800 * trend), 'kg', ROUND(9800 * trend), 'kg', '[DEMO] Scrap metal + cardboard', v_user),
      (v_org, v_plant, d + 27, 'waste', 'non_hazardous_landfilled',
       ROUND(6400 * trend), 'kg', ROUND(6400 * trend), 'kg', '[DEMO] General plant waste', v_user),
      (v_org, v_plant, d + 27, 'waste', 'hazardous_treated',
       ROUND(520 * trend), 'kg', ROUND(520 * trend), 'kg', '[DEMO] Solvents + machining coolant', v_user);
  END LOOP;

  -- ── Refrigerant top-ups (Scope 1) — kg × GWP 2088 (R-410A, IPCC_AR6) ──────
  INSERT INTO emission_entries (organization_id, site_id, entry_date, scope, source_type, scope1_category, source_detail,
    quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based,
    accounting_method, emission_factor_used, emission_factor_source, notes, created_by)
  VALUES
    (v_org, v_plant, DATE '2025-06-18', 'scope1', 'refrigerants', 'fugitive_emissions', 'R-410A',
     34, 'kg', 34, 'kg', 34 * 2088, 34 * 2088, 'location_based', 2088, 'IPCC_AR6',
     '[DEMO] Chiller recharge after leak repair', v_user),
    (v_org, v_plant, DATE '2026-05-12', 'scope1', 'refrigerants', 'fugitive_emissions', 'R-410A',
     21, 'kg', 21, 'kg', 21 * 2088, 21 * 2088, 'location_based', 2088, 'IPCC_AR6',
     '[DEMO] Annual chiller service', v_user);

  -- ── Market-based Scope 2: a renewable PPA at the plant (2026) ─────────────
  INSERT INTO emission_entries (organization_id, site_id, entry_date, scope, source_type,
    quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based,
    accounting_method, instrument_type, supplier_emission_factor,
    emission_factor_used, emission_factor_source, notes, created_by)
  VALUES (v_org, v_plant, DATE '2026-03-31', 'scope2', 'electricity',
    900000, 'kWh', 900000, 'kWh', 900000 * 0.0, 900000 * 0.5423,
    'market_based', 'ppa', 0.0, 0.0, 'supplier_specific',
    '[DEMO] Wind PPA — Q1 contractual volume', v_user);

  -- ── Goal ──────────────────────────────────────────────────────────────────
  -- target_emissions_kg is set explicitly (4,200,000 × 58%) so the dashboard
  -- goal-progress card has both endpoints it needs to plot.
  INSERT INTO goals (organization_id, name, goal_type, scope, scope_coverage, base_year,
    base_year_emissions_kg, target_year, target_emissions_kg, target_value, target_unit,
    target_reduction_pct, scope2_accounting_method, status, notes)
  VALUES (v_org, 'Cut Scope 1+2 42% by 2030 (SBTi 1.5°C)', 'sbti_15c', 'scope1_2',
    '{scope1,scope2}', 2025, 4200000, 2030, 2436000, 42, 'pct_reduction', 42,
    'location_based', 'active', '[DEMO]')
  RETURNING id INTO v_goal;

  -- ── Projects ──────────────────────────────────────────────────────────────
  INSERT INTO projects (organization_id, site_id, goal_id, name, description, category, status,
    estimated_co2e_reduction_kg_per_year, estimated_cost_usd, estimated_payback_months,
    start_date, completion_date, pipeline_inclusion_status, notes, created_by)
  VALUES
    (v_org, v_plant, v_goal, 'Plant LED retrofit', 'Replace high-bay metal halide with LED across production floor.',
     'energy_efficiency', 'completed', 186000, 240000, 34, DATE '2025-02-01', DATE '2025-08-15',
     'realized', '[DEMO]', v_user),
    (v_org, v_plant, v_goal, 'Compressed air leak program', 'Ultrasonic leak survey and repair on a quarterly cycle.',
     'energy_efficiency', 'in_progress', 74000, 45000, 9, DATE '2026-01-15', NULL,
     'forecasted', '[DEMO]', v_user),
    (v_org, v_dc, v_goal, 'Fleet electrification — phase 1', 'Replace 12 diesel delivery vans with EVs.',
     'fleet', 'approved', 128000, 890000, 96, DATE '2026-09-01', NULL,
     'forecasted', '[DEMO]', v_user),
    (v_org, v_plant, v_goal, 'Rooftop solar 1.2 MW', 'On-site generation covering ~15% of plant load.',
     'renewable_energy', 'idea', 640000, 1750000, 108, NULL, NULL,
     'excluded', '[DEMO]', v_user);

  -- ── Suppliers ─────────────────────────────────────────────────────────────
  SELECT id INTO v_sup_steel FROM suppliers WHERE organization_id = v_org AND name = 'Steelcore Industries';
  IF v_sup_steel IS NULL THEN
    INSERT INTO suppliers (organization_id, name, contact_name, contact_email, country, industry, spend_usd, tier, notes)
    VALUES (v_org, 'Steelcore Industries', 'Maria Chen', 'mchen@steelcore.example', 'Germany', 'steel', 4250000, 1, '[DEMO]')
    RETURNING id INTO v_sup_steel;
  END IF;

  SELECT id INTO v_sup_pack FROM suppliers WHERE organization_id = v_org AND name = 'PackageTech Solutions';
  IF v_sup_pack IS NULL THEN
    INSERT INTO suppliers (organization_id, name, contact_name, contact_email, country, industry, spend_usd, tier, notes)
    VALUES (v_org, 'PackageTech Solutions', 'James Okafor', 'jokafor@packagetech.example', 'USA', 'packaging', 980000, 2, '[DEMO]')
    RETURNING id INTO v_sup_pack;
  END IF;

  SELECT id INTO v_sup_elec FROM suppliers WHERE organization_id = v_org AND name = 'ElectroParts Co.';
  IF v_sup_elec IS NULL THEN
    INSERT INTO suppliers (organization_id, name, contact_name, contact_email, country, industry, spend_usd, tier, notes)
    VALUES (v_org, 'ElectroParts Co.', 'Yuki Tanaka', 'ytanaka@electroparts.example', 'Japan', 'electronics', 2100000, 1, '[DEMO]')
    RETURNING id INTO v_sup_elec;
  END IF;

  -- Supplier-declared CBAM factors (feed the Scope 3 "Supplier data" tab)
  INSERT INTO cbam_supplier_factors (organization_id, supplier_id, supplier_name, cn_code,
    commodity_name, emission_factor, factor_unit, factor_source, notes)
  VALUES
    (v_org, v_sup_steel, 'Steelcore Industries', '7208', 'Hot-rolled coil steel',
     1.842, 'tonne', 'Supplier declaration 2026-02-11', '[DEMO]'),
    (v_org, v_sup_elec, 'ElectroParts Co.', '7601 10', 'Unwrought aluminium',
     12.310, 'tonne', 'Supplier declaration 2026-01-28', '[DEMO]');

  -- ── Supplier survey with responses ────────────────────────────────────────
  SELECT id INTO v_survey FROM supplier_surveys
   WHERE organization_id = v_org AND title = '2026 CBAM Carbon Disclosure';
  IF v_survey IS NULL THEN
    INSERT INTO supplier_surveys (organization_id, title, regulation_type, status, due_date, notes, created_by)
    VALUES (v_org, '2026 CBAM Carbon Disclosure', 'cbam', 'active', DATE '2026-09-30', '[DEMO]', v_user)
    RETURNING id INTO v_survey;
  END IF;

  -- Steelcore: submitted, verified
  INSERT INTO supplier_survey_invitations (survey_id, supplier_id, supplier_name, email, status, sent_at, submitted_at)
  VALUES (v_survey, v_sup_steel, 'Steelcore Industries', 'mchen@steelcore.example',
          'submitted', NOW() - INTERVAL '40 days', NOW() - INTERVAL '31 days')
  ON CONFLICT (survey_id, supplier_id) DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_inv;

  INSERT INTO supplier_survey_question_responses (invitation_id, question_id, answer) VALUES
    (v_inv, 'q1', 'Hot-rolled coil steel, 3–12mm'),
    (v_inv, 'q2_quantity', '2400'),
    (v_inv, 'q2_unit', 'metric_tons'),
    (v_inv, 'q3_co2e_intensity', '1842'),
    (v_inv, 'q4_fuel', 'natural_gas'),
    (v_inv, 'q5_country', 'Germany'),
    (v_inv, 'q6_verified', 'yes'),
    (v_inv, 'q7_verification', 'BV-2026-DE-4417')
  ON CONFLICT (invitation_id, question_id) DO UPDATE SET answer = EXCLUDED.answer;

  -- PackageTech: submitted, self-declared
  INSERT INTO supplier_survey_invitations (survey_id, supplier_id, supplier_name, email, status, sent_at, submitted_at)
  VALUES (v_survey, v_sup_pack, 'PackageTech Solutions', 'jokafor@packagetech.example',
          'submitted', NOW() - INTERVAL '40 days', NOW() - INTERVAL '18 days')
  ON CONFLICT (survey_id, supplier_id) DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_inv;

  INSERT INTO supplier_survey_question_responses (invitation_id, question_id, answer) VALUES
    (v_inv, 'q1', 'Corrugated shipping cartons'),
    (v_inv, 'q2_quantity', '410'),
    (v_inv, 'q2_unit', 'metric_tons'),
    (v_inv, 'q3_co2e_intensity', '640'),
    (v_inv, 'q4_fuel', 'electricity'),
    (v_inv, 'q5_country', 'USA'),
    (v_inv, 'q6_verified', 'no'),
    (v_inv, 'q7_verification', '')
  ON CONFLICT (invitation_id, question_id) DO UPDATE SET answer = EXCLUDED.answer;

  -- ElectroParts: invited, not yet responded (shows a weak supplier score)
  INSERT INTO supplier_survey_invitations (survey_id, supplier_id, supplier_name, email, status, sent_at)
  VALUES (v_survey, v_sup_elec, 'ElectroParts Co.', 'ytanaka@electroparts.example',
          'sent', NOW() - INTERVAL '40 days')
  ON CONFLICT (survey_id, supplier_id) DO NOTHING;

  -- ── Scope 3 factor library (DEMO ONLY — see header) ───────────────────────
  INSERT INTO scope3_factors (organization_id, category_number, method, activity_key, label,
    factor_value, activity_unit, region, factor_source, data_year, effective_from, notes)
  VALUES
    (v_org, 1, 'spend_based', 'demo_fabricated_metal', 'Fabricated metal products (demo)',
     0.42, 'USD', 'US', 'DEMO DATA — not for reporting', 2025, DATE '2025-01-01', '[DEMO]'),
    (v_org, 1, 'spend_based', 'demo_paper_packaging', 'Paper & packaging (demo)',
     0.55, 'USD', 'US', 'DEMO DATA — not for reporting', 2025, DATE '2025-01-01', '[DEMO]'),
    (v_org, 4, 'distance_based', 'demo_road_freight', 'Road freight, average truck (demo)',
     0.11, 'tonne-km', 'US', 'DEMO DATA — not for reporting', 2025, DATE '2025-01-01', '[DEMO]'),
    (v_org, 5, 'waste_type_specific', 'demo_landfill_mixed', 'Mixed waste to landfill (demo)',
     0.58, 'kg', 'US', 'DEMO DATA — not for reporting', 2025, DATE '2025-01-01', '[DEMO]'),
    (v_org, 6, 'distance_based', 'demo_air_short_haul', 'Air travel, short haul (demo)',
     0.16, 'passenger-mile', 'US', 'DEMO DATA — not for reporting', 2025, DATE '2025-01-01', '[DEMO]'),
    (v_org, 7, 'distance_based', 'demo_commute_car', 'Employee commute, average car (demo)',
     0.34, 'mile', 'US', 'DEMO DATA — not for reporting', 2025, DATE '2025-01-01', '[DEMO]');

  -- ── Scope 3 entries — mixed methods and data quality ──────────────────────
  -- Category 1 from supplier-declared primary data (matches the CBAM factors)
  INSERT INTO scope3_entries (organization_id, supplier_id, category_number, entry_date, description,
    calculation_method, activity_value, activity_unit, factor_value, factor_unit, factor_source,
    factor_data_year, co2e_kg, data_quality, notes, created_by)
  VALUES
    (v_org, v_sup_steel, 1, DATE '2026-03-31', 'Hot-rolled coil steel — Steelcore Industries',
     'supplier_specific', 2400, 'tonnes', 1842, 'tonnes',
     'Supplier CBAM survey response (third-party verified: BV-2026-DE-4417)', 2026,
     2400 * 1842, 'primary', '[DEMO]', v_user),
    (v_org, v_sup_pack, 1, DATE '2026-03-31', 'Corrugated cartons — PackageTech Solutions',
     'supplier_specific', 410, 'tonnes', 640, 'tonnes',
     'Supplier CBAM survey response (self-declared)', 2026,
     410 * 640, 'primary', '[DEMO]', v_user),
    (v_org, v_sup_elec, 1, DATE '2026-03-31', 'Electronic components — ElectroParts Co.',
     'spend_based', 2100000, 'USD', 0.42, 'USD', 'DEMO DATA — not for reporting', 2025,
     2100000 * 0.42, 'estimated', '[DEMO]', v_user),
    -- Category 4 upstream freight
    (v_org, NULL, 4, DATE '2026-06-30', 'Inbound road freight — H1',
     'distance_based', 1850000, 'tonne-km', 0.11, 'tonne-km', 'DEMO DATA — not for reporting', 2025,
     1850000 * 0.11, 'secondary', '[DEMO]', v_user),
    -- Category 5 waste
    (v_org, NULL, 5, DATE '2026-06-30', 'Landfilled operational waste — H1',
     'waste_type_specific', 38400, 'kg', 0.58, 'kg', 'DEMO DATA — not for reporting', 2025,
     38400 * 0.58, 'secondary', '[DEMO]', v_user),
    -- Category 6 business travel
    (v_org, NULL, 6, DATE '2026-06-30', 'Employee air travel — H1',
     'distance_based', 740000, 'passenger-mile', 0.16, 'passenger-mile', 'DEMO DATA — not for reporting', 2025,
     740000 * 0.16, 'secondary', '[DEMO]', v_user),
    -- Category 7 commuting
    (v_org, NULL, 7, DATE '2026-06-30', 'Employee commuting — H1 survey extrapolation',
     'distance_based', 1240000, 'mile', 0.34, 'mile', 'DEMO DATA — not for reporting', 2025,
     1240000 * 0.34, 'estimated', '[DEMO]', v_user);

  -- ── A few disclosure narratives so the frameworks show progress ───────────
  -- Skipped cleanly if migration 011 has not been applied yet.
  IF to_regclass('public.disclosure_requirements') IS NULL THEN
    RAISE NOTICE 'Migration 011 not applied — skipping disclosure narratives.';
    RAISE NOTICE 'Demo data loaded. Sign in and open /dashboard.';
    RETURN;
  END IF;

  SELECT id INTO v_req FROM disclosure_requirements
   WHERE framework_code = 'TCFD' AND requirement_code = 'Governance a)';
  IF v_req IS NOT NULL THEN
    INSERT INTO disclosure_responses (organization_id, requirement_id, reporting_year, narrative, status)
    VALUES (v_org, v_req, 2026,
      'The Board retains oversight of climate-related risks and opportunities through the Audit & Risk Committee, '
      'which reviews the climate risk register at each quarterly meeting. The Committee approved the 2030 emissions '
      'reduction target and receives a progress report against it twice yearly. Climate-related capital expenditure '
      'above $500k requires full Board approval.',
      'complete')
    ON CONFLICT (organization_id, requirement_id, reporting_year)
      DO UPDATE SET narrative = EXCLUDED.narrative, status = EXCLUDED.status;
  END IF;

  SELECT id INTO v_req FROM disclosure_requirements
   WHERE framework_code = 'TCFD' AND requirement_code = 'Governance b)';
  IF v_req IS NOT NULL THEN
    INSERT INTO disclosure_responses (organization_id, requirement_id, reporting_year, narrative, status)
    VALUES (v_org, v_req, 2026,
      'Day-to-day management sits with the VP of Operations, supported by a cross-functional Sustainability Working '
      'Group drawn from Operations, Procurement, Finance and Facilities. The Group meets monthly, owns the emissions '
      'inventory and reduction project pipeline, and escalates material risks to the Audit & Risk Committee.',
      'complete')
    ON CONFLICT (organization_id, requirement_id, reporting_year)
      DO UPDATE SET narrative = EXCLUDED.narrative, status = EXCLUDED.status;
  END IF;

  SELECT id INTO v_req FROM disclosure_requirements
   WHERE framework_code = 'TCFD' AND requirement_code = 'Strategy a)';
  IF v_req IS NOT NULL THEN
    INSERT INTO disclosure_responses (organization_id, requirement_id, reporting_year, narrative, status)
    VALUES (v_org, v_req, 2026,
      'Short term (0–3 years): exposure to carbon pricing on imported steel and aluminium under the EU CBAM, and to '
      'electricity price volatility at the Chicago plant. Medium term (3–10 years): customer requirements for verified '
      'product carbon footprints, and tightening efficiency standards for the delivery fleet. Long term (10+ years): '
      'physical risk to the Austin distribution centre from increased frequency of extreme heat days.',
      'in_progress')
    ON CONFLICT (organization_id, requirement_id, reporting_year)
      DO UPDATE SET narrative = EXCLUDED.narrative, status = EXCLUDED.status;
  END IF;

  SELECT id INTO v_req FROM disclosure_requirements
   WHERE framework_code = 'GRI_305' AND requirement_code = '305-6';
  IF v_req IS NOT NULL THEN
    INSERT INTO disclosure_responses (organization_id, requirement_id, reporting_year, narrative, status)
    VALUES (v_org, v_req, 2026, NULL, 'not_material')
    ON CONFLICT (organization_id, requirement_id, reporting_year)
      DO UPDATE SET status = EXCLUDED.status;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- Modules added after this script was first written (migrations 023-035)
  -- ══════════════════════════════════════════════════════════════════════════
  -- Everything above predates the social and governance families, business
  -- metrics, materiality scoring, custom factors and the equipment profile, so
  -- those screens had nothing to show. Same conventions as above: every row is
  -- tagged [DEMO], and organization_id is set explicitly because auth_org_id()
  -- returns NULL when this runs as the database owner rather than as a
  -- signed-in user.

  -- ── Safety, workforce and training (18 months, site level) ────────────────
  -- Units are the canonical ones from sustainability_metrics and have to match
  -- exactly: hours_worked is 'hours', lost_days is 'days', everything else is
  -- 'count'. A count stored as hours is the trap migration 023 was shaped to
  -- avoid — one family, more than one unit.
  FOR m IN 0..17 LOOP
    d := (date_trunc('month', CURRENT_DATE) - (m || ' months')::INTERVAL + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

    FOREACH v_site IN ARRAY ARRAY[v_plant, v_dc] LOOP
      -- Hours worked: the denominator every safety rate divides by. Stored on
      -- its own rather than as part of a rate, because lib/social-metrics-core
      -- computes TRIR and DART from the raw inputs and a stored rate cannot be
      -- recomputed on a different hours basis.
      INSERT INTO ehs_entries (organization_id, site_id, entry_date, metric_type, source_type,
                               quantity, unit, quantity_normalized, unit_normalized, notes, created_by)
      VALUES (v_org, v_site, d, 'safety', 'hours_worked',
              32000 + (random() * 6000)::INT, 'hours',
              32000 + (random() * 6000)::INT, 'hours', '[DEMO]', v_user);

      -- Incidents are small integers and mostly zero on purpose. A demo where
      -- every month carries an injury teaches the wrong shape of the data.
      INSERT INTO ehs_entries (organization_id, site_id, entry_date, metric_type, source_type,
                               quantity, unit, quantity_normalized, unit_normalized, notes, created_by)
      SELECT v_org, v_site, d, 'safety', s.k, s.v, 'count', s.v, 'count', '[DEMO]', v_user
      FROM (VALUES
        ('recordable_incidents',      (random() * 2.4)::INT),
        ('lost_time_incidents',       (random() * 1.3)::INT),
        ('restricted_duty_incidents', (random() * 1.2)::INT),
        ('near_misses',               3 + (random() * 9)::INT)
      ) AS s(k, v);

      INSERT INTO ehs_entries (organization_id, site_id, entry_date, metric_type, source_type,
                               quantity, unit, quantity_normalized, unit_normalized, notes, created_by)
      VALUES (v_org, v_site, d, 'safety', 'lost_days',
              (random() * 9)::INT, 'days', (random() * 9)::INT, 'days', '[DEMO]', v_user);

      -- Workforce. headcount is point_in_time: these are readings rather than a
      -- flow, and summing twelve of them would report twelve workforces.
      INSERT INTO ehs_entries (organization_id, site_id, entry_date, metric_type, source_type,
                               quantity, unit, quantity_normalized, unit_normalized, notes, created_by)
      SELECT v_org, v_site, d, 'workforce', w.k, w.v, 'count', w.v, 'count', '[DEMO]', v_user
      FROM (VALUES
        ('headcount',                185 + (random() * 40)::INT),
        ('new_hires',                1 + (random() * 5)::INT),
        ('separations_voluntary',    1 + (random() * 4)::INT),
        ('separations_involuntary',  (random() * 2.2)::INT)
      ) AS w(k, v);

      INSERT INTO ehs_entries (organization_id, site_id, entry_date, metric_type, source_type,
                               quantity, unit, quantity_normalized, unit_normalized, notes, created_by)
      SELECT v_org, v_site, d, 'training', t.k, t.v, 'hours', t.v, 'hours', '[DEMO]', v_user
      FROM (VALUES
        ('training_hours',     120 + (random() * 280)::INT),
        ('ehs_training_hours',  40 + (random() * 110)::INT)
      ) AS t(k, v);
    END LOOP;
  END LOOP;

  -- ── Governance (organization level, so site_id is NULL) ───────────────────
  -- Migration 023 made site_id nullable for exactly these: board composition is
  -- a property of the company, not of a plant.
  FOR yr IN (EXTRACT(YEAR FROM CURRENT_DATE)::INT - 1)..(EXTRACT(YEAR FROM CURRENT_DATE)::INT) LOOP
    INSERT INTO ehs_entries (organization_id, site_id, entry_date, metric_type, source_type,
                             quantity, unit, quantity_normalized, unit_normalized, notes, created_by)
    SELECT v_org, NULL, make_date(yr, 12, 31), 'governance', g.k, g.v, 'count', g.v, 'count', '[DEMO]', v_user
    FROM (VALUES
      ('board_seats',                         9),
      ('independent_board_seats',             6),
      ('corruption_incidents_confirmed',      0),
      ('whistleblower_reports',               4 + (random() * 5)::INT),
      ('whistleblower_reports_substantiated', 1 + (random() * 2)::INT),
      ('policy_training_completions',         340 + (random() * 90)::INT)
    ) AS g(k, v);
  END LOOP;

  -- ── Business metrics — the denominators intensity figures divide by ───────
  -- Values only. The metric definitions themselves are seeded globally with a
  -- NULL organization_id, so nothing here defines a new metric.
  DELETE FROM business_metric_values WHERE organization_id = v_org AND notes = '[DEMO]';
  FOR yr IN (EXTRACT(YEAR FROM CURRENT_DATE)::INT - 1)..(EXTRACT(YEAR FROM CURRENT_DATE)::INT) LOOP
    INSERT INTO business_metric_values
      (organization_id, metric_key, reporting_year, site_id, as_of_date, value, notes, created_by)
    SELECT v_org, b.k, yr, NULL, make_date(yr, 12, 31), b.v, '[DEMO]', v_user
    FROM (VALUES
      ('revenue',           182000000 + (yr - 2025) * 9000000),
      ('production_volume',     41000 + (yr - 2025) * 1800),
      ('headcount_fte',           412 + (yr - 2025) * 11),
      ('operating_hours',        6100 + (yr - 2025) * 60)
    ) AS b(k, v);
  END LOOP;

  -- ── Equipment profile ─────────────────────────────────────────────────────
  DELETE FROM site_equipment WHERE organization_id = v_org AND notes = '[DEMO]';
  INSERT INTO site_equipment (organization_id, site_id, name, equipment_type, quantity,
                              manufacturer, energy_source, rated_capacity, capacity_unit, notes)
  VALUES
    (v_org, v_plant, 'Boiler #1',        'boiler',         1, 'Cleaver-Brooks', 'natural_gas',  500, 'hp',   '[DEMO]'),
    (v_org, v_plant, 'Chiller #2',       'chiller',        2, 'Trane',          'electricity',  350, 'tons', '[DEMO]'),
    (v_org, v_plant, 'Air Compressor A', 'air_compressor', 3, 'Atlas Copco',    'electricity',  150, 'hp',   '[DEMO]'),
    (v_org, v_plant, 'Paint Booth',      'paint_booth',    1, NULL,             'natural_gas', NULL, NULL,   '[DEMO]'),
    (v_org, v_dc,    'Rooftop Units',    'rooftop_unit',   6, 'Carrier',        'electricity',   25, 'tons', '[DEMO]'),
    (v_org, v_dc,    'Dock Lighting',    'lighting',       1, NULL,             'electricity', NULL, NULL,   '[DEMO]'),
    (v_org, v_hq,    'Server Room CRAC', 'server_room',    1, 'Liebert',        'electricity',   30, 'tons', '[DEMO]');

  -- ── Materiality assessment with scored topics ─────────────────────────────
  DELETE FROM materiality_assessments WHERE organization_id = v_org AND methodology = '[DEMO]';
  INSERT INTO materiality_assessments (organization_id, reporting_year, name, threshold, methodology)
  VALUES (v_org, EXTRACT(YEAR FROM CURRENT_DATE)::INT,
          'Double materiality assessment', 3, '[DEMO]')
  RETURNING id INTO v_assess;

  -- Scored so the matrix has real spread rather than a diagonal: E1 material on
  -- both axes, S2 and G1 material on one each, several clearly below threshold.
  -- Ratings are illustrative and are not a judgement about any real company.
  INSERT INTO topic_assessments (assessment_id, topic_code,
                                 impact_scale, impact_scope, impact_irremediability, impact_likelihood,
                                 impact_is_actual, impact_is_negative,
                                 financial_magnitude, financial_likelihood, rationale)
  VALUES
    (v_assess, 'E1', 5, 4, 4, 5, TRUE,  TRUE,  5, 4, '[DEMO] Climate change — highest on both axes.'),
    (v_assess, 'E2', 3, 3, 2, 3, TRUE,  TRUE,  2, 2, '[DEMO] Pollution — permitted emissions only.'),
    (v_assess, 'E3', 4, 3, 3, 4, TRUE,  TRUE,  3, 3, '[DEMO] Water — one site sits in a stressed basin.'),
    (v_assess, 'E4', 1, 2, 2, 1, FALSE, TRUE,  1, 1, '[DEMO] Biodiversity — limited land footprint.'),
    (v_assess, 'E5', 4, 4, 3, 4, TRUE,  TRUE,  3, 4, '[DEMO] Circular economy — packaging take-back pressure.'),
    (v_assess, 'S1', 4, 4, 3, 4, TRUE,  TRUE,  3, 3, '[DEMO] Own workforce — safety performance.'),
    (v_assess, 'S2', 4, 5, 4, 3, FALSE, TRUE,  4, 3, '[DEMO] Value chain workers — tier 2 audit coverage.'),
    (v_assess, 'S3', 2, 2, 2, 2, FALSE, TRUE,  1, 2, '[DEMO] Affected communities.'),
    (v_assess, 'S4', 2, 3, 2, 2, TRUE,  FALSE, 2, 2, '[DEMO] Consumers and end users.'),
    (v_assess, 'G1', 3, 3, 3, 3, TRUE,  TRUE,  4, 4, '[DEMO] Business conduct — anti-corruption programme.');

  -- ── A custom emission factor, to exercise the override path ───────────────
  -- A supplier-specific fuel mix is the legitimate reason to override a
  -- published factor, so this exists to make that screen non-empty.
  --
  -- factor_source says DEMO rather than naming a certificate. Inventing a
  -- plausible citation is the one thing this platform must never do, and a
  -- seeded factor citing a supplier document that does not exist would be
  -- indistinguishable from a real one the moment somebody forgot where it came
  -- from. Same convention as the Scope 3 factors above.
  --
  -- Existing entries keep the factor they were calculated with — that snapshot
  -- is the lineage — so adding this changes no number already recorded.
  DELETE FROM custom_emission_factors WHERE organization_id = v_org AND notes = '[DEMO]';
  INSERT INTO custom_emission_factors
    (organization_id, factor_category, factor_key, label, unit, co2e_factor,
     factor_source, data_year, effective_from, notes)
  VALUES
    (v_org, 'scope1', 'natural_gas', 'Natural gas — supplier blend (demo)', 'MMBtu', 52.400000,
     'DEMO DATA — not for reporting. Replace with your supplier certificate.',
     2026, DATE '2026-01-01', '[DEMO]');

  RAISE NOTICE 'Demo data loaded. Sign in and open /dashboard.';
END $$;


-- ============================================================
-- PURGE — remove everything this script created
-- ============================================================
-- Uncomment and run to strip the demo data back out. Sites are left in place
-- since you may have attached your own entries to them.
--
-- DO $$
-- DECLARE v_org UUID;
-- BEGIN
--   SELECT id INTO v_org FROM organizations ORDER BY created_at LIMIT 1;
--   DELETE FROM disclosure_responses WHERE organization_id = v_org;
--   DELETE FROM scope3_entries       WHERE organization_id = v_org AND notes = '[DEMO]';
--   DELETE FROM scope3_factors       WHERE organization_id = v_org AND notes = '[DEMO]';
--   DELETE FROM emission_entries     WHERE organization_id = v_org AND notes LIKE '[DEMO]%';
--   DELETE FROM ehs_entries          WHERE organization_id = v_org AND notes LIKE '[DEMO]%';
--   DELETE FROM cbam_supplier_factors WHERE organization_id = v_org AND notes = '[DEMO]';
--   DELETE FROM projects             WHERE organization_id = v_org AND notes = '[DEMO]';
--   DELETE FROM goals                WHERE organization_id = v_org AND notes = '[DEMO]';
--   DELETE FROM supplier_survey_question_responses WHERE invitation_id IN (
--     SELECT i.id FROM supplier_survey_invitations i
--     JOIN supplier_surveys s ON s.id = i.survey_id
--     WHERE s.organization_id = v_org AND s.notes = '[DEMO]');
--   DELETE FROM supplier_survey_invitations WHERE survey_id IN (
--     SELECT id FROM supplier_surveys WHERE organization_id = v_org AND notes = '[DEMO]');
--   DELETE FROM supplier_surveys WHERE organization_id = v_org AND notes = '[DEMO]';
--   DELETE FROM suppliers        WHERE organization_id = v_org AND notes = '[DEMO]';
--   DELETE FROM business_metric_values WHERE organization_id = v_org AND notes = '[DEMO]';
--   DELETE FROM site_equipment   WHERE organization_id = v_org AND notes = '[DEMO]';
--   DELETE FROM custom_emission_factors WHERE organization_id = v_org AND notes = '[DEMO]';
--   DELETE FROM materiality_assessments WHERE organization_id = v_org AND methodology = '[DEMO]';
--   -- topic_assessments cascade from materiality_assessments.
-- END $$;
