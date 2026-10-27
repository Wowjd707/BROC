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

/** 1 MMBtu = 1,055.05585 MJ (international table Btu). */
const MJ_PER_MMBTU = 1_055.05585262;
/** 1 MMBtu = 293.07107 kWh. */
export const KWH_PER_MMBTU = MJ_PER_MMBTU / 3.6;

/**
 * Convert purchased heat or steam to kWh (thermal). Suppliers bill district
 * heat and steam in energy units, not in kWh of electricity; this accepts the
 * common ones so the quantity can be multiplied by the supplier's kg CO₂e/kWh.
 */
export function heatToKWh(quantity: number, unit: string): number {
  switch (unit.toLowerCase().replace(/\s/g, '')) {
    case 'kwh':   return quantity;
    case 'mwh':   return quantity * 1_000;
    case 'gwh':   return quantity * 1_000_000;
    case 'mj':    return quantity / 3.6;
    case 'gj':    return (quantity * 1_000) / 3.6;
    case 'mmbtu': return quantity * KWH_PER_MMBTU;
    case 'therm': case 'therms': return quantity * KWH_PER_MMBTU * 0.1;
    default:
      throw new Error(`Unsupported heat or steam unit: ${unit}`);
  }
}

/**
 * Higher heating values from the EPA GHG Emission Factors Hub (2024), Table 1.
 * HHV throughout, to match the per-MMBtu emission factors, which are on an
 * HHV basis too. Keys are fuel types with underscores removed.
 */
const MMBTU_PER_GALLON: Record<string, number> = {
  diesel:     0.138, // distillate fuel oil No. 2 (EPA lists diesel under it)
  fueloilno2: 0.138,
  fueloilno4: 0.146,
  fueloilno6: 0.150,
  gasoline:   0.125, // motor gasoline
  kerosene:   0.135,
  propane:    0.091,
  lpg:        0.092,
};

/** EPA Hub 2024 Table 1, MMBtu per short ton. */
const MMBTU_PER_SHORT_TON: Record<string, number> = {
  coalanthracite:    25.09,
  coalbituminous:    24.93,
  coalsubbituminous: 17.25,
  coallignite:       14.21,
  woodbiomass:       17.48, // wood and wood residuals
};

/** EPA Hub 2024 Table 1, MMBtu per standard cubic foot. */
const MMBTU_PER_SCF: Record<string, number> = {
  naturalgas: 0.001026,
  propane:    0.002516, // propane gas
};

const KG_PER_SHORT_TON = 907.18474;
const SCF_PER_M3 = 35.3146667;

/** Convert any supported combustion-fuel unit to MMBtu */
export function toMMBtu(quantity: number, unit: string, fuelType: string): number {
  const u = unit.toLowerCase().replace(/\s/g, '');
  const ft = fuelType.toLowerCase().replace(/[_\s]/g, '');

  // Direct energy units
  if (u === 'mmbtu')     return quantity;
  if (u === 'btu')       return quantity / 1_000_000;
  if (u === 'therms' || u === 'therm') return quantity * 0.1;
  if (u === 'mj')        return quantity / MJ_PER_MMBTU;
  if (u === 'gj')        return (quantity * 1_000) / MJ_PER_MMBTU;

  // Gas volumes. Each gaseous fuel has its own energy content: a cubic foot of
  // propane carries about 2.5 times the energy of a cubic foot of natural gas,
  // so applying the natural-gas value to every fuel understated propane by 60%.
  const scf = (n: number): number => {
    const perScf = MMBTU_PER_SCF[ft];
    if (!perScf) throw new Error(`No volume→MMBtu factor for fuel: ${fuelType}. Enter it in MMBtu, therms or GJ.`);
    return n * perScf;
  };

  // Mass. Throws for a fuel without a published HHV per ton rather than
  // guessing: this once defaulted every unlisted fuel to bituminous coal, so a
  // tonne of diesel came out 45% low.
  const shortTons = (n: number): number => {
    const perTon = MMBTU_PER_SHORT_TON[ft];
    if (!perTon) throw new Error(`No mass→MMBtu factor for fuel: ${fuelType}. Enter it in volume or energy units.`);
    return n * perTon;
  };

  switch (u) {
    case 'cubic_feet': case 'cubicfeet': case 'cf': case 'scf':
      return scf(quantity);
    case 'ccf':
      return scf(quantity * 100);
    case 'mcf':
      return scf(quantity * 1_000);
    case 'cubic_meters': case 'cubicmeters': case 'm3':
      return scf(quantity * SCF_PER_M3);

    // Liquid fuels — gallons
    case 'gallons': case 'gal': case 'usgal': {
      const factor = MMBTU_PER_GALLON[ft];
      if (!factor) throw new Error(`No gallon→MMBtu factor for fuel: ${fuelType}`);
      return quantity * factor;
    }

    // Liquid fuels — litres (convert to US gallons first)
    case 'liters': case 'l': case 'litres':
      return toMMBtu(quantity / 3.785411784, 'gallons', fuelType);

    // Barrels
    case 'barrels': case 'bbl':
      return toMMBtu(quantity * 42, 'gallons', fuelType);

    // Mass (solid fuels)
    case 'pounds': case 'lbs': case 'lb':
      return shortTons(quantity / 2_000);
    case 'kg': case 'kilograms':
      return shortTons(quantity / KG_PER_SHORT_TON);
    case 'short_tons': case 'shorttons': case 'us_tons':
      return shortTons(quantity);
    case 'metric_tons': case 'metrictons': case 'mt': case 'tonnes':
      return shortTons((quantity * 1_000) / KG_PER_SHORT_TON);

    default:
      throw new Error(`Unsupported unit "${unit}" for fuel "${fuelType}"`);
  }
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
    // Purchased heat and steam → kWh (thermal); electricity → kWh
    return {
      quantityNormalized: sourceType === 'district_heating' ? heatToKWh(quantity, unit) : toKWh(quantity, unit),
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

export const HEAT_UNITS = [
  { value: 'kWh',    label: 'kWh (thermal)' },
  { value: 'MWh',    label: 'MWh (thermal)' },
  { value: 'MMBtu',  label: 'MMBtu' },
  { value: 'GJ',     label: 'GJ' },
  { value: 'therms', label: 'Therms' },
];

export const SOLID_FUEL_UNITS = [
  { value: 'short_tons',  label: 'Short Tons (US)' },
  { value: 'metric_tons', label: 'Metric Tons (t)' },
  { value: 'MMBtu',       label: 'MMBtu' },
  { value: 'GJ',          label: 'GJ' },
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
  if (scope === 'scope2') return sourceType === 'district_heating' ? HEAT_UNITS : ELECTRICITY_UNITS;
  if (sourceType === 'natural_gas') return NATURAL_GAS_UNITS;
  if (sourceType === 'refrigerants') return REFRIGERANT_UNITS;
  if (['diesel', 'gasoline', 'propane', 'fuel_oil_no2', 'fuel_oil_no4',
       'fuel_oil_no6', 'kerosene', 'lpg'].includes(sourceType)) {
    return LIQUID_FUEL_UNITS;
  }
  if (sourceType.startsWith('coal_') || sourceType === 'wood_biomass') return SOLID_FUEL_UNITS;
  // Fallback: energy units
  return [
    { value: 'MMBtu', label: 'MMBtu' },
    { value: 'therms', label: 'Therms' },
    { value: 'GJ', label: 'GJ' },
  ];
}
