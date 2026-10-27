/**
 * Pure mapping + validation for organization-scoped custom emission factor
 * imports.
 *
 * Custom factors override the global reference tables (EPA Scope 1, eGRID
 * Scope 2, IPCC refrigerant GWPs) for one organization, versioned by effective
 * date. Loading a whole vintage by hand through the form is impractical, so
 * this is the bulk path — and it applies exactly the same rules the form does:
 * a cited `factor_source` and `data_year` are mandatory, because a reported
 * number that traces back to an uncited factor is not assurable.
 *
 * Two failure modes get structural guards rather than trust:
 *
 *   • A mis-stated unit. MMBtu and kWh differ by a factor of ~293, so a
 *     Scope 1 factor labelled kWh is not a cosmetic error — it is a reported
 *     figure wrong by two orders of magnitude. The unit is therefore DERIVED
 *     from the category, and a file that states a contradicting one is
 *     rejected rather than silently corrected.
 *
 *   • An unresolvable key. A factor keyed to a fuel, refrigerant or site that
 *     does not exist never resolves at calculation time — it sits in the table
 *     looking applied while every entry silently uses the reference factor.
 *     Unknown keys are hard errors.
 *
 * Pure and dependency-free so it is unit-testable.
 */

import { isSiteKeyed, type CustomFactorCategory } from './custom-factors-core';

export const CUSTOM_FACTOR_CATEGORIES: readonly CustomFactorCategory[] = [
  'scope1', 'scope2_location', 'scope2_residual', 'scope2_heat', 'refrigerant',
] as const;

/**
 * The normalized denominator each category's factor is expressed per. Derived
 * from the category, never read from the file — see the unit note above.
 */
export const CATEGORY_UNIT: Record<CustomFactorCategory, string> = {
  scope1: 'MMBtu',
  scope2_location: 'kWh',
  scope2_residual: 'kWh',
  scope2_heat: 'kWh',
  refrigerant: 'kg',
};

/** What `factor_key` names, per category — used in error messages. */
const CATEGORY_KEY_LABEL: Record<CustomFactorCategory, string> = {
  scope1: 'fuel type',
  scope2_location: 'site name',
  scope2_residual: 'site name',
  scope2_heat: 'site name',
  refrigerant: 'refrigerant code',
};

export interface MappedCustomFactorRow {
  factor_category: CustomFactorCategory;
  factor_key: string;
  label: string | null;
  co2e_factor: number;
  unit: string;
  factor_source: string;
  data_year: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
}

export type CustomFactorRowResult =
  | { ok: true; row: MappedCustomFactorRow }
  | { ok: false; error: string };

export const CUSTOM_FACTOR_IMPORT_COLUMNS = [
  'factor_category', 'factor_key', 'label', 'co2e_factor', 'unit',
  'factor_source', 'data_year', 'effective_from', 'effective_to', 'notes',
] as const;

// ─── Key resolution ──────────────────────────────────────────────────────────

/**
 * Fold a key to a comparison form: lowercase, with every separator and space
 * removed. Lets `Natural Gas`, `natural_gas` and `NATURAL-GAS` all find the
 * same fuel, and `R410A` find `R-410A`, without the importer having to invent
 * per-category rewrite rules. The canonical value always comes back from the
 * lookup, so a fold that matches the wrong thing is impossible — it either
 * hits a real key or it is an error.
 */
export function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Build a lookup from a list of (key, value) pairs. Exact matches are
 * registered after folded ones so an exact hit always wins a collision.
 */
export function buildKeyLookup(entries: { key: string; value: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of entries) map.set(normalizeKey(e.key), e.value);
  for (const e of entries) map.set(e.key, e.value);
  return map;
}

export function resolveKey(lookup: ReadonlyMap<string, string>, raw: string): string | null {
  return lookup.get(raw) ?? lookup.get(normalizeKey(raw)) ?? null;
}

export interface FactorKeyLookups {
  /** fuel_type → fuel_type, from `scope1_emission_factors`. */
  fuelTypes: ReadonlyMap<string, string>;
  /** refrigerant_code → refrigerant_code, from `refrigerant_factors`. */
  refrigerantCodes: ReadonlyMap<string, string>;
  /** Site name → site **id**: the stored key for every site-keyed category is the id. */
  siteIdByName: ReadonlyMap<string, string>;
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Downloadable template with the header and one row per category. */
export function customFactorImportTemplate(): string {
  const header = CUSTOM_FACTOR_IMPORT_COLUMNS.join(',');
  // Placeholder values — replace with your own measured or supplier-specific
  // factors and their real provenance.
  const example1 = [
    'scope1', 'natural_gas', 'Metered site gas', '52.100000', 'MMBtu',
    'REPLACE WITH YOUR SOURCE', '2025', '2025-01-01', '', 'example row',
  ].join(',');
  const example2 = [
    'scope2_location', 'REPLACE WITH A SITE NAME', 'Contracted grid mix', '0.210000', 'kWh',
    'REPLACE WITH YOUR SOURCE', '2025', '2025-01-01', '', 'example row',
  ].join(',');
  const example3 = [
    'refrigerant', 'R-410A', '', '2256.000000', 'kg',
    'REPLACE WITH YOUR SOURCE', '2025', '2025-01-01', '', 'example row',
  ].join(',');
  return `${header}\n${example1}\n${example2}\n${example3}\n`;
}

export function mapCustomFactorCsvRow(
  row: Record<string, string>,
  lookups: FactorKeyLookups,
): CustomFactorRowResult {
  const categoryRaw = (row.factor_category ?? '').trim().toLowerCase();
  if (!(CUSTOM_FACTOR_CATEGORIES as readonly string[]).includes(categoryRaw)) {
    return {
      ok: false,
      error: `factor_category must be one of: ${CUSTOM_FACTOR_CATEGORIES.join(', ')}. Got "${row.factor_category ?? ''}".`,
    };
  }
  const category = categoryRaw as CustomFactorCategory;

  const keyRaw = (row.factor_key ?? '').trim();
  if (!keyRaw) {
    return { ok: false, error: `factor_key is required — the ${CATEGORY_KEY_LABEL[category]} this factor applies to.` };
  }

  const resolvedKey = resolveFactorKey(category, keyRaw, lookups);
  if (!resolvedKey.ok) return resolvedKey;

  const factorRaw = (row.co2e_factor ?? '').trim();
  const factorValue = Number(factorRaw);
  if (!factorRaw || !Number.isFinite(factorValue) || factorValue < 0) {
    return { ok: false, error: `co2e_factor must be a non-negative number, got "${row.co2e_factor ?? ''}".` };
  }

  // The unit is derived, not read. A stated one is accepted only as
  // confirmation; a contradiction means the file and the platform disagree
  // about what the number means, which is never safe to resolve silently.
  const unit = CATEGORY_UNIT[category];
  const unitRaw = (row.unit ?? '').trim();
  if (unitRaw && unitRaw.toLowerCase() !== unit.toLowerCase()) {
    return {
      ok: false,
      error: `unit for ${category} factors is kg CO₂e per ${unit}, but the file says "${unitRaw}". Correct the column or leave it blank — a factor stated per the wrong denominator would be wrong by orders of magnitude.`,
    };
  }

  const factorSource = (row.factor_source ?? '').trim();
  if (!factorSource) {
    return { ok: false, error: 'factor_source is required — factors must cite their provenance.' };
  }

  const dataYear = Number((row.data_year ?? '').trim());
  if (!Number.isInteger(dataYear) || dataYear < 1900 || dataYear > 2200) {
    return { ok: false, error: `data_year must be a four-digit year, got "${row.data_year ?? ''}".` };
  }

  const effectiveFromRaw = (row.effective_from ?? '').trim();
  const effectiveFrom = effectiveFromRaw || '1900-01-01';
  if (!ISO_DATE.test(effectiveFrom)) {
    return { ok: false, error: `effective_from must be YYYY-MM-DD, got "${effectiveFromRaw}".` };
  }

  const effectiveToRaw = (row.effective_to ?? '').trim();
  let effectiveTo: string | null = null;
  if (effectiveToRaw) {
    if (!ISO_DATE.test(effectiveToRaw)) {
      return { ok: false, error: `effective_to must be YYYY-MM-DD, got "${effectiveToRaw}".` };
    }
    if (effectiveToRaw <= effectiveFrom) {
      return { ok: false, error: 'effective_to must be after effective_from.' };
    }
    effectiveTo = effectiveToRaw;
  }

  return {
    ok: true,
    row: {
      factor_category: category,
      factor_key: resolvedKey.key,
      label: (row.label ?? '').trim() || null,
      co2e_factor: factorValue,
      unit,
      factor_source: factorSource,
      data_year: dataYear,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      notes: (row.notes ?? '').trim() || null,
    },
  };
}

function resolveFactorKey(
  category: CustomFactorCategory,
  raw: string,
  lookups: FactorKeyLookups,
): { ok: true; key: string } | { ok: false; error: string } {
  if (isSiteKeyed(category)) {
    const siteId = resolveKey(lookups.siteIdByName, raw);
    if (!siteId) {
      return { ok: false, error: `No active site named "${raw}". Site-level Scope 2 factors are keyed to a site, so the name must match one of your sites.` };
    }
    return { ok: true, key: siteId };
  }

  const lookup = category === 'scope1' ? lookups.fuelTypes : lookups.refrigerantCodes;
  const resolved = resolveKey(lookup, raw);
  if (!resolved) {
    const known = Array.from(new Set(lookup.values())).sort();
    return {
      ok: false,
      error: `Unknown ${CATEGORY_KEY_LABEL[category]} "${raw}". A factor keyed to something the platform does not recognise would never be applied. Known values: ${known.join(', ')}.`,
    };
  }
  return { ok: true, key: resolved };
}

// ─── Ambiguity detection ─────────────────────────────────────────────────────

export interface WindowKey {
  factor_category: string;
  factor_key: string;
  effective_from: string;
}

/** Identity of one versioned factor window, for collision checks. */
export function windowKeyOf(row: WindowKey): string {
  return `${row.factor_category}::${row.factor_key}::${row.effective_from}`;
}

/**
 * Find rows that define the same (category, key, effective_from) twice.
 *
 * Two windows opening on the same date for the same key are genuinely
 * ambiguous: `pickEffectiveFactor` breaks ties on the latest `effective_from`,
 * so with equal dates the winner falls out of row order — meaning the same file
 * could produce different reported numbers on different days. That is a defect
 * worth failing the import over.
 *
 * Overlapping windows with DIFFERENT start dates are not flagged: superseding a
 * vintage by importing it with a later `effective_from` is the documented
 * workflow, and the later start deterministically wins.
 */
export function findDuplicateWindows(
  rows: { row: WindowKey; line: number }[],
): { line: number; message: string }[] {
  const firstSeen = new Map<string, number>();
  const errors: { line: number; message: string }[] = [];

  for (const { row, line } of rows) {
    const key = windowKeyOf(row);
    const prior = firstSeen.get(key);
    if (prior === undefined) {
      firstSeen.set(key, line);
      continue;
    }
    errors.push({
      line,
      message: `Duplicates row ${prior}: the same factor already opens a window on ${row.effective_from}. Which one applies would depend on row order, so give them different effective_from dates.`,
    });
  }

  return errors;
}
