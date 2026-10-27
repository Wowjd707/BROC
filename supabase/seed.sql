-- ============================================================
-- EHS Carbon Accounting Platform — Demo Seed Data
-- Demo Org: "Demo Manufacturing Co"
-- ============================================================
-- NOTE: Run this AFTER migrations 001–003.
-- This seed creates auth users via Supabase's auth.users,
-- then populates all app tables with 12 months of realistic data.
-- Adjust UUIDs if re-seeding; these are stable for demo use.
-- ============================================================

-- ============================================================
-- 1. ORGANIZATION
-- ============================================================
INSERT INTO organizations (id, name, industry, hq_country, subscription_tier, reporting_year_start, base_year)
VALUES (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'Demo Manufacturing Co',
  'Manufacturing',
  'USA',
  'standard',
  1,   -- January fiscal year start
  2022
);

-- ============================================================
-- 2. AUTH USERS (Supabase auth.users — must be inserted first)
-- In a real Supabase project use the Dashboard or supabase CLI.
-- These are placeholder inserts for local dev.
-- ============================================================
-- Admin user: admin@demo.com / password: DemoPass123!
-- (In production, create via Supabase Auth API)

-- ============================================================
-- 3. USERS (app users table — mirrors auth.users ids)
-- ============================================================
INSERT INTO users (id, organization_id, email, first_name, last_name, role)
VALUES
  ('b1b2c3d4-0000-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'admin@demo.com',  'Alex',  'Rivera',  'admin'),
  ('b1b2c3d4-0000-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'editor@demo.com', 'Jordan','Kim',     'editor'),
  ('b1b2c3d4-0000-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'viewer@demo.com', 'Taylor','Morgan',  'viewer');

-- ============================================================
-- 4. SITES
-- ============================================================
INSERT INTO sites (id, organization_id, name, address, city, state, zip_code, country, site_type, floor_area_sqft)
VALUES
  ('c1b2c3d4-0000-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001',
   'HQ Office',   '123 Main St', 'Charlotte', 'NC', '28202', 'USA', 'office',        45000),
  ('c1b2c3d4-0000-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001',
   'Plant A',     '456 Industrial Blvd', 'Chicago',   'IL', '60601', 'USA', 'manufacturing', 120000),
  ('c1b2c3d4-0000-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001',
   'Warehouse',   '789 Logistics Way',   'Austin',    'TX', '78701', 'USA', 'warehouse',     80000);

-- ============================================================
-- 5. EMISSION ENTRIES — 12 months (Jan–Dec 2025)
-- Realistic manufacturing profile:
--   HQ: electricity + natural gas
--   Plant A: electricity (heavy) + natural gas + diesel
--   Warehouse: electricity + diesel (forklifts)
-- ============================================================

-- HQ — Electricity (Scope 2, location-based)
-- ~35,000 kWh/month; SRVC factor: 0.2705 kg/kWh (eGRID2023) → ~9,468 kg/month
INSERT INTO emission_entries (id, organization_id, site_id, entry_date, scope, source_type, quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based, accounting_method, emission_factor_used, emission_factor_source, created_by) VALUES
  ('e000001-0001-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-01-31', 'scope2', 'electricity', 35200, 'kWh', 35200, 'kWh', 9521.60, 9521.60, 'location_based', 0.2705, 'eGRID2023 (ZIP 28202)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000001-0001-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-02-28', 'scope2', 'electricity', 33800, 'kWh', 33800, 'kWh', 9142.90, 9142.90, 'location_based', 0.2705, 'eGRID2023 (ZIP 28202)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000001-0001-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-03-31', 'scope2', 'electricity', 34500, 'kWh', 34500, 'kWh', 9332.25, 9332.25, 'location_based', 0.2705, 'eGRID2023 (ZIP 28202)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000001-0001-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-04-30', 'scope2', 'electricity', 32100, 'kWh', 32100, 'kWh', 8683.05, 8683.05, 'location_based', 0.2705, 'eGRID2023 (ZIP 28202)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000001-0001-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-05-31', 'scope2', 'electricity', 36800, 'kWh', 36800, 'kWh', 9954.40, 9954.40, 'location_based', 0.2705, 'eGRID2023 (ZIP 28202)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000001-0001-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-06-30', 'scope2', 'electricity', 42300, 'kWh', 42300, 'kWh', 11442.15, 11442.15, 'location_based', 0.2705, 'eGRID2023 (ZIP 28202)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000001-0001-0000-0000-000000000007', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-07-31', 'scope2', 'electricity', 44100, 'kWh', 44100, 'kWh', 11929.05, 11929.05, 'location_based', 0.2705, 'eGRID2023 (ZIP 28202)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000001-0001-0000-0000-000000000008', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-08-31', 'scope2', 'electricity', 43500, 'kWh', 43500, 'kWh', 11766.75, 11766.75, 'location_based', 0.2705, 'eGRID2023 (ZIP 28202)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000001-0001-0000-0000-000000000009', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-09-30', 'scope2', 'electricity', 38900, 'kWh', 38900, 'kWh', 10522.45, 10522.45, 'location_based', 0.2705, 'eGRID2023 (ZIP 28202)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000001-0001-0000-0000-000000000010', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-10-31', 'scope2', 'electricity', 35600, 'kWh', 35600, 'kWh', 9629.80, 9629.80, 'location_based', 0.2705, 'eGRID2023 (ZIP 28202)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000001-0001-0000-0000-000000000011', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-11-30', 'scope2', 'electricity', 36200, 'kWh', 36200, 'kWh', 9792.10, 9792.10, 'location_based', 0.2705, 'eGRID2023 (ZIP 28202)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000001-0001-0000-0000-000000000012', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-12-31', 'scope2', 'electricity', 37100, 'kWh', 37100, 'kWh', 10035.55, 10035.55, 'location_based', 0.2705, 'eGRID2023 (ZIP 28202)', 'b1b2c3d4-0000-0000-0000-000000000001');

-- HQ — Natural Gas (Scope 1)
-- ~25 MMBtu/month winter, ~8 summer; factor: 53.12 kg CO2e/MMBtu (EPA 2024 + AR6, migration 038)
INSERT INTO emission_entries (id, organization_id, site_id, entry_date, scope, source_type, quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based, accounting_method, emission_factor_used, emission_factor_source, created_by) VALUES
  ('e000002-0001-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-01-31', 'scope1', 'natural_gas', 24300, 'cubic_feet', 24.9318, 'MMBtu', 1324.38, 1324.38, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000002-0001-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-02-28', 'scope1', 'natural_gas', 21800, 'cubic_feet', 22.3668, 'MMBtu', 1188.12, 1188.12, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000002-0001-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-03-31', 'scope1', 'natural_gas', 16500, 'cubic_feet', 16.9290, 'MMBtu', 899.27, 899.27, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000002-0001-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-04-30', 'scope1', 'natural_gas', 8200, 'cubic_feet', 8.4132, 'MMBtu', 446.91, 446.91, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000002-0001-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-05-31', 'scope1', 'natural_gas', 5100, 'cubic_feet', 5.2326, 'MMBtu', 277.96, 277.96, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000002-0001-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-06-30', 'scope1', 'natural_gas', 3800, 'cubic_feet', 3.8988, 'MMBtu', 207.10, 207.10, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000002-0001-0000-0000-000000000007', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-07-31', 'scope1', 'natural_gas', 3200, 'cubic_feet', 3.2832, 'MMBtu', 174.40, 174.40, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000002-0001-0000-0000-000000000008', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-08-31', 'scope1', 'natural_gas', 3500, 'cubic_feet', 3.5910, 'MMBtu', 190.75, 190.75, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000002-0001-0000-0000-000000000009', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-09-30', 'scope1', 'natural_gas', 7600, 'cubic_feet', 7.7976, 'MMBtu', 414.21, 414.21, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000002-0001-0000-0000-000000000010', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-10-31', 'scope1', 'natural_gas', 14200, 'cubic_feet', 14.5692, 'MMBtu', 773.92, 773.92, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000002-0001-0000-0000-000000000011', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-11-30', 'scope1', 'natural_gas', 20100, 'cubic_feet', 20.6226, 'MMBtu', 1095.47, 1095.47, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000002-0001-0000-0000-000000000012', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-12-31', 'scope1', 'natural_gas', 23400, 'cubic_feet', 24.0084, 'MMBtu', 1275.33, 1275.33, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001');

-- Plant A — Electricity (Scope 2, heavy manufacturing)
-- ~180,000 kWh/month; RFCW factor: 0.4155 kg/kWh (eGRID2023) → ~74,790 kg/month
INSERT INTO emission_entries (id, organization_id, site_id, entry_date, scope, source_type, quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based, accounting_method, emission_factor_used, emission_factor_source, created_by) VALUES
  ('e000003-0001-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-01-31', 'scope2', 'electricity', 178500, 'kWh', 178500, 'kWh', 74166.75, 74166.75, 'location_based', 0.4155, 'eGRID2023 (ZIP 60601)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000003-0001-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-02-28', 'scope2', 'electricity', 162300, 'kWh', 162300, 'kWh', 67435.65, 67435.65, 'location_based', 0.4155, 'eGRID2023 (ZIP 60601)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000003-0001-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-03-31', 'scope2', 'electricity', 175200, 'kWh', 175200, 'kWh', 72795.60, 72795.60, 'location_based', 0.4155, 'eGRID2023 (ZIP 60601)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000003-0001-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-04-30', 'scope2', 'electricity', 168400, 'kWh', 168400, 'kWh', 69970.20, 69970.20, 'location_based', 0.4155, 'eGRID2023 (ZIP 60601)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000003-0001-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-05-31', 'scope2', 'electricity', 180900, 'kWh', 180900, 'kWh', 75163.95, 75163.95, 'location_based', 0.4155, 'eGRID2023 (ZIP 60601)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000003-0001-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-06-30', 'scope2', 'electricity', 192400, 'kWh', 192400, 'kWh', 79942.20, 79942.20, 'location_based', 0.4155, 'eGRID2023 (ZIP 60601)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000003-0001-0000-0000-000000000007', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-07-31', 'scope2', 'electricity', 198700, 'kWh', 198700, 'kWh', 82559.85, 82559.85, 'location_based', 0.4155, 'eGRID2023 (ZIP 60601)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000003-0001-0000-0000-000000000008', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-08-31', 'scope2', 'electricity', 195300, 'kWh', 195300, 'kWh', 81147.15, 81147.15, 'location_based', 0.4155, 'eGRID2023 (ZIP 60601)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000003-0001-0000-0000-000000000009', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-09-30', 'scope2', 'electricity', 183100, 'kWh', 183100, 'kWh', 76078.05, 76078.05, 'location_based', 0.4155, 'eGRID2023 (ZIP 60601)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000003-0001-0000-0000-000000000010', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-10-31', 'scope2', 'electricity', 176800, 'kWh', 176800, 'kWh', 73460.40, 73460.40, 'location_based', 0.4155, 'eGRID2023 (ZIP 60601)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000003-0001-0000-0000-000000000011', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-11-30', 'scope2', 'electricity', 174200, 'kWh', 174200, 'kWh', 72380.10, 72380.10, 'location_based', 0.4155, 'eGRID2023 (ZIP 60601)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000003-0001-0000-0000-000000000012', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-12-31', 'scope2', 'electricity', 180100, 'kWh', 180100, 'kWh', 74831.55, 74831.55, 'location_based', 0.4155, 'eGRID2023 (ZIP 60601)', 'b1b2c3d4-0000-0000-0000-000000000001');

-- Plant A — Natural Gas (Scope 1)
-- ~850 MMBtu/month; factor: 53.12 kg CO2e/MMBtu → ~45,152 kg/month
INSERT INTO emission_entries (id, organization_id, site_id, entry_date, scope, source_type, quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based, accounting_method, emission_factor_used, emission_factor_source, created_by) VALUES
  ('e000004-0001-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-01-31', 'scope1', 'natural_gas', 840, 'MMBtu', 840, 'MMBtu', 44620.80, 44620.80, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000004-0001-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-02-28', 'scope1', 'natural_gas', 790, 'MMBtu', 790, 'MMBtu', 41964.80, 41964.80, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000004-0001-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-03-31', 'scope1', 'natural_gas', 810, 'MMBtu', 810, 'MMBtu', 43027.20, 43027.20, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000004-0001-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-04-30', 'scope1', 'natural_gas', 780, 'MMBtu', 780, 'MMBtu', 41433.60, 41433.60, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000004-0001-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-05-31', 'scope1', 'natural_gas', 800, 'MMBtu', 800, 'MMBtu', 42496.00, 42496.00, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000004-0001-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-06-30', 'scope1', 'natural_gas', 820, 'MMBtu', 820, 'MMBtu', 43558.40, 43558.40, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000004-0001-0000-0000-000000000007', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-07-31', 'scope1', 'natural_gas', 850, 'MMBtu', 850, 'MMBtu', 45152.00, 45152.00, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000004-0001-0000-0000-000000000008', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-08-31', 'scope1', 'natural_gas', 860, 'MMBtu', 860, 'MMBtu', 45683.20, 45683.20, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000004-0001-0000-0000-000000000009', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-09-30', 'scope1', 'natural_gas', 830, 'MMBtu', 830, 'MMBtu', 44089.60, 44089.60, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000004-0001-0000-0000-000000000010', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-10-31', 'scope1', 'natural_gas', 800, 'MMBtu', 800, 'MMBtu', 42496.00, 42496.00, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000004-0001-0000-0000-000000000011', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-11-30', 'scope1', 'natural_gas', 810, 'MMBtu', 810, 'MMBtu', 43027.20, 43027.20, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000004-0001-0000-0000-000000000012', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-12-31', 'scope1', 'natural_gas', 855, 'MMBtu', 855, 'MMBtu', 45417.60, 45417.60, 'location_based', 53.12, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001');

-- Plant A — Diesel (Scope 1, forklifts + generators)
-- ~1,200 gallons/month; → 1200 × 0.138 = 165.6 MMBtu; × 74.21 = 12,289 kg CO2e
INSERT INTO emission_entries (id, organization_id, site_id, entry_date, scope, source_type, quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based, accounting_method, emission_factor_used, emission_factor_source, created_by) VALUES
  ('e000005-0001-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-01-31', 'scope1', 'diesel', 1240, 'gallons', 171.1200, 'MMBtu', 12698.82, 12698.82, 'location_based', 74.21, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000005-0001-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-02-28', 'scope1', 'diesel', 1100, 'gallons', 151.8000, 'MMBtu', 11265.08, 11265.08, 'location_based', 74.21, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000005-0001-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-03-31', 'scope1', 'diesel', 1180, 'gallons', 162.8400, 'MMBtu', 12084.36, 12084.36, 'location_based', 74.21, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000005-0001-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-04-30', 'scope1', 'diesel', 1150, 'gallons', 158.7000, 'MMBtu', 11777.13, 11777.13, 'location_based', 74.21, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000005-0001-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-05-31', 'scope1', 'diesel', 1290, 'gallons', 178.0200, 'MMBtu', 13210.86, 13210.86, 'location_based', 74.21, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000005-0001-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-06-30', 'scope1', 'diesel', 1310, 'gallons', 180.7800, 'MMBtu', 13415.68, 13415.68, 'location_based', 74.21, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000005-0001-0000-0000-000000000007', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-07-31', 'scope1', 'diesel', 1350, 'gallons', 186.3000, 'MMBtu', 13825.32, 13825.32, 'location_based', 74.21, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000005-0001-0000-0000-000000000008', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-08-31', 'scope1', 'diesel', 1320, 'gallons', 182.1600, 'MMBtu', 13518.09, 13518.09, 'location_based', 74.21, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000005-0001-0000-0000-000000000009', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-09-30', 'scope1', 'diesel', 1220, 'gallons', 168.3600, 'MMBtu', 12494.00, 12494.00, 'location_based', 74.21, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000005-0001-0000-0000-000000000010', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-10-31', 'scope1', 'diesel', 1180, 'gallons', 162.8400, 'MMBtu', 12084.36, 12084.36, 'location_based', 74.21, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000005-0001-0000-0000-000000000011', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-11-30', 'scope1', 'diesel', 1200, 'gallons', 165.6000, 'MMBtu', 12289.18, 12289.18, 'location_based', 74.21, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000005-0001-0000-0000-000000000012', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-12-31', 'scope1', 'diesel', 1260, 'gallons', 173.8800, 'MMBtu', 12903.63, 12903.63, 'location_based', 74.21, 'EPA_2024_AR6', 'b1b2c3d4-0000-0000-0000-000000000001');

-- Warehouse — Electricity (Scope 2)
-- ~55,000 kWh/month; ERCT factor: 0.3341 kg/kWh (eGRID2023) → ~18,376 kg/month
INSERT INTO emission_entries (id, organization_id, site_id, entry_date, scope, source_type, quantity, unit, quantity_normalized, unit_normalized, co2e_kg, co2e_kg_location_based, accounting_method, emission_factor_used, emission_factor_source, created_by) VALUES
  ('e000006-0001-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000003', '2025-01-31', 'scope2', 'electricity', 52800, 'kWh', 52800, 'kWh', 17640.48, 17640.48, 'location_based', 0.3341, 'eGRID2023 (ZIP 78701)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000006-0001-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000003', '2025-02-28', 'scope2', 'electricity', 49200, 'kWh', 49200, 'kWh', 16437.72, 16437.72, 'location_based', 0.3341, 'eGRID2023 (ZIP 78701)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000006-0001-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000003', '2025-03-31', 'scope2', 'electricity', 51400, 'kWh', 51400, 'kWh', 17172.74, 17172.74, 'location_based', 0.3341, 'eGRID2023 (ZIP 78701)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000006-0001-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000003', '2025-04-30', 'scope2', 'electricity', 53200, 'kWh', 53200, 'kWh', 17774.12, 17774.12, 'location_based', 0.3341, 'eGRID2023 (ZIP 78701)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000006-0001-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000003', '2025-05-31', 'scope2', 'electricity', 58400, 'kWh', 58400, 'kWh', 19511.44, 19511.44, 'location_based', 0.3341, 'eGRID2023 (ZIP 78701)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000006-0001-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000003', '2025-06-30', 'scope2', 'electricity', 63100, 'kWh', 63100, 'kWh', 21081.71, 21081.71, 'location_based', 0.3341, 'eGRID2023 (ZIP 78701)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000006-0001-0000-0000-000000000007', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000003', '2025-07-31', 'scope2', 'electricity', 65500, 'kWh', 65500, 'kWh', 21883.55, 21883.55, 'location_based', 0.3341, 'eGRID2023 (ZIP 78701)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000006-0001-0000-0000-000000000008', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000003', '2025-08-31', 'scope2', 'electricity', 64800, 'kWh', 64800, 'kWh', 21649.68, 21649.68, 'location_based', 0.3341, 'eGRID2023 (ZIP 78701)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000006-0001-0000-0000-000000000009', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000003', '2025-09-30', 'scope2', 'electricity', 59200, 'kWh', 59200, 'kWh', 19778.72, 19778.72, 'location_based', 0.3341, 'eGRID2023 (ZIP 78701)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000006-0001-0000-0000-000000000010', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000003', '2025-10-31', 'scope2', 'electricity', 54100, 'kWh', 54100, 'kWh', 18074.81, 18074.81, 'location_based', 0.3341, 'eGRID2023 (ZIP 78701)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000006-0001-0000-0000-000000000011', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000003', '2025-11-30', 'scope2', 'electricity', 53600, 'kWh', 53600, 'kWh', 17907.76, 17907.76, 'location_based', 0.3341, 'eGRID2023 (ZIP 78701)', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('e000006-0001-0000-0000-000000000012', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000003', '2025-12-31', 'scope2', 'electricity', 55300, 'kWh', 55300, 'kWh', 18475.73, 18475.73, 'location_based', 0.3341, 'eGRID2023 (ZIP 78701)', 'b1b2c3d4-0000-0000-0000-000000000001');

-- ============================================================
-- 6. EHS ENTRIES — Water & Waste (6 months, Jan–Jun 2025)
-- ============================================================

-- HQ — Water Consumption (municipal, gallons)
INSERT INTO ehs_entries (id, organization_id, site_id, entry_date, metric_type, source_type, quantity, unit, quantity_normalized, unit_normalized, created_by) VALUES
  ('h000001-0001-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-01-31', 'water', 'municipal_consumption', 28400, 'gallons', 28400, 'gallons', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000001-0001-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-02-28', 'water', 'municipal_consumption', 26100, 'gallons', 26100, 'gallons', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000001-0001-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-03-31', 'water', 'municipal_consumption', 29800, 'gallons', 29800, 'gallons', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000001-0001-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-04-30', 'water', 'municipal_consumption', 31200, 'gallons', 31200, 'gallons', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000001-0001-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-05-31', 'water', 'municipal_consumption', 33500, 'gallons', 33500, 'gallons', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000001-0001-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000001', '2025-06-30', 'water', 'municipal_consumption', 36800, 'gallons', 36800, 'gallons', 'b1b2c3d4-0000-0000-0000-000000000001');

-- Plant A — Water Consumption (industrial process water)
INSERT INTO ehs_entries (id, organization_id, site_id, entry_date, metric_type, source_type, quantity, unit, quantity_normalized, unit_normalized, created_by) VALUES
  ('h000002-0001-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-01-31', 'water', 'municipal_consumption', 284000, 'gallons', 284000, 'gallons', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000002-0001-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-02-28', 'water', 'municipal_consumption', 261000, 'gallons', 261000, 'gallons', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000002-0001-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-03-31', 'water', 'municipal_consumption', 298000, 'gallons', 298000, 'gallons', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000002-0001-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-04-30', 'water', 'municipal_consumption', 312000, 'gallons', 312000, 'gallons', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000002-0001-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-05-31', 'water', 'municipal_consumption', 335000, 'gallons', 335000, 'gallons', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000002-0001-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-06-30', 'water', 'municipal_consumption', 368000, 'gallons', 368000, 'gallons', 'b1b2c3d4-0000-0000-0000-000000000001');

-- Plant A — Waste: Non-Hazardous (mixed — landfill + recycled)
INSERT INTO ehs_entries (id, organization_id, site_id, entry_date, metric_type, source_type, quantity, unit, quantity_normalized, unit_normalized, created_by) VALUES
  ('h000003-0001-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-01-31', 'waste', 'non_hazardous_landfilled', 4200, 'kg', 4200, 'kg', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000003-0001-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-02-28', 'waste', 'non_hazardous_landfilled', 3900, 'kg', 3900, 'kg', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000003-0001-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-03-31', 'waste', 'non_hazardous_landfilled', 4100, 'kg', 4100, 'kg', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000003-0001-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-04-30', 'waste', 'non_hazardous_landfilled', 3800, 'kg', 3800, 'kg', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000003-0001-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-05-31', 'waste', 'non_hazardous_landfilled', 4300, 'kg', 4300, 'kg', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000003-0001-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-06-30', 'waste', 'non_hazardous_landfilled', 4500, 'kg', 4500, 'kg', 'b1b2c3d4-0000-0000-0000-000000000001');

INSERT INTO ehs_entries (id, organization_id, site_id, entry_date, metric_type, source_type, quantity, unit, quantity_normalized, unit_normalized, created_by) VALUES
  ('h000004-0001-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-01-31', 'waste', 'non_hazardous_recycled', 6800, 'kg', 6800, 'kg', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000004-0001-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-02-28', 'waste', 'non_hazardous_recycled', 6400, 'kg', 6400, 'kg', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000004-0001-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-03-31', 'waste', 'non_hazardous_recycled', 6900, 'kg', 6900, 'kg', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000004-0001-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-04-30', 'waste', 'non_hazardous_recycled', 7100, 'kg', 7100, 'kg', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000004-0001-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-05-31', 'waste', 'non_hazardous_recycled', 7200, 'kg', 7200, 'kg', 'b1b2c3d4-0000-0000-0000-000000000001'),
  ('h000004-0001-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001', 'c1b2c3d4-0000-0000-0000-000000000002', '2025-06-30', 'waste', 'non_hazardous_recycled', 7500, 'kg', 7500, 'kg', 'b1b2c3d4-0000-0000-0000-000000000001');

-- ============================================================
-- 7. GOAL — 50% absolute reduction by 2030 (SBTi aligned)
-- Base year 2022; base emissions ~4,200,000 kg CO2e
-- Target: 4.2%/yr compound → ~3,213,200 kg by 2030
-- ============================================================
INSERT INTO goals (id, organization_id, name, goal_type, scope_coverage, base_year, base_year_emissions_kg, target_year, target_emissions_kg, target_reduction_pct, scope2_accounting_method, status)
VALUES (
  'g1b2c3d4-0000-0000-0000-000000000001',
  'a1b2c3d4-0000-0000-0000-000000000001',
  '50% Absolute Reduction by 2030 (SBTi 1.5°C)',
  'sbti_15c',
  '{scope1,scope2}',
  2022,
  4200000.00,
  2030,
  2100000.00,
  50.00,
  'market_based',
  'active'
);

-- ============================================================
-- 8. PROJECTS — one per status tier
-- ============================================================

-- Project 1: Approved — Solar installation at Plant A
INSERT INTO projects (id, organization_id, site_id, goal_id, name, description, category, status, estimated_co2e_reduction_kg, estimated_cost_usd, estimated_payback_months, target_completion_date, pipeline_inclusion_status, project_inputs, created_by)
VALUES (
  'p1b2c3d4-0000-0000-0000-000000000001',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'c1b2c3d4-0000-0000-0000-000000000002',
  'g1b2c3d4-0000-0000-0000-000000000001',
  '500 kW Rooftop Solar — Plant A',
  'Install 500 kW rooftop solar array to offset grid electricity at Plant A. Expected generation: 600,000 kWh/yr based on Chicago solar capacity factor.',
  'renewable_energy',
  'approved',
  325380.00,
  1250000.00,
  84,
  '2025-09-30',
  'forecasted',
  '{"calculator_type": "renewable_energy", "system_capacity_kw": 500, "capacity_factor": 1200, "annual_generation_kwh": 600000, "site_electricity_factor": 0.5423, "co2e_reduction_kg_per_year": 325380}'::jsonb,
  'b1b2c3d4-0000-0000-0000-000000000001'
);

-- Project 2: In Progress — LED lighting upgrade at HQ
INSERT INTO projects (id, organization_id, site_id, goal_id, name, description, category, status, estimated_co2e_reduction_kg, estimated_cost_usd, estimated_payback_months, target_completion_date, pipeline_inclusion_status, project_inputs, created_by)
VALUES (
  'p1b2c3d4-0000-0000-0000-000000000002',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'c1b2c3d4-0000-0000-0000-000000000001',
  'g1b2c3d4-0000-0000-0000-000000000001',
  'LED Lighting Retrofit — HQ Office',
  'Replace all fluorescent lighting with LED fixtures across 45,000 sqft HQ. Estimated 35% reduction in lighting electricity consumption.',
  'energy_efficiency',
  'in_progress',
  14787.44,
  85000.00,
  36,
  '2025-06-30',
  'forecasted',
  '{"calculator_type": "energy_efficiency", "current_energy_kwh_per_year": 145200, "reduction_pct": 35, "energy_saved_kwh": 50820, "site_electricity_factor": 0.2870, "electricity_rate_usd_kwh": 0.12, "co2e_reduction_kg_per_year": 14585.34}'::jsonb,
  'b1b2c3d4-0000-0000-0000-000000000001'
);

-- Project 3: Completed — Compressed air leak repair at Plant A
INSERT INTO projects (id, organization_id, site_id, goal_id, name, description, category, status, estimated_co2e_reduction_kg, actual_co2e_reduction_kg, estimated_cost_usd, estimated_payback_months, target_completion_date, actual_completion_date, pipeline_inclusion_status, project_inputs, created_by)
VALUES (
  'p1b2c3d4-0000-0000-0000-000000000003',
  'a1b2c3d4-0000-0000-0000-000000000001',
  'c1b2c3d4-0000-0000-0000-000000000002',
  'g1b2c3d4-0000-0000-0000-000000000001',
  'Compressed Air System Audit & Leak Repair — Plant A',
  'Comprehensive audit of compressed air system followed by repair of identified leaks. Leak survey found 23% system loss rate; target < 8% after repair.',
  'energy_efficiency',
  'completed',
  28741.52,
  31200.00,
  18500.00,
  8,
  '2025-02-28',
  '2025-02-14',
  'realized',
  '{"calculator_type": "energy_efficiency", "current_energy_kwh_per_year": 217400, "reduction_pct": 15, "energy_saved_kwh": 32610, "site_electricity_factor": 0.5423, "electricity_rate_usd_kwh": 0.09, "co2e_reduction_kg_per_year": 17683.05}'::jsonb,
  'b1b2c3d4-0000-0000-0000-000000000001'
);

-- ============================================================
-- 9. SUPPLIERS
-- ============================================================
-- NOTE: requires migration 006 (industry/spend_usd/notes columns)
INSERT INTO suppliers (id, organization_id, name, contact_name, contact_email, country, industry, spend_usd, tier, is_active)
VALUES
  ('s1b2c3d4-0000-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001', 'Steelcore Industries',   'Maria Chen',    'mchen@steelcore.example',     'Germany', 'steel',       1250000, 1, true),
  ('s1b2c3d4-0000-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001', 'PackageTech Solutions',  'James Okafor',  'jokafor@packagetech.example', 'USA',     'packaging',    340000, 2, true),
  ('s1b2c3d4-0000-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001', 'ElectroParts Co.',       'Yuki Tanaka',   'ytanaka@electroparts.example','Japan',   'electronics',  780000, 1, true);

-- ============================================================
-- 10. SUPPLIER SURVEY — CBAM Disclosure 2025
-- ============================================================
INSERT INTO supplier_surveys (id, organization_id, title, regulation_type, status, due_date, created_by)
VALUES (
  'sv1b2c3d4-0000-0000-0000-000000000001',
  'a1b2c3d4-0000-0000-0000-000000000001',
  '2025 CBAM Carbon Disclosure',
  'cbam',
  'active',
  '2025-04-30',
  'b1b2c3d4-0000-0000-0000-000000000001'
);

-- Survey invitations (token = stable UUID-like hex for demo)
INSERT INTO supplier_survey_invitations (id, survey_id, supplier_id, supplier_name, email, token, status, sent_at, submitted_at)
VALUES
  ('i1b2c3d4-0000-0000-0000-000000000001', 'sv1b2c3d4-0000-0000-0000-000000000001', 's1b2c3d4-0000-0000-0000-000000000001',
   'Steelcore Industries', 'mchen@steelcore.example',
   'a1b2c3d4e5f60001a1b2c3d4e5f60001', 'submitted', NOW() - INTERVAL '10 days', NOW() - INTERVAL '7 days'),
  ('i1b2c3d4-0000-0000-0000-000000000002', 'sv1b2c3d4-0000-0000-0000-000000000001', 's1b2c3d4-0000-0000-0000-000000000002',
   'PackageTech Solutions', 'jokafor@packagetech.example',
   'b2c3d4e5f6070002b2c3d4e5f6070002', 'submitted', NOW() - INTERVAL '10 days', NOW() - INTERVAL '5 days'),
  ('i1b2c3d4-0000-0000-0000-000000000003', 'sv1b2c3d4-0000-0000-0000-000000000001', 's1b2c3d4-0000-0000-0000-000000000003',
   'ElectroParts Co.', 'ytanaka@electroparts.example',
   'c3d4e5f6070803c3d4e5f6070803c3d4', 'sent',      NOW() - INTERVAL '10 days', NULL);

-- Survey responses (for the two who submitted)
INSERT INTO supplier_survey_responses (id, invitation_id, survey_id, supplier_id, responses, co2e_intensity_kg_per_unit, submitted_at, is_complete)
VALUES
  (
    'r1b2c3d4-0000-0000-0000-000000000001',
    'i1b2c3d4-0000-0000-0000-000000000001',
    'sv1b2c3d4-0000-0000-0000-000000000001',
    's1b2c3d4-0000-0000-0000-000000000001',
    '{"q1": "Hot-rolled coil steel", "q2_quantity": 500, "q2_unit": "metric tons", "q3_co2e_intensity": 2.14, "q4_fuel": "natural_gas", "q5_country": "Germany", "q6_verified": "yes", "q7_verification": "Third-party verification certificate, reference VER-2024-DE-8821"}'::jsonb,
    2.14,
    NOW() - INTERVAL '7 days',
    true
  ),
  (
    'r1b2c3d4-0000-0000-0000-000000000002',
    'i1b2c3d4-0000-0000-0000-000000000002',
    'sv1b2c3d4-0000-0000-0000-000000000001',
    's1b2c3d4-0000-0000-0000-000000000002',
    '{"q1": "Corrugated cardboard packaging", "q2_quantity": 120000, "q2_unit": "units", "q3_co2e_intensity": 0.38, "q4_fuel": "electricity", "q5_country": "USA", "q6_verified": "no", "q7_verification": ""}'::jsonb,
    0.38,
    NOW() - INTERVAL '5 days',
    true
  );

-- Scope 2 lineage (migration 039), as lib/entries.ts writes it for these US
-- sites: no US residual mix is held, so the market-based figure is the grid
-- average, and the row says so.
UPDATE emission_entries SET
  location_factor_used = emission_factor_used,
  location_factor_source = emission_factor_source,
  scope2_market_basis = 'grid_average',
  emission_factor_source = emission_factor_source || ' — grid average used for market-based: no residual mix for this market'
WHERE organization_id = 'a1b2c3d4-0000-0000-0000-000000000001'
  AND scope = 'scope2' AND accounting_method = 'location_based'
  AND (scope2_market_basis IS NULL OR scope2_market_basis = 'legacy');
