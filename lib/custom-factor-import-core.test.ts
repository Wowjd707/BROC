import { describe, it, expect } from 'vitest';
import {
  mapCustomFactorCsvRow,
  customFactorImportTemplate,
  findDuplicateWindows,
  buildKeyLookup,
  resolveKey,
  normalizeKey,
  CATEGORY_UNIT,
  CUSTOM_FACTOR_IMPORT_COLUMNS,
  type FactorKeyLookups,
} from './custom-factor-import-core';
import { parseCsvToObjects } from './csv';

const lookups: FactorKeyLookups = {
  fuelTypes: buildKeyLookup(
    ['natural_gas', 'diesel', 'fuel_oil_no2'].map((f) => ({ key: f, value: f })),
  ),
  refrigerantCodes: buildKeyLookup(
    ['R-410A', 'R-134a'].map((c) => ({ key: c, value: c })),
  ),
  siteIdByName: buildKeyLookup([
    { key: 'Austin Plant', value: 'site-uuid-1' },
    { key: 'Reno DC', value: 'site-uuid-2' },
  ]),
};

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    factor_category: 'scope1',
    factor_key: 'natural_gas',
    label: 'Metered gas',
    co2e_factor: '52.1',
    unit: 'MMBtu',
    factor_source: 'Site metering 2025',
    data_year: '2025',
    effective_from: '2025-01-01',
    effective_to: '',
    notes: '',
    ...overrides,
  };
}

function mapped(overrides: Record<string, string> = {}) {
  const r = mapCustomFactorCsvRow(row(overrides), lookups);
  if (!r.ok) throw new Error(r.error);
  return r.row;
}

function errorOf(overrides: Record<string, string> = {}): string {
  const r = mapCustomFactorCsvRow(row(overrides), lookups);
  if (r.ok) throw new Error('expected the row to be rejected');
  return r.error;
}

describe('normalizeKey / buildKeyLookup / resolveKey', () => {
  it('folds case, spaces and separators to one comparison form', () => {
    expect(normalizeKey('Natural Gas')).toBe('naturalgas');
    expect(normalizeKey('natural_gas')).toBe('naturalgas');
    expect(normalizeKey('  NATURAL-GAS  ')).toBe('naturalgas');
    expect(normalizeKey('R-410A')).toBe('r410a');
  });

  it('always returns the canonical stored value, not what was typed', () => {
    expect(resolveKey(lookups.fuelTypes, 'Natural Gas')).toBe('natural_gas');
    expect(resolveKey(lookups.refrigerantCodes, 'r410a')).toBe('R-410A');
  });

  it('returns null for an unknown key rather than guessing the nearest', () => {
    expect(resolveKey(lookups.fuelTypes, 'naturalgasoline')).toBeNull();
    expect(resolveKey(lookups.fuelTypes, '')).toBeNull();
  });

  it('prefers an exact match over a folded one', () => {
    // Two keys that fold together; the exact spelling must still win.
    const lookup = buildKeyLookup([
      { key: 'ab-c', value: 'folded-loser' },
      { key: 'abc', value: 'exact-winner' },
    ]);
    expect(resolveKey(lookup, 'abc')).toBe('exact-winner');
  });
});

describe('mapCustomFactorCsvRow', () => {
  it('maps a valid scope 1 row', () => {
    const r = mapped();
    expect(r).toMatchObject({
      factor_category: 'scope1',
      factor_key: 'natural_gas',
      co2e_factor: 52.1,
      unit: 'MMBtu',
      factor_source: 'Site metering 2025',
      data_year: 2025,
      effective_from: '2025-01-01',
      effective_to: null,
    });
  });

  it('resolves a site NAME to the site id for grid factors', () => {
    // The stored key is the id; nobody is going to type UUIDs into a CSV.
    const r = mapped({ factor_category: 'scope2_location', factor_key: 'Austin Plant', unit: 'kWh' });
    expect(r.factor_key).toBe('site-uuid-1');
    expect(r.unit).toBe('kWh');
  });

  it('accepts a refrigerant code in any common spelling', () => {
    expect(mapped({ factor_category: 'refrigerant', factor_key: 'r410a', unit: 'kg' }).factor_key)
      .toBe('R-410A');
  });

  it('rejects an unknown fuel and names the valid ones', () => {
    const error = errorOf({ factor_key: 'unobtanium' });
    expect(error).toContain('unobtanium');
    expect(error).toContain('natural_gas');
  });

  it('rejects an unknown site rather than creating an unresolvable factor', () => {
    const error = errorOf({ factor_category: 'scope2_location', factor_key: 'Nowhere Plant', unit: 'kWh' });
    expect(error).toContain('Nowhere Plant');
  });

  it('rejects an unknown category', () => {
    expect(errorOf({ factor_category: 'scope3' })).toContain('factor_category');
  });

  // ─── The unit guard ──────────────────────────────────────────────────────
  it('derives the unit from the category', () => {
    expect(mapped({ unit: '' }).unit).toBe('MMBtu');
    expect(mapped({ factor_category: 'refrigerant', factor_key: 'R-134a', unit: '' }).unit).toBe('kg');
    expect(CATEGORY_UNIT.scope2_location).toBe('kWh');
  });

  it('rejects a stated unit that contradicts the category', () => {
    // A Scope 1 factor read as kWh is wrong by ~293x — never resolve silently.
    const error = errorOf({ unit: 'kWh' });
    expect(error).toContain('MMBtu');
    expect(error).toContain('kWh');
  });

  it('accepts a matching stated unit regardless of case, so exports round-trip', () => {
    expect(mapped({ unit: 'mmbtu' }).unit).toBe('MMBtu');
  });

  // ─── Provenance ──────────────────────────────────────────────────────────
  it('rejects an uncited factor', () => {
    expect(errorOf({ factor_source: '   ' })).toContain('provenance');
  });

  it('rejects a missing or implausible data year', () => {
    expect(errorOf({ data_year: '' })).toContain('data_year');
    expect(errorOf({ data_year: '25' })).toContain('data_year');
    expect(errorOf({ data_year: '2025.5' })).toContain('data_year');
  });

  // ─── Numbers ─────────────────────────────────────────────────────────────
  it('rejects a non-numeric, negative or blank factor value', () => {
    expect(errorOf({ co2e_factor: 'abc' })).toContain('co2e_factor');
    expect(errorOf({ co2e_factor: '-1' })).toContain('co2e_factor');
    expect(errorOf({ co2e_factor: '' })).toContain('co2e_factor');
  });

  it('allows a zero factor, which is a real claim for a carbon-free source', () => {
    expect(mapped({ co2e_factor: '0' }).co2e_factor).toBe(0);
  });

  // ─── Effective dating ────────────────────────────────────────────────────
  it('defaults effective_from to the open past so an undated factor still applies', () => {
    expect(mapped({ effective_from: '' }).effective_from).toBe('1900-01-01');
  });

  it('rejects malformed dates', () => {
    expect(errorOf({ effective_from: '01/01/2025' })).toContain('effective_from');
    expect(errorOf({ effective_to: '2025' })).toContain('effective_to');
  });

  it('rejects a window that closes before it opens', () => {
    expect(errorOf({ effective_from: '2025-01-01', effective_to: '2024-01-01' })).toContain('after');
    expect(errorOf({ effective_from: '2025-01-01', effective_to: '2025-01-01' })).toContain('after');
  });

  it('nulls blank optional fields', () => {
    const r = mapped({ label: '', notes: '', effective_to: '' });
    expect(r.label).toBeNull();
    expect(r.notes).toBeNull();
    expect(r.effective_to).toBeNull();
  });
});

describe('findDuplicateWindows', () => {
  const base = { factor_category: 'scope1', factor_key: 'natural_gas' };

  it('flags two windows opening on the same date for the same factor', () => {
    // Tie-breaking would fall out of row order, so the same file could report
    // different numbers on different days.
    const errors = findDuplicateWindows([
      { line: 1, row: { ...base, effective_from: '2025-01-01' } },
      { line: 2, row: { ...base, effective_from: '2025-01-01' } },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
    expect(errors[0].message).toContain('row 1');
  });

  it('allows superseding a vintage with a later start date', () => {
    // The documented workflow: import next year's factors with a later
    // effective_from and the later window deterministically wins.
    expect(findDuplicateWindows([
      { line: 1, row: { ...base, effective_from: '2024-01-01' } },
      { line: 2, row: { ...base, effective_from: '2025-01-01' } },
    ])).toEqual([]);
  });

  it('does not confuse different keys or categories sharing a date', () => {
    expect(findDuplicateWindows([
      { line: 1, row: { ...base, effective_from: '2025-01-01' } },
      { line: 2, row: { ...base, factor_key: 'diesel', effective_from: '2025-01-01' } },
      { line: 3, row: { factor_category: 'refrigerant', factor_key: 'natural_gas', effective_from: '2025-01-01' } },
    ])).toEqual([]);
  });

  it('reports every duplicate against the first occurrence', () => {
    const errors = findDuplicateWindows([
      { line: 1, row: { ...base, effective_from: '2025-01-01' } },
      { line: 2, row: { ...base, effective_from: '2025-01-01' } },
      { line: 3, row: { ...base, effective_from: '2025-01-01' } },
    ]);
    expect(errors.map((e) => e.line)).toEqual([2, 3]);
    expect(errors.every((e) => e.message.includes('row 1'))).toBe(true);
  });
});

describe('customFactorImportTemplate', () => {
  it('starts with the documented header', () => {
    expect(customFactorImportTemplate().split('\n')[0]).toBe(CUSTOM_FACTOR_IMPORT_COLUMNS.join(','));
  });

  it('covers all three categories', () => {
    const { rows } = parseCsvToObjects(customFactorImportTemplate());
    expect(rows.map((r) => r.factor_category)).toEqual(['scope1', 'scope2_location', 'refrigerant']);
  });

  it('its rows validate once the placeholder site name is replaced', () => {
    const { rows } = parseCsvToObjects(customFactorImportTemplate());
    for (const r of rows) {
      const input = r.factor_category === 'scope2_location'
        ? { ...r, factor_key: 'Austin Plant' }
        : r;
      const result = mapCustomFactorCsvRow(input, lookups);
      expect(result.ok, result.ok ? '' : result.error).toBe(true);
    }
  });

  it('leaves the site row failing until the placeholder is replaced', () => {
    // The template must not look importable as shipped — the placeholder is an
    // instruction, and silently accepting it would create a factor keyed to
    // nothing.
    const { rows } = parseCsvToObjects(customFactorImportTemplate());
    const siteRow = rows.find((r) => r.factor_category === 'scope2_location')!;
    expect(mapCustomFactorCsvRow(siteRow, lookups).ok).toBe(false);
  });
});
