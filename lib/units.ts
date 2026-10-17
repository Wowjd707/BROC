/**
 * Display units for reported metrics.
 *
 * Data is always STORED in a single canonical unit per family (see
 * conversions.ts): carbon in kg CO₂e, water in US gallons, waste in kg, energy
 * in kWh. This module converts those canonical values for *display* only —
 * nothing here ever changes what is persisted, so switching display units can
 * never alter a reported figure.
 *
 * Why fixed rather than auto-scaling: the previous formatter picked a unit per
 * value (kg → t → Mt by magnitude), which meant two KPI cards side by side
 * could be in different units. That makes them impossible to compare at a
 * glance and is a real hazard on a reporting dashboard. A metric family now
 * renders in one unit across the whole view.
 *
 * Pure and dependency-free so it is unit-testable.
 */

export type MetricFamily = 'carbon' | 'water' | 'waste' | 'energy';

export type CarbonUnit = 'kg' | 't';
export type WaterUnit  = 'gal' | 'L' | 'm3';
export type WasteUnit  = 'kg' | 't' | 'lb';
export type EnergyUnit = 'kWh' | 'MWh' | 'GJ';

export interface UnitPreferences {
  carbon: CarbonUnit;
  water: WaterUnit;
  waste: WasteUnit;
  energy: EnergyUnit;
}

/**
 * Metric defaults. Carbon uses `t CO₂e` rather than `MT CO₂e`: in SI, `Mt`
 * means megatonne, so `MT` is genuinely ambiguous to an international reader
 * or an assurance provider. GHG Protocol and CDP both write `tCO₂e`. The
 * toggle labels spell out "metric tons" so there is no doubt.
 */
export const DEFAULT_UNITS: UnitPreferences = {
  carbon: 't',
  water: 'm3',
  waste: 't',
  energy: 'MWh',
};

// ─── Conversion from the canonical stored unit ───────────────────────────────

const CARBON_FROM_KG: Record<CarbonUnit, number> = { kg: 1, t: 1 / 1000 };
const WATER_FROM_GAL: Record<WaterUnit, number> = { gal: 1, L: 3.785411784, m3: 1 / 264.172052 };
const WASTE_FROM_KG:  Record<WasteUnit, number> = { kg: 1, t: 1 / 1000, lb: 1 / 0.45359237 };
const ENERGY_FROM_KWH: Record<EnergyUnit, number> = { kWh: 1, MWh: 1 / 1000, GJ: 0.0036 };

export const UNIT_LABELS: Record<string, string> = {
  kg: 'kg CO₂e', t: 't CO₂e',
  gal: 'gal', L: 'L', m3: 'm³',
  'waste:kg': 'kg', 'waste:t': 't', 'waste:lb': 'lb',
  kWh: 'kWh', MWh: 'MWh', GJ: 'GJ',
};

/** Human-readable options for the unit toggle. */
export const UNIT_OPTIONS: Record<MetricFamily, { value: string; label: string }[]> = {
  carbon: [
    { value: 't',  label: 'Metric tons (t CO₂e)' },
    { value: 'kg', label: 'Kilograms (kg CO₂e)' },
  ],
  water: [
    { value: 'm3',  label: 'Cubic meters (m³)' },
    { value: 'gal', label: 'US gallons' },
    { value: 'L',   label: 'Liters' },
  ],
  waste: [
    { value: 't',  label: 'Metric tons (t)' },
    { value: 'kg', label: 'Kilograms (kg)' },
    { value: 'lb', label: 'Pounds (lb)' },
  ],
  energy: [
    { value: 'MWh', label: 'MWh' },
    { value: 'kWh', label: 'kWh' },
    { value: 'GJ',  label: 'Gigajoules (GJ)' },
  ],
};

/** Convert a canonical value into the requested display unit. */
export function convertForDisplay(
  value: number,
  family: MetricFamily,
  unit: string,
): number {
  switch (family) {
    case 'carbon': return value * (CARBON_FROM_KG[unit as CarbonUnit] ?? 1);
    case 'water':  return value * (WATER_FROM_GAL[unit as WaterUnit] ?? 1);
    case 'waste':  return value * (WASTE_FROM_KG[unit as WasteUnit] ?? 1);
    case 'energy': return value * (ENERGY_FROM_KWH[unit as EnergyUnit] ?? 1);
  }
}

/** The unit label to render alongside a converted value. */
export function unitLabel(family: MetricFamily, unit: string): string {
  if (family === 'waste') return UNIT_LABELS[`waste:${unit}`] ?? unit;
  return UNIT_LABELS[unit] ?? unit;
}

/**
 * MAXIMUM decimal places that keep a figure readable without implying false
 * precision: large values get none, small ones get enough to not read as zero.
 * Used as a ceiling, not a fixed count — 500 renders "500", not "500.0".
 */
function decimalsFor(value: number): number {
  const abs = Math.abs(value);
  if (abs === 0) return 0;
  if (abs >= 1000) return 0;
  if (abs >= 10) return 1;
  if (abs >= 1) return 2;
  return 3;
}

/** Format a canonical value in the requested display unit, with its label. */
export function formatMetric(
  value: number | null | undefined,
  family: MetricFamily,
  unit: string,
  options: { withLabel?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const converted = convertForDisplay(value, family, unit);
  const text = converted.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimalsFor(converted),
  });
  return options.withLabel === false ? text : `${text} ${unitLabel(family, unit)}`;
}

/** Convenience wrappers reading from a preferences object. */
export function formatCarbon(kg: number | null | undefined, prefs: UnitPreferences): string {
  return formatMetric(kg, 'carbon', prefs.carbon);
}
export function formatWater(gallons: number | null | undefined, prefs: UnitPreferences): string {
  return formatMetric(gallons, 'water', prefs.water);
}
export function formatWaste(kg: number | null | undefined, prefs: UnitPreferences): string {
  return formatMetric(kg, 'waste', prefs.waste);
}
export function formatEnergy(kwh: number | null | undefined, prefs: UnitPreferences): string {
  return formatMetric(kwh, 'energy', prefs.energy);
}

/** Validate a stored preference blob, falling back to defaults per family. */
export function normalizePreferences(raw: unknown): UnitPreferences {
  const p = (raw ?? {}) as Partial<UnitPreferences>;
  const valid = <T extends string>(v: unknown, family: MetricFamily): T | null =>
    typeof v === 'string' && UNIT_OPTIONS[family].some((o) => o.value === v) ? (v as T) : null;

  return {
    carbon: valid<CarbonUnit>(p.carbon, 'carbon') ?? DEFAULT_UNITS.carbon,
    water:  valid<WaterUnit>(p.water, 'water')    ?? DEFAULT_UNITS.water,
    waste:  valid<WasteUnit>(p.waste, 'waste')    ?? DEFAULT_UNITS.waste,
    energy: valid<EnergyUnit>(p.energy, 'energy') ?? DEFAULT_UNITS.energy,
  };
}
