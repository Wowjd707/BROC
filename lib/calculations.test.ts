import { describe, it, expect } from 'vitest';
import {
  calculateEmissionCO2e,
  calculateProjectSavings,
  calculateSBTiTarget,
  getSBTiPathway,
  calculateAbsoluteTarget,
  formatCO2e,
  formatNumber,
} from './calculations';

describe('calculateEmissionCO2e — Scope 2', () => {
  const elec = { scope: 'scope2' as const, sourceType: 'electricity', quantity: 1000, unit: 'kWh' };

  it('stores a market-based figure for every row, from the residual mix when there is no contract', () => {
    // Regression: a row without a contract stored the grid average as its only
    // figure, and every market-based total silently used it.
    const r = calculateEmissionCO2e({
      ...elec,
      locationBasedFactor: 0.4, locationFactorSource: 'eGRID2023 (ZIP 28202)',
      residualMixFactor: 0.72, residualMixSource: 'AIB_2023 (direct CO2)',
    });
    expect(r.co2eKgLocationBased).toBeCloseTo(400, 6);
    expect(r.co2eKg).toBeCloseTo(720, 6);
    expect(r.scope2MarketBasis).toBe('residual_mix');
    expect(r.emissionFactorSource).toBe('AIB_2023 (direct CO2)');
    expect(r.locationFactorUsed).toBe(0.4);
    expect(r.locationFactorSource).toBe('eGRID2023 (ZIP 28202)');
    expect(r.accountingMethod).toBe('location_based');
  });

  it('falls back to the grid average for market-based where no residual mix exists, and says so', () => {
    const r = calculateEmissionCO2e({ ...elec, locationBasedFactor: 0.4, locationFactorSource: 'eGRID2023' });
    expect(r.co2eKg).toBeCloseTo(400, 6);
    expect(r.scope2MarketBasis).toBe('grid_average');
    expect(r.emissionFactorSource).toMatch(/grid average used for market-based/);
  });

  it('uses the contractual factor for market-based and keeps both factors', () => {
    const r = calculateEmissionCO2e({
      ...elec,
      accountingMethod: 'market_based',
      locationBasedFactor: 0.4,
      marketBasedFactor: 0.05,
      instrumentType: 'ppa',
      residualMixFactor: 0.7,
    });
    expect(r.co2eKg).toBeCloseTo(50, 6);
    expect(r.co2eKgLocationBased).toBeCloseTo(400, 6);
    expect(r.accountingMethod).toBe('market_based');
    expect(r.scope2MarketBasis).toBe('contractual');
    expect(r.supplierEmissionFactor).toBe(0.05);
    expect(r.locationFactorUsed).toBe(0.4);
    expect(r.emissionFactorSource).toBe('contractual: power purchase agreement');
  });

  it('refuses a market-based entry without its contractual factor', () => {
    expect(() => calculateEmissionCO2e({ ...elec, accountingMethod: 'market_based', locationBasedFactor: 0.4 }))
      .toThrow(/contractual emission factor/);
  });

  it('has no built-in grid factor: a missing location factor is an error', () => {
    // Regression: a hard-coded 0.386 stood in for any missing factor.
    expect(() => calculateEmissionCO2e({ ...elec })).toThrow(/No location-based grid factor/);
  });

  it('charges no Scope 2 emissions for electricity generated and consumed on site', () => {
    // Regression: 1,000 MWh of rooftop solar was charged at the grid rate.
    const r = calculateEmissionCO2e({ ...elec, sourceType: 'renewable_generated', quantity: 1, unit: 'MWh', locationBasedFactor: 0.287 });
    expect(r.co2eKg).toBe(0);
    expect(r.co2eKgLocationBased).toBe(0);
    expect(r.quantityNormalized).toBe(1000);
    expect(r.scope2MarketBasis).toBe('self_generated');
  });

  it('treats purchased renewables as a market-based claim', () => {
    const r = calculateEmissionCO2e({
      ...elec, sourceType: 'renewable_purchased', accountingMethod: 'market_based',
      locationBasedFactor: 0.287, marketBasedFactor: 0, instrumentType: 'rec',
    });
    expect(r.co2eKg).toBe(0);
    expect(r.co2eKgLocationBased).toBeCloseTo(287, 6);
    expect(() => calculateEmissionCO2e({ ...elec, sourceType: 'renewable_purchased', locationBasedFactor: 0.287 }))
      .toThrow(/market-based claim/);
  });

  it('prices purchased heat at the supplier factor, never the electricity grid factor', () => {
    const r = calculateEmissionCO2e({
      scope: 'scope2', sourceType: 'district_heating', quantity: 10, unit: 'MMBtu',
      locationBasedFactor: 0.4, heatFactor: 0.2, heatFactorSource: 'City Heat Co 2025 disclosure',
    });
    expect(r.quantityNormalized).toBeCloseTo(2930.7107, 3);
    expect(r.co2eKg).toBeCloseTo(2930.7107 * 0.2, 3);
    expect(r.co2eKgLocationBased).toBeCloseTo(r.co2eKg, 9);
    expect(r.scope2MarketBasis).toBe('heat_supplier');
    expect(() => calculateEmissionCO2e({ scope: 'scope2', sourceType: 'district_heating', quantity: 10, unit: 'MMBtu', locationBasedFactor: 0.4 }))
      .toThrow(/heat or steam needs the supplier/);
  });
});

describe('calculateEmissionCO2e — Scope 1', () => {
  it('multiplies refrigerant kg by GWP', () => {
    const r = calculateEmissionCO2e({
      scope: 'scope1',
      sourceType: 'refrigerants',
      quantity: 5,
      unit: 'kg',
      refrigerantGwp: 1526,
    });
    expect(r.co2eKg).toBeCloseTo(5 * 1526, 6);
    expect(r.emissionFactorUsed).toBe(1526);
    expect(r.co2eKgOutsideScopes).toBe(0);
  });

  it('reports Montreal Protocol gases outside the scopes', () => {
    // HCFC-22 is outside the Kyoto basket: reported separately, not in Scope 1.
    const r = calculateEmissionCO2e({
      scope: 'scope1', sourceType: 'refrigerants', quantity: 10, unit: 'kg',
      refrigerantGwp: 1960, isMontrealProtocol: true,
    });
    expect(r.co2eKg).toBe(0);
    expect(r.co2eKgLocationBased).toBe(0);
    expect(r.co2eKgOutsideScopes).toBeCloseTo(19_600, 6);
    expect(r.outsideScopesBasis).toBe('montreal_protocol_gas');
    expect(r.emissionFactorUsed).toBe(1960);
  });

  it('keeps biogenic CO2 from biomass out of Scope 1', () => {
    // Regression: wood was charged 93.8 kg CO2/MMBtu in Scope 1. Only CH4 and
    // N2O count; the biogenic CO2 is reported separately.
    const r = calculateEmissionCO2e({
      scope: 'scope1', sourceType: 'wood_biomass', quantity: 1000, unit: 'MMBtu',
      scope1Factor: 1.18, biogenicCo2Factor: 93.8,
    });
    expect(r.co2eKg).toBeCloseTo(1180, 6);
    expect(r.co2eKgOutsideScopes).toBeCloseTo(93_800, 6);
    expect(r.outsideScopesBasis).toBe('biogenic_co2');
  });

  it('throws when refrigerant GWP is missing', () => {
    expect(() =>
      calculateEmissionCO2e({
        scope: 'scope1',
        sourceType: 'refrigerants',
        quantity: 5,
        unit: 'kg',
      }),
    ).toThrow(/refrigerantGwp is required/);
  });

  it('multiplies combustion MMBtu by the fuel factor', () => {
    const r = calculateEmissionCO2e({
      scope: 'scope1',
      sourceType: 'natural_gas',
      quantity: 10,
      unit: 'therms', // → 1 MMBtu
      scope1Factor: 53.06,
    });
    expect(r.co2eKg).toBeCloseTo(53.06, 4);
  });

  it('throws when the combustion factor is missing', () => {
    expect(() =>
      calculateEmissionCO2e({
        scope: 'scope1',
        sourceType: 'natural_gas',
        quantity: 10,
        unit: 'therms',
      }),
    ).toThrow(/scope1Factor is required/);
  });
});

describe('calculateProjectSavings', () => {
  it('computes energy efficiency savings and payback', () => {
    const r = calculateProjectSavings({
      type: 'energy_efficiency',
      currentEnergyKwhPerYear: 100_000,
      reductionPct: 10,
      siteElectricityFactor: 0.4,
      electricityRateUsdKwh: 0.12,
      estimatedCostUsd: 12_000,
    });
    // 10,000 kWh saved * 0.4 = 4000 kg
    expect(r.estimatedCo2eReductionKgPerYear).toBe(4_000);
    // annual savings = 10,000 * 0.12 = 1200 → payback = 12000/1200*12 = 120 months
    expect(r.estimatedPaybackMonths).toBe(120);
  });

  it('computes renewable generation offset from capacity', () => {
    const r = calculateProjectSavings({
      type: 'renewable_energy',
      systemCapacityKw: 100,
      capacityFactor: 1200,
      siteElectricityFactor: 0.4,
    });
    // 120,000 kWh * 0.4 = 48,000 kg
    expect(r.estimatedCo2eReductionKgPerYear).toBe(48_000);
  });

  it('computes fleet savings from miles reduced', () => {
    const r = calculateProjectSavings({
      type: 'fleet',
      milesReducedPerYear: 10_000,
      fuelTypeDisplaced: 'gasoline',
      mpg: 25,
    });
    // 400 gal × 0.125 MMBtu/gal × 70.47 kg CO2e/MMBtu = 3,523.5
    expect(r.estimatedCo2eReductionKgPerYear).toBe(Math.round(400 * 0.125 * 70.47));
  });

  it('computes refrigerant leak reduction', () => {
    const r = calculateProjectSavings({
      type: 'refrigerants',
      currentAnnualLossKg: 100,
      reductionPct: 50,
      gwp: 2000,
    });
    // 50 kg * 2000 = 100,000 kg
    expect(r.estimatedCo2eReductionKgPerYear).toBe(100_000);
  });

  it('reports water savings with no CO2e reduction', () => {
    const r = calculateProjectSavings({ type: 'water', gallonsSavedPerYear: 5000 });
    expect(r.estimatedCo2eReductionKgPerYear).toBe(0);
  });

  it('passes through a custom estimate', () => {
    const r = calculateProjectSavings({ type: 'custom', co2eReductionKgPerYear: 1234 });
    expect(r.estimatedCo2eReductionKgPerYear).toBe(1234);
  });
});

describe('SBTi pathway', () => {
  it('applies 4.2% of base-year emissions per year, linearly', () => {
    // Regression: compounding gave 34.89% for 2020→2030. SBTi's absolute
    // contraction is linear: 4.2% × 10 = 42%.
    const { targetEmissionsKg, reductionPct } = calculateSBTiTarget(1_000_000, 2020, 2030);
    expect(reductionPct).toBe(42);
    expect(targetEmissionsKg).toBe(580_000);
  });

  it('never goes below zero', () => {
    expect(calculateSBTiTarget(1_000, 2020, 2050).targetEmissionsKg).toBe(0);
  });

  it('produces a year-by-year pathway inclusive of both endpoints', () => {
    const pathway = getSBTiPathway(1_000_000, 2020, 2030);
    expect(pathway).toHaveLength(11);
    expect(pathway[0]).toEqual({ year: 2020, targetKg: 1_000_000 });
    expect(pathway[10].year).toBe(2030);
    expect(pathway[5]).toEqual({ year: 2025, targetKg: 790_000 });
    expect(pathway[10]).toEqual({ year: 2030, targetKg: 580_000 });
  });
});

describe('calculateAbsoluteTarget', () => {
  it('reduces the base year by the given percent', () => {
    expect(calculateAbsoluteTarget(1000, 40)).toBeCloseTo(600, 6);
  });
});

describe('formatting', () => {
  it('formats CO2e with smart unit selection', () => {
    expect(formatCO2e(500)).toBe('500 kg CO₂e');
    expect(formatCO2e(1500)).toBe('1.5 t CO₂e');
    // 2,500,000 kg is 2,500 t (this used to render as "2.50 tCO₂e").
    expect(formatCO2e(2_500_000)).toBe('2,500 t CO₂e');
  });
  it('formats numbers with fixed decimals', () => {
    expect(formatNumber(1234.5, 2)).toBe('1,234.50');
  });
});
