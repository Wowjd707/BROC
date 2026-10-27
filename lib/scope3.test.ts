import { describe, it, expect } from 'vitest';
import {
  SCOPE3_CATEGORIES,
  getScope3Category,
  calculateScope3,
  defaultDataQuality,
  unitsCompatible,
  unitFamily,
  totalsByCategory,
  primaryDataShare,
  type Scope3CalculationInput,
} from './scope3';

function input(overrides: Partial<Scope3CalculationInput> = {}): Scope3CalculationInput {
  return {
    categoryNumber: 1,
    method: 'spend_based',
    activityValue: 1000,
    activityUnit: 'USD',
    factorValue: 0.25,
    factorUnit: 'USD',
    factorSource: 'EPA Supply Chain GHG Factors v1.3',
    factorDataYear: 2022,
    ...overrides,
  };
}

describe('Scope 3 categories', () => {
  it('defines exactly the 15 GHG Protocol categories', () => {
    expect(SCOPE3_CATEGORIES).toHaveLength(15);
    expect(SCOPE3_CATEGORIES.map(c => c.number)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
  });

  it('splits 1-8 upstream and 9-15 downstream', () => {
    for (const c of SCOPE3_CATEGORIES) {
      expect(c.valueChain).toBe(c.number <= 8 ? 'upstream' : 'downstream');
    }
  });

  it('looks up by number', () => {
    expect(getScope3Category(6)?.name).toBe('Business travel');
    expect(getScope3Category(99)).toBeUndefined();
  });
});

describe('unit compatibility', () => {
  it('recognises unit families', () => {
    expect(unitFamily('USD')).toBe('currency');
    expect(unitFamily('tonne-km')).toBe('freight');
    expect(unitFamily('passenger-mile')).toBe('passenger-distance');
    expect(unitFamily('frobnicates')).toBeNull();
  });

  it('accepts exact and same-family matches', () => {
    expect(unitsCompatible('USD', 'USD')).toBe(true);
    expect(unitsCompatible('kg', 'tonnes')).toBe(true);
    expect(unitsCompatible('miles', 'km')).toBe(true);
  });

  it('rejects a different currency and unlike counts', () => {
    // Converting EUR to USD needs an exchange rate and a price year.
    expect(unitsCompatible('EUR', 'USD')).toBe(false);
    expect(unitsCompatible('nights', 'units')).toBe(false);
  });

  it('rejects cross-family matches', () => {
    expect(unitsCompatible('USD', 'kg')).toBe(false);
    expect(unitsCompatible('miles', 'tonne-km')).toBe(false);
    expect(unitsCompatible('kg', 'kWh')).toBe(false);
  });
});

describe('calculateScope3', () => {
  it('converts the activity into the factor\'s unit before multiplying', () => {
    // Regression: same-family units were accepted but never converted, so
    // 10 tonnes × 2 kg CO₂e/kg came out at 20 kg instead of 20,000.
    const tonnes = calculateScope3(input({ activityValue: 10, activityUnit: 'tonnes', factorValue: 2, factorUnit: 'kg' }));
    expect(tonnes.co2eKg).toBeCloseTo(20_000, 6);
    expect(tonnes.unitConversion).toBe(1000);
    const mwh = calculateScope3(input({ activityValue: 500, activityUnit: 'MWh', factorValue: 0.05, factorUnit: 'kWh' }));
    expect(mwh.co2eKg).toBeCloseTo(25_000, 6);
    const miles = calculateScope3(input({ activityValue: 1000, activityUnit: 'miles', factorValue: 0.15, factorUnit: 'km' }));
    expect(miles.co2eKg).toBeCloseTo(241.4016, 4);
    const tonMiles = calculateScope3(input({ activityValue: 1, activityUnit: 'ton-mile', factorValue: 1, factorUnit: 'tonne-km' }));
    expect(tonMiles.co2eKg).toBeCloseTo(1.459972, 5);
  });

  it('refuses spend in one currency against a factor in another', () => {
    expect(() => calculateScope3(input({ activityUnit: 'EUR', factorUnit: 'USD' }))).toThrow(/Convert the spend/);
  });

  it('multiplies activity by factor (spend-based)', () => {
    const r = calculateScope3(input());
    expect(r.co2eKg).toBeCloseTo(250, 6); // 1000 USD × 0.25
    expect(r.factorSource).toBe('EPA Supply Chain GHG Factors v1.3');
  });

  it('handles distance-based business travel', () => {
    const r = calculateScope3(input({
      categoryNumber: 6,
      method: 'distance_based',
      activityValue: 5000,
      activityUnit: 'passenger-mile',
      factorValue: 0.15,
      factorUnit: 'passenger-mile',
      factorSource: 'DEFRA 2024',
    }));
    expect(r.co2eKg).toBeCloseTo(750, 6);
    expect(r.dataQuality).toBe('secondary');
  });

  it('rejects a factor whose unit family does not match the activity', () => {
    expect(() => calculateScope3(input({ activityUnit: 'USD', factorUnit: 'kg' })))
      .toThrow(/cannot be applied to activity measured in/);
  });

  it('rejects an unknown category', () => {
    expect(() => calculateScope3(input({ categoryNumber: 16 }))).toThrow(/Unknown Scope 3 category/);
  });

  it('rejects negative or non-finite inputs', () => {
    expect(() => calculateScope3(input({ activityValue: -1 }))).toThrow(/non-negative/);
    expect(() => calculateScope3(input({ factorValue: Number.NaN }))).toThrow(/non-negative/);
  });

  it('requires a cited factor source', () => {
    expect(() => calculateScope3(input({ factorSource: '   ' })))
      .toThrow(/factorSource is required/);
  });

  it('honours an explicit data-quality override', () => {
    const r = calculateScope3(input({ dataQuality: 'primary' }));
    expect(r.dataQuality).toBe('primary');
  });
});

describe('defaultDataQuality', () => {
  it('treats supplier/site/asset-specific as primary and spend-based as estimated', () => {
    expect(defaultDataQuality('supplier_specific')).toBe('primary');
    expect(defaultDataQuality('site_specific')).toBe('primary');
    expect(defaultDataQuality('spend_based')).toBe('estimated');
    expect(defaultDataQuality('average_data')).toBe('secondary');
    expect(defaultDataQuality('distance_based')).toBe('secondary');
  });
});

describe('roll-ups', () => {
  const entries = [
    { category_number: 1, co2e_kg: 1000, data_quality: 'primary' },
    { category_number: 1, co2e_kg: 500,  data_quality: 'estimated' },
    { category_number: 6, co2e_kg: 250,  data_quality: 'secondary' },
  ];

  it('totals by category and includes empty categories', () => {
    const totals = totalsByCategory(entries);
    expect(totals).toHaveLength(15);
    expect(totals.find(t => t.categoryNumber === 1)).toMatchObject({ co2eKg: 1500, entryCount: 2 });
    expect(totals.find(t => t.categoryNumber === 6)).toMatchObject({ co2eKg: 250, entryCount: 1 });
    expect(totals.find(t => t.categoryNumber === 2)).toMatchObject({ co2eKg: 0, entryCount: 0 });
  });

  it('computes the primary-data share by emissions, not entry count', () => {
    // 1000 primary of 1750 total
    expect(primaryDataShare(entries)).toBeCloseTo((1000 / 1750) * 100, 6);
  });

  it('returns 0 primary share when there are no emissions', () => {
    expect(primaryDataShare([])).toBe(0);
  });
});
