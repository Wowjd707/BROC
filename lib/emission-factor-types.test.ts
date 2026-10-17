import { describe, it, expect } from 'vitest';
import {
  SCOPE1_CATEGORIES, SCOPE1_SOURCE_TYPES, suggestScope1Category,
} from './emission-factor-types';

describe('SCOPE1_CATEGORIES', () => {
  it('covers the four GHG Protocol Scope 1 source categories', () => {
    expect(SCOPE1_CATEGORIES.map(c => c.value)).toEqual([
      'stationary_combustion', 'mobile_combustion', 'process_emissions', 'fugitive_emissions',
    ]);
  });

  it('gives every category help text', () => {
    for (const c of SCOPE1_CATEGORIES) {
      expect(c.label).toBeTruthy();
      expect(c.help.length).toBeGreaterThan(10);
    }
  });
});

describe('suggestScope1Category', () => {
  it('classifies refrigerants as fugitive', () => {
    expect(suggestScope1Category('refrigerants')).toBe('fugitive_emissions');
  });

  it('classifies unambiguously stationary fuels', () => {
    expect(suggestScope1Category('natural_gas')).toBe('stationary_combustion');
    expect(suggestScope1Category('coal_bituminous')).toBe('stationary_combustion');
    expect(suggestScope1Category('fuel_oil_no6')).toBe('stationary_combustion');
  });

  it('returns null for fuels that are genuinely ambiguous', () => {
    // Diesel and gasoline are each legitimately stationary (generators) or
    // mobile (fleet) — the user must choose rather than inherit a guess.
    expect(suggestScope1Category('diesel')).toBeNull();
    expect(suggestScope1Category('gasoline')).toBeNull();
    expect(suggestScope1Category('propane')).toBeNull();
    expect(suggestScope1Category('lpg')).toBeNull();
  });

  it('returns null for an unrecognised source', () => {
    expect(suggestScope1Category('unobtanium')).toBeNull();
  });

  it('only ever suggests a category that exists', () => {
    const valid = SCOPE1_CATEGORIES.map(c => c.value);
    for (const s of SCOPE1_SOURCE_TYPES) {
      const suggestion = suggestScope1Category(s.value);
      if (suggestion !== null) expect(valid).toContain(suggestion);
    }
  });
});
