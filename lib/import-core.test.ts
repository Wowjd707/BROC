import { describe, it, expect } from 'vitest';
import { mapEmissionCsvRow, emissionImportTemplate, EMISSION_IMPORT_HEADERS } from './import-core';

const sites = new Map<string, string>([
  ['main plant', 'site-1'],
  ['hq office', 'site-2'],
]);

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    site: 'Main Plant',
    entry_date: '2025-01-31',
    scope: 'scope1',
    source_type: 'natural_gas',
    scope1_category: 'stationary_combustion',
    refrigerant_code: '',
    quantity: '1200',
    unit: 'therms',
    accounting_method: '',
    instrument_type: '',
    supplier_factor: '',
    notes: 'boiler',
    ...overrides,
  };
}

describe('mapEmissionCsvRow', () => {
  it('maps a valid scope 1 row and resolves the site case-insensitively', () => {
    const r = mapEmissionCsvRow(row({ site: 'MAIN PLANT' }), sites);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.siteId).toBe('site-1');
      expect(r.input.scope).toBe('scope1');
      expect(r.input.quantity).toBe(1200);
      expect(r.input.notes).toBe('boiler');
    }
  });

  it('carries the Scope 1 category through and rejects unknown values', () => {
    const ok = mapEmissionCsvRow(row({ scope1_category: 'mobile_combustion' }), sites);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.input.scope1Category).toBe('mobile_combustion');

    const bad = mapEmissionCsvRow(row({ scope1_category: 'burning_stuff' }), sites);
    expect(bad).toEqual({ ok: false, error: expect.stringContaining('Unknown Scope 1 Category') });
  });

  it('ignores the Scope 1 category on Scope 2 rows', () => {
    const r = mapEmissionCsvRow(row({
      scope: 'scope2', source_type: 'electricity', unit: 'kWh',
      scope1_category: 'stationary_combustion',
    }), sites);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.scope1Category).toBeUndefined();
  });

  it('rejects an unknown site', () => {
    const r = mapEmissionCsvRow(row({ site: 'Nowhere' }), sites);
    expect(r).toEqual({ ok: false, error: expect.stringContaining('Unknown Site') });
  });

  it('rejects a bad date format', () => {
    const r = mapEmissionCsvRow(row({ entry_date: '01/31/2025' }), sites);
    expect(r.ok).toBe(false);
  });

  it('rejects an invalid scope', () => {
    const r = mapEmissionCsvRow(row({ scope: 'scope3' }), sites);
    expect(r.ok).toBe(false);
  });

  it('rejects a non-positive quantity', () => {
    expect(mapEmissionCsvRow(row({ quantity: '0' }), sites).ok).toBe(false);
    expect(mapEmissionCsvRow(row({ quantity: 'abc' }), sites).ok).toBe(false);
  });

  it('requires refrigerant_code for refrigerant source', () => {
    const bad = mapEmissionCsvRow(row({ scope: 'scope1', source_type: 'refrigerants', unit: 'kg', refrigerant_code: '' }), sites);
    expect(bad.ok).toBe(false);
    const good = mapEmissionCsvRow(row({ scope: 'scope1', source_type: 'refrigerants', unit: 'kg', refrigerant_code: 'R-134a' }), sites);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.input.refrigerantCode).toBe('R-134a');
  });

  it('validates accounting_method and supplier_factor for scope 2', () => {
    const r = mapEmissionCsvRow(row({
      scope: 'scope2', source_type: 'electricity', unit: 'kWh',
      accounting_method: 'market_based', supplier_factor: '0.12',
    }), sites);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.accountingMethod).toBe('market_based');
      expect(r.input.supplierFactor).toBe(0.12);
    }
    expect(mapEmissionCsvRow(row({ accounting_method: 'invalid' }), sites).ok).toBe(false);
    expect(mapEmissionCsvRow(row({ supplier_factor: '-1' }), sites).ok).toBe(false);
  });
});

describe('emissionImportTemplate', () => {
  it('starts with the documented header row', () => {
    expect(emissionImportTemplate().split('\n')[0]).toBe(EMISSION_IMPORT_HEADERS.join(','));
  });
  it('the spaced header row still reaches the snake_case keys the validator reads', async () => {
    // "Scope 1 Category" normalizes to scope_1_category, not scope1_category.
    // The round-trip test below cannot catch that: the column is optional, so a
    // header that fails to normalize simply goes missing and the row still
    // validates — every Scope 1 entry would import with no category and nothing
    // would say so. Assert the value arrives, not merely that the row is valid.
    const { parseCsvToObjects } = await import('./csv');
    const { rows } = parseCsvToObjects(emissionImportTemplate());
    const scope1 = mapEmissionCsvRow(rows[0], sites);
    expect(scope1.ok).toBe(true);
    if (scope1.ok) expect(scope1.input.scope1Category).toBe('stationary_combustion');
  });

  it('example rows parse back to valid entries', async () => {
    const { parseCsvToObjects } = await import('./csv');
    const { rows } = parseCsvToObjects(emissionImportTemplate());
    for (const r of rows) {
      expect(mapEmissionCsvRow(r, sites).ok).toBe(true);
    }
  });
});
