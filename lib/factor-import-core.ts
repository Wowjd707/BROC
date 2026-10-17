/**
 * Pure mapping + validation for Scope 3 emission-factor library imports.
 *
 * Deploying organizations load the factor set they are licensed for (EPA Supply Chain /
 * USEEIO, DEFRA, EPA WARM, ecoinvent, …). The platform does not bundle these,
 * so this importer is the supported path for getting them in. A cited source
 * and data year are mandatory on every row — an uncited factor is rejected
 * outright rather than silently accepted, because every reported number must
 * trace to its provenance.
 */

import { SCOPE3_METHODS, getScope3Category, type Scope3Method } from './scope3';

export interface MappedFactorRow {
  category_number: number;
  method: Scope3Method;
  activity_key: string;
  label: string | null;
  factor_value: number;
  activity_unit: string;
  region: string | null;
  factor_source: string;
  data_year: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
}

export type FactorRowResult =
  | { ok: true; row: MappedFactorRow }
  | { ok: false; error: string };

export const FACTOR_IMPORT_COLUMNS = [
  'category_number', 'method', 'activity_key', 'label', 'factor_value',
  'activity_unit', 'region', 'factor_source', 'data_year',
  'effective_from', 'effective_to', 'notes',
] as const;

/** Downloadable template with the header and two illustrative rows. */
export function factorImportTemplate(): string {
  const header = FACTOR_IMPORT_COLUMNS.join(',');
  // Placeholder values only — replace with rows from your licensed factor set.
  const example1 = [
    '1', 'spend_based', '331110', 'Iron and steel mills', '0.00000',
    'USD', 'US', 'REPLACE WITH YOUR LICENSED SOURCE', '2022', '2022-01-01', '', 'example row',
  ].join(',');
  const example2 = [
    '6', 'distance_based', 'air_short_haul', 'Air travel (short haul)', '0.00000',
    'passenger-mile', 'GB', 'REPLACE WITH YOUR LICENSED SOURCE', '2024', '2024-01-01', '', 'example row',
  ].join(',');
  return `${header}\n${example1}\n${example2}\n`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function mapFactorCsvRow(row: Record<string, string>): FactorRowResult {
  const categoryNumber = Number((row.category_number ?? '').trim());
  if (!Number.isInteger(categoryNumber) || !getScope3Category(categoryNumber)) {
    return { ok: false, error: `category_number must be an integer 1-15, got "${row.category_number}".` };
  }

  const method = (row.method ?? '').trim().toLowerCase() as Scope3Method;
  if (!SCOPE3_METHODS.includes(method)) {
    return { ok: false, error: `Unknown method "${row.method}". Expected one of: ${SCOPE3_METHODS.join(', ')}.` };
  }

  const activityKey = (row.activity_key ?? '').trim();
  if (!activityKey) return { ok: false, error: 'activity_key is required.' };

  const factorValue = Number((row.factor_value ?? '').trim());
  if (!Number.isFinite(factorValue) || factorValue < 0) {
    return { ok: false, error: `factor_value must be a non-negative number, got "${row.factor_value}".` };
  }

  const activityUnit = (row.activity_unit ?? '').trim();
  if (!activityUnit) return { ok: false, error: 'activity_unit is required (the factor denominator).' };

  const factorSource = (row.factor_source ?? '').trim();
  if (!factorSource) {
    return { ok: false, error: 'factor_source is required — factors must cite their provenance.' };
  }

  const dataYear = Number((row.data_year ?? '').trim());
  if (!Number.isInteger(dataYear) || dataYear < 1900 || dataYear > 2200) {
    return { ok: false, error: `data_year must be a four-digit year, got "${row.data_year}".` };
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
      category_number: categoryNumber,
      method,
      activity_key: activityKey,
      label: (row.label ?? '').trim() || null,
      factor_value: factorValue,
      activity_unit: activityUnit,
      region: (row.region ?? '').trim() || null,
      factor_source: factorSource,
      data_year: dataYear,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      notes: (row.notes ?? '').trim() || null,
    },
  };
}
