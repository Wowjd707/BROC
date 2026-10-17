import { describe, it, expect } from 'vitest';
import { mapFactorCsvRow, factorImportTemplate, FACTOR_IMPORT_COLUMNS } from './factor-import-core';
import { parseCsvToObjects } from './csv';

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    category_number: '1',
    method: 'spend_based',
    activity_key: '331110',
    label: 'Iron and steel mills',
    factor_value: '0.42',
    activity_unit: 'USD',
    region: 'US',
    factor_source: 'EPA Supply Chain GHG Factors v1.3',
    data_year: '2022',
    effective_from: '2022-01-01',
    effective_to: '',
    notes: '',
    ...overrides,
  };
}

describe('mapFactorCsvRow', () => {
  it('maps a valid row', () => {
    const r = mapFactorCsvRow(row());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row).toMatchObject({
        category_number: 1,
        method: 'spend_based',
        activity_key: '331110',
        factor_value: 0.42,
        activity_unit: 'USD',
        data_year: 2022,
        effective_from: '2022-01-01',
        effective_to: null,
      });
    }
  });

  it('rejects an out-of-range category', () => {
    expect(mapFactorCsvRow(row({ category_number: '16' })).ok).toBe(false);
    expect(mapFactorCsvRow(row({ category_number: '0' })).ok).toBe(false);
    expect(mapFactorCsvRow(row({ category_number: 'x' })).ok).toBe(false);
  });

  it('rejects an unknown method', () => {
    const r = mapFactorCsvRow(row({ method: 'vibes_based' }));
    expect(r).toEqual({ ok: false, error: expect.stringContaining('Unknown method') });
  });

  it('requires a cited source', () => {
    const r = mapFactorCsvRow(row({ factor_source: '  ' }));
    expect(r).toEqual({ ok: false, error: expect.stringContaining('factor_source is required') });
  });

  it('rejects a negative or non-numeric factor value', () => {
    expect(mapFactorCsvRow(row({ factor_value: '-1' })).ok).toBe(false);
    expect(mapFactorCsvRow(row({ factor_value: 'abc' })).ok).toBe(false);
  });

  it('accepts zero as a valid factor value', () => {
    expect(mapFactorCsvRow(row({ factor_value: '0' })).ok).toBe(true);
  });

  it('requires an activity unit', () => {
    expect(mapFactorCsvRow(row({ activity_unit: '' })).ok).toBe(false);
  });

  it('validates the data year', () => {
    expect(mapFactorCsvRow(row({ data_year: '22' })).ok).toBe(false);
    expect(mapFactorCsvRow(row({ data_year: '' })).ok).toBe(false);
  });

  it('defaults effective_from and validates date formats', () => {
    const r = mapFactorCsvRow(row({ effective_from: '' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.effective_from).toBe('1900-01-01');
    expect(mapFactorCsvRow(row({ effective_from: '01/01/2022' })).ok).toBe(false);
  });

  it('rejects effective_to on or before effective_from', () => {
    expect(mapFactorCsvRow(row({ effective_from: '2022-01-01', effective_to: '2022-01-01' })).ok).toBe(false);
    expect(mapFactorCsvRow(row({ effective_from: '2022-01-01', effective_to: '2021-01-01' })).ok).toBe(false);
    expect(mapFactorCsvRow(row({ effective_from: '2022-01-01', effective_to: '2023-01-01' })).ok).toBe(true);
  });

  it('nulls out blank optional fields', () => {
    const r = mapFactorCsvRow(row({ label: '', region: '', notes: '' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.label).toBeNull();
      expect(r.row.region).toBeNull();
      expect(r.row.notes).toBeNull();
    }
  });
});

describe('factorImportTemplate', () => {
  it('starts with the documented header', () => {
    expect(factorImportTemplate().split('\n')[0]).toBe(FACTOR_IMPORT_COLUMNS.join(','));
  });

  it('example rows are structurally valid (placeholder source included)', () => {
    const { rows } = parseCsvToObjects(factorImportTemplate());
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(mapFactorCsvRow(r).ok).toBe(true);
    }
  });
});
