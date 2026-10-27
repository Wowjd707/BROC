import { describe, it, expect } from 'vitest';
import {
  convertForDisplay, convertFromDisplay, formatMetric, unitLabel, normalizePreferences,
  DEFAULT_UNITS, UNIT_OPTIONS,
} from './units';

describe('convertFromDisplay', () => {
  it('turns a typed display value back into the stored unit', () => {
    // A goal baseline typed as 4,200 t CO₂e is stored as 4,200,000 kg.
    expect(convertFromDisplay(4200, 'carbon', 't')).toBeCloseTo(4_200_000, 6);
    expect(convertFromDisplay(1, 'water', 'm3')).toBeCloseTo(264.172052, 6);
    expect(convertFromDisplay(convertForDisplay(123.4, 'waste', 'lb'), 'waste', 'lb')).toBeCloseTo(123.4, 9);
  });
});

describe('convertForDisplay', () => {
  it('converts carbon from kg', () => {
    expect(convertForDisplay(1_500_000, 'carbon', 't')).toBe(1500);
    expect(convertForDisplay(1_500_000, 'carbon', 'kg')).toBe(1_500_000);
  });

  it('converts water from US gallons', () => {
    expect(convertForDisplay(1000, 'water', 'gal')).toBe(1000);
    expect(convertForDisplay(1, 'water', 'L')).toBeCloseTo(3.785411784, 9);
    expect(convertForDisplay(264.172052, 'water', 'm3')).toBeCloseTo(1, 6);
  });

  it('converts waste from kg', () => {
    expect(convertForDisplay(2000, 'waste', 't')).toBe(2);
    expect(convertForDisplay(1, 'waste', 'lb')).toBeCloseTo(2.20462, 4);
  });

  it('converts energy from kWh', () => {
    expect(convertForDisplay(1000, 'energy', 'MWh')).toBe(1);
    expect(convertForDisplay(1000, 'energy', 'GJ')).toBeCloseTo(3.6, 6);
  });

  it('round-trips through the canonical unit without drift', () => {
    const gallons = 12345.678;
    const m3 = convertForDisplay(gallons, 'water', 'm3');
    expect(m3 * 264.172052).toBeCloseTo(gallons, 6);
  });

  it('falls back to the canonical value for an unknown unit', () => {
    expect(convertForDisplay(500, 'carbon', 'furlongs')).toBe(500);
  });
});

describe('formatMetric', () => {
  it('renders a fixed unit rather than auto-scaling by magnitude', () => {
    // The whole point: both render in tonnes, so they are comparable.
    expect(formatMetric(500_000, 'carbon', 't')).toBe('500 t CO₂e');
    expect(formatMetric(4_000_000, 'carbon', 't')).toBe('4,000 t CO₂e');
  });

  it('keeps small values from reading as zero', () => {
    expect(formatMetric(500, 'carbon', 't')).toBe('0.5 t CO₂e');
    expect(formatMetric(12, 'carbon', 't')).toBe('0.012 t CO₂e');
  });

  it('renders an em dash for null/undefined/NaN', () => {
    expect(formatMetric(null, 'carbon', 't')).toBe('—');
    expect(formatMetric(undefined, 'carbon', 't')).toBe('—');
    expect(formatMetric(Number.NaN, 'carbon', 't')).toBe('—');
  });

  it('can omit the label', () => {
    expect(formatMetric(1_000_000, 'carbon', 't', { withLabel: false })).toBe('1,000');
  });

  it('handles zero', () => {
    expect(formatMetric(0, 'carbon', 't')).toBe('0 t CO₂e');
  });
});

describe('unitLabel', () => {
  it('disambiguates waste mass from carbon mass', () => {
    expect(unitLabel('carbon', 't')).toBe('t CO₂e');
    expect(unitLabel('waste', 't')).toBe('t');
    expect(unitLabel('water', 'm3')).toBe('m³');
  });
});

describe('normalizePreferences', () => {
  it('returns defaults for empty or malformed input', () => {
    expect(normalizePreferences(null)).toEqual(DEFAULT_UNITS);
    expect(normalizePreferences({})).toEqual(DEFAULT_UNITS);
    expect(normalizePreferences('nonsense')).toEqual(DEFAULT_UNITS);
  });

  it('keeps valid values and replaces invalid ones per family', () => {
    const prefs = normalizePreferences({ carbon: 'kg', water: 'bogus', waste: 'lb' });
    expect(prefs.carbon).toBe('kg');
    expect(prefs.water).toBe(DEFAULT_UNITS.water);
    expect(prefs.waste).toBe('lb');
    expect(prefs.energy).toBe(DEFAULT_UNITS.energy);
  });

  it('only accepts units the toggle actually offers', () => {
    for (const family of Object.keys(UNIT_OPTIONS) as (keyof typeof UNIT_OPTIONS)[]) {
      for (const opt of UNIT_OPTIONS[family]) {
        const prefs = normalizePreferences({ [family]: opt.value });
        expect(prefs[family]).toBe(opt.value);
      }
    }
  });
});
