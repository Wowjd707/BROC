import { describe, it, expect } from 'vitest';
import {
  compareEvidence, compareQuantity, comparePeriod, readableKind, unreadableReason, mediaTypeFor,
  type Normalizer,
} from './evidence-check-core';
import { parseDocumentReading, type ParsedDocument } from './ai/tasks';

/** Electricity: kWh canonical. */
const toKwh: Normalizer = (q, u) => (u === 'kWh' ? q : u === 'MWh' ? q * 1000 : u === 'GWh' ? q * 1e6 : null);

const doc = (over: Partial<ParsedDocument> = {}): ParsedDocument => ({
  readable: true, documentType: 'utility bill', issuer: 'Duke Energy', accountOrMeter: '123',
  periodStart: '2026-03-15', periodEnd: '2026-04-14', readings: [], total: null, notes: null,
  fellBackToProse: false, ...over,
});
const line = (quantity: number, unitCode: string | null, description = 'Usage') => ({
  description, quantity, unitAsWritten: unitCode, unitCode, sourceText: `${quantity} ${unitCode}`,
});
const entry = { quantity: 12500, unit: 'kWh', entryDate: '2026-04-01' };

describe('compareQuantity', () => {
  it('matches the total within rounding', () => {
    const r = compareQuantity(entry, doc({ total: line(12_480, 'kWh', 'Total') }), toKwh);
    expect(r.status).toBe('match');
    expect(r.matchedOn).toBe('total');
  });

  it('converts units before comparing', () => {
    expect(compareQuantity(entry, doc({ total: line(12.5, 'MWh') }), toKwh).status).toBe('match');
  });

  it('matches a single line when the entry is one meter of several', () => {
    const r = compareQuantity(entry, doc({ total: line(30_000, 'kWh'), readings: [line(17_500, 'kWh', 'Meter A'), line(12_500, 'kWh', 'Meter B')] }), toKwh);
    expect(r).toMatchObject({ status: 'match', matchedOn: 'Meter B' });
  });

  it('sums lines when no total is printed', () => {
    const r = compareQuantity(entry, doc({ readings: [line(10_000, 'kWh', 'Peak'), line(2_500, 'kWh', 'Off-peak')] }), toKwh);
    expect(r).toMatchObject({ status: 'match', matchedOn: 'sum of the lines' });
  });

  it('calls a factor of 1,000 a unit slip, not a mismatch', () => {
    const slip = { quantity: 12.5, unit: 'kWh', entryDate: '2026-04-01' };
    expect(compareQuantity(slip, doc({ total: line(12_500, 'kWh') }), toKwh).status).toBe('unit_slip');
  });

  it('reports the difference on a real mismatch', () => {
    const r = compareQuantity(entry, doc({ total: line(10_000, 'kWh') }), toKwh);
    expect(r.status).toBe('mismatch');
    expect(r.differencePct).toBeCloseTo(0.25);
  });

  it('will not compare a unit it cannot convert', () => {
    expect(compareQuantity(entry, doc({ total: line(42, null) }), toKwh).status).toBe('not_comparable');
    expect(compareQuantity(entry, doc({ total: line(42, 'therms') }), toKwh).status).toBe('not_comparable');
  });

  it('says so when nothing was read', () => {
    expect(compareQuantity(entry, doc(), toKwh).status).toBe('not_found');
  });
});

describe('comparePeriod', () => {
  it('accepts a billing period that straddles the month', () => {
    expect(comparePeriod(entry, doc()).status).toBe('covers');
  });
  it('flags a document wholly outside the month', () => {
    expect(comparePeriod(entry, doc({ periodStart: '2026-01-01', periodEnd: '2026-01-31' })).status).toBe('outside');
  });
  it('is unknown when the document has no dates', () => {
    expect(comparePeriod(entry, doc({ periodStart: null, periodEnd: null })).status).toBe('unknown');
  });
  it('handles the last day of a month', () => {
    expect(comparePeriod({ ...entry, entryDate: '2026-02-28' }, doc({ periodStart: '2026-02-28', periodEnd: '2026-02-28' })).status).toBe('covers');
  });
});

describe('compareEvidence', () => {
  it('needs both quantity and period to call it a match', () => {
    expect(compareEvidence(entry, doc({ total: line(12_500, 'kWh') }), toKwh).outcome).toBe('match');
    const wrongMonth = compareEvidence(entry, doc({ total: line(12_500, 'kWh'), periodStart: '2025-04-01', periodEnd: '2025-04-30' }), toKwh);
    expect(wrongMonth.outcome).toBe('mismatch');
    expect(wrongMonth.summary).toMatch(/quantity matches/);
  });
  it('never reports a match for an unreadable document', () => {
    expect(compareEvidence(entry, doc({ readable: false, total: line(12_500, 'kWh') }), toKwh).outcome).toBe('unreadable');
  });
  it('words a slip so a reviewer knows what to look for', () => {
    const r = compareEvidence({ ...entry, quantity: 12.5 }, doc({ total: line(12_500, 'kWh') }), toKwh);
    expect(r.outcome).toBe('unit_slip');
    expect(r.summary).toMatch(/factor of 1,000/);
  });
});

describe('which files can be read', () => {
  it('reads PDFs and common images, not office files or HEIC', () => {
    expect(readableKind('application/pdf', 'bill.pdf')).toBe('pdf');
    expect(readableKind('image/jpeg', 'meter.jpg')).toBe('image');
    expect(readableKind(null, 'scan.PNG')).toBe('image');
    expect(readableKind('image/heic', 'photo.heic')).toBeNull();
    expect(readableKind('application/vnd.ms-excel', 'bill.xls')).toBeNull();
    expect(mediaTypeFor('image', null, 'scan.png')).toBe('image/png');
  });
  it('explains a refusal', () => {
    expect(unreadableReason('text/csv', 'x.csv', 10)).toMatch(/Only PDFs and images/);
    expect(unreadableReason('image/png', 'x.png', 6 * 1024 * 1024)).toMatch(/larger than 5 MB/);
    expect(unreadableReason('application/pdf', 'x.pdf', 1000)).toBeNull();
  });
});

describe('parseDocumentReading', () => {
  it('keeps only unit codes the platform offered', () => {
    const p = parseDocumentReading(
      '```json\n{"readable":true,"period_start":"2026-03-15","period_end":"14/04/2026","readings":[{"quantity":"12,500","unit_as_written":"kWh","unit_code":"kWh","source_text":"12,500 kWh"},{"quantity":5,"unit_code":"bananas"}],"total":null}\n```',
      ['kWh', 'MWh'],
    );
    expect(p.readings[0]).toMatchObject({ quantity: 12500, unitCode: 'kWh' });
    expect(p.readings[1].unitCode).toBeNull();
    expect(p.periodStart).toBe('2026-03-15');
    expect(p.periodEnd).toBeNull(); // not ISO: dropped rather than guessed
  });
  it('treats an unparseable reply as unreadable', () => {
    const p = parseDocumentReading('I think it says about 12,000 kWh.', ['kWh']);
    expect(p.readable).toBe(false);
    expect(compareEvidence(entry, p, toKwh).outcome).toBe('unreadable');
  });
  it('drops quantities that are not numbers', () => {
    const p = parseDocumentReading('{"readings":[{"quantity":"n/a","unit_code":"kWh"}]}', ['kWh']);
    expect(p.readings).toHaveLength(0);
  });
});
