import { describe, it, expect } from 'vitest';
import {
  normalizeCn, regulationsForCn, currentValues, fieldStatus, validUntil, regulationProgress, valuesFromAnswers,
  type ValueRow,
} from './compliance-core';
import { COMPLIANCE_FIELDS, FIELD_BY_KEY, REGULATION_KEYS, normalizeFieldValue, BUILT_IN_QUESTION_MAP, fieldsFor } from './compliance-catalog';
import { getQuestionSet } from './regulations';

const row = (over: Partial<ValueRow>): ValueRow => ({
  product_id: 'p1', field_key: 'eudr.geolocation', value: 'x', unit: null, valid_from: '2026-01-01',
  valid_to: '2026-12-31', source: 'manual', source_invitation_id: null, recorded_at: '2026-01-01T00:00:00Z', ...over,
});

describe('CN codes', () => {
  it('accepts the usual ways of writing a code', () => {
    expect(normalizeCn('7208 51 20')).toEqual({ ok: true, value: '72085120' });
    expect(normalizeCn('7208.51.20')).toEqual({ ok: true, value: '72085120' });
    expect(normalizeCn('')).toEqual({ ok: true, value: null });
    expect(normalizeCn('72AB').ok).toBe(false);
    expect(normalizeCn('7').ok).toBe(false);
  });

  it('scopes by prefix, ignoring regulations BROC does not know', () => {
    const rules = [
      { regulation: 'cbam', cn_prefix: '72' },
      { regulation: 'eudr', cn_prefix: '4011' },
      { regulation: 'made_up', cn_prefix: '72' },
    ];
    expect(regulationsForCn('72085120', rules)).toEqual(['cbam']);
    expect(regulationsForCn('40111000', rules)).toEqual(['eudr']);
    expect(regulationsForCn('84', rules)).toEqual([]);
    expect(regulationsForCn(null, rules)).toEqual([]);
  });
});

describe('values', () => {
  it('takes the latest recorded value as current', () => {
    const cur = currentValues([
      row({ value: 'old', recorded_at: '2026-01-01T00:00:00Z' }),
      row({ value: 'new', recorded_at: '2026-06-01T00:00:00Z' }),
    ]);
    expect(cur.get('p1|eudr.geolocation')?.value).toBe('new');
  });

  it('tells current, expiring, expired and missing apart', () => {
    expect(fieldStatus(undefined, '2026-11-19')).toBe('missing');
    expect(fieldStatus(row({ valid_to: null }), '2026-11-19')).toBe('current');
    expect(fieldStatus(row({ valid_to: '2027-06-01' }), '2026-11-19')).toBe('current');
    expect(fieldStatus(row({ valid_to: '2026-12-10' }), '2026-11-19')).toBe('expiring');
    expect(fieldStatus(row({ valid_to: '2026-11-18' }), '2026-11-19')).toBe('expired');
  });

  it('computes the last valid day, including month ends', () => {
    expect(validUntil('2026-11-19', 12)).toBe('2027-11-18');
    expect(validUntil('2026-01-31', 1)).toBe('2026-02-27');
    expect(validUntil('2026-11-19', null)).toBeNull();
  });

  it('counts progress per regulation', () => {
    const cur = currentValues([row({ field_key: 'eudr.geolocation', valid_to: null })]);
    const [p] = regulationProgress('p1', ['eudr'], cur, '2026-11-19');
    expect(p.total).toBe(fieldsFor('eudr').length);
    expect(p.current).toBe(1);
    expect(p.missing).toBe(p.total - 1);
  });
});

describe('survey answers to values', () => {
  it('writes each mapped answer to every product on the invitation', () => {
    const { values, skipped } = valuesFromAnswers(
      [{ questionId: 'origin', mapsTo: 'eudr.country_of_production' }, { questionId: 'weight', mapsTo: 'ppwr.packaging_weight' }],
      { origin: 'Brazil', weight: '1,250' },
      ['p1', 'p2'], 'inv1', '2026-11-19',
    );
    expect(skipped).toEqual([]);
    expect(values).toHaveLength(4);
    expect(values.find((v) => v.product_id === 'p2' && v.field_key === 'ppwr.packaging_weight'))
      .toMatchObject({ value: '1250', unit: 'g', valid_to: '2028-11-18', source_invitation_id: 'inv1' });
  });

  it('skips an answer that does not fit, rather than storing it as something else', () => {
    const { values, skipped } = valuesFromAnswers(
      [{ questionId: 'w', mapsTo: 'ppwr.packaging_weight' }, { questionId: 'x', mapsTo: 'nope.nothing' }],
      { w: 'about a kilo', x: 'y' }, ['p1'], 'inv1', '2026-11-19',
    );
    expect(values).toEqual([]);
    expect(skipped.map((s) => s.field)).toEqual(['ppwr.packaging_weight', 'nope.nothing']);
  });

  it('ignores unanswered questions', () => {
    expect(valuesFromAnswers([{ questionId: 'a', mapsTo: 'eudr.geolocation' }], {}, ['p1'], 'i', '2026-11-19').values).toEqual([]);
  });
});

describe('catalogue', () => {
  it('has unique, well-formed keys under known regulations', () => {
    const keys = COMPLIANCE_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of COMPLIANCE_FIELDS) {
      expect(f.key).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
      expect(f.key.startsWith(`${f.regulation}.`)).toBe(true);
      expect(REGULATION_KEYS).toContain(f.regulation);
      if (f.type === 'select') expect(f.options?.length).toBeGreaterThan(0);
    }
  });

  it('maps built-in questions only to fields and questions that exist', () => {
    for (const [type, map] of Object.entries(BUILT_IN_QUESTION_MAP)) {
      const set = getQuestionSet(type);
      for (const [qid, key] of Object.entries(map)) {
        expect(set?.questions.some((q) => q.id === qid), `${type}.${qid}`).toBe(true);
        expect(FIELD_BY_KEY.has(key), key).toBe(true);
      }
    }
  });

  it('normalizes answers by type', () => {
    const f = (k: string) => FIELD_BY_KEY.get(k)!;
    expect(normalizeFieldValue(f('ppwr.reusable'), 'Y')).toEqual({ ok: true, value: 'yes' });
    expect(normalizeFieldValue(f('ppwr.packaging_material'), 'Glass')).toEqual({ ok: true, value: 'glass' });
    expect(normalizeFieldValue(f('ppwr.recycled_content'), '120').ok).toBe(false);
    expect(normalizeFieldValue(f('eudr.geolocation'), '  ').ok).toBe(false);
  });
});
