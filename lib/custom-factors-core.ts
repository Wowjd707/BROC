/**
 * Pure, environment-agnostic logic for resolving versioned custom emission
 * factors. Kept free of server-only / Supabase imports so it can be unit
 * tested and reused on either side of the network boundary.
 */

export type CustomFactorCategory =
  | 'scope1'
  | 'scope2_location'
  | 'scope2_residual'
  | 'scope2_heat'
  | 'refrigerant';

/** Categories keyed by site id rather than by a fuel or refrigerant code. */
export const SITE_KEYED_CATEGORIES: readonly CustomFactorCategory[] = [
  'scope2_location', 'scope2_residual', 'scope2_heat',
];

export function isSiteKeyed(category: string): boolean {
  return (SITE_KEYED_CATEGORIES as readonly string[]).includes(category);
}

export interface ResolvedFactor {
  factor: number;
  source: string;
  dataYear: number;
}

export interface FactorWindow {
  co2e_factor: number;
  factor_source: string;
  data_year: number;
  effective_from: string;
  effective_to: string | null;
}

/**
 * Select the effective factor for a date from a set of versioned rows.
 * Checks both bounds of each window — [effective_from, effective_to), with
 * effective_to open-ended when null — so it is correct regardless of whether
 * the caller pre-filtered. When several windows overlap the date, the one with
 * the latest effective_from wins. Returns null if none apply.
 */
export function pickEffectiveFactor(
  rows: FactorWindow[],
  onDate: string,
): ResolvedFactor | null {
  const applicable = rows.filter(
    (row) =>
      row.effective_from <= onDate &&
      (row.effective_to == null || row.effective_to > onDate),
  );
  if (applicable.length === 0) return null;

  const match = applicable.reduce((latest, row) =>
    row.effective_from > latest.effective_from ? row : latest,
  );
  return {
    factor: Number(match.co2e_factor),
    source: match.factor_source,
    dataYear: match.data_year,
  };
}
