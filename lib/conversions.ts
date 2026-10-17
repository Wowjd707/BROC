/**
 * Unit conversion utilities for EHS Carbon Accounting Platform.
 * All emission calculations normalize raw inputs to a base unit
 * before applying emission factors. Nothing is ever stored
 * without both the raw and normalized values.
 *
 * Base units:
 *   - Combustion fuels → MMBtu
 *   - Electricity      → kWh
 *   - Waste            → kg
 *   - Water            → gallons
 */

import { isSocialGovernanceFamily, normalizeSocialInput } from './social-metrics-core';

// ─── Energy ─────────────────────────────────────────────────────────────────

/** Convert any supported electricity unit to kWh */
export function toKWh(quantity: number, unit: string): number {
  switch (unit.toLowerCase().replace(/\s/g, '')) {
    case 'kwh':  return quantity;
    case 'mwh':  return quantity * 1_000;
    case 'gwh':  return quantity * 1_000_000;
    default:
      throw new Error(`Unsupported electricity unit: ${unit}`);
  }
}

/** Convert any supported combustion-fuel unit to MMBtu */
export function toMMBtu(quantity: number, unit: string, fuelType: string): number {
  const u = unit.toLowerCase().replace(/\s/g, '');
  const ft = fuelType.toLowerCase().replace(/[_\s]/g, '');

  // Direct energy units
  if (u === 'mmbtu')     return quantity;
  if (u === 'btu')       return quantity / 1_000_000;
  if (u === 'therms' || u === 'therm') return quantity * 0.1;
  if (u === 'mj')        return quantity * 0.000948;
  if (u === 'gj')        return quantity * 0.948;

  // Volume/mass — fuel-specific conversions
  switch (u) {
    // Natural gas
    case 'cubic_feet': case 'cf': case 'scf':
      return quantity * 0.001026;
    case 'mcf':
      return quantity * 1.026;
    case 'ccf':
      return quantity * 0.1026;
    case 'cubic_meters': case 'm3':
      return quantity * 0.03616;

    // Liquid fuels — gallons
    case 'gallons': case 'gal': case 'usgal': {
      const gallonFactors: Record<string, number> = {
        diesel:     0.13756,
        gasoline:   0.12454,
        propane:    0.09150,
        fueloilno2: 0.13860,
        fueloilno4: 0.14590,
        fueloilno6: 0.15010,
        kerosene:   0.13500,
        lpg:        0.09150,
      };
      const normalized = ft.replace(/_/g, '');
      const factor = gallonFactors[normalized];
      if (!factor) throw new Error(`No gallon→MMBtu factor for fuel: ${fuelType}`);
      return quantity * factor;
    }

    // Liquid fuels — liters (convert to gallons first)
    case 'liters': case 'l': case 'litres': {
      const gallons = quantity * 0.26417;
      return toMMBtu(gallons, 'gallons', fuelType);
    }

    // Barrels
    case 'barrels': case 'bbl': {
      const gallons = quantity * 42;
      return toMMBtu(gallons, 'gallons', fuelType);
    }

    // Mass (solid fuels / pellets). Energy content is MJ per kg, so the mass
    // must be expressed in kg before applying it. 0.000948 converts MJ → MMBtu.
    case 'pounds': case 'lbs': case 'lb':
      return quantity * 0.45359 * getCoalMJperKg(ft) * 0.000948;
    case 'kg': case 'kilograms':
      return quantity * getCoalMJperKg(ft) * 0.000948;
    case 'short_tons': case 'shorttons': case 'us_tons':
      return quantity * 907.185 * getCoalMJperKg(ft) * 0.000948;
    case 'metric_tons': case 'metrictons': case 'mt': case 'tonnes':
      return quantity * 1000 * getCoalMJperKg(ft) * 0.000948;

    default:
      throw new Error(`Unsupported unit "${unit}" for fuel "${fuelType}"`);
  }
}

/** Energy content (MJ/kg) for solid fuels, used in mass→MMBtu conversions */
function getCoalMJperKg(ft: string): number {
  const vals: Record<string, number> = {
    coalanthracite:    26.8,
    coalbituminous:    24.9,
    coalsubbituminous: 18.8,
    coallignite:       14.7,
    woodbiomass:       17.4,
  };
  return vals[ft] ?? 24.9; // default to bituminous
}

// ─── Waste ───────────────────────────────────────────────────────────────────

/** Convert any waste quantity to kg */
export function wasteToKg(quantity: number, unit: string): number {
  switch (unit.toLowerCase().replace(/\s/g, '')) {
    case 'kg': case 'kilograms':  return quantity;
    case 'lbs': case 'lb': case 'pounds': return quantity * 0.45359;
    case 'short_tons': case 'shorttons': case 'us_tons': return quantity * 907.185;
    case 'metric_tons': case 'metrictons': case 'mt': case 'tonnes': return quantity * 1_000;
    default:
      throw new Error(`Unsupported waste unit: ${unit}`);
  }
}

// ─── Water ───────────────────────────────────────────────────────────────────

/** Convert any water volume to US gallons */
export function waterToGallons(quantity: number, unit: string): number {
  switch (unit.toLowerCase().replace(/\s/g, '')) {
    case 'gallons': case 'gal': case 'usgal': return quantity;
    case 'liters': case 'l': case 'litres':  return quantity * 0.26417;
    case 'cubic_meters': case 'm3':          return quantity * 264.172;
    case 'ccf': case 'hundred_cubic_feet':   return quantity * 748.052;
    case 'cubic_feet': case 'cf':            return quantity * 7.48052;
    default:
      throw new Error(`Unsupported water unit: ${unit}`);
  }
}

// ─── Refrigerant ─────────────────────────────────────────────────────────────

/** Convert refrigerant quantity to kg (for GWP multiplication) */
export function refrigerantToKg(quantity: number, unit: string): number {
  switch (unit.toLowerCase().replace(/\s/g, '')) {
    case 'kg': case 'kilograms': return quantity;
    case 'lbs': case 'lb': case 'pounds': return quantity * 0.45359;
    default:
      throw new Error(`Unsupported refrigerant unit: ${unit}`);
  }
}

// ─── Convenience: normalize to base unit and label ──────────────────────────

export type NormalizationResult = {
  quantityNormalized: number;
  unitNormalized: string;
};

export function normalizeEmissionInput(
  quantity: number,
  unit: string,
  scope: 'scope1' | 'scope2',
  sourceType: string,
): NormalizationResult {
  if (scope === 'scope2') {
    // Electricity → kWh
    return {
      quantityNormalized: toKWh(quantity, unit),
      unitNormalized: 'kWh',
    };
  }

  // Scope 1 — check if it's a refrigerant
  const isRefrigerant = sourceType === 'refrigerants';
  if (isRefrigerant) {
    return {
      quantityNormalized: refrigerantToKg(quantity, unit),
      unitNormalized: 'kg',
    };
  }

  // Combustion fuel → MMBtu
  return {
    quantityNormalized: toMMBtu(quantity, unit, sourceType),
    unitNormalized: 'MMBtu',
  };
}

/**
 * Normalize any EHS-table reading to its canonical unit.
 *
 * Water and waste convert between units, so they are handled here. The social
 * and governance families do not: counts, hours and days have no conversion
 * between them, so `social-metrics-core` validates the unit against the
 * metric's definition instead of converting it, and needs `sourceType` to know
 * which metric that is.
 *
 * `sourceType` is optional so the water/waste call sites are unchanged. It is
 * required for the social and governance families, and omitting it there
 * throws rather than guessing.
 */
export function normalizeEhsInput(
  quantity: number,
  unit: string,
  metricType: string,
  sourceType?: string,
): NormalizationResult {
  if (isSocialGovernanceFamily(metricType)) {
    if (!sourceType) {
      throw new Error(`A source type is required to normalize a ${metricType} metric.`);
    }
    return normalizeSocialInput(quantity, unit, metricType, sourceType);
  }

  if (metricType === 'water') {
    return {
      quantityNormalized: waterToGallons(quantity, unit),
      unitNormalized: 'gallons',
    };
  }
  if (metricType === 'waste') {
    return {
      quantityNormalized: wasteToKg(quantity, unit),
      unitNormalized: 'kg',
    };
  }
  throw new Error(`Unknown metric type: ${metricType}.`);
}

// ─── Unit option lists for dropdowns ─────────────────────────────────────────

export const ELECTRICITY_UNITS = [
  { value: 'kWh',  label: 'kWh' },
  { value: 'MWh',  label: 'MWh' },
  { value: 'GWh',  label: 'GWh' },
];

export const NATURAL_GAS_UNITS = [
  { value: 'cubic_feet',  label: 'Cubic Feet (cf)' },
  { value: 'CCF',         label: 'CCF (hundred cubic feet)' },
  { value: 'MCF',         label: 'MCF (thousand cubic feet)' },
  { value: 'cubic_meters', label: 'Cubic Meters (m³)' },
  { value: 'therms',      label: 'Therms' },
  { value: 'MMBtu',       label: 'MMBtu' },
];

export const LIQUID_FUEL_UNITS = [
  { value: 'gallons', label: 'Gallons (US)' },
  { value: 'liters',  label: 'Liters' },
  { value: 'barrels', label: 'Barrels' },
];

export const WASTE_UNITS = [
  { value: 'kg',          label: 'Kilograms (kg)' },
  { value: 'lbs',         label: 'Pounds (lbs)' },
  { value: 'short_tons',  label: 'Short Tons (US)' },
  { value: 'metric_tons', label: 'Metric Tons (t)' },
];

export const WATER_UNITS = [
  { value: 'gallons',       label: 'Gallons (US)' },
  { value: 'liters',        label: 'Liters' },
  { value: 'cubic_meters',  label: 'Cubic Meters (m³)' },
  { value: 'CCF',           label: 'CCF (hundred cubic feet)' },
  { value: 'cubic_feet',    label: 'Cubic Feet (cf)' },
];

export const REFRIGERANT_UNITS = [
  { value: 'kg',  label: 'Kilograms (kg)' },
  { value: 'lbs', label: 'Pounds (lbs)' },
];

/** Returns the correct unit options for a given scope + source type */
export function getUnitsForSource(scope: string, sourceType: string) {
  if (scope === 'scope2') return ELECTRICITY_UNITS;
  if (sourceType === 'natural_gas') return NATURAL_GAS_UNITS;
  if (sourceType === 'refrigerants') return REFRIGERANT_UNITS;
  if (['diesel', 'gasoline', 'propane', 'fuel_oil_no2', 'fuel_oil_no4',
       'fuel_oil_no6', 'kerosene', 'lpg'].includes(sourceType)) {
    return LIQUID_FUEL_UNITS;
  }
  // Fallback: energy units
  return [
    { value: 'MMBtu', label: 'MMBtu' },
    { value: 'therms', label: 'Therms' },
    { value: 'GJ', label: 'GJ' },
  ];
}
