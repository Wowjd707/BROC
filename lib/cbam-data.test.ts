import { describe, it, expect } from 'vitest';
import {
  CBAM_COMMODITIES,
  searchCBAMCommodities,
  findCBAMCommodityByCN,
  calculateCBAM,
  type CBAMCommodity,
} from './cbam-data';

describe('CBAM commodity reference data', () => {
  it('carries a positive default factor and a unit for every commodity', () => {
    for (const c of CBAM_COMMODITIES) {
      expect(c.defaultFactor).toBeGreaterThan(0);
      expect(['tonne', 'MWh']).toContain(c.unit);
      expect(c.cnCode).toBeTruthy();
      expect(c.name).toBeTruthy();
    }
  });

  it('uses MWh only for electricity', () => {
    for (const c of CBAM_COMMODITIES) {
      if (c.unit === 'MWh') expect(c.sector).toBe('Electricity');
    }
  });
});

describe('searchCBAMCommodities', () => {
  it('returns all commodities for an empty query', () => {
    expect(searchCBAMCommodities('')).toHaveLength(CBAM_COMMODITIES.length);
  });
  it('matches by CN code prefix', () => {
    const results = searchCBAMCommodities('7208');
    expect(results.some((c) => c.cnCode === '7208')).toBe(true);
  });
  it('matches by name fragment case-insensitively', () => {
    const results = searchCBAMCommodities('cement');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((c) => c.sector === 'Cement' || /cement/i.test(c.name))).toBe(true);
  });
  it('matches by sector', () => {
    const results = searchCBAMCommodities('aluminium');
    expect(results.every((c) => c.sector === 'Aluminium')).toBe(true);
  });
});

describe('findCBAMCommodityByCN', () => {
  it('finds an exact CN code', () => {
    expect(findCBAMCommodityByCN('2716 00')?.sector).toBe('Electricity');
  });
  it('returns undefined for an unknown code', () => {
    expect(findCBAMCommodityByCN('0000 00')).toBeUndefined();
  });
});

describe('calculateCBAM', () => {
  const steel: CBAMCommodity = {
    cnCode: '7208',
    name: 'Hot-rolled steel',
    sector: 'Iron & Steel',
    defaultFactor: 2.123,
    unit: 'tonne',
  };

  it('computes embedded emissions and cost for tonnes', () => {
    const r = calculateCBAM({
      commodity: steel,
      quantity: 500,
      massUnit: 'tonnes',
      emissionFactor: 2.123,
      factorType: 'eu_default',
      certificatePriceEur: 55,
    });
    expect(r.quantityTonnes).toBe(500);
    expect(r.totalTCO2e).toBeCloseTo(1061.5, 4);
    expect(r.estimatedCostEur).toBeCloseTo(1061.5 * 55, 2);
  });

  it('normalises kg to tonnes', () => {
    const r = calculateCBAM({
      commodity: steel,
      quantity: 2000,
      massUnit: 'kg',
      emissionFactor: 2,
      factorType: 'supplier_provided',
      certificatePriceEur: 50,
    });
    expect(r.quantityTonnes).toBe(2); // 2000 kg → 2 t
    expect(r.totalTCO2e).toBeCloseTo(4, 6);
    expect(r.estimatedCostEur).toBeCloseTo(200, 2);
  });

  it('passes MWh through unchanged', () => {
    const electricity: CBAMCommodity = {
      cnCode: '2716 00',
      name: 'Electrical energy',
      sector: 'Electricity',
      defaultFactor: 0.501,
      unit: 'MWh',
    };
    const r = calculateCBAM({
      commodity: electricity,
      quantity: 1000,
      massUnit: 'MWh',
      emissionFactor: 0.501,
      factorType: 'eu_default',
      certificatePriceEur: 55,
    });
    expect(r.quantityTonnes).toBe(1000); // MWh not divided
    expect(r.totalTCO2e).toBeCloseTo(501, 4);
  });
});
