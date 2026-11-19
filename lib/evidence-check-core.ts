/**
 * Checking an entry against its supporting document.
 *
 * An assurance provider samples entries and asks for the bill behind each one.
 * The errors they find are the ones statistics cannot: a plausible number from
 * the wrong month, a figure in MWh typed into a kWh field, one meter of three.
 *
 * The work is split so that no model ever decides whether an entry is right:
 *
 *   1. A model READS the document (`read_evidence_document` in lib/ai/tasks.ts)
 *      and reports what it says, quoting the text behind each value. It is not
 *      told what was entered, so it has nothing to agree with.
 *   2. This module COMPARES that reading with the entry, in plain arithmetic
 *      the reviewer can repeat by hand.
 *
 * Every outcome is a prompt to look, never a verdict on the data — the same
 * stance as lib/anomaly-core.ts. A bill that does not match can be correct (an
 * entry covering two bills; a meter shared with another site), and the
 * reviewer, not the platform, knows which.
 *
 * Pure and dependency-free so it is unit-testable.
 */

import type { DocumentReading, ParsedDocument } from './ai/tasks';

// ─── Which files can be read ─────────────────────────────────────────────────

/** Formats both supported providers read natively. HEIC is not one of them. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Per-file ceiling for sending to a model. Providers cap images near 5 MB. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ReadableKind = 'pdf' | 'image';

export function readableKind(contentType: string | null, fileName: string): ReadableKind | null {
  const type = (contentType ?? '').toLowerCase();
  const name = fileName.toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (IMAGE_TYPES.has(type)) return 'image';
  if (/\.(png|jpe?g|gif|webp)$/.test(name)) return 'image';
  return null;
}

export function mediaTypeFor(kind: ReadableKind, contentType: string | null, fileName: string): string {
  if (kind === 'pdf') return 'application/pdf';
  if (contentType && IMAGE_TYPES.has(contentType.toLowerCase())) return contentType.toLowerCase();
  const ext = fileName.toLowerCase().split('.').pop();
  return ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

/** Why a file cannot be checked, in words for the reviewer — or null if it can. */
export function unreadableReason(contentType: string | null, fileName: string, sizeBytes: number | null): string | null {
  const kind = readableKind(contentType, fileName);
  if (!kind) {
    return 'Only PDFs and images (PNG, JPEG, GIF, WebP) can be checked. Attach the bill as a PDF or a photo.';
  }
  const limit = kind === 'pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (sizeBytes != null && sizeBytes > limit) {
    return `This file is larger than ${Math.round(limit / 1024 / 1024)} MB, the most that can be sent for reading.`;
  }
  return null;
}

// ─── Comparison ──────────────────────────────────────────────────────────────

/** Bills round; a 1% band absorbs that without hiding a real difference. */
export const MATCH_TOLERANCE = 0.01;

/** A factor of 1,000 either way is the kWh/MWh, kg/t slip. */
const SLIP_FACTORS = [1000, 0.001];

export interface EntryForCheck {
  quantity: number;
  unit: string;
  /** ISO date; the entry's month is the period it reports. */
  entryDate: string;
}

/**
 * Converts a quantity to the entry's canonical unit, or null when the unit is
 * not one this kind of entry can take. Supplied by the caller (wrapping
 * lib/conversions.ts) so this module stays pure.
 */
export type Normalizer = (quantity: number, unitCode: string) => number | null;

export type QuantityStatus = 'match' | 'mismatch' | 'unit_slip' | 'not_comparable' | 'not_found';
export type PeriodStatus = 'covers' | 'outside' | 'unknown';
export type CheckOutcome = 'match' | 'mismatch' | 'unit_slip' | 'needs_review' | 'unreadable';

export interface QuantityComparison {
  status: QuantityStatus;
  /** The document value the entry was compared with, as printed. */
  documentQuantity: number | null;
  documentUnit: string | null;
  sourceText: string | null;
  /** 'total' or the description of the line it matched. */
  matchedOn: string | null;
  /** (entry − document) / document, both in canonical units. */
  differencePct: number | null;
}

export interface PeriodComparison {
  status: PeriodStatus;
  documentStart: string | null;
  documentEnd: string | null;
  entryMonth: string;
}

export interface EvidenceComparison {
  outcome: CheckOutcome;
  quantity: QuantityComparison;
  period: PeriodComparison;
  /** One plain sentence for the list view. */
  summary: string;
}

function relDiff(entry: number, doc: number): number {
  if (doc === 0) return entry === 0 ? 0 : Infinity;
  return (entry - doc) / Math.abs(doc);
}

function near(a: number, b: number, tol = MATCH_TOLERANCE): boolean {
  return Math.abs(relDiff(a, b)) <= tol;
}

interface Candidate { reading: DocumentReading; label: string }

function candidates(doc: ParsedDocument): Candidate[] {
  const out: Candidate[] = [];
  if (doc.total) out.push({ reading: doc.total, label: 'total' });
  for (const r of doc.readings) out.push({ reading: r, label: r.description ?? 'a line on the document' });
  // A total printed only as the sum of its lines is still a total worth
  // comparing with; summing lines that share a unit is arithmetic, not a guess.
  if (!doc.total && doc.readings.length > 1) {
    const codes = new Set(doc.readings.map((r) => r.unitCode));
    const [only] = [...codes];
    if (codes.size === 1 && only) {
      const sum = doc.readings.reduce((s, r) => s + r.quantity, 0);
      out.push({
        reading: { description: 'sum of the lines', quantity: sum, unitAsWritten: doc.readings[0].unitAsWritten, unitCode: only, sourceText: null },
        label: 'sum of the lines',
      });
    }
  }
  return out;
}

export function compareQuantity(entry: EntryForCheck, doc: ParsedDocument, normalize: Normalizer): QuantityComparison {
  const cands = candidates(doc);
  const empty = { documentQuantity: null, documentUnit: null, sourceText: null, matchedOn: null, differencePct: null };
  if (cands.length === 0) return { status: 'not_found', ...empty };

  const entryCanon = normalize(entry.quantity, entry.unit);
  if (entryCanon == null) return { status: 'not_comparable', ...empty };

  let firstComparable: { c: Candidate; docCanon: number } | null = null;
  let slip: { c: Candidate; docCanon: number } | null = null;

  for (const c of cands) {
    if (!c.reading.unitCode) continue;
    const docCanon = normalize(c.reading.quantity, c.reading.unitCode);
    if (docCanon == null) continue;
    const pick = (status: QuantityStatus): QuantityComparison => ({
      status,
      documentQuantity: c.reading.quantity,
      documentUnit: c.reading.unitAsWritten ?? c.reading.unitCode,
      sourceText: c.reading.sourceText,
      matchedOn: c.label,
      differencePct: Number.isFinite(relDiff(entryCanon, docCanon)) ? relDiff(entryCanon, docCanon) : null,
    });
    if (near(entryCanon, docCanon)) return pick('match');
    if (!slip && docCanon !== 0 && SLIP_FACTORS.some((f) => near(entryCanon, docCanon * f))) slip = { c, docCanon };
    if (!firstComparable) firstComparable = { c, docCanon };
  }

  const describe = (x: { c: Candidate; docCanon: number }, status: QuantityStatus): QuantityComparison => ({
    status,
    documentQuantity: x.c.reading.quantity,
    documentUnit: x.c.reading.unitAsWritten ?? x.c.reading.unitCode,
    sourceText: x.c.reading.sourceText,
    matchedOn: x.c.label,
    differencePct: Number.isFinite(relDiff(entryCanon, x.docCanon)) ? relDiff(entryCanon, x.docCanon) : null,
  });
  if (slip) return describe(slip, 'unit_slip');
  if (firstComparable) return describe(firstComparable, 'mismatch');

  // Values were read, but in units this entry cannot be converted from.
  const c = cands[0];
  return {
    status: 'not_comparable',
    documentQuantity: c.reading.quantity,
    documentUnit: c.reading.unitAsWritten,
    sourceText: c.reading.sourceText,
    matchedOn: c.label,
    differencePct: null,
  };
}

function monthBounds(isoDate: string): { start: string; end: string; month: string } {
  const [y, m] = isoDate.slice(0, 7).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const month = `${y}-${String(m).padStart(2, '0')}`;
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}`, month };
}

/**
 * Billing periods straddle months — a 15 March to 14 April bill is normal
 * evidence for an April entry. Any overlap with the entry's month counts as
 * covering it; only a document wholly outside that month is flagged.
 */
export function comparePeriod(entry: EntryForCheck, doc: ParsedDocument): PeriodComparison {
  const { start, end, month } = monthBounds(entry.entryDate);
  const docStart = doc.periodStart ?? doc.periodEnd;
  const docEnd = doc.periodEnd ?? doc.periodStart;
  if (!docStart || !docEnd) {
    return { status: 'unknown', documentStart: doc.periodStart, documentEnd: doc.periodEnd, entryMonth: month };
  }
  const [lo, hi] = docStart <= docEnd ? [docStart, docEnd] : [docEnd, docStart];
  const overlaps = lo <= end && hi >= start;
  return { status: overlaps ? 'covers' : 'outside', documentStart: doc.periodStart, documentEnd: doc.periodEnd, entryMonth: month };
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function pct(p: number | null): string {
  return p == null ? '' : ` (${p > 0 ? '+' : ''}${(p * 100).toFixed(1)}%)`;
}

export function compareEvidence(entry: EntryForCheck, doc: ParsedDocument, normalize: Normalizer): EvidenceComparison {
  const period = comparePeriod(entry, doc);
  const quantity = doc.readable
    ? compareQuantity(entry, doc, normalize)
    : { status: 'not_found' as const, documentQuantity: null, documentUnit: null, sourceText: null, matchedOn: null, differencePct: null };

  const entered = `${fmt(entry.quantity)} ${entry.unit}`;
  const onDoc = quantity.documentQuantity != null ? `${fmt(quantity.documentQuantity)} ${quantity.documentUnit ?? ''}`.trim() : null;
  const periodNote = period.status === 'outside'
    ? ` The document covers ${period.documentStart ?? '?'} to ${period.documentEnd ?? '?'}, outside ${period.entryMonth}.`
    : '';

  if (!doc.readable || quantity.status === 'not_found') {
    return {
      outcome: 'unreadable', quantity, period,
      summary: doc.readable
        ? 'No quantity for this kind of entry was found on the document.'
        : `The document could not be read${doc.notes ? `: ${doc.notes}` : '.'}`,
    };
  }
  if (quantity.status === 'unit_slip') {
    return {
      outcome: 'unit_slip', quantity, period,
      summary: `Entered ${entered}; the document shows ${onDoc}. That is a factor of 1,000, which usually means the wrong unit was picked (kWh and MWh, kg and t).${periodNote}`,
    };
  }
  if (quantity.status === 'mismatch') {
    return {
      outcome: 'mismatch', quantity, period,
      summary: `Entered ${entered}; the document's ${quantity.matchedOn} is ${onDoc}${pct(quantity.differencePct)}.${periodNote}`,
    };
  }
  if (quantity.status === 'not_comparable') {
    return {
      outcome: 'needs_review', quantity, period,
      summary: `Entered ${entered}; the document shows ${onDoc ?? 'a quantity'} in a unit that cannot be converted automatically. Compare by hand.${periodNote}`,
    };
  }
  // Quantity matches.
  if (period.status === 'outside') {
    return { outcome: 'mismatch', quantity, period, summary: `The quantity matches (${onDoc}), but${periodNote.replace(/^ The/, ' the')}` };
  }
  return {
    outcome: 'match', quantity, period,
    summary: `Matches the document's ${quantity.matchedOn}: ${onDoc}${period.status === 'unknown' ? '. The document shows no billing period, so the month was not checked.' : `, for a period that covers ${period.entryMonth}.`}`,
  };
}

export const CHECK_OUTCOME_LABELS: Record<CheckOutcome, string> = {
  match: 'Matches document',
  mismatch: 'Differs from document',
  unit_slip: 'Likely unit slip',
  needs_review: 'Compare by hand',
  unreadable: 'Could not read',
};
