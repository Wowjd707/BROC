import { describe, it, expect } from 'vitest';
import { waterBalance, waterWithdrawal, waterClassOf, WATER_SOURCE_CLASS } from './water-core';

describe('waterBalance', () => {
  it('computes consumption as withdrawal minus discharge', () => {
    // Regression: 1,000 in and 800 out was reported as 1,800 consumed.
    const b = waterBalance([
      { source_type: 'municipal_consumption', quantity_normalized: 600 },
      { source_type: 'groundwater', quantity_normalized: 400 },
      { source_type: 'municipal_discharge', quantity_normalized: 800 },
      { source_type: 'recycled_water', quantity_normalized: 50 },
    ]);
    expect(b).toEqual({ withdrawal: 1000, discharge: 800, consumption: 200, recycled: 50, unclassified: 0 });
  });

  it('leaves consumption null with no withdrawal, and unknown types out of every figure', () => {
    const b = waterBalance([
      { source_type: 'treated_discharge', quantity_normalized: 100 },
      { source_type: 'mystery', quantity_normalized: 7 },
    ]);
    expect(b.consumption).toBeNull();
    expect(b.discharge).toBe(100);
    expect(b.unclassified).toBe(7);
  });
});

describe('waterWithdrawal', () => {
  it('counts only withdrawals, and only water rows', () => {
    expect(waterWithdrawal([
      { metric_type: 'water', source_type: 'surface_water', quantity_normalized: 10 },
      { metric_type: 'water', source_type: 'municipal_discharge', quantity_normalized: 9 },
      { metric_type: 'waste', source_type: 'surface_water', quantity_normalized: 99 },
      { metric_type: 'water', source_type: 'stormwater', quantity_normalized: null },
    ])).toBe(10);
  });

  it('classifies every source type the water form offers', () => {
    for (const t of ['municipal_consumption', 'municipal_discharge', 'groundwater', 'surface_water',
      'recycled_water', 'treated_discharge', 'stormwater']) {
      expect(waterClassOf(t), t).not.toBeNull();
    }
    expect(Object.keys(WATER_SOURCE_CLASS)).toHaveLength(7);
  });
});
