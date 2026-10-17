-- ============================================================
-- EHS Carbon Accounting Platform — Reference Data Seed
-- Migration 003: Emission factors (scope 1, scope 2, refrigerants)
-- ============================================================

-- ============================================================
-- SCOPE 1 EMISSION FACTORS (EPA 2024, kg CO2e per MMBtu)
-- Source: EPA Emission Factors for Greenhouse Gas Inventories (April 2024)
-- ============================================================
INSERT INTO scope1_emission_factors (fuel_type, unit, co2e_factor, factor_source, data_year) VALUES
  ('natural_gas',        'MMBtu', 53.06,   'EPA_2024', 2024),
  ('diesel',             'MMBtu', 73.96,   'EPA_2024', 2024),
  ('gasoline',           'MMBtu', 70.22,   'EPA_2024', 2024),
  ('propane',            'MMBtu', 63.07,   'EPA_2024', 2024),
  ('fuel_oil_no2',       'MMBtu', 74.21,   'EPA_2024', 2024),
  ('fuel_oil_no4',       'MMBtu', 75.29,   'EPA_2024', 2024),
  ('fuel_oil_no6',       'MMBtu', 75.10,   'EPA_2024', 2024),
  ('coal_anthracite',    'MMBtu', 103.69,  'EPA_2024', 2024),
  ('coal_bituminous',    'MMBtu', 93.28,   'EPA_2024', 2024),
  ('coal_subbituminous', 'MMBtu', 97.17,   'EPA_2024', 2024),
  ('coal_lignite',       'MMBtu', 97.72,   'EPA_2024', 2024),
  ('kerosene',           'MMBtu', 75.20,   'EPA_2024', 2024),
  ('lpg',                'MMBtu', 65.60,   'EPA_2024', 2024),
  ('wood_biomass',       'MMBtu', 93.80,   'EPA_2024', 2024),
  ('other_combustion',   'MMBtu', 74.00,   'EPA_2024', 2024);

-- ============================================================
-- SCOPE 2 EMISSION FACTORS (eGRID2023, kg CO2e per kWh)
-- Location-based: eGRID subregion averages
-- Source: EPA eGRID 2023 (published 2024)
-- ============================================================
INSERT INTO scope2_emission_factors (factor_type, geographic_scope, geographic_identifier, co2e_factor, data_year, factor_source) VALUES
  -- eGRID subregions (location-based)
  ('electricity', 'egrid_subregion', 'AKGD', 0.3384, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'AKMS', 0.0853, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'AZNM', 0.3463, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'CAMX', 0.2070, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'ERCT', 0.3618, 2023, 'eGRID2023'),  -- Texas ERCOT
  ('electricity', 'egrid_subregion', 'FRCC', 0.3860, 2023, 'eGRID2023'),  -- Florida
  ('electricity', 'egrid_subregion', 'HIMS', 0.6290, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'HIOA', 0.6810, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'MROE', 0.5740, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'MROW', 0.5196, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'NEWE', 0.2005, 2023, 'eGRID2023'),  -- New England
  ('electricity', 'egrid_subregion', 'NWPP', 0.2523, 2023, 'eGRID2023'),  -- Northwest
  ('electricity', 'egrid_subregion', 'NYCW', 0.2003, 2023, 'eGRID2023'),  -- NYC/Westchester
  ('electricity', 'egrid_subregion', 'NYLI', 0.3394, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'NYUP', 0.1093, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'RFCE', 0.2942, 2023, 'eGRID2023'),  -- Mid-Atlantic
  ('electricity', 'egrid_subregion', 'RFCM', 0.5958, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'RFCW', 0.5423, 2023, 'eGRID2023'),  -- Midwest
  ('electricity', 'egrid_subregion', 'RMPA', 0.5628, 2023, 'eGRID2023'),  -- Rocky Mountain
  ('electricity', 'egrid_subregion', 'SPNO', 0.5340, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'SPSO', 0.4370, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'SRMV', 0.3527, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'SRMW', 0.6288, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'SRSO', 0.3946, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'SRTV', 0.4360, 2023, 'eGRID2023'),
  ('electricity', 'egrid_subregion', 'SRVC', 0.2870, 2023, 'eGRID2023'),

  -- US national average fallback (location-based)
  ('electricity', 'national_average', 'US', 0.3860, 2023, 'eGRID2023'),

  -- Residual mix factors (market-based) — US
  -- Source: M-RETS / Green-e 2023 Residual Mix
  ('residual_mix', 'national_average', 'US',  0.4550, 2023, 'M-RETS_Greene_2023'),

  -- Residual mix factors — EU countries (market-based)
  -- Source: AIB European Residual Mixes 2023
  ('residual_mix', 'country', 'DE', 0.6240, 2023, 'AIB_2023'),
  ('residual_mix', 'country', 'FR', 0.0370, 2023, 'AIB_2023'),
  ('residual_mix', 'country', 'GB', 0.2680, 2023, 'AIB_2023'),
  ('residual_mix', 'country', 'ES', 0.2590, 2023, 'AIB_2023'),
  ('residual_mix', 'country', 'IT', 0.4560, 2023, 'AIB_2023'),
  ('residual_mix', 'country', 'NL', 0.5490, 2023, 'AIB_2023'),
  ('residual_mix', 'country', 'BE', 0.1780, 2023, 'AIB_2023'),
  ('residual_mix', 'country', 'PL', 0.8240, 2023, 'AIB_2023'),
  ('residual_mix', 'country', 'SE', 0.0290, 2023, 'AIB_2023'),
  ('residual_mix', 'country', 'NO', 0.0080, 2023, 'AIB_2023');

-- ============================================================
-- ZIP → eGRID SUBREGION LOOKUP (selected major metros)
-- Covers demo seed data zip codes + major US metros
-- ============================================================
INSERT INTO scope2_emission_factors (factor_type, geographic_scope, geographic_identifier, co2e_factor, data_year, factor_source) VALUES
  -- Charlotte NC (28202) → SRVC
  ('electricity', 'zip_code', '28202', 0.2870, 2023, 'eGRID2023'),
  -- Chicago IL (60601) → RFCW
  ('electricity', 'zip_code', '60601', 0.5423, 2023, 'eGRID2023'),
  -- Austin TX (78701) → ERCT
  ('electricity', 'zip_code', '78701', 0.3618, 2023, 'eGRID2023'),
  -- New York NY
  ('electricity', 'zip_code', '10001', 0.2003, 2023, 'eGRID2023'),
  -- Los Angeles CA
  ('electricity', 'zip_code', '90001', 0.2070, 2023, 'eGRID2023'),
  -- San Francisco CA
  ('electricity', 'zip_code', '94102', 0.2070, 2023, 'eGRID2023'),
  -- Seattle WA
  ('electricity', 'zip_code', '98101', 0.2523, 2023, 'eGRID2023'),
  -- Phoenix AZ
  ('electricity', 'zip_code', '85001', 0.3463, 2023, 'eGRID2023'),
  -- Denver CO
  ('electricity', 'zip_code', '80201', 0.5628, 2023, 'eGRID2023'),
  -- Boston MA
  ('electricity', 'zip_code', '02101', 0.2005, 2023, 'eGRID2023'),
  -- Atlanta GA
  ('electricity', 'zip_code', '30301', 0.3946, 2023, 'eGRID2023'),
  -- Dallas TX
  ('electricity', 'zip_code', '75201', 0.3618, 2023, 'eGRID2023'),
  -- Miami FL
  ('electricity', 'zip_code', '33101', 0.3860, 2023, 'eGRID2023'),
  -- Minneapolis MN
  ('electricity', 'zip_code', '55401', 0.5196, 2023, 'eGRID2023');

-- ============================================================
-- REFRIGERANT GWP FACTORS (IPCC AR6 100-year GWP)
-- Source: IPCC Sixth Assessment Report (2021)
-- GWP values represent kg CO2e per kg refrigerant
-- ============================================================
INSERT INTO refrigerant_factors (refrigerant_name, refrigerant_code, gwp_100_year, data_year, factor_source) VALUES
  -- HFCs (common commercial refrigerants)
  ('R-134a (HFC-134a)',     'R-134a',   1526,   2021, 'IPCC_AR6'),
  ('R-410A (blend)',         'R-410A',   2088,   2021, 'IPCC_AR6'),
  ('R-404A (blend)',         'R-404A',   3922,   2021, 'IPCC_AR6'),
  ('R-407C (blend)',         'R-407C',   1774,   2021, 'IPCC_AR6'),
  ('R-407A (blend)',         'R-407A',   2107,   2021, 'IPCC_AR6'),
  ('R-422D (blend)',         'R-422D',   2729,   2021, 'IPCC_AR6'),
  ('R-507A (blend)',         'R-507A',   3985,   2021, 'IPCC_AR6'),
  ('R-32 (HFC-32)',          'R-32',     771,    2021, 'IPCC_AR6'),
  ('R-125 (HFC-125)',        'R-125',    3740,   2021, 'IPCC_AR6'),
  ('R-143a (HFC-143a)',      'R-143a',   5810,   2021, 'IPCC_AR6'),
  ('R-152a (HFC-152a)',      'R-152a',   164,    2021, 'IPCC_AR6'),
  ('R-245fa (HFC-245fa)',    'R-245fa',  962,    2021, 'IPCC_AR6'),
  -- HFOs (low-GWP alternatives)
  ('R-1234yf (HFO-1234yf)', 'R-1234yf', 1,      2021, 'IPCC_AR6'),
  ('R-1234ze (HFO-1234ze)', 'R-1234ze', 7,      2021, 'IPCC_AR6'),
  ('R-513A (blend)',         'R-513A',   631,    2021, 'IPCC_AR6'),
  -- Natural refrigerants
  ('R-717 (Ammonia)',        'R-717',    0,      2021, 'IPCC_AR6'),
  ('R-744 (CO2)',            'R-744',    1,      2021, 'IPCC_AR6'),
  ('R-290 (Propane)',        'R-290',    0.02,   2021, 'IPCC_AR6'),
  -- HCFCs (being phased out)
  ('R-22 (HCFC-22)',         'R-22',     1960,   2021, 'IPCC_AR6'),
  ('R-123 (HCFC-123)',       'R-123',    79,     2021, 'IPCC_AR6'),
  ('R-124 (HCFC-124)',       'R-124',    527,    2021, 'IPCC_AR6');
