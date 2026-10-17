import { describe, it, expect } from 'vitest';
import {
  scope1CategoriesFor,
  suggestScope1Category,
  suggestScope,
  metricsForFamily,
  canonicalUnitFor,
  isPointInTime,
  proposeEmissionAdjustments,
  type MetricCatalogEntry,
} from './import-cascade-core';

/**
 * A slice of `sustainability_metrics` shaped like the real thing, including the
 * case migration 023 calls out: one family holding two different units.
 */
const catalog: MetricCatalogEntry[] = [
  { metricType: 'safety',     sourceType: 'hours_worked',         label: 'Hours worked',       canonicalUnit: 'hours',     aggregation: 'sum' },
  { metricType: 'safety',     sourceType: 'recordable_incidents', label: 'Recordable injuries', canonicalUnit: 'incidents', aggregation: 'sum' },
  { metricType: 'workforce',  sourceType: 'headcount',            label: 'Headcount',          canonicalUnit: 'people',    aggregation: 'point_in_time' },
  { metricType: 'training',   sourceType: 'training_hours',       label: 'Training hours',     canonicalUnit: 'hours',     aggregation: 'sum' },
  { metricType: 'governance', sourceType: 'board_seats',          label: 'Board seats',        canonicalUnit: 'seats',     aggregation: 'point_in_time' },
  { metricType: 'water',      sourceType: 'groundwater',          label: 'Groundwater',        canonicalUnit: 'gal',       aggregation: 'sum' },
];

describe('scope1CategoriesFor', () => {
  it('narrows a single-use fuel to one category', () => {
    expect(scope1CategoriesFor('fuel_oil_no2')).toEqual(['stationary_combustion']);
    expect(scope1CategoriesFor('refrigerants')).toEqual(['fugitive_emissions']);
  });

  it('keeps both open for a fuel with two common uses', () => {
    expect(scope1CategoriesFor('diesel')).toEqual(
      ['stationary_combustion', 'mobile_combustion'],
    );
    // Forklifts, not just building heat.
    expect(scope1CategoriesFor('propane')).toContain('mobile_combustion');
  });

  it('offers no Scope 1 category for a Scope 2 source', () => {
    expect(scope1CategoriesFor('electricity')).toEqual([]);
    expect(scope1CategoriesFor('district_heating')).toEqual([]);
  });

  it('leaves an unknown source unconstrained rather than empty', () => {
    // An organization's own source type must not arrive with zero options.
    expect(scope1CategoriesFor('bespoke_kiln_gas').length).toBe(4);
  });
});

describe('suggestScope1Category', () => {
  it('pre-fills only when there is one honest answer', () => {
    const s = suggestScope1Category('refrigerants');
    expect(s.value).toBe('fugitive_emissions');
    expect(s.requiresConfirmation).toBe(false);
  });

  it('refuses to guess between a boiler and a fleet', () => {
    const s = suggestScope1Category('diesel');
    expect(s.value).toBeNull();
    expect(s.requiresConfirmation).toBe(true);
    expect(s.reason).toMatch(/both ways/i);
  });
});

describe('suggestScope', () => {
  it('sets Scope 2 for purchased energy without asking', () => {
    const s = suggestScope('electricity');
    expect(s.value).toBe('scope2');
    expect(s.requiresConfirmation).toBe(false);
  });

  it('suggests Scope 1 for a fuel but demands confirmation', () => {
    // The whole point of the module. Diesel is Scope 1 only inside the
    // boundary; a silent Scope 1 would push a haulier's fuel into the total.
    const s = suggestScope('diesel');
    expect(s.value).toBe('scope1');
    expect(s.requiresConfirmation).toBe(true);
    expect(s.reason).toMatch(/scope 3/i);
  });

  it('says so when it cannot tell', () => {
    const s = suggestScope('something_unknown');
    expect(s.value).toBeNull();
    expect(s.requiresConfirmation).toBe(true);
  });
});

describe('metricsForFamily', () => {
  it('groups several metric types under social', () => {
    const labels = metricsForFamily('social', catalog).map((m) => m.sourceType);
    expect(labels).toContain('hours_worked');
    expect(labels).toContain('headcount');
    expect(labels).toContain('training_hours');
    expect(labels).not.toContain('board_seats');
  });

  it('picks up a metric the deploying organization added, with no code change', () => {
    const extended = [...catalog, {
      metricType: 'safety', sourceType: 'contractor_hours',
      label: 'Contractor hours', canonicalUnit: 'hours', aggregation: 'sum' as const,
    }];
    expect(metricsForFamily('social', extended).map((m) => m.sourceType))
      .toContain('contractor_hours');
  });
});

describe('canonicalUnitFor', () => {
  it('takes the unit from the metric, never the family', () => {
    // Migration 023 trap 1: one family, two units. Inferring from the family
    // turns a count of injuries into a number of hours.
    expect(canonicalUnitFor('safety', 'hours_worked', catalog)).toBe('hours');
    expect(canonicalUnitFor('safety', 'recordable_incidents', catalog)).toBe('incidents');
  });

  it('returns null for a metric it does not know', () => {
    expect(canonicalUnitFor('safety', 'not_a_metric', catalog)).toBeNull();
  });
});

describe('isPointInTime', () => {
  it('flags a stock so twelve monthly rows are not summed into twelve workforces', () => {
    expect(isPointInTime('workforce', 'headcount', catalog)).toBe(true);
    expect(isPointInTime('safety', 'hours_worked', catalog)).toBe(false);
  });
});

describe('proposeEmissionAdjustments', () => {
  it('fills an empty scope and marks it for confirmation', () => {
    const [a] = proposeEmissionAdjustments({
      sourceType: 'diesel', scope: null, scope1Category: null,
    });
    expect(a.field).toBe('scope');
    expect(a.to).toBe('scope1');
    expect(a.requiresConfirmation).toBe(true);
  });

  it('does not overwrite a scope the file stated, but surfaces the disagreement', () => {
    // An operator writing scope2 against diesel may be right — leased assets.
    // Silently replacing it would hide a judgement worth seeing.
    const out = proposeEmissionAdjustments({
      sourceType: 'diesel', scope: 'scope2', scope1Category: null,
    });
    const scopeAdj = out.find((a) => a.field === 'scope');
    expect(scopeAdj?.to).toBeNull();
    expect(scopeAdj?.from).toBe('scope2');
    expect(scopeAdj?.requiresConfirmation).toBe(true);
  });

  it('applies a certain category without demanding confirmation', () => {
    const out = proposeEmissionAdjustments({
      sourceType: 'refrigerants', scope: 'scope1', scope1Category: null,
    });
    const cat = out.find((a) => a.field === 'scope1Category');
    expect(cat?.to).toBe('fugitive_emissions');
    expect(cat?.requiresConfirmation).toBe(false);
  });

  it('asks rather than guesses when the fuel has two uses', () => {
    const out = proposeEmissionAdjustments({
      sourceType: 'diesel', scope: 'scope1', scope1Category: null,
    });
    const cat = out.find((a) => a.field === 'scope1Category');
    expect(cat?.to).toBeNull();
    expect(cat?.requiresConfirmation).toBe(true);
  });

  it('rejects a category the fuel cannot produce', () => {
    const out = proposeEmissionAdjustments({
      sourceType: 'natural_gas', scope: 'scope1', scope1Category: 'fugitive_emissions',
    });
    const cat = out.find((a) => a.field === 'scope1Category');
    expect(cat?.requiresConfirmation).toBe(true);
    expect(cat?.reason).toMatch(/not a category/i);
  });

  it('proposes no Scope 1 category for a Scope 2 row', () => {
    const out = proposeEmissionAdjustments({
      sourceType: 'electricity', scope: null, scope1Category: null,
    });
    expect(out.find((a) => a.field === 'scope1Category')).toBeUndefined();
    expect(out.find((a) => a.field === 'scope')?.requiresConfirmation).toBe(false);
  });

  it('leaves a fully specified valid row alone', () => {
    const out = proposeEmissionAdjustments({
      sourceType: 'natural_gas', scope: 'scope1', scope1Category: 'stationary_combustion',
    });
    expect(out).toEqual([]);
  });
});
