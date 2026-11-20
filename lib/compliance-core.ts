/**
 * Pure logic for product compliance data: CN-code scoping, which value is
 * current, when it expires, and turning survey answers into field values.
 * No I/O, so it is unit-tested directly.
 */

import {
  FIELD_BY_KEY, fieldsFor, isRegulationKey, normalizeFieldValue, questionTypeFor, REGULATIONS, BUILT_IN_QUESTION_MAP,
  type RegulationKey,
} from './compliance-catalog';

// ─── Customs codes: HS, CN, HTS ───────────────────────────────────────────────

export type CodeSystem = 'hs' | 'cn' | 'hts';

export const CODE_SYSTEMS: Record<CodeSystem, { label: string; name: string; maxDigits: number; example: string }> = {
  hs: { label: 'HS', name: 'Harmonized System', maxDigits: 6, example: '7208 51' },
  cn: { label: 'CN', name: 'EU Combined Nomenclature', maxDigits: 10, example: '7208 51 20' },
  hts: { label: 'HTS', name: 'US Harmonized Tariff Schedule', maxDigits: 10, example: '7208.51.0030' },
};

export const CODE_SYSTEM_KEYS = Object.keys(CODE_SYSTEMS) as CodeSystem[];

/**
 * "7208 51 20", "7208.51.20" and "72085120" are the same code. Anything that
 * is not 2 digits up to the system's length, once separators are gone, is
 * refused rather than guessed — an 8-digit "HS code" is really a CN or HTS
 * code, and filing it as HS would hide which.
 */
export function normalizeCode(
  raw: string | null | undefined,
  system: CodeSystem = 'cn',
): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = (raw ?? '').replace(/[\s.\-]/g, '');
  if (!s) return { ok: true, value: null };
  const { label, maxDigits } = CODE_SYSTEMS[system];
  if (!/^\d+$/.test(s) || s.length < 2 || s.length > maxDigits) {
    return {
      ok: false,
      error: system === 'hs' && /^\d+$/.test(s) && s.length > 6
        ? `HS codes have at most 6 digits; "${raw}" looks like a CN or HTS code.`
        : `${label} code must be 2 to ${maxDigits} digits, got "${raw}".`,
    };
  }
  return { ok: true, value: s };
}

/**
 * Codes pasted as a list: one per line, or separated by commas or semicolons.
 * Spaces inside a code are kept, because "7208 51 20" is one code.
 */
export function splitCodes(text: string): string[] {
  return text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
}

export interface ProductCodes {
  hs_code?: string | null;
  cn_code?: string | null;
  hts_code?: string | null;
}

export interface ScopeRule {
  regulation: string;
  /** Prefix in `code_system` (column named for CN, see migration 044). */
  cn_prefix: string;
  /** Rules saved before migration 044 have none; they are CN rules. */
  code_system?: string | null;
}

function codeIn(product: ProductCodes, system: CodeSystem): string | null {
  return (system === 'hs' ? product.hs_code : system === 'cn' ? product.cn_code : product.hts_code) ?? null;
}

/**
 * The regulations whose cited scope list covers this product.
 *
 * A rule is checked against the product's code in the rule's own system. The
 * first six digits are the same in HS, CN and HTS by design, so a rule of six
 * digits or fewer also matches whichever code the product has: an HS "7208"
 * rule covers a part that only carries its HTS code. Longer prefixes are
 * national and only ever match their own system.
 */
export function regulationsForProduct(product: ProductCodes, rules: ScopeRule[]): RegulationKey[] {
  return [...new Set(matchingRules(product, rules).map((r) => r.regulation as RegulationKey))].sort();
}

/** The rules that put a product in scope, so the page can say why. */
export function matchingRules<R extends ScopeRule>(product: ProductCodes, rules: R[]): R[] {
  const all = [product.hs_code, product.cn_code, product.hts_code].filter((c): c is string => !!c);
  if (all.length === 0) return [];
  return rules.filter((r) => {
    if (!isRegulationKey(r.regulation)) return false;
    const system = (CODE_SYSTEM_KEYS as string[]).includes(r.code_system ?? '') ? (r.code_system as CodeSystem) : 'cn';
    const own = codeIn(product, system);
    return !!own?.startsWith(r.cn_prefix)
      || (r.cn_prefix.length <= 6 && all.some((c) => c.startsWith(r.cn_prefix)));
  });
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

// ─── Surveys that collect fields ─────────────────────────────────────────────

/**
 * The survey "Create a survey for these fields" builds: one question per field,
 * mapped to it. CBAM and EUDR keep their regulation type (so the response
 * dashboard files them under that topic); PPWR has no built-in type, so it is
 * a custom survey named for it. Adding questions to a built-in type replaces
 * its built-in set, which is what is wanted here.
 */
export function fieldSurveyPlan(regulation: RegulationKey) {
  const reg = REGULATIONS[regulation];
  const builtIn = regulation === 'cbam' || regulation === 'eudr';
  return {
    survey: {
      title: `${reg.label} product data request`,
      regulation_type: builtIn ? regulation : 'custom',
      custom_regulation_name: builtIn ? null : reg.label,
      status: 'active',
      notes: `Questions map to BROC's ${reg.label} product fields. Answers are recorded on each product the request asks about.`,
    },
    questions: fieldsFor(regulation).map((f, i) => ({
      position: i,
      question_key: f.key.replace('.', '_'),
      label: f.label,
      question_type: questionTypeFor(f),
      required: false,
      unit: f.unit ?? null,
      options: f.options ? f.options.map((o) => ({ value: o.value, label: o.label })) : [],
      help_text: f.help ?? null,
      maps_to: f.key,
    })),
  };
}

/**
 * Which product fields a survey's answers fill: its custom questions' maps_to,
 * or the built-in map when it has no custom questions.
 */
export function surveyFieldKeys(
  survey: { id: string; regulation_type: string },
  questions: { survey_id: string; maps_to: string | null }[],
): string[] {
  const own = questions.filter((q) => q.survey_id === survey.id);
  if (own.length > 0) return own.flatMap((q) => (q.maps_to && FIELD_BY_KEY.has(q.maps_to) ? [q.maps_to] : []));
  return Object.values(BUILT_IN_QUESTION_MAP[survey.regulation_type] ?? {});
}
