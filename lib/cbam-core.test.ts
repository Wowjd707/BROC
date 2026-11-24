import { describe, it, expect } from 'vitest';
import {
  sectorForCode, embeddedEmissions, countsTowardsThreshold, summariseYear, certificatesFor,
  declarationIssues, declarationCsv, thresholdFor, declarationDue, importIssues, type ImportRow, type DeclarationRow,
} from './cbam-core';

const imp = (o: Partial<ImportRow> = {}): ImportRow => ({
  id: Math.random().toString(36).slice(2), product_id: 'p', supplier_id: null, import_date: '2026-03-10',
  customs_reference: null, cn_code: '73269098', quantity: 10, unit: 'tonne', country_of_origin: 'CN',
  installation_name: 'Plant A', installation_id: null, direct_emissions: 2, indirect_emissions: 0.5,
  emissions_basis: 'default', emissions_source: 'Commission default values, Dec 2025', verification_report: null,
  carbon_price_paid_eur: null, carbon_price_evidence: null, notes: null, ...o,
});

const decl = (o: Partial<DeclarationRow> = {}): DeclarationRow => ({
  id: 'd', year: 2026, authorised_declarant_number: 'NL-CBAM-1', carbon_price_deduction: null, carbon_price_deduction_source: null,
  free_allocation_adjustment: null, free_allocation_source: null, price_q1_eur: null, price_q2_eur: null, price_q3_eur: null,
  price_q4_eur: null, price_source: null, status: 'draft', submitted_on: null, registry_reference: null, notes: null, ...o,
});

describe('sectorForCode', () => {
  it('reads the Annex I headings, longest prefix first', () => {
    expect(sectorForCode('7326 90 98')).toBe('Iron & Steel');
    expect(sectorForCode('76061291')).toBe('Aluminium');
    expect(sectorForCode('25070080')).toBe('Cement');
    expect(sectorForCode('28041000')).toBe('Hydrogen');
    expect(sectorForCode('28042100')).toBeNull();
    expect(sectorForCode('27160000')).toBe('Electricity');
    expect(sectorForCode('3105 20 10')).toBe('Fertilisers');
    expect(sectorForCode('7312')).toBeNull();
    expect(sectorForCode('')).toBeNull();
  });
});

describe('embeddedEmissions', () => {
  it('counts direct emissions only for iron and steel (Annex II)', () => {
    expect(embeddedEmissions(imp())?.total).toBe(20);
  });
  it('counts indirect emissions too for cement and fertilisers', () => {
    expect(embeddedEmissions(imp({ cn_code: '252329', direct_emissions: 0.8, indirect_emissions: 0.1 }))?.total).toBeCloseTo(9);
  });
  it('is unknown, not zero, when a needed figure is missing', () => {
    expect(embeddedEmissions(imp({ direct_emissions: null }))).toBeNull();
    expect(embeddedEmissions(imp({ cn_code: '252329', indirect_emissions: null }))).toBeNull();
    expect(embeddedEmissions(imp({ indirect_emissions: null }))?.total).toBe(20);
  });
});

describe('threshold', () => {
  it('is 50 t for 2026, and falls back with a flag for a year not yet recorded', () => {
    expect(thresholdFor(2026)).toMatchObject({ tonnes: 50, confirmed: true });
    expect(thresholdFor(2028)).toMatchObject({ tonnes: 50, confirmed: false });
  });
  it('leaves electricity and hydrogen out of the mass (Art. 2a(4))', () => {
    expect(countsTowardsThreshold(imp())).toBe(true);
    expect(countsTowardsThreshold(imp({ cn_code: '28041000' }))).toBe(false);
    expect(countsTowardsThreshold(imp({ cn_code: '27160000', unit: 'MWh' }))).toBe(false);
  });
  it('is exceeded only above 50 t, and then applies to everything', () => {
    expect(summariseYear([imp({ quantity: 50 })], 2026).obligationsApply).toBe(false);
    const s = summariseYear([imp({ quantity: 30 }), imp({ quantity: 20.5, import_date: '2026-11-01' })], 2026);
    expect(s.thresholdMass).toBeCloseTo(50.5);
    expect(s.exceeded).toBe(true);
  });
  it('applies obligations to hydrogen whatever the mass', () => {
    expect(summariseYear([imp({ cn_code: '28041000', quantity: 1 })], 2026).obligationsApply).toBe(true);
  });
  it('counts only the calendar year asked for', () => {
    expect(summariseYear([imp({ quantity: 60, import_date: '2025-12-31' })], 2026).imports).toBe(0);
  });
  it('is due on 30 September of the next year (Art. 6(1))', () => {
    expect(declarationDue(2026)).toBe('2027-09-30');
  });
});

describe('summariseYear', () => {
  it('groups by CN code with emissions, sources and gaps', () => {
    const s = summariseYear([
      imp({ quantity: 40, emissions_basis: 'actual', verification_report: 'VR-1' }),
      imp({ quantity: 20 }),
      imp({ cn_code: '76061291', quantity: 5, direct_emissions: null, emissions_basis: null, emissions_source: null }),
    ], 2026);
    expect(s.lines.map((l) => l.cn_code)).toEqual(['73269098', '76061291']);
    expect(s.lines[0]).toMatchObject({ quantity: 60, embedded: 120, verificationReports: ['VR-1'] });
    expect(s.lines[0].actualShare).toBeCloseTo(80 / 120);
    expect(s.lines[1]).toMatchObject({ embedded: 0, incomplete: 1 });
    expect(s.incomplete).toBe(1);
    expect(s.embeddedByQuarter[0]).toBe(120);
  });
});

describe('certificatesFor', () => {
  const s = summariseYear([imp({ quantity: 30 }), imp({ quantity: 30, import_date: '2026-08-01' })], 2026);
  it('takes the recorded deductions off the embedded emissions', () => {
    const c = certificatesFor(s, decl({ carbon_price_deduction: 10, free_allocation_adjustment: 5 }));
    expect(c).toMatchObject({ gross: 120, net: 105 });
  });
  it('prices each quarter at its own price, and only when every quarter used has one', () => {
    expect(certificatesFor(s, decl({ price_q1_eur: 70 })).estimatedCostEur).toBeNull();
    const c = certificatesFor(s, decl({ price_q1_eur: 70, price_q3_eur: 80 }));
    expect(c.averagePriceEur).toBe(75);
    expect(c.estimatedCostEur).toBe(9000);
  });
});

describe('issues', () => {
  it('blocks the declaration on missing emissions or declarant number', () => {
    const s = summariseYear([imp({ quantity: 60, direct_emissions: null, emissions_basis: null, emissions_source: null })], 2026);
    const msgs = declarationIssues(s, decl({ authorised_declarant_number: null })).map((i) => i.message);
    expect(msgs.some((m) => m.includes('no embedded emissions'))).toBe(true);
    expect(msgs.some((m) => m.includes('declarant number'))).toBe(true);
  });
  it('asks nothing of an importer under the threshold', () => {
    expect(declarationIssues(summariseYear([imp({ quantity: 10 })], 2026), null)).toEqual([]);
  });
  it('wants a verification report for actual values', () => {
    expect(importIssues(imp({ emissions_basis: 'actual' })).some((i) => i.message.includes('verification report'))).toBe(true);
    expect(importIssues(imp()).length).toBe(0);
  });
});

describe('declarationCsv', () => {
  it('lists each type of goods and the certificate figures', () => {
    const csv = declarationCsv(summariseYear([imp({ quantity: 60 })], 2026), decl(), 'Acme BV');
    expect(csv).toContain('"73269098","Iron & Steel","tonne","60","120"');
    expect(csv).toContain('"CBAM certificates to surrender","120"');
    expect(csv).toContain('Due 2027-09-30');
  });
});
