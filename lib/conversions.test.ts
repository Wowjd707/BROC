import { describe, it, expect } from 'vitest';
import {
  toKWh,
  heatToKWh,
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

describe('heatToKWh', () => {
  it('converts purchased heat and steam energy units to kWh', () => {
    expect(heatToKWh(1, 'MMBtu')).toBeCloseTo(293.07107, 4);
    expect(heatToKWh(1, 'GJ')).toBeCloseTo(277.7778, 4);
    expect(heatToKWh(10, 'therms')).toBeCloseTo(293.07107, 4);
    expect(heatToKWh(2, 'MWh')).toBe(2000);
    expect(() => heatToKWh(1, 'gallons')).toThrow(/heat or steam/);
  });
  it('is what normalizeEmissionInput applies to district heating', () => {
    expect(normalizeEmissionInput(1, 'MMBtu', 'scope2', 'district_heating').quantityNormalized).toBeCloseTo(293.07107, 4);
    expect(() => normalizeEmissionInput(1, 'MMBtu', 'scope2', 'electricity')).toThrow(/electricity unit/);
  });
});

describe('toMMBtu', () => {
  it('passes through MMBtu and converts direct energy units', () => {
    expect(toMMBtu(5, 'MMBtu', 'natural_gas')).toBe(5);
    expect(toMMBtu(1_000_000, 'btu', 'natural_gas')).toBe(1);
    expect(toMMBtu(10, 'therms', 'natural_gas')).toBeCloseTo(1, 10);
    // 1 GJ = 1000 MJ / 1055.056 MJ per MMBtu
    expect(toMMBtu(1, 'GJ', 'natural_gas')).toBeCloseTo(0.947817, 6);
  });

  it('converts natural gas volume units at the EPA HHV of 1,026 Btu/scf', () => {
    expect(toMMBtu(1000, 'cubic_feet', 'natural_gas')).toBeCloseTo(1.026, 6);
    expect(toMMBtu(1, 'MCF', 'natural_gas')).toBeCloseTo(1.026, 6);
    expect(toMMBtu(1, 'CCF', 'natural_gas')).toBeCloseTo(0.1026, 6);
    // 1 m³ = 35.3147 scf
    expect(toMMBtu(1, 'cubic_meters', 'natural_gas')).toBeCloseTo(35.3146667 * 0.001026, 8);
  });

  it('uses each gaseous fuel\'s own energy content per cubic foot', () => {
    // Regression: every gas volume used the natural-gas value, so 1,000 cf of
    // propane came out as 1.026 MMBtu instead of 2.516 (EPA, propane gas).
    expect(toMMBtu(1000, 'cubic_feet', 'propane')).toBeCloseTo(2.516, 6);
    expect(() => toMMBtu(1000, 'cubic_feet', 'diesel')).toThrow(/No volume/);
  });

  it('converts liquid fuel gallons with EPA Hub HHVs', () => {
    expect(toMMBtu(100, 'gallons', 'diesel')).toBeCloseTo(13.8, 6);
    expect(toMMBtu(100, 'gallons', 'gasoline')).toBeCloseTo(12.5, 6);
    expect(toMMBtu(100, 'gallons', 'lpg')).toBeCloseTo(9.2, 6);
  });

  it('converts liters and barrels via gallons', () => {
    expect(toMMBtu(1, 'barrels', 'diesel')).toBeCloseTo(42 * 0.138, 6);
    expect(toMMBtu(3.785411784, 'liters', 'diesel')).toBeCloseTo(0.138, 9);
  });

  it('converts solid-fuel mass using EPA HHV per short ton', () => {
    expect(toMMBtu(1, 'short_tons', 'coal_bituminous')).toBeCloseTo(24.93, 9);
    expect(toMMBtu(1, 'short_tons', 'coal_anthracite')).toBeCloseTo(25.09, 9);
    expect(toMMBtu(1, 'short_tons', 'wood_biomass')).toBeCloseTo(17.48, 9);
    // 1 tonne = 1000 / 907.18474 short tons
    expect(toMMBtu(1, 'metric_tons', 'coal_bituminous')).toBeCloseTo(24.93 * 1000 / 907.18474, 9);
    expect(toMMBtu(2000, 'lbs', 'coal_lignite')).toBeCloseTo(14.21, 9);
    // kg and tonnes must agree at 1000:1
    expect(toMMBtu(1000, 'kg', 'coal_bituminous')).toBeCloseTo(
      toMMBtu(1, 'metric_tons', 'coal_bituminous'),
      9,
    );
  });

  it('refuses mass units for a fuel without a published HHV per ton', () => {
    // Regression: unlisted fuels defaulted to bituminous coal, so a tonne of
    // diesel came out at 23.6 MMBtu instead of about 43.
    expect(() => toMMBtu(1, 'metric_tons', 'diesel')).toThrow(/No mass/);
    expect(() => toMMBtu(1, 'kg', 'propane')).toThrow(/No mass/);
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
