import { describe, it, expect } from 'vitest';
import { validCas, declarationIssues, regimesFor, inventoryCsv, REGIMES, type DeclarationRow, type SubstanceRow } from './pfas-core';

const decl = (o: Partial<DeclarationRow> = {}): DeclarationRow => ({
  id: 'd1', product_id: 'p1', status: 'none', basis: 'supplier_declaration', evidence: 'Supplier letter 2026-05-01',
  declared_on: '2026-05-01', supplier_id: null, markets: ['US-MN', 'DE'], product_category: null, notes: null, ...o,
});
const sub = (o: Partial<SubstanceRow> = {}): SubstanceRow => ({
  id: 's1', declaration_id: 'd1', name: 'PTFE', cas_number: '9002-84-0', function: 'Low-friction seal face', component: 'Shaft seal',
  amount_low: 1200, amount_high: 1500, amount_unit: 'mg_per_unit', notes: null, ...o,
});

describe('validCas', () => {
  it('checks the check digit', () => {
    expect(validCas('9002-84-0')).toBe(true);   // PTFE
    expect(validCas('335-67-1')).toBe(true);    // PFOA
    expect(validCas('1763-23-1')).toBe(true);   // PFOS
    expect(validCas('335-67-2')).toBe(false);
    expect(validCas('33567-1')).toBe(false);
  });
});

describe('declarationIssues', () => {
  it('treats no declaration, or unknown, as unknown, never as PFAS-free', () => {
    expect(declarationIssues(null, [], '2026-11-24')[0].level).toBe('block');
    expect(declarationIssues(decl({ status: 'unknown' }), [], '2026-11-24')[0].level).toBe('block');
  });
  it('is satisfied by an evidenced "none" with markets', () => {
    expect(declarationIssues(decl(), [], '2026-11-24')).toEqual([]);
  });
  it('flags a declaration over two years old', () => {
    expect(declarationIssues(decl({ declared_on: '2024-10-01' }), [], '2026-11-24')[0].message).toMatch(/24 months/);
  });
  it('wants the substances of a part that contains PFAS, with valid CAS numbers', () => {
    const d = decl({ status: 'intentionally_added' });
    expect(declarationIssues(d, [], '2026-11-24')[0].message).toMatch(/no substance/);
    expect(declarationIssues(d, [sub()], '2026-11-24')).toEqual([]);
    expect(declarationIssues(d, [sub({ cas_number: '9002-84-1' })], '2026-11-24')[0]).toMatchObject({ level: 'block' });
    const msgs = declarationIssues(d, [sub({ cas_number: null, function: null, amount_low: null, amount_high: null })], '2026-11-24').map((i) => i.message);
    expect(msgs).toHaveLength(3);
  });
  it('asks for markets, since they decide the rules', () => {
    expect(declarationIssues(decl({ markets: [] }), [], '2026-11-24')[0].message).toMatch(/markets/);
  });
});

describe('regimesFor', () => {
  const added = (markets: string[]) => decl({ status: 'intentionally_added', markets });
  it('puts a part sold in Minnesota or Maine with intentionally added PFAS under those states', () => {
    expect(regimesFor(added(['US-MN', 'US-ME']), { country_of_origin: 'US' }).map((r) => r.code)).toEqual(['US-MN', 'US-ME']);
  });
  it('flags US imports for TSCA review, but not US-made parts', () => {
    expect(regimesFor(added(['US-TX']), { country_of_origin: 'DE' }).map((r) => r.code)).toEqual(['EPA-PFAS-TSCA']);
    expect(regimesFor(added(['US-TX']), { country_of_origin: 'US' })).toEqual([]);
  });
  it('touches nothing for a part without intentionally added PFAS', () => {
    expect(regimesFor(decl({ markets: ['US-MN'] }), { country_of_origin: 'CN' })).toEqual([]);
    expect(regimesFor(null, { country_of_origin: 'CN' })).toEqual([]);
  });
  it('gives every regime a source and a verified date', () => {
    for (const r of REGIMES) {
      expect(r.sources.length).toBeGreaterThan(0);
      expect(r.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('inventoryCsv', () => {
  it('writes one row per substance, and one for a part without any', () => {
    const csv = inventoryCsv(
      [{ id: 'p1', part_number: 'PUMP', description: 'Pump', country_of_origin: 'DE' }, { id: 'p2', part_number: 'BOLT', description: null, country_of_origin: 'US' }],
      [decl({ status: 'intentionally_added' })], [sub(), sub({ id: 's2', name: 'FKM', cas_number: '9011-17-0', amount_low: 40, amount_high: 40 })],
    );
    const lines = csv.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('"PTFE","9002-84-0","Low-friction seal face","Shaft seal","1200–1500 mg per unit"');
    expect(lines[1]).toContain('"US-MN DE"');
    expect(lines[1]).toContain('"US-MN EPA-PFAS-TSCA"');
    expect(lines[3]).toContain('"BOLT","","No declaration"');
  });
});
