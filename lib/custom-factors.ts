import 'server-only';
import { createServerClient } from './supabase/server';
import {
  pickEffectiveFactor,
  type CustomFactorCategory,
  type FactorWindow,
  type ResolvedFactor,
} from './custom-factors-core';

export type { CustomFactorCategory, ResolvedFactor } from './custom-factors-core';
export { pickEffectiveFactor } from './custom-factors-core';

/**
 * Resolution of organization-specific emission factors.
 *
 * A custom factor overrides the global reference factor for the caller's org.
 * Factors are versioned by effective date: for a given category + key + date,
 * the active row whose [effective_from, effective_to) window contains the date
 * wins. Returns null when no custom factor applies, so callers fall back to the
 * global reference tables. RLS scopes custom_emission_factors to the caller's
 * org, so no org id is passed.
 */
export async function getCustomFactor(
  category: CustomFactorCategory,
  key: string,
  onDate: string,
): Promise<ResolvedFactor | null> {
  const supabase = await createServerClient();

  const { data } = await supabase
    .from('custom_emission_factors')
    .select('co2e_factor, factor_source, data_year, effective_from, effective_to')
    .eq('factor_category', category)
    .eq('factor_key', key)
    .eq('is_active', true)
    .lte('effective_from', onDate)
    .order('effective_from', { ascending: false });

  if (!data || data.length === 0) return null;
  return pickEffectiveFactor(data as FactorWindow[], onDate);
}
