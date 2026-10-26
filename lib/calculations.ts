/**
 * CO2e calculation engine.
 * Always calculates at entry time. Dashboard reads stored values.
 */

import { normalizeEmissionInput, normalizeEhsInput, toMMBtu } from './conversions';
import { fmtCO2e } from './utils';

export interface EmissionCalculationInput {
  scope: 'scope1' | 'scope2';
  sourceType: string;
  sourceDetail?: string; // e.g. refrigerant code
  quantity: number;
  unit: string;
  // Scope 2 specific
  accountingMethod?: 'location_based' | 'market_based';
  locationBasedFactor?: number;   // kg CO2e / kWh
  marketBasedFactor?: number;     // kg CO2e / kWh (supplier/contractual)
  instrumentType?: string;
  // Scope 1 specific
  scope1Factor?: number;          // kg CO2e / MMBtu (from scope1_emission_factors)
  refrigerantGwp?: number;        // GWP value (from refrigerant_factors), for refrigerants
  emissionFactorSource?: string;
}

export interface EmissionCalculationResult {
  quantityNormalized: number;
  unitNormalized: string;
  co2eKg: number;
  co2eKgLocationBased: number;    // always populated; same as co2eKg for location-based
  emissionFactorUsed: number;
  emissionFactorSource: string;
  accountingMethod: 'location_based' | 'market_based';
  instrumentType?: string;
  supplierEmissionFactor?: number;
}

/**
 * Calculate CO2e for an emission entry.
 * Returns all values to be stored in emission_entries.
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

  // ─── Scope 2: Electricity ───────────────────────────────────────────────
  if (input.scope === 'scope2') {
    const method = input.accountingMethod ?? 'location_based';
    const locationFactor = input.locationBasedFactor ?? 0.386; // US national fallback
    const locationCo2e = quantityNormalized * locationFactor;

    if (method === 'market_based') {
      const marketFactor = input.marketBasedFactor ?? 0.455; // US residual mix fallback
      const marketCo2e = quantityNormalized * marketFactor;

      return {
        quantityNormalized,
        unitNormalized,
        co2eKg: marketCo2e,
        co2eKgLocationBased: locationCo2e,
        emissionFactorUsed: marketFactor,
        emissionFactorSource: input.emissionFactorSource ?? 'M-RETS_Greene_2023_residual_mix',
        accountingMethod: 'market_based',
        instrumentType: input.instrumentType,
        supplierEmissionFactor: input.marketBasedFactor,
      };
    }

    return {
      quantityNormalized,
      unitNormalized,
      co2eKg: locationCo2e,
      co2eKgLocationBased: locationCo2e,
      emissionFactorUsed: locationFactor,
      emissionFactorSource: input.emissionFactorSource ?? 'eGRID2023',
      accountingMethod: 'location_based',
    };
  }

  // ─── Scope 1: Refrigerants (kg × GWP) ──────────────────────────────────
  if (input.sourceType === 'refrigerants') {
    if (!input.refrigerantGwp) {
      throw new Error('refrigerantGwp is required for refrigerant entries');
    }
    const co2eKg = quantityNormalized * input.refrigerantGwp;
    return {
      quantityNormalized,
      unitNormalized,
      co2eKg,
      co2eKgLocationBased: co2eKg,
      emissionFactorUsed: input.refrigerantGwp,
      emissionFactorSource: input.emissionFactorSource ?? 'IPCC_AR6',
      accountingMethod: 'location_based',
    };
  }

  // ─── Scope 1: Combustion fuels (MMBtu × factor) ─────────────────────────
  if (!input.scope1Factor) {
    throw new Error(`scope1Factor is required for Scope 1 source: ${input.sourceType}`);
  }
  const co2eKg = quantityNormalized * input.scope1Factor;

  return {
    quantityNormalized,
    unitNormalized,
    co2eKg,
    co2eKgLocationBased: co2eKg,
    emissionFactorUsed: input.scope1Factor,
    emissionFactorSource: input.emissionFactorSource ?? 'EPA_2024',
    accountingMethod: 'location_based',
  };
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

const GASOLINE_CO2E_PER_GALLON = 8.78;  // kg CO2e / gallon (EPA 2024)
const DIESEL_CO2E_PER_GALLON   = 10.21; // kg CO2e / gallon (EPA 2024)
const GASOLINE_MMBtu_PER_GAL   = 0.12454;
const DIESEL_MMBtu_PER_GAL     = 0.13756;
const GASOLINE_CO2E_FACTOR     = 70.22; // kg/MMBtu
const DIESEL_CO2E_FACTOR       = 73.96; // kg/MMBtu

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
        ? GASOLINE_MMBtu_PER_GAL * GASOLINE_CO2E_FACTOR
        : DIESEL_MMBtu_PER_GAL * DIESEL_CO2E_FACTOR;
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

/** Annual compound reduction rate for SBTi 1.5°C science-based target */
const SBTI_15C_ANNUAL_REDUCTION = 0.042; // 4.2% per year

export function calculateSBTiTarget(
  baseYearEmissionsKg: number,
  baseYear: number,
  targetYear: number,
): { targetEmissionsKg: number; reductionPct: number } {
  const years = targetYear - baseYear;
  const targetEmissionsKg =
    baseYearEmissionsKg * Math.pow(1 - SBTI_15C_ANNUAL_REDUCTION, years);
  const reductionPct =
    ((baseYearEmissionsKg - targetEmissionsKg) / baseYearEmissionsKg) * 100;
  return {
    targetEmissionsKg: Math.round(targetEmissionsKg),
    reductionPct: Math.round(reductionPct * 100) / 100,
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
    const years = y - baseYear;
    const targetKg =
      baseYearEmissionsKg * Math.pow(1 - SBTI_15C_ANNUAL_REDUCTION, years);
    pathway.push({ year: y, targetKg: Math.round(targetKg) });
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
