/**
 * Scope 3 value-chain emissions engine.
 *
 * Implements the calculation methods of the GHG Protocol Corporate Value Chain
 * (Scope 3) Standard and its Technical Guidance. Pure and dependency-free so it
 * is unit-testable and can run on either side of the network boundary.
 *
 * The arithmetic of every method reduces to `activity × factor`. What differs
 * is *what* the activity is and *which* factor is legitimate — so the engine's
 * real job is validating that the factor's denominator matches the activity
 * being measured. Silently multiplying spend by a per-tonne factor is exactly
 * the kind of error that destroys an inventory's credibility, so it is a hard
 * error here rather than a rounding difference nobody notices.
 */

// ─── Categories ──────────────────────────────────────────────────────────────

export interface Scope3Category {
  number: number;
  name: string;
  valueChain: 'upstream' | 'downstream';
}

/** The 15 categories of the GHG Protocol Scope 3 Standard. */
export const SCOPE3_CATEGORIES: Scope3Category[] = [
  { number: 1,  name: 'Purchased goods and services',            valueChain: 'upstream' },
  { number: 2,  name: 'Capital goods',                            valueChain: 'upstream' },
  { number: 3,  name: 'Fuel- and energy-related activities',      valueChain: 'upstream' },
  { number: 4,  name: 'Upstream transportation and distribution', valueChain: 'upstream' },
  { number: 5,  name: 'Waste generated in operations',            valueChain: 'upstream' },
  { number: 6,  name: 'Business travel',                          valueChain: 'upstream' },
  { number: 7,  name: 'Employee commuting',                       valueChain: 'upstream' },
  { number: 8,  name: 'Upstream leased assets',                   valueChain: 'upstream' },
  { number: 9,  name: 'Downstream transportation and distribution', valueChain: 'downstream' },
  { number: 10, name: 'Processing of sold products',              valueChain: 'downstream' },
  { number: 11, name: 'Use of sold products',                     valueChain: 'downstream' },
  { number: 12, name: 'End-of-life treatment of sold products',   valueChain: 'downstream' },
  { number: 13, name: 'Downstream leased assets',                 valueChain: 'downstream' },
  { number: 14, name: 'Franchises',                               valueChain: 'downstream' },
  { number: 15, name: 'Investments',                              valueChain: 'downstream' },
];

export function getScope3Category(n: number): Scope3Category | undefined {
  return SCOPE3_CATEGORIES.find((c) => c.number === n);
}

// ─── Methods ─────────────────────────────────────────────────────────────────

export type Scope3Method =
  | 'supplier_specific'
  | 'average_data'
  | 'spend_based'
  | 'distance_based'
  | 'fuel_based'
  | 'waste_type_specific'
  | 'asset_specific'
  | 'site_specific'
  | 'franchise_specific'
  | 'investment_specific';

export const SCOPE3_METHODS: Scope3Method[] = [
  'supplier_specific', 'average_data', 'spend_based', 'distance_based',
  'fuel_based', 'waste_type_specific', 'asset_specific', 'site_specific',
  'franchise_specific', 'investment_specific',
];

export const METHOD_LABELS: Record<Scope3Method, string> = {
  supplier_specific:   'Supplier-specific',
  average_data:        'Average-data',
  spend_based:         'Spend-based',
  distance_based:      'Distance-based',
  fuel_based:          'Fuel-based',
  waste_type_specific: 'Waste-type-specific',
  asset_specific:      'Asset-specific',
  site_specific:       'Site-specific',
  franchise_specific:  'Franchise-specific',
  investment_specific: 'Investment-specific',
};

/**
 * Data-quality tiers. The GHG Protocol expects reporters to distinguish primary
 * (supplier/activity-specific) from secondary (industry-average) data; spend-based
 * estimates are the weakest and should be prioritised for replacement.
 */
export type DataQuality = 'primary' | 'secondary' | 'estimated';

/** Default data-quality tier implied by the method, unless the user overrides. */
export function defaultDataQuality(method: Scope3Method): DataQuality {
  switch (method) {
    case 'supplier_specific':
    case 'site_specific':
    case 'asset_specific':
      return 'primary';
    case 'spend_based':
      return 'estimated';
    default:
      return 'secondary';
  }
}

// ─── Unit compatibility ──────────────────────────────────────────────────────

/**
 * Canonical activity-unit families. A factor is only applicable to an activity
 * measured in the same family — you cannot apply a per-USD factor to kilograms.
 */
export type UnitFamily = 'currency' | 'mass' | 'distance' | 'passenger-distance' | 'freight' | 'energy' | 'volume' | 'count';

const UNIT_FAMILIES: Record<string, UnitFamily> = {
  // currency
  usd: 'currency', eur: 'currency', gbp: 'currency',
  // mass
  kg: 'mass', kilograms: 'mass', tonne: 'mass', tonnes: 'mass',
  't': 'mass', 'metric_tons': 'mass', lb: 'mass', lbs: 'mass', 'short_tons': 'mass',
  // distance
  mile: 'distance', miles: 'distance', km: 'distance', kilometers: 'distance', kilometres: 'distance',
  // passenger-distance (travel/commuting)
  'passenger-mile': 'passenger-distance', 'passenger-km': 'passenger-distance',
  // freight (mass × distance)
  'tonne-km': 'freight', 'tonne-mile': 'freight', 'ton-mile': 'freight', 'kg-km': 'freight',
  // energy
  kwh: 'energy', mwh: 'energy', mmbtu: 'energy', gj: 'energy', therms: 'energy',
  // volume
  liters: 'volume', litres: 'volume', l: 'volume', gallons: 'volume', m3: 'volume',
  // count
  units: 'count', items: 'count', 'employee-days': 'count', nights: 'count',
};

export function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, '_');
}

export function unitFamily(unit: string): UnitFamily | null {
  return UNIT_FAMILIES[normalizeUnit(unit)] ?? null;
}

/**
 * Size of each unit in its family's base unit (kg, km, passenger-km,
 * tonne-km, kWh, litre). Currency and count have no conversion: a per-USD
 * factor applies to USD only (converting EUR needs an exchange rate and a
 * price-year adjustment, which belong with the user, not a constant), and
 * "units" of one thing are not "nights" of another.
 */
const TO_BASE: Record<string, number> = {
  // mass → kg
  kg: 1, kilograms: 1, tonne: 1000, tonnes: 1000, t: 1000, metric_tons: 1000,
  lb: 0.45359237, lbs: 0.45359237, short_tons: 907.18474,
  // distance → km
  km: 1, kilometers: 1, kilometres: 1, mile: 1.609344, miles: 1.609344,
  // passenger-distance → passenger-km
  'passenger-km': 1, 'passenger-mile': 1.609344,
  // freight → tonne-km (a ton-mile is a short ton carried one mile)
  'tonne-km': 1, 'tonne-mile': 1.609344, 'ton-mile': 0.90718474 * 1.609344, 'kg-km': 0.001,
  // energy → kWh
  kwh: 1, mwh: 1000, mmbtu: 293.07107, gj: 1000 / 3.6, therms: 29.307107,
  // volume → litres
  liters: 1, litres: 1, l: 1, gallons: 3.785411784, m3: 1000,
};

/**
 * Multiplier that expresses an activity quantity in the factor's unit, or null
 * when the two cannot be converted. 1 for an exact match.
 */
export function activityToFactorUnit(activityUnit: string, factorUnit: string): number | null {
  const a = normalizeUnit(activityUnit);
  const f = normalizeUnit(factorUnit);
  if (a === f) return 1;
  const fa = unitFamily(a);
  const ff = unitFamily(f);
  if (fa == null || fa !== ff) return null;
  const ka = TO_BASE[a];
  const kf = TO_BASE[f];
  if (ka == null || kf == null) return null;
  return ka / kf;
}

/**
 * True when a factor expressed per `factorUnit` may be applied to an activity
 * measured in `activityUnit`: an exact match, or two units of one physical
 * family that convert (tonnes to kg, miles to km). Currency must match
 * exactly, and mismatched families are never compatible.
 */
export function unitsCompatible(activityUnit: string, factorUnit: string): boolean {
  return activityToFactorUnit(activityUnit, factorUnit) != null;
}

// ─── Calculation ─────────────────────────────────────────────────────────────

export interface Scope3CalculationInput {
  categoryNumber: number;
  method: Scope3Method;
  /** Raw activity data: spend, mass, distance, passenger-distance, etc. */
  activityValue: number;
  activityUnit: string;
  /** kg CO2e per factorUnit */
  factorValue: number;
  factorUnit: string;
  factorSource: string;
  factorDataYear?: number;
  dataQuality?: DataQuality;
}

export interface Scope3CalculationResult {
  co2eKg: number;
  /** Activity units → factor units (1 when they match). Reproducible from the two units. */
  unitConversion: number;
  categoryNumber: number;
  method: Scope3Method;
  activityValue: number;
  activityUnit: string;
  factorValue: number;
  factorUnit: string;
  factorSource: string;
  factorDataYear?: number;
  dataQuality: DataQuality;
}

/**
 * Calculate a Scope 3 entry. Throws on inputs that would produce a number
 * nobody could defend in assurance: unknown category, negative activity,
 * missing provenance, or a factor whose denominator does not match the
 * activity being measured.
 */
export function calculateScope3(input: Scope3CalculationInput): Scope3CalculationResult {
  if (!getScope3Category(input.categoryNumber)) {
    throw new Error(`Unknown Scope 3 category: ${input.categoryNumber}. Must be 1-15.`);
  }
  if (!Number.isFinite(input.activityValue) || input.activityValue < 0) {
    throw new Error('activityValue must be a non-negative, finite number.');
  }
  if (!Number.isFinite(input.factorValue) || input.factorValue < 0) {
    throw new Error('factorValue must be a non-negative, finite number.');
  }
  if (!input.factorSource || !input.factorSource.trim()) {
    throw new Error('factorSource is required — every Scope 3 factor must cite its provenance.');
  }
  // Convert the activity into the factor's unit before multiplying. Accepting
  // "same family" units without converting them — as this once did — made
  // 10 tonnes × 2 kg CO₂e/kg come out at 20 kg instead of 20,000.
  const conversion = activityToFactorUnit(input.activityUnit, input.factorUnit);
  if (conversion == null) {
    const currency = unitFamily(input.activityUnit) === 'currency' && unitFamily(input.factorUnit) === 'currency';
    throw new Error(
      currency
        ? `Factor is per ${input.factorUnit} but the spend is in ${input.activityUnit}. Convert the spend to `
          + `${input.factorUnit} (at the exchange rate and price year the factor assumes) before entering it.`
        : `Factor unit "${input.factorUnit}" cannot be applied to activity measured in "${input.activityUnit}".`,
    );
  }

  return {
    co2eKg: input.activityValue * conversion * input.factorValue,
    unitConversion: conversion,
    categoryNumber: input.categoryNumber,
    method: input.method,
    activityValue: input.activityValue,
    activityUnit: input.activityUnit,
    factorValue: input.factorValue,
    factorUnit: input.factorUnit,
    factorSource: input.factorSource,
    factorDataYear: input.factorDataYear,
    dataQuality: input.dataQuality ?? defaultDataQuality(input.method),
  };
}

// ─── Roll-ups ────────────────────────────────────────────────────────────────

export interface Scope3EntryLike {
  category_number: number;
  co2e_kg: number;
  data_quality?: string | null;
}

export interface CategoryTotal {
  categoryNumber: number;
  name: string;
  valueChain: 'upstream' | 'downstream';
  co2eKg: number;
  entryCount: number;
}

/** Total Scope 3 by category, including categories with no data (co2eKg 0). */
export function totalsByCategory(entries: Scope3EntryLike[]): CategoryTotal[] {
  return SCOPE3_CATEGORIES.map((cat) => {
    const rows = entries.filter((e) => e.category_number === cat.number);
    return {
      categoryNumber: cat.number,
      name: cat.name,
      valueChain: cat.valueChain,
      co2eKg: rows.reduce((sum, r) => sum + (r.co2e_kg ?? 0), 0),
      entryCount: rows.length,
    };
  });
}

/**
 * Share of total Scope 3 backed by primary data — the headline data-quality
 * metric reporters are asked to improve year over year. Returns 0 when there
 * are no emissions to characterise.
 */
export function primaryDataShare(entries: Scope3EntryLike[]): number {
  const total = entries.reduce((s, e) => s + (e.co2e_kg ?? 0), 0);
  if (total <= 0) return 0;
  const primary = entries
    .filter((e) => e.data_quality === 'primary')
    .reduce((s, e) => s + (e.co2e_kg ?? 0), 0);
  return (primary / total) * 100;
}
