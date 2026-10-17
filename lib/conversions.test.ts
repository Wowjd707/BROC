import { describe, it, expect } from 'vitest';
import {
  toKWh,
  toMMBtu,
  wasteToKg,
  waterToGallons,
  refrigerantToKg,
  normalizeEmissionInput,
  normalizeEhsInput,
} from './conversions';

describe('toKWh', () => {
  it('passes through kWh', () => {
    expect(toKWh(100, 'kWh')).toBe(100);
  });
  it('converts MWh and GWh', () => {
    expect(toKWh(1, 'MWh')).toBe(1_000);
    expect(toKWh(1, 'GWh')).toBe(1_000_000);
  });
  it('is case- and whitespace-insensitive', () => {
    expect(toKWh(2, ' mwh ')).toBe(2_000);
  });
  it('throws on unsupported units', () => {
    expect(() => toKWh(1, 'therms')).toThrow(/Unsupported electricity unit/);
  });
});

describe('toMMBtu', () => {
  it('passes through MMBtu and converts direct energy units', () => {
    expect(toMMBtu(5, 'MMBtu', 'natural_gas')).toBe(5);
    expect(toMMBtu(1_000_000, 'btu', 'natural_gas')).toBe(1);
    expect(toMMBtu(10, 'therms', 'natural_gas')).toBeCloseTo(1, 10);
    expect(toMMBtu(1, 'GJ', 'natural_gas')).toBeCloseTo(0.948, 10);
  });

  it('converts natural gas volume units', () => {
    expect(toMMBtu(1000, 'cubic_feet', 'natural_gas')).toBeCloseTo(1.026, 6);
    expect(toMMBtu(1, 'MCF', 'natural_gas')).toBeCloseTo(1.026, 6);
    expect(toMMBtu(1, 'CCF', 'natural_gas')).toBeCloseTo(0.1026, 6);
  });

  it('converts liquid fuel gallons with fuel-specific factors', () => {
    expect(toMMBtu(100, 'gallons', 'diesel')).toBeCloseTo(13.756, 6);
    expect(toMMBtu(100, 'gallons', 'gasoline')).toBeCloseTo(12.454, 6);
  });

  it('converts liters and barrels via gallons', () => {
    // 1 barrel = 42 gallons diesel
    expect(toMMBtu(1, 'barrels', 'diesel')).toBeCloseTo(42 * 0.13756, 6);
  });

  it('converts solid-fuel mass using per-kg energy content', () => {
    // 1 tonne bituminous coal = 1000 kg × 24.9 MJ/kg × 0.000948 MMBtu/MJ ≈ 23.6 MMBtu
    expect(toMMBtu(1, 'metric_tons', 'coal_bituminous')).toBeCloseTo(
      1000 * 24.9 * 0.000948,
      6,
    );
    // kg and tonnes must agree at 1000:1 (regression guard for the former
    // factor-of-1000 error where mass was normalized to tonnes but multiplied
    // by a per-kg energy density)
    expect(toMMBtu(1000, 'kg', 'coal_bituminous')).toBeCloseTo(
      toMMBtu(1, 'metric_tons', 'coal_bituminous'),
      9,
    );
    // short tons use the 907.185 kg/ton factor
    expect(toMMBtu(1, 'short_tons', 'wood_biomass')).toBeCloseTo(
      907.185 * 17.4 * 0.000948,
      6,
    );
  });

  it('throws when a gallon factor is missing for a fuel', () => {
    expect(() => toMMBtu(1, 'gallons', 'unicorn_fuel')).toThrow(/No gallon/);
  });

  it('throws on entirely unsupported units', () => {
    expect(() => toMMBtu(1, 'furlongs', 'diesel')).toThrow(/Unsupported unit/);
  });
});

describe('wasteToKg', () => {
  it('converts common mass units', () => {
    expect(wasteToKg(10, 'kg')).toBe(10);
    expect(wasteToKg(1, 'lbs')).toBeCloseTo(0.45359, 6);
    expect(wasteToKg(1, 'short_tons')).toBeCloseTo(907.185, 3);
    expect(wasteToKg(1, 'metric_tons')).toBe(1_000);
  });
  it('throws on unsupported units', () => {
    expect(() => wasteToKg(1, 'gallons')).toThrow(/Unsupported waste unit/);
  });
});

describe('waterToGallons', () => {
  it('converts common volume units', () => {
    expect(waterToGallons(10, 'gallons')).toBe(10);
    expect(waterToGallons(1, 'liters')).toBeCloseTo(0.26417, 6);
    expect(waterToGallons(1, 'cubic_meters')).toBeCloseTo(264.172, 3);
    expect(waterToGallons(1, 'CCF')).toBeCloseTo(748.052, 3);
  });
  it('throws on unsupported units', () => {
    expect(() => waterToGallons(1, 'therms')).toThrow(/Unsupported water unit/);
  });
});

describe('refrigerantToKg', () => {
  it('converts kg and lbs', () => {
    expect(refrigerantToKg(3, 'kg')).toBe(3);
    expect(refrigerantToKg(1, 'lbs')).toBeCloseTo(0.45359, 6);
  });
  it('throws on unsupported units', () => {
    expect(() => refrigerantToKg(1, 'tonnes')).toThrow(/Unsupported refrigerant unit/);
  });
});

describe('normalizeEmissionInput', () => {
  it('normalizes scope 2 electricity to kWh', () => {
    expect(normalizeEmissionInput(1, 'MWh', 'scope2', 'electricity')).toEqual({
      quantityNormalized: 1_000,
      unitNormalized: 'kWh',
    });
  });
  it('normalizes refrigerants to kg', () => {
    expect(normalizeEmissionInput(2, 'kg', 'scope1', 'refrigerants')).toEqual({
      quantityNormalized: 2,
      unitNormalized: 'kg',
    });
  });
  it('normalizes combustion fuel to MMBtu', () => {
    const r = normalizeEmissionInput(10, 'therms', 'scope1', 'natural_gas');
    expect(r.unitNormalized).toBe('MMBtu');
    expect(r.quantityNormalized).toBeCloseTo(1, 10);
  });
});

describe('normalizeEhsInput', () => {
  it('normalizes water to gallons and waste to kg', () => {
    expect(normalizeEhsInput(1, 'cubic_meters', 'water')).toEqual({
      quantityNormalized: 264.172,
      unitNormalized: 'gallons',
    });
    expect(normalizeEhsInput(1, 'metric_tons', 'waste')).toEqual({
      quantityNormalized: 1_000,
      unitNormalized: 'kg',
    });
  });
});
