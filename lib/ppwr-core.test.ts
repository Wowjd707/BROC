import { describe, it, expect } from 'vitest';
import {
  gramsPerUnit, componentIssues, jurisdictionReport, jurisdictionsFor, reportIssues, reportCsv, isEuMemberState,
  type ComponentRow, type PlacementRow, type RegistrationRow,
} from './ppwr-core';

const comp = (o: Partial<ComponentRow> = {}): ComponentRow => ({
  id: Math.random().toString(36).slice(2), product_id: 'p1', name: 'Carton', material: 'paper_cardboard', material_detail: null,
  function: 'sales', weight_g: 120, units_per_packaging: 1, reusable: false, food_contact: false, recycled_content_pct: null,
  supplier_id: null, heavy_metals_evidence: 'Supplier declaration 2026', pfas_evidence: null, conformity_reference: 'DoC-1',
  notes: null, is_active: true, ...o,
});
const place = (o: Partial<PlacementRow> = {}): PlacementRow => ({
  id: Math.random().toString(36).slice(2), product_id: 'p1', jurisdiction: 'DE', year: 2026, quarter: null, units: 10000,
  source: null, notes: null, ...o,
});
const reg = (o: Partial<RegistrationRow> = {}): RegistrationRow => ({
  id: 'r', jurisdiction: 'DE', register_name: 'LUCID', registration_number: 'DE123', fulfilment: 'pro', pro_name: 'Dual system',
  authorised_representative: null, registered_on: '2026-01-01', notes: null, ...o,
});

describe('weights', () => {
  it('shares transport packaging over the units it holds', () => {
    expect(gramsPerUnit({ weight_g: 400, units_per_packaging: 200 })).toBe(2);
  });
  it('adds up tonnes by material and function', () => {
    const r = jurisdictionReport([place()], [comp(), comp({ name: 'Pallet wrap', material: 'plastic', function: 'transport', weight_g: 400, units_per_packaging: 200 })], 'DE', 2026);
    expect(r.tonnes.paper_cardboard).toBeCloseTo(1.2);
    expect(r.tonnes.plastic).toBeCloseTo(0.02);
    expect(r.byFunction.transport.plastic).toBeCloseTo(0.02);
    expect(r.total).toBeCloseTo(1.22);
    expect(r.singleUseTonnes).toBeCloseTo(1.22);
  });
  it('splits reusable from single-use, and ignores inactive components', () => {
    const r = jurisdictionReport([place()], [comp({ reusable: true }), comp({ is_active: false, weight_g: 9999 })], 'DE', 2026);
    expect(r.reusableTonnes).toBeCloseTo(1.2);
    expect(r.total).toBeCloseTo(1.2);
  });
  it('sums quarters, and keeps countries and years apart', () => {
    const r = jurisdictionReport([place({ quarter: 1 }), place({ quarter: 2 }), place({ jurisdiction: 'FR' }), place({ year: 2025 })], [comp()], 'DE', 2026);
    expect(r.units).toBe(20000);
  });
  it('reports parts without packaging as unknown, not zero', () => {
    const r = jurisdictionReport([place({ product_id: 'p2' })], [comp()], 'DE', 2026);
    expect(r.partsWithoutPackaging).toEqual(['p2']);
    expect(r.total).toBe(0);
  });
});

describe('EU rules', () => {
  it('knows the Member States, so US states get no EU deadline', () => {
    expect(isEuMemberState('DE')).toBe(true);
    expect(isEuMemberState('US-OR')).toBe(false);
    expect(jurisdictionReport([place({ jurisdiction: 'US-OR' })], [comp()], 'US-OR', 2026)).toMatchObject({ eu: false, due: null, smallProducer: null });
  });
  it('is due 1 June of the next year and flags producers under 10 t (Art. 44(7), (8))', () => {
    expect(jurisdictionReport([place()], [comp()], 'DE', 2026)).toMatchObject({ due: '2027-06-01', smallProducer: true });
    expect(jurisdictionReport([place({ units: 100000 })], [comp()], 'DE', 2026).smallProducer).toBe(false);
  });
  it('orders countries by units placed', () => {
    expect(jurisdictionsFor([place({ jurisdiction: 'FR', units: 5 }), place({ units: 50 }), place({ jurisdiction: 'NL', units: 7 })], 2026)).toEqual(['DE', 'NL', 'FR']);
  });
});

describe('issues', () => {
  it('blocks food-contact packaging without PFAS evidence (Art. 5(5))', () => {
    expect(componentIssues(comp({ food_contact: true }))[0]).toMatchObject({ level: 'block' });
    expect(componentIssues(comp({ food_contact: true, pfas_evidence: 'Lab report 44' }))).toEqual([]);
  });
  it('asks for heavy-metal evidence, a declaration of conformity, and plastic recycled content', () => {
    const msgs = componentIssues(comp({ material: 'plastic', heavy_metals_evidence: null, conformity_reference: null })).map((i) => i.message);
    expect(msgs.some((m) => m.includes('100 mg/kg'))).toBe(true);
    expect(msgs.some((m) => m.includes('declaration of conformity'))).toBe(true);
    expect(msgs.some((m) => m.includes('Recycled content'))).toBe(true);
  });
  it('blocks an EU report with no registration or with parts missing packaging', () => {
    const r = jurisdictionReport([place(), place({ product_id: 'p2' })], [comp()], 'DE', 2026);
    const msgs = reportIssues(r, null, [comp()], [place()]).map((i) => i.message);
    expect(msgs.some((m) => m.includes('no packaging recorded'))).toBe(true);
    expect(msgs.some((m) => m.includes('Art. 44(2)'))).toBe(true);
    expect(reportIssues(jurisdictionReport([place()], [comp()], 'DE', 2026), reg(), [comp()], [place()])).toEqual([]);
  });
  it('does not demand an EU registration for a US state', () => {
    const r = jurisdictionReport([place({ jurisdiction: 'US-CO' })], [comp()], 'US-CO', 2026);
    expect(reportIssues(r, null, [comp()], [place({ jurisdiction: 'US-CO' })])).toEqual([]);
  });
});

describe('reportCsv', () => {
  it('lays tonnes out in the Annex IX material columns by function', () => {
    const r = jurisdictionReport([place()], [comp()], 'DE', 2026);
    const csv = reportCsv(r, reg(), 'Acme BV');
    expect(csv).toContain('"Glass (t)","Plastic (t)","Paper and cardboard (t)"');
    expect(csv).toContain('"Sales packaging","0","0","1.2","0","0","0","0","1.2"');
    expect(csv).toContain('Due 2027-06-01');
    expect(csv).toContain('Registration DE123');
  });
});
