import { describe, it, expect } from 'vitest';
import {
  templateFor, headersFor, canonicalizeRow, stageRow,
  applyValue, isCommittable, FAMILY_COLUMNS,
  type StagingContext,
} from './staged-import-core';
import type { MetricCatalogEntry } from './import-cascade-core';

const catalog: MetricCatalogEntry[] = [
  { metricType: 'water',      sourceType: 'municipal_consumption', label: 'Municipal Water', canonicalUnit: 'gal',       aggregation: 'sum' },
  { metricType: 'waste',      sourceType: 'non_hazardous_landfilled', label: 'Landfilled',   canonicalUnit: 'kg',        aggregation: 'sum' },
  { metricType: 'safety',     sourceType: 'hours_worked',          label: 'Hours worked',    canonicalUnit: 'hours',     aggregation: 'sum' },
  { metricType: 'safety',     sourceType: 'recordable_incidents',  label: 'Recordables',     canonicalUnit: 'incidents', aggregation: 'sum' },
  { metricType: 'workforce',  sourceType: 'headcount',             label: 'Headcount',       canonicalUnit: 'people',    aggregation: 'point_in_time' },
  { metricType: 'governance', sourceType: 'board_seats',           label: 'Board seats',     canonicalUnit: 'seats',     aggregation: 'point_in_time' },
];

const sites = new Map([['main plant', 'site-1'], ['hq office', 'site-2']]);

const ctx = (family: StagingContext['family']): StagingContext =>
  ({ family, siteIdByName: sites, catalog });

const row = (over: Record<string, string> = {}): Record<string, string> => ({
  site: 'Main Plant', entry_date: '2025-01-31', quantity: '100', ...over,
});

describe('templates', () => {
  it('writes spaced, capitalized headers for every family', () => {
    expect(headersFor('emissions')[1]).toBe('Entry Date');
    expect(headersFor('water')).toEqual(['Site', 'Entry Date', 'Metric', 'Quantity', 'Unit', 'Notes']);
    for (const family of Object.keys(FAMILY_COLUMNS) as (keyof typeof FAMILY_COLUMNS)[]) {
      const header = templateFor(family).split('\n')[0];
      expect(header).not.toMatch(/_/);
      expect(header).toBe(headersFor(family).join(','));
    }
  });

  it('every template example stages without a hard error', () => {
    for (const family of Object.keys(FAMILY_COLUMNS) as (keyof typeof FAMILY_COLUMNS)[]) {
      const lines = templateFor(family).trim().split('\n');
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
      for (const line of lines.slice(1)) {
        const cells = line.split(',');
        const obj = Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
        expect(stageRow(1, obj, ctx(family)).status).not.toBe('error');
      }
    }
  });
});

describe('canonicalizeRow', () => {
  it('maps the spellings that do not survive normalization', () => {
    // "Scope 1 Category" normalizes to scope_1_category, not scope1_category.
    expect(canonicalizeRow({ scope_1_category: 'mobile_combustion' }).scope1_category)
      .toBe('mobile_combustion');
  });

  it('never lets an alias overwrite an explicit value', () => {
    const out = canonicalizeRow({ scope_1_category: 'mobile_combustion', scope1_category: 'stationary_combustion' });
    expect(out.scope1_category).toBe('stationary_combustion');
  });
});

describe('stageRow — what is an error and what is reviewable', () => {
  it('errors only on what a dropdown cannot fix', () => {
    expect(stageRow(1, row({ quantity: 'lots' }), ctx('water')).status).toBe('error');
    expect(stageRow(1, row({ entry_date: '31/01/2025' }), ctx('water')).status).toBe('error');
  });

  it('treats an unmatched site as reviewable, not fatal', () => {
    // "Plant 3 (Toledo)" vs "Plant 3" is the most common reason a real export
    // fails to load, and the least deserving of a re-export.
    const r = stageRow(1, row({ site: 'Plant 3 (Toledo)', metric: 'municipal_consumption', unit: 'gal' }), ctx('water'));
    expect(r.status).toBe('needs_review');
    expect(r.error).toBeNull();
    expect(r.adjustments.find((a) => a.field === 'site')?.requiresConfirmation).toBe(true);
  });

  it('keeps raw untouched while resolved changes', () => {
    const r = stageRow(1, row({ metric: 'municipal_consumption', unit: 'gal' }), ctx('water'));
    applyValue(r, 'quantity', '250', 'user', null);
    expect(r.raw.quantity).toBe('100');
    expect(r.resolved.quantity).toBe('250');
  });
});

describe('stageRow — metric families', () => {
  it('resolves the metric family from the metric, not the file', () => {
    const r = stageRow(1, row({ metric: 'hours_worked', unit: 'hours' }), ctx('social'));
    expect(r.resolved.metric_type).toBe('safety');
    expect(r.status).toBe('valid');
  });

  it('rejects a metric that belongs to another family', () => {
    const r = stageRow(1, row({ metric: 'board_seats' }), ctx('social'));
    expect(r.adjustments.find((a) => a.field === 'metric')?.requiresConfirmation).toBe(true);
  });

  it('fills a missing unit from the metric, silently', () => {
    const r = stageRow(1, row({ metric: 'hours_worked' }), ctx('social'));
    const unit = r.adjustments.find((a) => a.field === 'unit');
    expect(unit?.to).toBe('hours');
    expect(unit?.requiresConfirmation).toBe(false);
  });

  it('surfaces a unit disagreement instead of overwriting it', () => {
    // kg vs tonnes is a factor of a thousand, not a label.
    const r = stageRow(1, row({ metric: 'non_hazardous_landfilled', unit: 't' }), ctx('waste'));
    const unit = r.adjustments.find((a) => a.field === 'unit');
    expect(unit?.requiresConfirmation).toBe(true);
    expect(unit?.to).toBeNull();
  });

  it('takes the unit from the metric, never the family', () => {
    // One family, two units — migration 023 trap 1.
    expect(stageRow(1, row({ metric: 'hours_worked' }), ctx('social'))
      .adjustments.find((a) => a.field === 'unit')?.to).toBe('hours');
    expect(stageRow(1, row({ metric: 'recordable_incidents' }), ctx('social'))
      .adjustments.find((a) => a.field === 'unit')?.to).toBe('incidents');
  });

  it('warns about a point-in-time metric without blocking it', () => {
    const r = stageRow(1, row({ metric: 'headcount', unit: 'people' }), ctx('social'));
    expect(r.warnings[0]).toMatch(/point-in-time/i);
    expect(isCommittable(r)).toBe(true);
  });

  it('allows a governance row with no site', () => {
    const r = stageRow(1, { entry_date: '2025-01-31', quantity: '9', metric: 'board_seats', unit: 'seats' }, ctx('governance'));
    expect(r.adjustments.find((a) => a.field === 'site')).toBeUndefined();
    expect(isCommittable(r)).toBe(true);
  });
});

describe('stageRow — emissions', () => {
  it('holds a fuel row for scope confirmation', () => {
    const r = stageRow(1, row({ source_type: 'diesel', unit: 'gal' }), ctx('emissions'));
    expect(r.status).toBe('needs_review');
    expect(isCommittable(r)).toBe(false);
  });

  it('lets a fully specified electricity row through', () => {
    const r = stageRow(1, row({ source_type: 'electricity', scope: 'scope2', unit: 'kWh' }), ctx('emissions'));
    expect(isCommittable(r)).toBe(true);
  });
});

describe('applyValue', () => {
  it('records the change and clears the proposal it answers', () => {
    const r = stageRow(1, row({ source_type: 'diesel', unit: 'gal' }), ctx('emissions'));
    expect(isCommittable(r)).toBe(false);

    const rec = applyValue(r, 'scope', 'scope1', 'user', 'Owned fleet');
    expect(rec).toEqual({
      field: 'scope', oldValue: null, newValue: 'scope1',
      origin: 'user', reason: 'Owned fleet',
    });
    expect(r.resolved.scope).toBe('scope1');
    expect(r.adjustments.find((a) => a.field === 'scope')).toBeUndefined();
  });

  it('returns null for a no-op rather than logging noise', () => {
    const r = stageRow(1, row({ metric: 'hours_worked', unit: 'hours' }), ctx('social'));
    expect(applyValue(r, 'quantity', '100', 'user', null)).toBeNull();
  });

  it('distinguishes a machine value from a human one', () => {
    const r = stageRow(1, row({ metric: 'hours_worked' }), ctx('social'));
    expect(applyValue(r, 'unit', 'hours', 'auto', 'catalog')?.origin).toBe('auto');
  });
});
