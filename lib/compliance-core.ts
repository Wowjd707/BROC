/**
 * Pure logic for product compliance data: CN-code scoping, which value is
 * current, when it expires, and turning survey answers into field values.
 * No I/O, so it is unit-tested directly.
 */

import {
  FIELD_BY_KEY, fieldsFor, isRegulationKey, normalizeFieldValue,
  type RegulationKey,
} from './compliance-catalog';

// ─── CN codes ────────────────────────────────────────────────────────────────

/**
 * "7208 51 20", "7208.51.20" and "72085120" are the same code. Anything that
 * is not 2–10 digits once separators are gone is refused rather than guessed.
 */
export function normalizeCn(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = (raw ?? '').replace(/[\s.\-]/g, '');
  if (!s) return { ok: true, value: null };
  if (!/^\d{2,10}$/.test(s)) return { ok: false, error: `CN code must be 2 to 10 digits, got "${raw}".` };
  return { ok: true, value: s };
}

export interface ScopeRule {
  regulation: string;
  cn_prefix: string;
}

/** The regulations whose cited scope list covers this CN code. */
export function regulationsForCn(cn: string | null, rules: ScopeRule[]): RegulationKey[] {
  if (!cn) return [];
  const out = new Set<RegulationKey>();
  for (const r of rules) {
    if (isRegulationKey(r.regulation) && cn.startsWith(r.cn_prefix)) out.add(r.regulation);
  }
  return [...out].sort();
}

// ─── Values and their status ─────────────────────────────────────────────────

export interface ValueRow {
  product_id: string;
  field_key: string;
  value: string;
  unit: string | null;
  valid_from: string;
  valid_to: string | null;
  source: string;
  source_invitation_id: string | null;
  recorded_at: string;
}

export type FieldStatus = 'missing' | 'current' | 'expiring' | 'expired';

/** Days before expiry that a value counts as expiring. */
export const EXPIRING_DAYS = 30;

/** Latest recorded value per product and field. History stays in the table. */
export function currentValues(rows: ValueRow[]): Map<string, ValueRow> {
  const out = new Map<string, ValueRow>();
  for (const r of rows) {
    const k = `${r.product_id}|${r.field_key}`;
    const prev = out.get(k);
    if (!prev || r.recorded_at > prev.recorded_at) out.set(k, r);
  }
  return out;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fieldStatus(row: ValueRow | undefined, today: string): FieldStatus {
  if (!row) return 'missing';
  if (!row.valid_to) return 'current';
  if (row.valid_to < today) return 'expired';
  if (row.valid_to <= addDays(today, EXPIRING_DAYS)) return 'expiring';
  return 'current';
}

/** valid_from + months, as the last day it is valid. */
export function validUntil(validFrom: string, months: number | null): string | null {
  if (months == null) return null;
  const [y, m, d] = validFrom.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  // Valid up to the day before the same date N months on.
  return addDays(target.toISOString().slice(0, 10), -1);
}

export interface RegulationProgress {
  regulation: RegulationKey;
  total: number;
  current: number;
  expiring: number;
  expired: number;
  missing: number;
}

export function regulationProgress(
  productId: string,
  regulations: RegulationKey[],
  current: Map<string, ValueRow>,
  today: string,
): RegulationProgress[] {
  return regulations.map((regulation) => {
    const p: RegulationProgress = { regulation, total: 0, current: 0, expiring: 0, expired: 0, missing: 0 };
    for (const f of fieldsFor(regulation)) {
      p.total++;
      p[fieldStatus(current.get(`${productId}|${f.key}`), today)]++;
    }
    return p;
  });
}

// ─── Survey answers → field values ───────────────────────────────────────────

export interface MappedQuestion {
  /** The id answers are stored under (question_key for custom questions). */
  questionId: string;
  mapsTo: string;
  /** Unit stated on the question, if any. */
  unit?: string | null;
}

export interface NewValue {
  product_id: string;
  field_key: string;
  value: string;
  unit: string | null;
  valid_from: string;
  valid_to: string | null;
  source: 'survey';
  source_invitation_id: string;
}

/**
 * One value per mapped answer per product on the invitation. An answer that
 * does not fit its field (text in a number field) is reported and skipped,
 * never stored as something it is not; the raw answer is still in the survey
 * response.
 */
export function valuesFromAnswers(
  mapped: MappedQuestion[],
  answers: Record<string, string>,
  productIds: string[],
  invitationId: string,
  today: string,
): { values: NewValue[]; skipped: { field: string; reason: string }[] } {
  const values: NewValue[] = [];
  const skipped: { field: string; reason: string }[] = [];
  for (const q of mapped) {
    const field = FIELD_BY_KEY.get(q.mapsTo);
    if (!field) { skipped.push({ field: q.mapsTo, reason: 'not a known field' }); continue; }
    const raw = answers[q.questionId];
    if (raw == null || String(raw).trim() === '') continue;
    const norm = normalizeFieldValue(field, String(raw));
    if (!norm.ok) { skipped.push({ field: field.key, reason: norm.error }); continue; }
    for (const product_id of productIds) {
      values.push({
        product_id,
        field_key: field.key,
        value: norm.value,
        unit: q.unit?.trim() || field.unit || null,
        valid_from: today,
        valid_to: validUntil(today, field.validMonths),
        source: 'survey',
        source_invitation_id: invitationId,
      });
    }
  }
  return { values, skipped };
}
