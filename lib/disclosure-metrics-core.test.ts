import { describe, it, expect } from 'vitest';
import {
  resolveMetric,
  requirementState,
  coveragePercent,
  type InventoryInput,
  type RequirementState,
} from './disclosure-metrics-core';

function inventory(overrides: Partial<InventoryInput> = {}): InventoryInput {
  return {
    scope1Kg: 500_000,
    scope2LocationKg: 300_000,
    scope2MarketKg: 250_000,
    scope3Kg: 2_000_000,
    scope3ByCategory: [
      { categoryNumber: 1, name: 'Purchased goods and services', co2eKg: 1_500_000 },
      { categoryNumber: 6, name: 'Business travel', co2eKg: 500_000 },
      { categoryNumber: 2, name: 'Capital goods', co2eKg: 0 },
    ],
    energyKwh: 1_200_000,
    waterGallons: 45_000,
    wasteKg: 80_000,
    intensityDenominator: 100_000,
    intensityDenominatorUnit: 'sq ft',
    targets: [
      { name: 'Net zero by 2040', targetYear: 2040, targetReductionPct: 90, status: 'active' },
    ],
    ...overrides,
  };
}

describe('resolveMetric', () => {
  it('converts kg to tonnes for GHG metrics', () => {
    expect(resolveMetric('scope1_total', inventory())).toMatchObject({ value: 500, unit: 'tCO₂e' });
    expect(resolveMetric('scope3_total', inventory())).toMatchObject({ value: 2000 });
  });

  it('reports both Scope 2 methods for dual disclosure', () => {
    const m = resolveMetric('scope2_both', inventory())!;
    expect(m.breakdown).toEqual([
      { label: 'Location-based', value: 300, unit: 'tCO₂e' },
      { label: 'Market-based', value: 250, unit: 'tCO₂e' },
    ]);
  });

  it('sums all scopes using location-based Scope 2', () => {
    const m = resolveMetric('ghg_all_scopes', inventory())!;
    expect(m.value).toBe(2800); // 500 + 300 + 2000
    expect(m.breakdown).toHaveLength(4);
  });

  it('omits zero categories from the Scope 3 breakdown', () => {
    const m = resolveMetric('scope3_by_category', inventory())!;
    expect(m.breakdown).toHaveLength(2);
    expect(m.breakdown!.map(b => b.label)).not.toContain('2. Capital goods');
  });

  it('computes intensity per denominator', () => {
    const m = resolveMetric('ghg_intensity', inventory())!;
    expect(m.value).toBeCloseTo(800 / 100_000, 10);
    expect(m.unit).toBe('tCO₂e per sq ft');
  });

  it('marks intensity missing when there is no denominator', () => {
    const m = resolveMetric('ghg_intensity', inventory({ intensityDenominator: null }))!;
    expect(m.value).toBeNull();
    expect(m.missing).toBe(true);
  });

  it('distinguishes "no data" from a real zero', () => {
    const m = resolveMetric('scope1_total', inventory({ scope1Kg: 0 }))!;
    expect(m.missing).toBe(true);
  });

  it('lists targets with their reduction percentages', () => {
    const m = resolveMetric('targets', inventory())!;
    expect(m.value).toBe(1);
    expect(m.breakdown![0].label).toContain('Net zero by 2040');
  });

  it('marks targets missing when none exist', () => {
    expect(resolveMetric('targets', inventory({ targets: [] }))!.missing).toBe(true);
  });

  it('reports energy, water and waste in framework units, not storage units', () => {
    // Regression: water went out in US gallons and energy in kWh, units no
    // CSRD or GRI reader expects.
    const e = resolveMetric('energy_consumption', inventory())!;
    expect(e.unit).toBe('MWh');
    expect(e.value).toBeCloseTo(1_200, 6);
    const w = resolveMetric('water_consumption', inventory())!;
    expect(w.unit).toBe('m³');
    expect(w.value).toBeCloseTo(45_000 * 0.003785411784, 6);
    const t = resolveMetric('waste_total', inventory())!;
    expect(t.unit).toBe('t');
    expect(t.value).toBe(80);
  });

  it('lists only targets that have a reduction percentage', () => {
    const m = resolveMetric('targets', inventory({
      targets: [
        { name: 'Cut 42%', targetYear: 2030, targetReductionPct: 42, status: 'active' },
        { name: 'Absolute value target', targetYear: 2030, targetReductionPct: null, status: 'active' },
      ],
    }))!;
    expect(m.value).toBe(2);
    expect(m.breakdown!.map((b) => b.label)).toEqual(['Cut 42% (by 2030)']);
  });

  it('returns null for an unknown key', () => {
    expect(resolveMetric('not_a_metric', inventory())).toBeNull();
  });
});

describe('requirementState', () => {
  const req = { id: 'r1', response_type: 'both', metric_key: 'scope1_total' };
  const metric = { label: 'x', value: 500, unit: 'tCO₂e' };

  it('counts a metric-backed requirement with data as covered', () => {
    expect(requirementState(req, undefined, metric)).toBe('satisfied_by_data');
  });

  it('does not count a metric with no data', () => {
    expect(requirementState(req, undefined, { ...metric, missing: true })).toBe('outstanding');
  });

  it('respects explicit statuses over data', () => {
    expect(requirementState(req, { requirement_id: 'r1', status: 'not_material', narrative: null }, metric))
      .toBe('not_material');
    expect(requirementState(req, { requirement_id: 'r1', status: 'complete', narrative: null }, metric))
      .toBe('answered');
    expect(requirementState(req, { requirement_id: 'r1', status: 'in_progress', narrative: null }, metric))
      .toBe('in_progress');
  });

  it('treats draft narrative as in progress', () => {
    const narrativeReq = { id: 'r2', response_type: 'narrative', metric_key: null };
    expect(requirementState(narrativeReq, { requirement_id: 'r2', status: 'not_started', narrative: 'draft…' }, null))
      .toBe('in_progress');
  });

  it('is outstanding with no response and no metric', () => {
    const narrativeReq = { id: 'r2', response_type: 'narrative', metric_key: null };
    expect(requirementState(narrativeReq, undefined, null)).toBe('outstanding');
  });

  it('is applicable by default, so ungated frameworks are unaffected', () => {
    expect(requirementState(req, undefined, metric)).toBe('satisfied_by_data');
  });

  it('excludes a requirement the materiality assessment scoped out', () => {
    // Even with data available — the point is that it is not demanded.
    expect(requirementState(req, undefined, metric, false)).toBe('excluded_immaterial');
  });

  it('keeps a completed disclosure over the materiality gate', () => {
    // Voluntary disclosure beyond the material scope: the work is done and
    // intended, so it is not demoted to "excluded".
    expect(requirementState(req, { requirement_id: 'r1', status: 'complete', narrative: 'text' }, metric, false))
      .toBe('answered');
  });

  it('lets the materiality gate override a draft', () => {
    expect(requirementState(req, { requirement_id: 'r1', status: 'in_progress', narrative: 'draft…' }, metric, false))
      .toBe('excluded_immaterial');
  });

  it('keeps a hand-marked not_material distinct from an assessment exclusion', () => {
    expect(requirementState(req, { requirement_id: 'r1', status: 'not_material', narrative: null }, metric, false))
      .toBe('not_material');
  });
});

describe('coveragePercent', () => {
  it('counts data-satisfied and answered as covered', () => {
    const states: RequirementState[] = ['satisfied_by_data', 'answered', 'outstanding', 'in_progress'];
    expect(coveragePercent(states)).toBe(50);
  });

  it('excludes not_material from the denominator', () => {
    const states: RequirementState[] = ['answered', 'not_material', 'outstanding'];
    expect(coveragePercent(states)).toBe(50); // 1 of 2 applicable
  });

  it('excludes assessment-scoped requirements from the denominator', () => {
    // A CSRD statement complete for its material topics reads 100%, not 33%.
    const states: RequirementState[] = ['answered', 'excluded_immaterial', 'excluded_immaterial'];
    expect(coveragePercent(states)).toBe(100);
  });

  it('still counts undetermined requirements as gaps', () => {
    // 'undetermined' never becomes a state — the requirement stays in the
    // denominator as whatever it actually is.
    const states: RequirementState[] = ['answered', 'outstanding', 'excluded_immaterial'];
    expect(coveragePercent(states)).toBe(50);
  });

  it('returns 0 when everything is scoped out', () => {
    expect(coveragePercent(['not_material', 'excluded_immaterial'])).toBe(0);
  });

  it('returns 0 for an empty framework', () => {
    expect(coveragePercent([])).toBe(0);
  });
});
