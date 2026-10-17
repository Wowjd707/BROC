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

describe('calculateEmissionCO2e — Scope 2 electricity', () => {
  it('uses the location-based factor by default', () => {
    const r = calculateEmissionCO2e({
      scope: 'scope2',
      sourceType: 'electricity',
      quantity: 1000,
      unit: 'kWh',
      locationBasedFactor: 0.4,
    });
    expect(r.co2eKg).toBeCloseTo(400, 6);
    expect(r.co2eKgLocationBased).toBeCloseTo(400, 6);
    expect(r.accountingMethod).toBe('location_based');
    expect(r.emissionFactorUsed).toBe(0.4);
  });

  it('uses the market-based factor but still reports location-based', () => {
    const r = calculateEmissionCO2e({
      scope: 'scope2',
      sourceType: 'electricity',
      quantity: 1000,
      unit: 'kWh',
      accountingMethod: 'market_based',
      locationBasedFactor: 0.4,
      marketBasedFactor: 0.5,
      instrumentType: 'rec',
    });
    expect(r.co2eKg).toBeCloseTo(500, 6);
    expect(r.co2eKgLocationBased).toBeCloseTo(400, 6);
    expect(r.accountingMethod).toBe('market_based');
    expect(r.supplierEmissionFactor).toBe(0.5);
    expect(r.instrumentType).toBe('rec');
  });

  it('falls back to US default factors when none supplied', () => {
    const r = calculateEmissionCO2e({
      scope: 'scope2',
      sourceType: 'electricity',
      quantity: 1000,
      unit: 'kWh',
    });
    expect(r.co2eKg).toBeCloseTo(386, 6); // 0.386 US national fallback
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
    // 400 gal * (0.12454 * 70.22) ≈ 400 * 8.746 ≈ 3498
    expect(r.estimatedCo2eReductionKgPerYear).toBeGreaterThan(3_000);
    expect(r.estimatedCo2eReductionKgPerYear).toBeLessThan(4_000);
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
  it('applies a 4.2% compound annual reduction', () => {
    const { targetEmissionsKg, reductionPct } = calculateSBTiTarget(1_000_000, 2020, 2030);
    // 1,000,000 * (1 - 0.042)^10 ≈ 649,300
    expect(targetEmissionsKg).toBeGreaterThan(640_000);
    expect(targetEmissionsKg).toBeLessThan(660_000);
    expect(reductionPct).toBeGreaterThan(34);
    expect(reductionPct).toBeLessThan(36);
  });

  it('produces a year-by-year pathway inclusive of both endpoints', () => {
    const pathway = getSBTiPathway(1_000_000, 2020, 2030);
    expect(pathway).toHaveLength(11);
    expect(pathway[0]).toEqual({ year: 2020, targetKg: 1_000_000 });
    expect(pathway[10].year).toBe(2030);
    expect(pathway[10].targetKg).toBeLessThan(pathway[0].targetKg);
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
    expect(formatCO2e(1500)).toBe('1.5 tCO₂e');
    expect(formatCO2e(2_500_000)).toBe('2.50 tCO₂e');
  });
  it('formats numbers with fixed decimals', () => {
    expect(formatNumber(1234.5, 2)).toBe('1,234.50');
  });
});
