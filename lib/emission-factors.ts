/**
 * Emission factor lookup helpers.
 * These query the pre-seeded scope1/scope2/refrigerant_factors tables
 * via Supabase. All lookups return factors in the canonical units
 * (kg CO2e / MMBtu for Scope 1, kg CO2e / kWh for Scope 2).
 */

import { createServerClient } from './supabase/server';

/** Look up Scope 1 factor by fuel type */
export async function getScope1Factor(
  fuelType: string,
): Promise<{ factor: number; source: string } | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('scope1_emission_factors')
    .select('co2e_factor, factor_source')
    .eq('fuel_type', fuelType)
    .order('data_year', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return { factor: data.co2e_factor, source: data.factor_source };
}

/**
 * Look up Scope 2 electricity factor.
 * Priority order: zip_code → egrid_subregion → national_average
 */
export async function getScope2LocationFactor(
  zipCode?: string,
  egridSubregion?: string,
): Promise<{ factor: number; source: string; basis: string }> {
  const supabase = await createServerClient();

  // 1. Try ZIP code
  if (zipCode) {
    const { data } = await supabase
      .from('scope2_emission_factors')
      .select('co2e_factor, factor_source, geographic_identifier')
      .eq('factor_type', 'electricity')
      .eq('geographic_scope', 'zip_code')
      .eq('geographic_identifier', zipCode)
      .order('data_year', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      return {
        factor: data.co2e_factor,
        source: data.factor_source,
        basis: `ZIP ${zipCode}`,
      };
    }
  }

  // 2. Try eGRID subregion
  if (egridSubregion) {
    const { data } = await supabase
      .from('scope2_emission_factors')
      .select('co2e_factor, factor_source')
      .eq('factor_type', 'electricity')
      .eq('geographic_scope', 'egrid_subregion')
      .eq('geographic_identifier', egridSubregion)
      .order('data_year', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      return {
        factor: data.co2e_factor,
        source: data.factor_source,
        basis: `eGRID subregion ${egridSubregion}`,
      };
    }
  }

  // 3. Fall back to US national average
  return {
    factor: 0.386,
    source: 'eGRID2023',
    basis: 'US national average',
  };
}

/**
 * Look up Scope 2 residual mix factor for market-based accounting.
 * Falls back to US national residual mix if country-specific not found.
 */
export async function getResidualMixFactor(
  countryCode: string = 'US',
): Promise<{ factor: number; source: string; isDefault: boolean }> {
  const supabase = await createServerClient();

  const { data } = await supabase
    .from('scope2_emission_factors')
    .select('co2e_factor, factor_source')
    .eq('factor_type', 'residual_mix')
    .eq('geographic_identifier', countryCode.toUpperCase())
    .order('data_year', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    return { factor: data.co2e_factor, source: data.factor_source, isDefault: false };
  }

  // Default: US residual mix
  return {
    factor: 0.455,
    source: 'M-RETS_Greene_2023',
    isDefault: true,
  };
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
): Promise<{ gwp: number; source: string } | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('refrigerant_factors')
    .select('gwp_100_year, factor_source')
    .eq('refrigerant_code', refrigerantCode)
    .single();

  if (error || !data) return null;
  return { gwp: data.gwp_100_year, source: data.factor_source };
}

// ─── Source type display labels ─────────────────────────────────────────────
// Kept in a separate client-safe file; re-exported here for server-side callers.
export { SCOPE1_SOURCE_TYPES, SCOPE2_SOURCE_TYPES } from './emission-factor-types';
