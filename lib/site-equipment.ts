/**
 * Vocabulary for the site sustainability profile and equipment inventory.
 *
 * Every list here mirrors a CHECK constraint in migration 020. They are kept
 * together so the two can be diffed by eye: a value offered in the UI that the
 * database rejects produces a save failure the user cannot act on.
 *
 * Config over hardcoding applies to *factors and regulatory rules*, not to
 * these — they are the shape of the form, and adding a value means adding a
 * migration. `other` plus a free-text name is the escape hatch in between.
 *
 * Pure and dependency-free so it is unit-testable.
 */

export interface Option { value: string; label: string }

// ─── Site profile ────────────────────────────────────────────────────────────

/**
 * Water withdrawal source. The split matters for disclosure: CDP Water,
 * ESRS E3 and GRI 303 all report withdrawal by source, and a groundwater draw
 * carries permit obligations a municipal purchase does not.
 */
export const WATER_SOURCES: Option[] = [
  { value: 'municipal',             label: 'Municipal / public supply' },
  { value: 'groundwater_well',      label: 'Groundwater (on-site well)' },
  { value: 'surface_water',         label: 'Surface water (river, lake)' },
  { value: 'rainwater',             label: 'Rainwater harvesting' },
  { value: 'reclaimed',             label: 'Reclaimed / recycled water' },
  { value: 'purchased_third_party', label: 'Purchased from a third party' },
  { value: 'mixed',                 label: 'Mixed sources' },
  { value: 'other',                 label: 'Other' },
];

export const WASTEWATER_DISCHARGES: Option[] = [
  { value: 'municipal_sewer',  label: 'Municipal sewer (POTW)' },
  { value: 'septic',           label: 'Septic system' },
  { value: 'surface_water',    label: 'Permitted surface discharge' },
  { value: 'onsite_treatment', label: 'On-site treatment' },
  { value: 'evaporation',      label: 'Evaporation / zero discharge' },
  { value: 'other',            label: 'Other' },
];

export const GENERATOR_FUELS: Option[] = [
  { value: 'diesel',      label: 'Diesel' },
  { value: 'natural_gas', label: 'Natural gas' },
  { value: 'propane',     label: 'Propane / LPG' },
  { value: 'gasoline',    label: 'Gasoline' },
  { value: 'dual_fuel',   label: 'Dual fuel' },
  { value: 'other',       label: 'Other' },
];

// ─── Equipment ───────────────────────────────────────────────────────────────

/**
 * Grouped so a long list stays navigable. The groups are presentational only —
 * the stored value is the flat `value`, and the database constraint knows
 * nothing about groups.
 */
export const EQUIPMENT_GROUPS: { group: string; items: Option[] }[] = [
  {
    group: 'Heating, cooling & air',
    items: [
      { value: 'chiller',        label: 'Chiller' },
      { value: 'boiler',         label: 'Boiler' },
      { value: 'furnace',        label: 'Furnace' },
      { value: 'air_handler',    label: 'Air handler (AHU)' },
      { value: 'rooftop_unit',   label: 'Rooftop unit (RTU)' },
      { value: 'cooling_tower',  label: 'Cooling tower' },
      { value: 'water_heater',   label: 'Water heater' },
      { value: 'refrigeration',  label: 'Refrigeration / cold storage' },
    ],
  },
  {
    group: 'Utilities & motors',
    items: [
      { value: 'air_compressor', label: 'Air compressor' },
      { value: 'pump',           label: 'Pump' },
      { value: 'fan_blower',     label: 'Fan / blower' },
      { value: 'motor_drive',    label: 'Motor / VFD' },
      { value: 'conveyor',       label: 'Conveyor' },
      { value: 'dust_collector', label: 'Dust collector' },
    ],
  },
  {
    group: 'Manufacturing',
    items: [
      { value: 'cnc_machine',      label: 'CNC machine' },
      { value: 'injection_molding', label: 'Injection molding machine' },
      { value: 'press_stamping',   label: 'Press / stamping' },
      { value: 'welding',          label: 'Welding equipment' },
      { value: 'oven_dryer',       label: 'Oven / dryer' },
      { value: 'kiln_furnace',     label: 'Kiln / industrial furnace' },
      { value: 'paint_booth',      label: 'Paint booth' },
      { value: 'process_other',    label: 'Other process equipment' },
    ],
  },
  {
    group: 'Facility',
    items: [
      { value: 'lighting',             label: 'Lighting system' },
      { value: 'server_room',          label: 'Server room / IT load' },
      { value: 'ev_charger',           label: 'EV charger' },
      { value: 'emergency_generator',  label: 'Emergency / standby generator' },
      { value: 'other',                label: 'Other' },
    ],
  },
];

export const EQUIPMENT_TYPES: Option[] = EQUIPMENT_GROUPS.flatMap((g) => g.items);

export const EQUIPMENT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  EQUIPMENT_TYPES.map((t) => [t.value, t.label]),
);

export const ENERGY_SOURCES: Option[] = [
  { value: 'electricity',     label: 'Electricity' },
  { value: 'natural_gas',     label: 'Natural gas' },
  { value: 'diesel',          label: 'Diesel' },
  { value: 'propane',         label: 'Propane / LPG' },
  { value: 'fuel_oil',        label: 'Fuel oil' },
  { value: 'steam',           label: 'Purchased steam' },
  { value: 'chilled_water',   label: 'Purchased chilled water' },
  { value: 'compressed_air',  label: 'Compressed air' },
  { value: 'multiple',        label: 'Multiple' },
  { value: 'other',           label: 'Other' },
];

export const EQUIPMENT_STATUSES: Option[] = [
  { value: 'operating', label: 'Operating' },
  { value: 'standby',   label: 'Standby' },
  { value: 'idle',      label: 'Idle' },
  { value: 'retired',   label: 'Retired' },
];

/**
 * Nameplate capacity units. Deliberately domain-specific and free of any
 * conversion table: a chiller's "tons" and a press's "tons" are different
 * quantities (refrigeration vs. force), so silently converting between them
 * would be worse than not converting at all. `rated_power_kw` is the column to
 * read for anything numeric.
 */
export const CAPACITY_UNITS: Option[] = [
  { value: 'tons_refrigeration', label: 'Tons (refrigeration)' },
  { value: 'hp',                 label: 'Horsepower (HP)' },
  { value: 'kw',                 label: 'kW' },
  { value: 'btu_hr',             label: 'BTU/hr' },
  { value: 'mmbtu_hr',           label: 'MMBtu/hr' },
  { value: 'cfm',                label: 'CFM' },
  { value: 'gpm',                label: 'GPM' },
  { value: 'lb_hr_steam',        label: 'lb/hr steam' },
  { value: 'tons_force',         label: 'Tons (force)' },
  { value: 'other',              label: 'Other' },
];

export const CAPACITY_UNIT_LABELS: Record<string, string> = Object.fromEntries(
  CAPACITY_UNITS.map((u) => [u.value, u.label]),
);

/** Equipment types that normally hold a refrigerant charge. */
const REFRIGERANT_BEARING = new Set([
  'chiller', 'refrigeration', 'rooftop_unit', 'air_handler',
]);

/**
 * Whether the refrigerant fields are worth showing for a type. Advisory only —
 * a charge recorded against any type is still stored, because the alternative
 * is losing a number the user deliberately entered.
 */
export function holdsRefrigerant(equipmentType: string): boolean {
  return REFRIGERANT_BEARING.has(equipmentType);
}

/**
 * Connected electrical load implied by an inventory, in kW.
 *
 * Only equipment with a stated `rated_power_kw` contributes; everything else is
 * counted as unknown rather than estimated from nameplate capacity. Turning
 * tons of refrigeration into kW needs an efficiency assumption, and inventing
 * one here would put a fabricated number on a sustainability dashboard.
 *
 * Retired equipment is excluded — it is history, not load.
 */
export function connectedLoadKw(
  equipment: { rated_power_kw: number | null; quantity: number; status: string; is_active: boolean }[],
): { knownKw: number; itemsWithPower: number; itemsWithoutPower: number } {
  let knownKw = 0;
  let itemsWithPower = 0;
  let itemsWithoutPower = 0;

  for (const e of equipment) {
    if (!e.is_active || e.status === 'retired') continue;
    if (e.rated_power_kw != null && Number.isFinite(e.rated_power_kw)) {
      knownKw += e.rated_power_kw * (e.quantity || 1);
      itemsWithPower += 1;
    } else {
      itemsWithoutPower += 1;
    }
  }

  return { knownKw, itemsWithPower, itemsWithoutPower };
}
