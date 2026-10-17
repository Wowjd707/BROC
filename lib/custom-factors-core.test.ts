import { describe, it, expect } from 'vitest';
import { pickEffectiveFactor, type FactorWindow } from './custom-factors-core';

// Rows arrive pre-sorted by effective_from descending (as the query returns them).
const rows: FactorWindow[] = [
  { co2e_factor: 50, factor_source: '2025 supplier', data_year: 2025, effective_from: '2025-01-01', effective_to: null },
  { co2e_factor: 48, factor_source: '2024 supplier', data_year: 2024, effective_from: '2024-01-01', effective_to: '2025-01-01' },
  { co2e_factor: 45, factor_source: '2023 supplier', data_year: 2023, effective_from: '2023-01-01', effective_to: '2024-01-01' },
];

describe('pickEffectiveFactor', () => {
  it('selects the open-ended current window for a recent date', () => {
    expect(pickEffectiveFactor(rows, '2025-06-01')?.factor).toBe(50);
  });

  it('selects the correct historical window for a past date', () => {
    expect(pickEffectiveFactor(rows, '2024-06-01')?.factor).toBe(48);
    expect(pickEffectiveFactor(rows, '2023-06-01')?.factor).toBe(45);
  });

  it('treats effective_to as exclusive (boundary date belongs to the newer window)', () => {
    // 2024-01-01 is the effective_to of the 2023 row and effective_from of 2024 row
    expect(pickEffectiveFactor(rows, '2024-01-01')?.factor).toBe(48);
  });

  it('returns null when no window contains the date', () => {
    const closed: FactorWindow[] = [
      { co2e_factor: 10, factor_source: 's', data_year: 2022, effective_from: '2022-01-01', effective_to: '2022-06-01' },
    ];
    expect(pickEffectiveFactor(closed, '2023-01-01')).toBeNull();
  });

  it('carries source and data year through', () => {
    const r = pickEffectiveFactor(rows, '2025-06-01');
    expect(r).toEqual({ factor: 50, source: '2025 supplier', dataYear: 2025 });
  });
});
