import { describe, it, expect } from 'vitest';
import {
  mapRequirementCsvRow, requirementImportTemplate, REQUIREMENT_IMPORT_COLUMNS,
} from './requirement-import-core';
import { parseCsvToObjects } from './csv';

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    framework_code: 'CSRD',
    requirement_code: 'E5-5',
    section: 'ESRS E5 — Resource use',
    title: 'Resource outflows',
    description: 'Waste by composition and treatment route.',
    response_type: 'both',
    metric_key: 'waste_total',
    sort_order: '40',
    ...overrides,
  };
}

describe('mapRequirementCsvRow', () => {
  it('maps a valid row', () => {
    const r = mapRequirementCsvRow(row());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row).toMatchObject({
        framework_code: 'CSRD',
        requirement_code: 'E5-5',
        response_type: 'both',
        metric_key: 'waste_total',
        sort_order: 40,
      });
    }
  });

  it('requires framework_code, requirement_code and title', () => {
    expect(mapRequirementCsvRow(row({ framework_code: '' })).ok).toBe(false);
    expect(mapRequirementCsvRow(row({ requirement_code: '' })).ok).toBe(false);
    expect(mapRequirementCsvRow(row({ title: '  ' })).ok).toBe(false);
  });

  it('defaults response_type to narrative', () => {
    const r = mapRequirementCsvRow(row({ response_type: '', metric_key: '' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.response_type).toBe('narrative');
  });

  it('rejects an unknown response_type', () => {
    expect(mapRequirementCsvRow(row({ response_type: 'interpretive_dance' })).ok).toBe(false);
  });

  it('rejects a metric_key the platform cannot compute', () => {
    const r = mapRequirementCsvRow(row({ metric_key: 'vibes_index' }));
    expect(r).toEqual({ ok: false, error: expect.stringContaining('Unknown metric_key') });
  });

  it('rejects response_type "metric" with no metric_key', () => {
    // Otherwise the requirement could never be answered from data — a silent
    // dead end rather than a visible gap.
    const r = mapRequirementCsvRow(row({ response_type: 'metric', metric_key: '' }));
    expect(r).toEqual({ ok: false, error: expect.stringContaining('requires a metric_key') });
  });

  it('allows a narrative requirement with no metric', () => {
    const r = mapRequirementCsvRow(row({ response_type: 'narrative', metric_key: '' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.metric_key).toBeNull();
  });

  it('validates sort_order is a whole number and defaults to 0', () => {
    expect(mapRequirementCsvRow(row({ sort_order: '1.5' })).ok).toBe(false);
    expect(mapRequirementCsvRow(row({ sort_order: 'x' })).ok).toBe(false);
    const r = mapRequirementCsvRow(row({ sort_order: '' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.sort_order).toBe(0);
  });

  it('nulls blank optional fields', () => {
    const r = mapRequirementCsvRow(row({ section: '', description: '' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.section).toBeNull();
      expect(r.row.description).toBeNull();
    }
  });
});

describe('mapRequirementCsvRow — topic_codes', () => {
  function topics(value: string | undefined) {
    const r = mapRequirementCsvRow(row(value === undefined ? {} : { topic_codes: value }));
    if (!r.ok) throw new Error(r.error);
    return r.topicCodes;
  }

  it('leaves links untouched when the column is absent or blank', () => {
    // A file written before this column existed must not un-scope a framework.
    expect(topics(undefined)).toBeUndefined();
    expect(topics('')).toBeUndefined();
    expect(topics('   ')).toBeUndefined();
  });

  it('reads a single topic', () => {
    expect(topics('E1')).toEqual(['E1']);
  });

  it('splits multiple topics on semicolons, not the CSV delimiter', () => {
    expect(topics('E1;E5')).toEqual(['E1', 'E5']);
    expect(topics(' E1 ; E5 ')).toEqual(['E1', 'E5']);
  });

  it('treats "none" as an explicit instruction to clear the links', () => {
    expect(topics('none')).toEqual([]);
    expect(topics('NONE')).toEqual([]);
  });

  it('rejects a cell of separators, which is ambiguous between blank and none', () => {
    const r = mapRequirementCsvRow(row({ topic_codes: ';;' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('none');
  });

  it('rejects repeated topics rather than writing a duplicate link', () => {
    const r = mapRequirementCsvRow(row({ topic_codes: 'E1;E1' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('E1');
  });
});

describe('requirementImportTemplate', () => {
  it('starts with the documented header', () => {
    expect(requirementImportTemplate().split('\n')[0]).toBe(REQUIREMENT_IMPORT_COLUMNS.join(','));
  });

  it('its own example rows validate', () => {
    const { rows } = parseCsvToObjects(requirementImportTemplate());
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(mapRequirementCsvRow(r).ok).toBe(true);
    }
  });
});
