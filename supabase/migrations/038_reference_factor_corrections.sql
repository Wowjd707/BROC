-- ============================================================
-- Migration 038: correct the reference emission factors seeded by 003
-- ============================================================
--
-- Migration 003 shipped reference factors that did not match the sources
-- named beside them. Checked line by line against the publications in
-- October 2026:
--
--  * Scope 1 (EPA): the table mixed CO2-only rows (natural gas, diesel,
--    gasoline, coal) with CO2e rows (fuel oil No. 2, No. 4) under one
--    "co2e_factor" column; LPG was 6% high; "other_combustion" had no source
--    at all; and wood was charged its biogenic CO2 (93.80 kg/MMBtu) in
--    Scope 1, which the GHG Protocol requires to be reported separately,
--    outside the scopes.
--  * Scope 2 (eGRID): the "eGRID2023" subregion rates differed from eGRID2023
--    by -64% to +36% (e.g. NYCW 0.2003 vs 0.3927 kg/kWh).
--  * Residual mixes (AIB): did not match the AIB 2023 results; Norway carried
--    its generation mix (0.008) instead of its residual mix (0.599).
--  * Refrigerants: labelled IPCC AR6, but the blends carried AR4 values
--    (R-410A 2088 = 0.5 x 675 + 0.5 x 3500, the AR4 component GWPs) and two
--    HCFCs carried AR5 values.
--
-- Every value below is taken from, or computed only from, the cited source.
-- Existing entries are NOT recalculated: each entry stores the factor it was
-- calculated with, and silently rewriting history would break the audit
-- trail. Re-save or re-import entries to apply corrected factors; see
-- docs/FACTORS.md.
--
-- Re-runnable: every statement is an idempotent UPDATE/INSERT-if-missing/
-- DELETE keyed on the identifiers 003 inserted. No BEGIN/COMMIT here: the
-- runner applies each migration in a single transaction with its ledger row.

-- ── Scope 1: EPA GHG Emission Factors Hub (2024), Table 1 ─────────────────
-- CO2e = CO2 + CH4 x GWP + N2O x GWP, with the Hub's kg CO2, g CH4 and g N2O
-- per MMBtu, and IPCC AR6 GWP-100 (GHG Protocol GWP table, Aug 2024):
-- CH4 fossil 29.8, CH4 non-fossil 27.0, N2O 273 — the same assessment report
-- the refrigerant table uses, so one inventory does not mix GWP sets.
-- Mobile use of gasoline and diesel shares these rows; vehicle-specific CH4
-- and N2O differ slightly, and a team that needs them should load custom
-- factors (Emission factors page; see docs/FACTORS.md).
UPDATE scope1_emission_factors AS f SET
  co2e_factor = v.co2e,
  factor_source = 'EPA_2024_AR6',
  data_year = 2024
FROM (VALUES
  ('natural_gas',         53.12),  -- CO2 53.06, CH4 1.0 g, N2O 0.10 g
  ('diesel',              74.21),  -- distillate fuel oil No. 2: CO2 73.96, CH4 3.0 g, N2O 0.60 g
  ('gasoline',            70.47),  -- motor gasoline: CO2 70.22
  ('propane',             63.12),  -- CO2 62.87
  ('fuel_oil_no2',        74.21),  -- CO2 73.96
  ('fuel_oil_no4',        75.29),  -- CO2 75.04
  ('fuel_oil_no6',        75.35),  -- residual fuel oil No. 6: CO2 75.10
  ('coal_anthracite',    104.45),  -- CO2 103.69, CH4 11 g, N2O 1.6 g
  ('coal_bituminous',     94.04),  -- CO2 93.28
  ('coal_subbituminous',  97.93),  -- CO2 97.17
  ('coal_lignite',        98.48),  -- CO2 97.72
  ('kerosene',            75.45),  -- CO2 75.20
  ('lpg',                 61.96)   -- liquefied petroleum gases: CO2 61.71 (was 65.60)
) AS v(fuel_type, co2e)
WHERE f.fuel_type = v.fuel_type AND f.unit = 'MMBtu';

-- Wood: the GHG Protocol Corporate Standard requires direct CO2 from burning
-- biomass to be reported separately from the scopes, so its biogenic CO2
-- (93.80 kg/MMBtu in the Hub) is excluded from Scope 1. Only CH4 and N2O
-- count: 7.2 g x 27.0 + 3.6 g x 273 = 1.18 kg CO2e/MMBtu.
UPDATE scope1_emission_factors SET
  co2e_factor = 1.18,
  factor_source = 'EPA_2024_AR6 (CH4+N2O only; biogenic CO2 reported separately)',
  data_year = 2024
WHERE fuel_type = 'wood_biomass' AND unit = 'MMBtu';

-- "Other combustion" had no source. It now uses distillate fuel oil No. 2 as
-- a stated proxy, so the figure is traceable and the label says what it is.
-- Replace it with the actual fuel's factor (custom factor) where known.
UPDATE scope1_emission_factors SET
  co2e_factor = 74.21,
  factor_source = 'EPA_2024_AR6 proxy: distillate fuel oil No. 2 — replace with the fuel''s own factor',
  data_year = 2024
WHERE fuel_type = 'other_combustion' AND unit = 'MMBtu';

-- ── Scope 2 location-based: EPA eGRID2023 (released Jan 2025) ──────────────
-- Subregion total output CO2e emission rates, lb/MWh, converted to kg/kWh
-- (x 0.45359237 / 1000). Source: eGRID2023 Summary Tables, Table 1, as
-- produced 03/27/2025 (rev. 2), which supersedes the January 2025 rev. 1.
-- e.g. NYCW 865.7 lb/MWh x 0.45359237 / 1000 = 0.3927 kg/kWh.
DROP TABLE IF EXISTS pg_temp.egrid2023;
CREATE TEMP TABLE egrid2023 (subregion text PRIMARY KEY, kg_per_kwh numeric);
INSERT INTO egrid2023 VALUES
  ('AKGD', 0.4105), ('AKMS', 0.2370), ('AZNM', 0.3203), ('CAMX', 0.1950),
  ('ERCT', 0.3341), ('FRCC', 0.3560), ('HIMS', 0.5141), ('HIOA', 0.6799),
  ('MROE', 0.6373), ('MROW', 0.4203), ('NEWE', 0.2464), ('NWPP', 0.2882),
  ('NYCW', 0.3927), ('NYLI', 0.5395), ('NYUP', 0.1101), ('PRMS', 0.7024),
  ('RFCE', 0.2718), ('RFCM', 0.4427), ('RFCW', 0.4155), ('RMPA', 0.4729),
  ('SPNO', 0.3936), ('SPSO', 0.3972), ('SRMV', 0.3364), ('SRMW', 0.5664),
  ('SRSO', 0.3837), ('SRTV', 0.4097), ('SRVC', 0.2705), ('US',   0.3497);

UPDATE scope2_emission_factors AS f SET
  co2e_factor = e.kg_per_kwh, data_year = 2023, factor_source = 'eGRID2023'
FROM egrid2023 e
WHERE f.factor_type = 'electricity'
  AND f.geographic_scope IN ('egrid_subregion', 'national_average')
  AND f.geographic_identifier = e.subregion;

-- PRMS (Puerto Rico) was missing from 003.
INSERT INTO scope2_emission_factors (factor_type, geographic_scope, geographic_identifier, co2e_factor, data_year, factor_source)
SELECT 'electricity', 'egrid_subregion', 'PRMS', 0.7024, 2023, 'eGRID2023'
WHERE NOT EXISTS (
  SELECT 1 FROM scope2_emission_factors
  WHERE factor_type = 'electricity' AND geographic_scope = 'egrid_subregion' AND geographic_identifier = 'PRMS'
);

-- The ZIP rows 003 seeded are copies of their subregion's rate.
UPDATE scope2_emission_factors AS f SET
  co2e_factor = e.kg_per_kwh, data_year = 2023, factor_source = 'eGRID2023'
FROM (VALUES
  ('28202', 'SRVC'), ('60601', 'RFCW'), ('78701', 'ERCT'), ('10001', 'NYCW'),
  ('90001', 'CAMX'), ('94102', 'CAMX'), ('98101', 'NWPP'), ('85001', 'AZNM'),
  ('80201', 'RMPA'), ('02101', 'NEWE'), ('30301', 'SRSO'), ('75201', 'ERCT'),
  ('33101', 'FRCC'), ('55401', 'MROW')
) AS z(zip, subregion)
JOIN egrid2023 e ON e.subregion = z.subregion
WHERE f.factor_type = 'electricity' AND f.geographic_scope = 'zip_code' AND f.geographic_identifier = z.zip;

-- ── Scope 2 market-based: residual mixes ───────────────────────────────────
-- AIB European Residual Mixes 2023 (final results, v1.0, 2024-05-30),
-- direct CO2 g/kWh -> kg/kWh. AIB publishes CO2, not CO2e; the source label
-- says so.
UPDATE scope2_emission_factors AS f SET
  co2e_factor = v.kg, data_year = 2023, factor_source = 'AIB_2023 (direct CO2)'
FROM (VALUES
  ('DE', 0.7199), ('FR', 0.0407), ('GB', 0.3884), ('ES', 0.2825), ('IT', 0.5006),
  ('NL', 0.3799), ('BE', 0.1675), ('PL', 0.7882), ('SE', 0.0682), ('NO', 0.5986)
) AS v(country, kg)
WHERE f.factor_type = 'residual_mix' AND f.geographic_scope = 'country' AND f.geographic_identifier = v.country;

-- The "US national residual mix (M-RETS / Green-e 2023)" has no source:
-- Green-e publishes residual mixes by eGRID subregion only, and M-RETS
-- publishes none. Removed rather than kept as an untraceable number. With no
-- residual mix for the country, market-based Scope 2 falls back to the
-- location-based grid average, as the GHG Protocol Scope 2 Guidance permits
-- when no residual mix exists, and the entry records that it did.
DELETE FROM scope2_emission_factors
WHERE factor_type = 'residual_mix' AND geographic_identifier = 'US'
  AND factor_source = 'M-RETS_Greene_2023';

-- ── Refrigerants: IPCC AR6 GWP-100 ─────────────────────────────────────────
-- Pure gases from the GHG Protocol GWP table (Aug 2024, AR6 column). Blends
-- are mass-weighted from their components' AR6 values using the standard
-- ASHRAE 34 compositions, which is how AR6 blend GWPs are derived (IPCC does
-- not tabulate blends).
UPDATE refrigerant_factors AS f SET
  gwp_100_year = v.gwp, data_year = 2021, factor_source = 'IPCC_AR6'
FROM (VALUES
  ('R-410A',   2256),   -- R-32/125 50/50
  ('R-404A',   4728),   -- R-125/143a/134a 44/52/4
  ('R-407C',   1906),   -- R-32/125/134a 23/25/52
  ('R-407A',   2261),   -- R-32/125/134a 20/40/40
  ('R-422D',   2915),   -- R-125/134a/600a 65.1/31.5/3.4
  ('R-507A',   4775),   -- R-125/143a 50/50
  ('R-513A',    672),   -- R-1234yf/134a 56/44
  ('R-1234yf', 0.501),  -- stored as 0.50: the column is NUMERIC(10,2)
  ('R-1234ze', 1.37),   -- HFO-1234ze(E)
  ('R-123',    90.4),   -- HCFC-123 (was the AR5 value, 79)
  ('R-124',     597)    -- HCFC-124 (was the AR5 value, 527)
) AS v(code, gwp)
WHERE f.refrigerant_code = v.code;

DROP TABLE IF EXISTS pg_temp.egrid2023;
