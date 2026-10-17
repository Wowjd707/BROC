/**
 * Display names for activity source types.
 *
 * Shared rather than defined per page: the data-quality review names the same
 * streams the entry tables do, and two drifting copies would have a reviewer
 * chasing a "Fuel Oil No2" finding against a "Fuel Oil #2" row.
 */

export const SOURCE_LABELS: Record<string, string> = {
  // Scope 1 — combustion and fugitive
  natural_gas: 'Natural Gas', diesel: 'Diesel', gasoline: 'Gasoline', propane: 'Propane',
  fuel_oil_no2: 'Fuel Oil #2', fuel_oil_no4: 'Fuel Oil #4', fuel_oil_no6: 'Fuel Oil #6',
  kerosene: 'Kerosene', lpg: 'LPG',
  coal_anthracite: 'Coal (Anthracite)', coal_bituminous: 'Coal (Bituminous)',
  coal_subbituminous: 'Coal (Sub-bituminous)', coal_lignite: 'Coal (Lignite)',
  wood_biomass: 'Wood/Biomass', refrigerants: 'Refrigerants',
  other_combustion: 'Other Combustion',

  // Scope 2
  electricity: 'Electricity', district_heating: 'District Heating',
  renewable_purchased: 'Renewable (Purchased)', renewable_generated: 'Renewable (On-site)',

  // Water
  municipal_consumption: 'Municipal Water', municipal_discharge: 'Municipal Discharge',
  groundwater: 'Groundwater', surface_water: 'Surface Water',
  recycled_water: 'Recycled Water', stormwater: 'Stormwater',

  // Waste
  non_hazardous_landfilled: 'Landfilled', non_hazardous_recycled: 'Recycled — mixed',
  non_hazardous_recycled_metals: 'Recycled — metals',
  non_hazardous_recycled_paper: 'Recycled — paper/cardboard',
  non_hazardous_recycled_plastics: 'Recycled — plastics',
  non_hazardous_composted: 'Composted', non_hazardous_incinerated: 'Incinerated',
  hazardous: 'Hazardous Waste', hazardous_incinerated: 'Hazardous — incinerated',
  other: 'Other',

  // Safety — the labels here must match sustainability_metrics.label, for the
  // same reason the waste labels are shared: a data-review finding named
  // against one wording and a table row named against another sends a reviewer
  // chasing a discrepancy that does not exist.
  hours_worked: 'Hours worked',
  recordable_incidents: 'Recordable work-related injuries',
  lost_time_incidents: 'Lost-time injuries',
  restricted_duty_incidents: 'Restricted-duty or job-transfer cases',
  lost_days: 'Days away from work',
  high_consequence_incidents: 'High-consequence work-related injuries',
  fatalities: 'Work-related fatalities',
  near_misses: 'Near misses reported',

  // Workforce
  headcount: 'Headcount',
  new_hires: 'New employee hires',
  separations_voluntary: 'Voluntary separations',
  separations_involuntary: 'Involuntary separations',

  // Training
  training_hours: 'Training hours delivered',
  ehs_training_hours: 'Health and safety training hours',

  // Governance
  board_seats: 'Board seats',
  independent_board_seats: 'Independent board seats',
  corruption_incidents_confirmed: 'Confirmed incidents of corruption',
  whistleblower_reports: 'Reports received through grievance channels',
  whistleblower_reports_substantiated: 'Reports substantiated after investigation',
  policy_training_completions: 'Anti-corruption training completions',
};

/** Falls back to the raw key made readable, never to an empty label. */
export function sourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? sourceType.replace(/_/g, ' ');
}

// ─── Waste diversion ─────────────────────────────────────────────────────────

/**
 * Which waste streams count as diverted from disposal.
 *
 * Defined here rather than at each call site because the dashboard and the KPI
 * page were each carrying their own list, and they disagreed: one matched on
 * the substring "recycled" (missing composting and energy recovery), the other
 * matched literal `'recycled'`, `'composted'`, `'reused'`, `'waste_to_energy'`
 * — none of which is a value this platform has ever stored, since every waste
 * source type is prefixed with its hazard class. That page reported a 0.0%
 * diversion rate for every organization, permanently, while the dashboard
 * reported a real figure from the same rows.
 *
 * Energy recovery is counted as diverted because it is diverted from landfill,
 * which is what a diversion rate measures. Organizations that report recycling
 * rate separately should read `non_hazardous_recycled*` on its own — a single
 * rate cannot serve both definitions, and conflating them is the more common
 * reporting error.
 */
export const DIVERTED_WASTE_SOURCES: readonly string[] = [
  'non_hazardous_recycled',
  'non_hazardous_recycled_metals',
  'non_hazardous_recycled_paper',
  'non_hazardous_recycled_plastics',
  'non_hazardous_composted',
  'non_hazardous_incinerated_energy',
  'hazardous_treated',
];

export function isDivertedWaste(sourceType: string | null | undefined): boolean {
  return sourceType != null && DIVERTED_WASTE_SOURCES.includes(sourceType);
}

// ─── Renewable electricity ───────────────────────────────────────────────────

/**
 * Source types that represent renewable electricity.
 *
 * The KPI page previously tested `accounting_method === 'market'`, a value the
 * schema cannot hold — the CHECK constraint allows only `location_based` and
 * `market_based` — so its renewable percentage was always 0.0%. It also gated
 * on `co2e_kg === 0`, which excludes a genuine renewable instrument carrying a
 * small non-zero supplier factor.
 */
export const RENEWABLE_ELECTRICITY_SOURCES: readonly string[] = [
  'renewable_generated',
  'renewable_purchased',
];

export function isRenewableElectricity(sourceType: string | null | undefined): boolean {
  return sourceType != null && RENEWABLE_ELECTRICITY_SOURCES.includes(sourceType);
}

/** Grid and on-site electricity together — the denominator for renewable share. */
export function isElectricitySource(sourceType: string | null | undefined): boolean {
  return sourceType === 'electricity' || isRenewableElectricity(sourceType);
}
