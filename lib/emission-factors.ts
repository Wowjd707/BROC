/**
 * Emission factor lookup helpers.
 * These query the pre-seeded scope1/scope2/refrigerant_factors tables
 * via Supabase. All lookups return factors in the canonical units
 * (kg CO2e / MMBtu for Scope 1, kg CO2e / kWh for Scope 2).
 */

import { createServerClient } from './supabase/server';
import { isUsSite, toIso2 } from './country-core';

/**
 * Look up a Scope 1 factor by fuel type. `biogenicCo2Factor` is set for
 * biomass: its CO2 is reported outside the scopes (migration 039).
 */
export async function getScope1Factor(
  fuelType: string,
): Promise<{ factor: number; source: string; biogenicCo2Factor: number | null } | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('scope1_emission_factors')
    .select('co2e_factor, factor_source, biogenic_co2_factor')
    .eq('fuel_type', fuelType)
    .order('data_year', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return {
    factor: Number(data.co2e_factor),
    source: data.factor_source,
    biogenicCo2Factor: data.biogenic_co2_factor == null ? null : Number(data.biogenic_co2_factor),
  };
}

async function scope2Row(
  factorType: 'electricity' | 'residual_mix',
  scopes: string[],
  identifier: string,
): Promise<{ factor: number; source: string } | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('scope2_emission_factors')
    .select('co2e_factor, factor_source')
    .eq('factor_type', factorType)
    .in('geographic_scope', scopes)
    .eq('geographic_identifier', identifier)
    .order('data_year', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { factor: Number(data.co2e_factor), source: data.factor_source } : null;
}

/**
 * Look up the location-based (grid-average) electricity factor for a site.
 *
 * US sites: ZIP → eGRID subregion → the US national average, all read from
 * the reference table. A site outside the US needs a country-level factor in
 * the table; there is none by default, so it returns null and the entry is
 * refused until the organization adds one (a "Scope 2 grid (site)" custom
 * factor). It once fell back to a hard-coded US average for every site
 * anywhere, which priced a German plant on the American grid.
 */
export async function getScope2LocationFactor(
  site: { zipCode?: string | null; country?: string | null; egridSubregion?: string | null },
): Promise<{ factor: number; source: string; basis: string } | null> {
  if (!isUsSite(site.country)) {
    const iso = toIso2(site.country);
    if (!iso) return null;
    const row = await scope2Row('electricity', ['country', 'national_average'], iso);
    return row ? { ...row, basis: `country ${iso}` } : null;
  }

  if (site.zipCode) {
    const row = await scope2Row('electricity', ['zip_code'], site.zipCode);
    if (row) return { ...row, basis: `ZIP ${site.zipCode}` };
  }
  if (site.egridSubregion) {
    const row = await scope2Row('electricity', ['egrid_subregion'], site.egridSubregion);
    if (row) return { ...row, basis: `eGRID subregion ${site.egridSubregion}` };
  }
  const national = await scope2Row('electricity', ['national_average'], 'US');
  return national ? { ...national, basis: 'US national average' } : null;
}

/**
 * Look up the residual mix for a site's market (market-based Scope 2).
 * Returns null when none is held — there is no default. Under the Scope 2
 * Guidance the market-based figure then uses the grid average, and the entry
 * records that it did. (The US has no national residual mix: Green-e
 * publishes by eGRID subregion. Load one per site as a "Scope 2 residual mix
 * (site)" custom factor.)
 */
export async function getResidualMixFactor(
  country: string | null | undefined,
): Promise<{ factor: number; source: string } | null> {
  const iso = isUsSite(country) ? 'US' : toIso2(country);
  if (!iso) return null;
  return scope2Row('residual_mix', ['country', 'national_average'], iso);
}

/** Get all refrigerant factors for dropdown + GWP lookup */
export async function getRefrigerantFactors() {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('refrigerant_factors')
    .select('refrigerant_code, refrigerant_name, gwp_100_year, factor_source')
    .order('refrigerant_code');

  if (error) throw error;
  return data ?? [];
}

/** Get GWP for a specific refrigerant code */
export async function getRefrigerantGwp(
  refrigerantCode: string,
): Promise<{ gwp: number; source: string; isMontrealProtocol: boolean } | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('refrigerant_factors')
    .select('gwp_100_year, factor_source, is_montreal_protocol')
    .eq('refrigerant_code', refrigerantCode)
    .single();

  if (error || !data) return null;
  return {
    gwp: Number(data.gwp_100_year),
    source: data.factor_source,
    isMontrealProtocol: data.is_montreal_protocol === true,
  };
}

// ─── Source type display labels ─────────────────────────────────────────────
// Kept in a separate client-safe file; re-exported here for server-side callers.
export { SCOPE1_SOURCE_TYPES, SCOPE2_SOURCE_TYPES } from './emission-factor-types';
