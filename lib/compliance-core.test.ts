import { describe, it, expect } from 'vitest';
import {
  normalizeCode, regulationsForProduct, matchingRules, splitCodes, fieldSurveyPlan, surveyFieldKeys, currentValues, fieldStatus, validUntil, regulationProgress, valuesFromAnswers,
  type ValueRow,
} from './compliance-core';
import { COMPLIANCE_FIELDS, FIELD_BY_KEY, REGULATION_KEYS, normalizeFieldValue, BUILT_IN_QUESTION_MAP, fieldsFor } from './compliance-catalog';
import { getQuestionSet } from './regulations';

const row = (over: Partial<ValueRow>): ValueRow => ({
  product_id: 'p1', field_key: 'eudr.geolocation', value: 'x', unit: null, valid_from: '2026-01-01',
  valid_to: '2026-12-31', source: 'manual', source_invitation_id: null, recorded_at: '2026-01-01T00:00:00Z', ...over,
});

describe('customs codes', () => {
  it('accepts the usual ways of writing a code', () => {
    expect(normalizeCode('7208 51 20', 'cn')).toEqual({ ok: true, value: '72085120' });
    expect(normalizeCode('7208.51.0030', 'hts')).toEqual({ ok: true, value: '7208510030' });
    expect(normalizeCode('7208.51', 'hs')).toEqual({ ok: true, value: '720851' });
    expect(normalizeCode('', 'cn')).toEqual({ ok: true, value: null });
    expect(normalizeCode('72AB', 'cn').ok).toBe(false);
    expect(normalizeCode('7', 'hts').ok).toBe(false);
  });

  it('refuses a national code typed into the HS field, and says why', () => {
    const r = normalizeCode('7208 51 20', 'hs');
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/at most 6 digits.*CN or HTS/) });
  });

  const rules = [
    { regulation: 'cbam', code_system: 'cn', cn_prefix: '72085120' },
    { regulation: 'eudr', code_system: 'hs', cn_prefix: '4011' },
    { regulation: 'ppwr', code_system: 'hts', cn_prefix: '4819100040' },
    { regulation: 'made_up', code_system: 'cn', cn_prefix: '72' },
  ];

  it('matches a long prefix only in its own system', () => {
    expect(regulationsForProduct({ cn_code: '72085120' }, rules)).toEqual(['cbam']);
    // Same digits, but an HTS code: the 8-digit CN rule does not apply.
    expect(regulationsForProduct({ hts_code: '7208512000' }, rules)).toEqual([]);
    expect(regulationsForProduct({ hts_code: '4819100040' }, rules)).toEqual(['ppwr']);
    expect(regulationsForProduct({ cn_code: '48191000' }, rules)).toEqual([]);
  });

  it('matches a prefix of six digits or fewer against any code, since they share those digits', () => {
    expect(regulationsForProduct({ hs_code: '401110' }, rules)).toEqual(['eudr']);
    expect(regulationsForProduct({ cn_code: '40111000' }, rules)).toEqual(['eudr']);
    expect(regulationsForProduct({ hts_code: '4011101010' }, rules)).toEqual(['eudr']);
  });

  it('treats a rule saved before code systems as a CN rule', () => {
    expect(regulationsForProduct({ cn_code: '72085120' }, [{ regulation: 'cbam', cn_prefix: '72085120' }])).toEqual(['cbam']);
  });

  it('ignores unknown regulations and products with no code', () => {
    expect(regulationsForProduct({ cn_code: '72010000' }, rules)).toEqual([]);
    expect(regulationsForProduct({}, rules)).toEqual([]);
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

describe('surveys and pasted codes', () => {
  it('splits a pasted list without breaking codes that contain spaces', () => {
    expect(splitCodes('7208 51 20\n7209, 7210;  7211 \n\n')).toEqual(['7208 51 20', '7209', '7210', '7211']);
  });

  it('builds a survey with one mapped question per field', () => {
    const cbam = fieldSurveyPlan('cbam');
    expect(cbam.survey).toMatchObject({ regulation_type: 'cbam', custom_regulation_name: null, status: 'active' });
    expect(cbam.questions.map((q) => q.maps_to)).toEqual(fieldsFor('cbam').map((f) => f.key));
    expect(new Set(cbam.questions.map((q) => q.question_key)).size).toBe(cbam.questions.length);
    for (const q of cbam.questions) if (q.question_type === 'select') expect(q.options.length).toBeGreaterThan(0);
    // No built-in PPWR survey type, so it is a custom survey named for it.
    expect(fieldSurveyPlan('ppwr').survey).toMatchObject({ regulation_type: 'custom', custom_regulation_name: 'PPWR' });
  });

  it('reports the fields a survey fills, built-in or custom', () => {
    expect(surveyFieldKeys({ id: 's1', regulation_type: 'eudr' }, [])).toContain('eudr.geolocation');
    expect(surveyFieldKeys({ id: 's1', regulation_type: 'eudr' }, [
      { survey_id: 's1', maps_to: 'ppwr.reusable' }, { survey_id: 's1', maps_to: null }, { survey_id: 's2', maps_to: 'eudr.commodity' },
    ])).toEqual(['ppwr.reusable']);
    expect(surveyFieldKeys({ id: 's1', regulation_type: 'general_carbon' }, [])).toEqual([]);
  });
});

describe('matchingRules', () => {
  it('returns the rules that put a product in scope', () => {
    const rules = [
      { id: 'a', regulation: 'cbam', code_system: 'cn', cn_prefix: '7208' },
      { id: 'b', regulation: 'cbam', code_system: 'hts', cn_prefix: '7208510030' },
      { id: 'c', regulation: 'eudr', code_system: 'cn', cn_prefix: '4011' },
    ];
    expect(matchingRules({ cn_code: '72085120', hts_code: '7208510030' }, rules).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
