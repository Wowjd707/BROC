/**
 * Pure mapping and validation for bulk business-metric-value imports.
 *
 * No Supabase, no I/O, so the rules that decide whether a denominator is
 * accepted are unit-testable. That matters more here than it looks: every
 * intensity figure the organization reports is this number divided into an
 * emissions total, so a value in the wrong year or against the wrong metric
 * quietly distorts a reported KPI rather than failing loudly.
 */

import { parseCsvToObjects } from './csv';

export const BUSINESS_METRIC_IMPORT_COLUMNS = [
  'metric_key', 'reporting_year', 'site', 'as_of_date', 'value', 'notes',
] as const;

export interface MappedMetricValue {
  metric_key: string;
  reporting_year: number;
  /** Null means the figure is organization-wide. */
  site_id: string | null;
  as_of_date: string;
  value: number;
  notes: string | null;
}

export interface MetricImportRowError {
  /** 1-based data-row number, excluding the header. */
  line: number;
  message: string;
}

export interface MetricImportPlan {
  rows: MappedMetricValue[];
  errors: MetricImportRowError[];
  /** Rows that duplicate an existing figure and would replace it. */
  replacing: number;
}

/** What the caller must supply for keys and site names to resolve. */
export interface MetricImportContext {
  /** Active metric keys, with the aggregation each expects. */
  knownMetricKeys: ReadonlySet<string>;
  /** Lowercased site name to id. */
  siteIdByName: ReadonlyMap<string, string>;
  /**
   * Keys of figures already stored, as `${metric_key}|${year}|${site_id ?? ''}|${as_of_date}`.
   * Used to report how many rows replace rather than add.
   */
  existingKeys?: ReadonlySet<string>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function valueKey(v: MappedMetricValue): string {
  return `${v.metric_key}|${v.reporting_year}|${v.site_id ?? ''}|${v.as_of_date}`;
}

/** A template with the header and two example rows: one org-wide, one per-site. */
export function businessMetricImportTemplate(currentYear: number): string {
  const header = BUSINESS_METRIC_IMPORT_COLUMNS.join(',');
  const orgWide = ['revenue', String(currentYear), '', `${currentYear}-12-31`, '48200000', 'Audited FY revenue'].join(',');
  const perSite = ['headcount_fte', String(currentYear), 'Main Plant', `${currentYear}-12-31`, '312', 'Year-end headcount'].join(',');
  return `${header}\n${orgWide}\n${perSite}\n`;
}

/**
 * Map and validate a whole CSV.
 *
 * Errors are collected per row rather than aborting, so a file with three bad
 * lines loads the rest and names the three. Duplicate rows *within the file* are
 * an error, not a last-one-wins: two different figures for the same metric,
 * year, site and date means the person does not yet know which is right, and
 * silently picking one is how a wrong denominator gets reported.
 */
export function planBusinessMetricImport(
  csvText: string,
  ctx: MetricImportContext,
  currentYear: number,
): MetricImportPlan {
  const errors: MetricImportRowError[] = [];
  const rows: MappedMetricValue[] = [];

  const { headers, rows: raw } = parseCsvToObjects(csvText);

  if (raw.length === 0) {
    errors.push({ line: 0, message: 'The file has no data rows.' });
    return { rows, errors, replacing: 0 };
  }

  for (const required of ['metric_key', 'value'] as const) {
    if (!headers.includes(required)) {
      errors.push({ line: 0, message: `Missing required column "${required}".` });
    }
  }
  if (errors.length) return { rows, errors, replacing: 0 };

  const seen = new Map<string, number>();

  raw.forEach((row, i) => {
    const line = i + 1;
    const fail = (message: string) => errors.push({ line, message });

    const metricKey = (row.metric_key ?? '').trim();
    if (!metricKey) return fail('Missing metric_key.');
    if (!ctx.knownMetricKeys.has(metricKey)) {
      return fail(
        `Unknown metric_key "${metricKey}". Define the metric first, or check the spelling — ` +
        `keys are the short form (revenue, headcount_fte), not the label.`,
      );
    }

    // Year defaults to the current reporting year: a file exported for one year
    // often omits it, and guessing the current year is the safe guess.
    const yearRaw = (row.reporting_year ?? '').trim();
    const year = yearRaw ? Number(yearRaw) : currentYear;
    if (!Number.isInteger(year) || year < 1990 || year > currentYear + 1) {
      return fail(`reporting_year "${yearRaw}" is not a plausible year.`);
    }

    // Blank site means organization-wide. That is a real and common case, so it
    // must not read as a missing value.
    const siteName = (row.site ?? '').trim();
    let siteId: string | null = null;
    if (siteName) {
      const resolved = ctx.siteIdByName.get(siteName.toLowerCase());
      if (!resolved) {
        return fail(`Unknown site "${siteName}". Leave the column blank for an organization-wide figure.`);
      }
      siteId = resolved;
    }

    const asOf = (row.as_of_date ?? '').trim() || `${year}-12-31`;
    if (!ISO_DATE.test(asOf)) {
      return fail(`as_of_date "${asOf}" is not YYYY-MM-DD.`);
    }
    // A fiscal year can straddle a calendar boundary, so ±1 rather than exact.
    // Wider than that is a typo worth catching: a 2019 date under FY2026 would
    // otherwise sit in the data forever.
    const asOfYear = Number(asOf.slice(0, 4));
    if (Math.abs(asOfYear - year) > 1) {
      return fail(`as_of_date ${asOf} is not within a year of reporting_year ${year}.`);
    }

    const valueRaw = (row.value ?? '').trim().replace(/,/g, '');
    if (!valueRaw) return fail('Missing value.');
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) return fail(`value "${row.value}" is not a number.`);
    if (value < 0) {
      return fail(`value ${value} is negative. A denominator cannot be negative.`);
    }

    const mapped: MappedMetricValue = {
      metric_key: metricKey,
      reporting_year: year,
      site_id: siteId,
      as_of_date: asOf,
      value,
      notes: (row.notes ?? '').trim() || null,
    };

    const key = valueKey(mapped);
    const firstSeenAt = seen.get(key);
    if (firstSeenAt !== undefined) {
      return fail(
        `duplicates row ${firstSeenAt} — same metric, year, site and date. ` +
        `Remove one; the importer will not pick for you.`,
      );
    }
    seen.set(key, line);
    rows.push(mapped);
  });

  const existing = ctx.existingKeys;
  const replacing = existing ? rows.filter((r) => existing.has(valueKey(r))).length : 0;

  return { rows, errors, replacing };
}
