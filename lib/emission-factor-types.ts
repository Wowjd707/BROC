/**
 * Static source type labels for Scope 1 and Scope 2 emission entries.
 * Kept in a separate file from emission-factors.ts so client components
 * can import these arrays without pulling in server-only DB lookup code.
 */

export const SCOPE1_SOURCE_TYPES = [
  { value: 'natural_gas',      label: 'Natural Gas' },
  { value: 'diesel',           label: 'Diesel' },
  { value: 'gasoline',         label: 'Gasoline' },
  { value: 'propane',          label: 'Propane' },
  { value: 'fuel_oil_no2',     label: 'Fuel Oil No. 2' },
  { value: 'fuel_oil_no4',     label: 'Fuel Oil No. 4' },
  { value: 'fuel_oil_no6',     label: 'Fuel Oil No. 6 (Residual)' },
  { value: 'kerosene',         label: 'Kerosene' },
  { value: 'lpg',              label: 'LPG (Liquefied Petroleum Gas)' },
  { value: 'coal_anthracite',  label: 'Coal — Anthracite' },
  { value: 'coal_bituminous',  label: 'Coal — Bituminous' },
  { value: 'wood_biomass',     label: 'Wood / Biomass' },
  { value: 'refrigerants',     label: 'Refrigerants' },
  { value: 'other_combustion', label: 'Other Combustion' },
];

// ─── Scope 1 source categories (GHG Protocol Corporate Standard) ────────────

export type Scope1Category =
  | 'stationary_combustion'
  | 'mobile_combustion'
  | 'process_emissions'
  | 'fugitive_emissions';

export const SCOPE1_CATEGORIES: { value: Scope1Category; label: string; help: string }[] = [
  {
    value: 'stationary_combustion',
    label: 'Stationary combustion',
    help: 'Fuel burned in fixed equipment — boilers, furnaces, standby generators, ovens.',
  },
  {
    value: 'mobile_combustion',
    label: 'Mobile combustion',
    help: 'Fuel burned in vehicles the organization owns or controls — fleet, forklifts, marine, aviation.',
  },
  {
    value: 'process_emissions',
    label: 'Process emissions',
    help: 'Emissions from physical or chemical processing rather than combustion — e.g. cement calcination.',
  },
  {
    value: 'fugitive_emissions',
    label: 'Fugitive emissions',
    help: 'Unintentional releases — refrigerant leakage, SF₆ from switchgear, methane from seals.',
  },
];

export const SCOPE1_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  SCOPE1_CATEGORIES.map((c) => [c.value, c.label]),
);

/**
 * The category a source type most likely belongs to, used only to pre-select
 * the field — never to fill it in silently. Fuels that are genuinely ambiguous
 * (diesel, gasoline, LPG can each be stationary or mobile) return null so the
 * user has to make the call rather than inherit a guess.
 */
export function suggestScope1Category(sourceType: string): Scope1Category | null {
  if (sourceType === 'refrigerants') return 'fugitive_emissions';
  if ([
    'natural_gas', 'fuel_oil_no2', 'fuel_oil_no4', 'fuel_oil_no6',
    'coal_anthracite', 'coal_bituminous', 'wood_biomass', 'kerosene',
  ].includes(sourceType)) {
    return 'stationary_combustion';
  }
  // diesel, gasoline, propane, lpg, other_combustion → ambiguous by design
  return null;
}

export const SCOPE2_SOURCE_TYPES = [
  { value: 'electricity',           label: 'Electricity (Grid)' },
  { value: 'district_heating',      label: 'District Heating / Steam' },
  { value: 'renewable_purchased',   label: 'Renewable Electricity (Purchased)' },
  { value: 'renewable_generated',   label: 'Renewable Electricity (On-site Generated)' },
];
