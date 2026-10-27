/**
 * CO2e calculation engine.
 * Always calculates at entry time. Dashboard reads stored values.
 */

import { normalizeEmissionInput } from './conversions';
import { fmtCO2e } from './utils';

export type Scope2MarketBasis =
  | 'contractual'
  | 'residual_mix'
  | 'grid_average'
  | 'self_generated'
  | 'heat_supplier';

export interface EmissionCalculationInput {
  scope: 'scope1' | 'scope2';
  sourceType: string;
  sourceDetail?: string; // e.g. refrigerant code
  quantity: number;
  unit: string;
  // ── Scope 2 ──
  /** market_based means a contractual instrument or supplier factor applies. */
  accountingMethod?: 'location_based' | 'market_based';
  locationBasedFactor?: number;   // kg CO2e / kWh, grid average for the site
  locationFactorSource?: string;
  marketBasedFactor?: number;     // kg CO2e / kWh, contractual (supplier / certificate)
  residualMixFactor?: number;     // kg CO2e / kWh, residual mix for the site's market
  residualMixSource?: string;
  heatFactor?: number;            // kg CO2e / kWh thermal, heat or steam supplier
  heatFactorSource?: string;
  instrumentType?: string;
  // ── Scope 1 ──
  scope1Factor?: number;          // kg CO2e / MMBtu (from scope1_emission_factors)
  /** kg biogenic CO2 / MMBtu, reported outside the scopes (biomass only). */
  biogenicCo2Factor?: number;
  refrigerantGwp?: number;        // GWP value (from refrigerant_factors), for refrigerants
  /** HCFCs and other Montreal Protocol gases are reported outside the scopes. */
  isMontrealProtocol?: boolean;
  emissionFactorSource?: string;
}

export interface EmissionCalculationResult {
  quantityNormalized: number;
  unitNormalized: string;
  /** Scope 1: the emission. Scope 2: the MARKET-based figure, for every row. */
  co2eKg: number;
  /** Scope 1: same as co2eKg. Scope 2: the location-based figure. */
  co2eKgLocationBased: number;
  emissionFactorUsed: number;
  emissionFactorSource: string;
  accountingMethod: 'location_based' | 'market_based';
  instrumentType?: string;
  supplierEmissionFactor?: number;
  /** Scope 2 only. */
  locationFactorUsed?: number;
  locationFactorSource?: string;
  scope2MarketBasis?: Scope2MarketBasis;
  /** Biogenic CO2 and Montreal Protocol gases: reported separately, never in a scope total. */
  co2eKgOutsideScopes: number;
  outsideScopesBasis?: string;
}

export const SELF_GENERATED_SOURCE =
  'On-site generation consumed on site: no Scope 2 emissions (GHG Protocol Scope 2 Guidance)';

/**
 * Calculate CO2e for an emission entry.
 * Returns all values to be stored in emission_entries.
 *
 * Every factor comes from the caller (lib/entries.ts resolves them from the
 * reference tables and the organization's custom factors). There are no
 * built-in fallback numbers here: a hard-coded grid factor drifts from the
 * reference table it claims to mirror, and a missing factor is an error the
 * user can fix, not a gap to fill silently.
 */
export function calculateEmissionCO2e(
  input: EmissionCalculationInput,
): EmissionCalculationResult {
  const { quantityNormalized, unitNormalized } = normalizeEmissionInput(
    input.quantity,
    input.unit,
    input.scope,
    input.sourceType,
  );

  if (input.scope === 'scope2') return calculateScope2(input, quantityNormalized, unitNormalized);

  // ─── Scope 1: Refrigerants (kg × GWP) ──────────────────────────────────
  if (input.sourceType === 'refrigerants') {
    if (input.refrigerantGwp == null || !Number.isFinite(input.refrigerantGwp)) {
      throw new Error('refrigerantGwp is required for refrigerant entries');
    }
    const co2eKg = quantityNormalized * input.refrigerantGwp;
    const source = input.emissionFactorSource ?? 'IPCC_AR6';
    // Montreal Protocol gases are outside the Kyoto basket: the GHG Protocol
    // has them reported separately, not in Scope 1.
    if (input.isMontrealProtocol) {
      return {
        quantityNormalized,
        unitNormalized,
        co2eKg: 0,
        co2eKgLocationBased: 0,
        emissionFactorUsed: input.refrigerantGwp,
        emissionFactorSource: source,
        accountingMethod: 'location_based',
        co2eKgOutsideScopes: co2eKg,
        outsideScopesBasis: 'montreal_protocol_gas',
      };
    }
    return {
      quantityNormalized,
      unitNormalized,
      co2eKg,
      co2eKgLocationBased: co2eKg,
      emissionFactorUsed: input.refrigerantGwp,
      emissionFactorSource: source,
      accountingMethod: 'location_based',
      co2eKgOutsideScopes: 0,
    };
  }

  // ─── Scope 1: Combustion fuels (MMBtu × factor) ─────────────────────────
  if (input.scope1Factor == null || !Number.isFinite(input.scope1Factor)) {
    throw new Error(`scope1Factor is required for Scope 1 source: ${input.sourceType}`);
  }
  const co2eKg = quantityNormalized * input.scope1Factor;
  const biogenic = input.biogenicCo2Factor != null && input.biogenicCo2Factor > 0
    ? quantityNormalized * input.biogenicCo2Factor
    : 0;

  return {
    quantityNormalized,
    unitNormalized,
    co2eKg,
    co2eKgLocationBased: co2eKg,
    emissionFactorUsed: input.scope1Factor,
    emissionFactorSource: input.emissionFactorSource ?? 'EPA_2024_AR6',
    accountingMethod: 'location_based',
    co2eKgOutsideScopes: biogenic,
    outsideScopesBasis: biogenic > 0 ? 'biogenic_co2' : undefined,
  };
}

/**
 * Scope 2, following the GHG Protocol Scope 2 Guidance (2015):
 *
 *  - Location-based: the grid-average factor for where the energy is used.
 *  - Market-based, for every row: a contractual instrument or supplier factor
 *    if there is one; otherwise the residual mix for that market; otherwise,
 *    where no residual mix exists, the grid average, and the row records that
 *    it was used so the report can disclose it.
 *  - Electricity generated on site and consumed on site was not purchased, so
 *    it carries no Scope 2 emissions under either method.
 *  - Purchased heat and steam use the supplier's factor under both methods: an
 *    electricity grid factor says nothing about a heat network.
 */
function calculateScope2(
  input: EmissionCalculationInput,
  quantityNormalized: number,
  unitNormalized: string,
): EmissionCalculationResult {
  const base = { quantityNormalized, unitNormalized, co2eKgOutsideScopes: 0 };

  if (input.sourceType === 'renewable_generated') {
    return {
      ...base,
      co2eKg: 0,
      co2eKgLocationBased: 0,
      emissionFactorUsed: 0,
      emissionFactorSource: SELF_GENERATED_SOURCE,
      accountingMethod: 'location_based',
      locationFactorUsed: 0,
      locationFactorSource: SELF_GENERATED_SOURCE,
      scope2MarketBasis: 'self_generated',
    };
  }

  if (input.sourceType === 'district_heating') {
    if (input.heatFactor == null || !Number.isFinite(input.heatFactor)) {
      throw new Error(
        'Purchased heat or steam needs the supplier\'s emission factor. Add a "Scope 2 heat/steam (site)" '
        + 'custom factor for this site on the Emission factors page, then save the entry again.',
      );
    }
    const co2e = quantityNormalized * input.heatFactor;
    const source = input.heatFactorSource ?? 'heat supplier factor';
    return {
      ...base,
      co2eKg: co2e,
      co2eKgLocationBased: co2e,
      emissionFactorUsed: input.heatFactor,
      emissionFactorSource: source,
      accountingMethod: 'location_based',
      locationFactorUsed: input.heatFactor,
      locationFactorSource: source,
      scope2MarketBasis: 'heat_supplier',
    };
  }

  if (input.locationBasedFactor == null || !Number.isFinite(input.locationBasedFactor)) {
    throw new Error(
      'No location-based grid factor for this site. Add a "Scope 2 grid (site)" custom factor for it '
      + 'on the Emission factors page, then save the entry again.',
    );
  }
  const locationFactor = input.locationBasedFactor;
  const locationSource = input.locationFactorSource ?? 'grid average';
  const locationCo2e = quantityNormalized * locationFactor;
  const location = {
    co2eKgLocationBased: locationCo2e,
    locationFactorUsed: locationFactor,
    locationFactorSource: locationSource,
  };

  if (input.accountingMethod === 'market_based') {
    if (input.marketBasedFactor == null || !Number.isFinite(input.marketBasedFactor) || input.marketBasedFactor < 0) {
      throw new Error(
        'A market-based entry needs its contractual emission factor (kg CO₂e/kWh) — from the supplier, '
        + 'the PPA, or 0 for certificates retired on your behalf. Without a contract, choose Location-based: '
        + 'the market-based figure then comes from the residual mix.',
      );
    }
    return {
      ...base,
      ...location,
      co2eKg: quantityNormalized * input.marketBasedFactor,
      emissionFactorUsed: input.marketBasedFactor,
      emissionFactorSource: `contractual: ${instrumentLabel(input.instrumentType)}`,
      accountingMethod: 'market_based',
      instrumentType: input.instrumentType,
      supplierEmissionFactor: input.marketBasedFactor,
      scope2MarketBasis: 'contractual',
    };
  }

  if (input.sourceType === 'renewable_purchased') {
    throw new Error(
      'Purchased renewable electricity is a market-based claim: choose Market-based and enter the '
      + 'contractual factor (usually 0 where certificates are retired on your behalf). Without a '
      + 'contract or certificates, enter it as grid electricity.',
    );
  }

  if (input.residualMixFactor != null && Number.isFinite(input.residualMixFactor)) {
    return {
      ...base,
      ...location,
      co2eKg: quantityNormalized * input.residualMixFactor,
      emissionFactorUsed: input.residualMixFactor,
      emissionFactorSource: input.residualMixSource ?? 'residual mix',
      accountingMethod: 'location_based',
      scope2MarketBasis: 'residual_mix',
    };
  }

  return {
    ...base,
    ...location,
    co2eKg: locationCo2e,
    emissionFactorUsed: locationFactor,
    emissionFactorSource: `${locationSource} — grid average used for market-based: no residual mix for this market`,
    accountingMethod: 'location_based',
    scope2MarketBasis: 'grid_average',
  };
}

const INSTRUMENT_LABELS: Record<string, string> = {
  rec: 'energy attribute certificate',
  ppa: 'power purchase agreement',
  green_tariff: 'green tariff',
  supplier_specific: 'supplier-specific factor',
};

function instrumentLabel(t: string | undefined): string {
  return (t && INSTRUMENT_LABELS[t]) || 'supplier-specific factor';
}

// ─── Project savings calculators ────────────────────────────────────────────

export interface EnergyEfficiencySavings {
  type: 'energy_efficiency';
  currentEnergyKwhPerYear: number;
  reductionPct: number;
  siteElectricityFactor: number; // kg CO2e / kWh
  electricityRateUsdKwh?: number; // default 0.12
  estimatedCostUsd?: number;
}

export interface RenewableEnergySavings {
  type: 'renewable_energy';
  systemCapacityKw?: number;
  annualGenerationKwh?: number;
  capacityFactor?: number; // kWh/kW/yr, default 1200
  siteElectricityFactor: number;
}

export interface FleetSavings {
  type: 'fleet';
  vehiclesConverted?: number;
  milesReducedPerYear?: number;
  fuelTypeDisplaced: 'gasoline' | 'diesel';
  mpg: number;
}

export interface RefrigerantSavings {
  type: 'refrigerants';
  currentAnnualLossKg: number;
  reductionPct: number;
  gwp: number;
}

export interface WaterSavings {
  type: 'water';
  gallonsSavedPerYear: number;
}

export interface CustomSavings {
  type: 'custom';
  co2eReductionKgPerYear: number;
}

export type SavingsInput =
  | EnergyEfficiencySavings
  | RenewableEnergySavings
  | FleetSavings
  | RefrigerantSavings
  | WaterSavings
  | CustomSavings;

export interface SavingsResult {
  estimatedCo2eReductionKgPerYear: number;
  estimatedPaybackMonths?: number;
  summary: string;
}

// Fleet estimates: per-gallon CO2e from the EPA Hub 2024 HHVs (MMBtu/gallon)
// and the EPA 2024 + AR6 CO2e factors per MMBtu that migration 038 seeds.
// Estimates only — measured fuel use goes through Scope 1 entries.
const GASOLINE_MMBTU_PER_GAL = 0.125;
const DIESEL_MMBTU_PER_GAL   = 0.138;
const GASOLINE_CO2E_PER_MMBTU = 70.47;
const DIESEL_CO2E_PER_MMBTU   = 74.21;

export function calculateProjectSavings(input: SavingsInput): SavingsResult {
  switch (input.type) {
    case 'energy_efficiency': {
      const kwhSaved = input.currentEnergyKwhPerYear * (input.reductionPct / 100);
      const co2e = kwhSaved * input.siteElectricityFactor;
      const rate = input.electricityRateUsdKwh ?? 0.12;
      const annualSavingsUsd = kwhSaved * rate;
      const payback = input.estimatedCostUsd && annualSavingsUsd > 0
        ? Math.round((input.estimatedCostUsd / annualSavingsUsd) * 12)
        : undefined;
      return {
        estimatedCo2eReductionKgPerYear: Math.round(co2e),
        estimatedPaybackMonths: payback,
        summary: `${Math.round(kwhSaved).toLocaleString()} kWh/yr saved → ${Math.round(co2e).toLocaleString()} kg CO₂e/yr`,
      };
    }

    case 'renewable_energy': {
      const factor = input.capacityFactor ?? 1200;
      const kwhGenerated = input.annualGenerationKwh
        ?? (input.systemCapacityKw ?? 0) * factor;
      const co2e = kwhGenerated * input.siteElectricityFactor;
      return {
        estimatedCo2eReductionKgPerYear: Math.round(co2e),
        summary: `${Math.round(kwhGenerated).toLocaleString()} kWh/yr generated → ${Math.round(co2e).toLocaleString()} kg CO₂e/yr offset`,
      };
    }

    case 'fleet': {
      const miles = input.milesReducedPerYear ?? 0;
      const gallonsSaved = miles / input.mpg;
      const factor = input.fuelTypeDisplaced === 'gasoline'
        ? GASOLINE_MMBTU_PER_GAL * GASOLINE_CO2E_PER_MMBTU
        : DIESEL_MMBTU_PER_GAL * DIESEL_CO2E_PER_MMBTU;
      const co2e = gallonsSaved * factor;
      return {
        estimatedCo2eReductionKgPerYear: Math.round(co2e),
        summary: `${Math.round(gallonsSaved).toLocaleString()} gal/yr saved → ${Math.round(co2e).toLocaleString()} kg CO₂e/yr`,
      };
    }

    case 'refrigerants': {
      const kgReduced = input.currentAnnualLossKg * (input.reductionPct / 100);
      const co2e = kgReduced * input.gwp;
      return {
        estimatedCo2eReductionKgPerYear: Math.round(co2e),
        summary: `${kgReduced.toFixed(1)} kg refrigerant/yr reduced × GWP ${input.gwp} → ${Math.round(co2e).toLocaleString()} kg CO₂e/yr`,
      };
    }

    case 'water': {
      return {
        estimatedCo2eReductionKgPerYear: 0,
        summary: `${input.gallonsSavedPerYear.toLocaleString()} gallons/yr water saved (no direct CO₂e reduction)`,
      };
    }

    case 'custom': {
      return {
        estimatedCo2eReductionKgPerYear: input.co2eReductionKgPerYear,
        summary: `Custom estimate: ${input.co2eReductionKgPerYear.toLocaleString()} kg CO₂e/yr`,
      };
    }
  }
}

// ─── SBTi 1.5°C pathway ─────────────────────────────────────────────────────

/**
 * SBTi absolute contraction approach, 1.5 °C: a minimum 4.2% of BASE-YEAR
 * emissions per year, linear — the source of the familiar "42% by 2030 from a
 * 2020 base". This was once compounded (base × 0.958^years), which gives 34.9%
 * over the same ten years: a target about 12% of base-year emissions weaker
 * than the one SBTi validates.
 *
 * This is the minimum ambition under the near-term criteria and nothing more.
 * SBTi revises its criteria (separate Scope 1 and Scope 2 minimums, base-year
 * rules, the 5–10-year window); check the version in force when setting a
 * target and record it with the goal.
 */
export const SBTI_15C_ANNUAL_REDUCTION = 0.042; // 4.2% of base-year emissions per year

function sbtiFraction(years: number): number {
  return Math.min(1, Math.max(0, SBTI_15C_ANNUAL_REDUCTION * years));
}

export function calculateSBTiTarget(
  baseYearEmissionsKg: number,
  baseYear: number,
  targetYear: number,
): { targetEmissionsKg: number; reductionPct: number } {
  const fraction = sbtiFraction(targetYear - baseYear);
  return {
    targetEmissionsKg: Math.round(baseYearEmissionsKg * (1 - fraction)),
    reductionPct: Math.round(fraction * 100 * 100) / 100,
  };
}

/** Generate year-by-year SBTi reduction pathway for goal progress chart */
export function getSBTiPathway(
  baseYearEmissionsKg: number,
  baseYear: number,
  targetYear: number,
): Array<{ year: number; targetKg: number }> {
  const pathway = [];
  for (let y = baseYear; y <= targetYear; y++) {
    pathway.push({ year: y, targetKg: Math.round(baseYearEmissionsKg * (1 - sbtiFraction(y - baseYear))) });
  }
  return pathway;
}

/** Calculate absolute reduction target given % */
export function calculateAbsoluteTarget(
  baseYearEmissionsKg: number,
  reductionPct: number,
): number {
  return baseYearEmissionsKg * (1 - reductionPct / 100);
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

/**
 * Format kg CO2e for display.
 *
 * Kept as an alias so there is exactly one CO₂e formatter. This used to carry
 * its own copy, which divided by a million and labelled the result tonnes —
 * 2,500,000 kg rendered as "2.50 tCO₂e", a thousand times too small.
 */
export function formatCO2e(kg: number): string {
  return fmtCO2e(kg);
}

export function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
