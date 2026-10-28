/**
 * Migrations 038 and 039 — the corrected reference factors and the Scope 2 /
 * outside-the-scopes columns, pinned against a real Postgres running the real
 * migrations. Each expected value is the published figure (or computed only
 * from it); the migration comments carry the arithmetic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootDatabase, type Harness } from './rls-harness';

let h: Harness;

beforeAll(async () => { h = await bootDatabase(); }, 120_000);
afterAll(async () => { await h?.db.close(); });

async function one<T>(sql: string, p: unknown[] = []): Promise<T> {
  return (await h.db.query<T>(sql, p)).rows[0];
}

describe('migration 038: reference factors match their cited sources', () => {
  it('stores Scope 1 fuels as CO2e at AR6 (EPA Hub 2024 Table 1)', async () => {
    const gas = await one<{ co2e_factor: string; factor_source: string }>(
      `SELECT co2e_factor, factor_source FROM scope1_emission_factors WHERE fuel_type = 'natural_gas'`);
    // 53.06 + 1.0 g × 29.8 + 0.10 g × 273 = 53.12
    expect(Number(gas.co2e_factor)).toBeCloseTo(53.12, 6);
    expect(gas.factor_source).toBe('EPA_2024_AR6');
    const lpg = await one<{ co2e_factor: string }>(
      `SELECT co2e_factor FROM scope1_emission_factors WHERE fuel_type = 'lpg'`);
    expect(Number(lpg.co2e_factor)).toBeCloseTo(61.96, 6);
  });

  it('keeps biogenic CO2 out of the wood factor and records it separately (039)', async () => {
    const wood = await one<{ co2e_factor: string; biogenic_co2_factor: string }>(
      `SELECT co2e_factor, biogenic_co2_factor FROM scope1_emission_factors WHERE fuel_type = 'wood_biomass'`);
    expect(Number(wood.co2e_factor)).toBeCloseTo(1.18, 6);
    expect(Number(wood.biogenic_co2_factor)).toBeCloseTo(93.8, 6);
  });

  it('uses eGRID2023 rev. 2 subregion rates for subregions and their ZIPs', async () => {
    const rows = (await h.db.query<{ geographic_identifier: string; co2e_factor: string }>(
      `SELECT geographic_identifier, co2e_factor FROM scope2_emission_factors
       WHERE factor_type = 'electricity' AND geographic_identifier IN ('NYCW', '10001', 'RFCW', '60601', 'US')`)).rows;
    const by = Object.fromEntries(rows.map((r) => [r.geographic_identifier, Number(r.co2e_factor)]));
    // 865.7 lb/MWh × 0.45359237 / 1000
    expect(by.NYCW).toBeCloseTo(0.3927, 6);
    expect(by['10001']).toBeCloseTo(0.3927, 6);
    expect(by.RFCW).toBeCloseTo(0.4155, 6);
    expect(by['60601']).toBeCloseTo(0.4155, 6);
    expect(by.US).toBeCloseTo(0.3497, 6);
  });

  it('uses AIB 2023 residual mixes and holds no unsourced US residual mix', async () => {
    const no = await one<{ co2e_factor: string }>(
      `SELECT co2e_factor FROM scope2_emission_factors WHERE factor_type = 'residual_mix' AND geographic_identifier = 'NO'`);
    expect(Number(no.co2e_factor)).toBeCloseTo(0.5986, 6);
    const us = await one<{ c: string }>(
      `SELECT count(*)::text AS c FROM scope2_emission_factors WHERE factor_type = 'residual_mix' AND geographic_identifier = 'US'`);
    expect(us.c).toBe('0');
  });

  it('gives refrigerant blends their AR6 values and flags Montreal gases (039)', async () => {
    const rows = (await h.db.query<{ refrigerant_code: string; gwp_100_year: string; is_montreal_protocol: boolean }>(
      `SELECT refrigerant_code, gwp_100_year, is_montreal_protocol FROM refrigerant_factors
       WHERE refrigerant_code IN ('R-404A', 'R-410A', 'R-22', 'R-134a')`)).rows;
    const by = Object.fromEntries(rows.map((r) => [r.refrigerant_code, r]));
    expect(Number(by['R-404A'].gwp_100_year)).toBe(4728);
    expect(Number(by['R-410A'].gwp_100_year)).toBe(2256);
    expect(by['R-22'].is_montreal_protocol).toBe(true);
    expect(by['R-134a'].is_montreal_protocol).toBe(false);
  });
});

describe('migration 039: schema', () => {
  it('accepts the new site-level custom factor categories', async () => {
    const def = await one<{ d: string }>(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
       WHERE conrelid = 'public.custom_emission_factors'::regclass AND conname = 'custom_emission_factors_factor_category_check'`);
    expect(def.d).toContain('scope2_residual');
    expect(def.d).toContain('scope2_heat');
  });

  it('refuses an unknown Scope 2 market basis', async () => {
    const def = await one<{ d: string }>(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'emission_entries_scope2_market_basis_allowed'`);
    expect(def.d).toContain('grid_average');
    expect(def.d).toContain('residual_mix');
  });
});

describe('migration 040: pipeline default and SBTi targets', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'migrations', '040_pipeline_default_and_sbti_targets.sql'), 'utf8');

  it('defaults new projects into the pipeline', async () => {
    const d = await one<{ column_default: string }>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'projects' AND column_name = 'pipeline_inclusion_status'`);
    expect(d.column_default).toContain('forecasted');
  });

  it('never undoes an exclusion made after its first run', async () => {
    const org = (await h.db.query<{ id: string }>(`INSERT INTO organizations (name) VALUES ('P Co') RETURNING id`)).rows[0].id;
    await h.db.query(
      `INSERT INTO projects (organization_id, name, category, status, pipeline_inclusion_status)
       VALUES ($1, 'Deliberately excluded', 'energy_efficiency', 'approved', 'excluded')`, [org]);
    await h.db.exec(sql);
    const r = await one<{ pipeline_inclusion_status: string }>(
      `SELECT pipeline_inclusion_status FROM projects WHERE name = 'Deliberately excluded'`);
    expect(r.pipeline_inclusion_status).toBe('excluded');
  });

  it('restates a compounded SBTi target linearly from its years', async () => {
    const org = (await h.db.query<{ id: string }>(`INSERT INTO organizations (name) VALUES ('S Co') RETURNING id`)).rows[0].id;
    await h.db.query(
      `INSERT INTO goals (organization_id, name, goal_type, base_year, base_year_emissions_kg, target_year,
         target_emissions_kg, target_value, target_unit, target_reduction_pct, status)
       VALUES ($1, 'Old SBTi', 'sbti_15c', 2020, 1000000, 2030, 651100, 34.89, 'pct_reduction', 34.89, 'active')`, [org]);
    await h.db.exec(sql);
    const g = await one<{ target_value: string; target_emissions_kg: string }>(
      `SELECT target_value, target_emissions_kg FROM goals WHERE name = 'Old SBTi'`);
    expect(Number(g.target_value)).toBe(42);
    expect(Number(g.target_emissions_kg)).toBe(580000);
  });
});
