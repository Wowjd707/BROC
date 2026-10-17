/**
 * Staging: turning an uploaded file into reviewable rows.
 *
 * The old importer had one column set, because it only ever loaded emissions.
 * Five families now share this path — emissions, water, waste, social,
 * governance — and they do not share a shape. Emissions carry a scope and a
 * Scope 1 category; the others carry a metric whose family and canonical unit
 * are properties of the metric itself, looked up rather than stated.
 *
 * What they do share is the staging contract: every row keeps the file's own
 * values untouched in `raw`, carries its current values in `resolved`, and
 * explains the difference through adjustments. Nothing here writes an entry.
 *
 * Pure and catalog-injected, like `import-cascade-core`. Header labels are the
 * spaced, capitalized ones an operator sees; `lib/csv.ts` normalizes them back
 * to the snake_case keys these functions read.
 */

import {
  proposeEmissionAdjustments,
  canonicalUnitFor,
  isPointInTime,
  metricsForFamily,
  type EntryFamily,
  type MetricCatalogEntry,
  type ProposedAdjustment,
} from './import-cascade-core';

import { SOURCE_LABELS } from './source-labels';

export type { EntryFamily } from './import-cascade-core';

/**
 * Label → key, built once.
 *
 * The XLSX template puts readable labels in its dropdowns — a list reading
 * `natural_gas` defeats the point of shipping a formatted workbook — while the
 * database stores keys. Rather than translating on the way out of the
 * spreadsheet, staging accepts either, so a hand-written CSV of keys and a
 * filled-in template of labels both load through one path.
 */
const KEY_BY_LABEL: Map<string, string> = new Map(
  Object.entries(SOURCE_LABELS).map(([key, label]) => [label.toLowerCase(), key]),
);

/**
 * Accept a vocabulary value written either way.
 *
 * Matching is case-insensitive and trims, because a value that came back from
 * Excel has often been through a copy-paste and a cell format. An unrecognised
 * value is returned unchanged so the caller can report it as unknown rather
 * than as blank — a row that quietly lost its source type is worse than one
 * that says it does not recognise "Diesel Fuel".
 */
export function canonicalVocabularyValue(
  value: string,
  extraLabels?: Map<string, string>,
): string {
  const trimmed = value.trim();
  if (trimmed === '') return trimmed;
  if (SOURCE_LABELS[trimmed] !== undefined) return trimmed; // already a key
  const lower = trimmed.toLowerCase();
  return extraLabels?.get(lower) ?? KEY_BY_LABEL.get(lower) ?? trimmed;
}

export type RowStatus = 'needs_review' | 'valid' | 'error';

/** A staged row, before anything is written. */
export interface StagedRow {
  lineNumber: number;
  /** The file's own values, keyed by canonical column. Never mutated. */
  raw: Record<string, string>;
  /** Current values, after the cascade and any edits. */
  resolved: Record<string, string | null>;
  status: RowStatus;
  error: string | null;
  /** Unapplied proposals and warnings a reviewer must look at. */
  adjustments: ProposedAdjustment[];
  /** Non-blocking notes — an aggregation trap, a unit the catalog overrode. */
  warnings: string[];
}

// ─── Column sets ─────────────────────────────────────────────────────────────

/**
 * Canonical column keys per family, in the order they appear in the template.
 *
 * Emissions keeps the shape `import-core.ts` already validates, so the two
 * paths cannot drift apart on what a column is called. The other four share one
 * shape, because after `metric` is chosen the family and the unit follow from
 * the catalog — asking for them again would invite a contradiction.
 */
export const FAMILY_COLUMNS: Record<EntryFamily, string[]> = {
  emissions: [
    'site', 'entry_date', 'scope', 'source_type', 'scope1_category',
    'refrigerant_code', 'quantity', 'unit', 'accounting_method',
    'instrument_type', 'supplier_factor', 'notes',
  ],
  water:      ['site', 'entry_date', 'metric', 'quantity', 'unit', 'notes'],
  waste:      ['site', 'entry_date', 'metric', 'quantity', 'unit', 'notes'],
  social:     ['site', 'entry_date', 'metric', 'quantity', 'unit', 'notes'],
  governance: ['site', 'entry_date', 'metric', 'quantity', 'unit', 'notes'],
};

/** What each column is called on screen and in the template. */
export const COLUMN_LABELS: Record<string, string> = {
  site: 'Site',
  entry_date: 'Entry Date',
  scope: 'Scope',
  source_type: 'Source Type',
  scope1_category: 'Scope 1 Category',
  refrigerant_code: 'Refrigerant Code',
  metric: 'Metric',
  quantity: 'Quantity',
  unit: 'Unit',
  accounting_method: 'Accounting Method',
  instrument_type: 'Instrument Type',
  supplier_factor: 'Supplier Factor',
  notes: 'Notes',
};

/**
 * Header spellings that do not survive `lib/csv.ts`'s normalization, which
 * lowercases and turns runs of whitespace into underscores.
 *
 * "Scope 1 Category" becomes `scope_1_category`, not `scope1_category`. Left
 * unmapped, the column would be silently absent and every Scope 1 row would
 * import with no category — no error, because the field is optional. The same
 * trap `import-core.ts` carries, for the same reason.
 */
const HEADER_ALIASES: Record<string, string> = {
  scope_1_category: 'scope1_category',
  date: 'entry_date',
  site_name: 'site',
  metric_name: 'metric',
  source: 'source_type',
};

export function headersFor(family: EntryFamily): string[] {
  return FAMILY_COLUMNS[family].map((c) => COLUMN_LABELS[c] ?? c);
}

/** Fold alias spellings onto canonical keys; an explicit key always wins. */
export function canonicalizeRow(row: Record<string, string>): Record<string, string> {
  const out = { ...row };
  for (const [alias, canonical] of Object.entries(HEADER_ALIASES)) {
    if (out[alias] !== undefined && out[canonical] === undefined) {
      out[canonical] = out[alias];
    }
  }
  return out;
}

// ─── Templates ───────────────────────────────────────────────────────────────

const EXAMPLES: Record<EntryFamily, string[][]> = {
  emissions: [
    ['Main Plant', '2025-01-31', 'scope1', 'natural_gas', 'stationary_combustion', '',
      '1200', 'therms', '', '', '', 'January boiler gas'],
    ['HQ Office', '2025-01-31', 'scope2', 'electricity', '', '',
      '45000', 'kWh', 'location_based', '', '', 'January electricity'],
  ],
  water:      [['Main Plant', '2025-01-31', 'municipal_consumption', '120000', 'gal', 'January municipal water']],
  waste:      [['Main Plant', '2025-01-31', 'non_hazardous_landfilled', '8400', 'kg', 'January landfill']],
  social:     [['Main Plant', '2025-01-31', 'hours_worked', '18400', 'hours', 'January hours']],
  governance: [['', '2025-01-31', 'board_seats', '9', 'seats', 'Board size at year end']],
};

export function templateFor(family: EntryFamily): string {
  const header = headersFor(family).join(',');
  const rows = EXAMPLES[family].map((r) => r.join(','));
  return [header, ...rows].join('\n') + '\n';
}

// ─── Staging ─────────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface StagingContext {
  family: EntryFamily;
  /** Lowercased site name → id. Sites the operator can actually post to. */
  siteIdByName: Map<string, string>;
  catalog: MetricCatalogEntry[];
}

/**
 * Stage one CSV row.
 *
 * Errors are reserved for what cannot be fixed on the review screen — a
 * quantity that is not a number, a date that is not a date. Anything a
 * reviewer can resolve from a dropdown, including an unknown site, comes back
 * as `needs_review` instead, because "Plant 3 (Toledo)" failing to match
 * "Plant 3" is the single most common reason a real export does not load and
 * the least deserving of a re-export.
 */
export function stageRow(
  lineNumber: number,
  input: Record<string, string>,
  ctx: StagingContext,
): StagedRow {
  const raw = canonicalizeRow(input);
  const resolved: Record<string, string | null> = {};
  const adjustments: ProposedAdjustment[] = [];
  const warnings: string[] = [];

  for (const col of FAMILY_COLUMNS[ctx.family]) {
    const v = (raw[col] ?? '').trim();
    resolved[col] = v === '' ? null : v;
  }

  // Site: resolvable in review, so a miss is not an error. Governance metrics
  // are legitimately org-level, which is why 023 made site_id nullable.
  const siteName = resolved.site;
  if (siteName) {
    const id = ctx.siteIdByName.get(siteName.toLowerCase());
    if (id) {
      resolved.site_id = id;
    } else {
      adjustments.push({
        field: 'site',
        from: siteName,
        to: null,
        reason: `No site named "${siteName}". Pick the matching site, or add it first.`,
        requiresConfirmation: true,
      });
    }
  } else if (ctx.family !== 'governance') {
    adjustments.push({
      field: 'site',
      from: null,
      to: null,
      reason: 'Choose a site for this row.',
      requiresConfirmation: true,
    });
  }

  const date = resolved.entry_date;
  if (!date || !ISO_DATE.test(date)) {
    return fail(lineNumber, raw, resolved,
      `Entry Date must be YYYY-MM-DD, got "${date ?? ''}".`);
  }

  const qty = Number(resolved.quantity ?? '');
  if (!Number.isFinite(qty) || qty < 0) {
    return fail(lineNumber, raw, resolved,
      `Quantity must be a number that is not negative, got "${resolved.quantity ?? ''}".`);
  }

  if (ctx.family === 'emissions') {
    const source = resolved.source_type
      ? canonicalVocabularyValue(resolved.source_type)
      : null;
    if (source) resolved.source_type = source;
    if (!source) {
      adjustments.push({
        field: 'source_type', from: null, to: null,
        reason: 'Choose a source type.', requiresConfirmation: true,
      });
    } else {
      adjustments.push(...proposeEmissionAdjustments({
        sourceType: source,
        scope: resolved.scope,
        scope1Category: resolved.scope1_category,
      }));
    }
  } else {
    stageMetricRow(ctx, resolved, adjustments, warnings);
  }

  const status: RowStatus =
    adjustments.some((a) => a.requiresConfirmation) ? 'needs_review' : 'valid';

  return { lineNumber, raw, resolved, status, error: null, adjustments, warnings };
}

/**
 * Resolve the metric for a non-emissions row.
 *
 * The unit is taken from the catalog, never from the family. Migration 023
 * records why: `safety` holds both hours worked and incident counts, so a unit
 * inferred from the family turns a count of injuries into a duration. Where the
 * file states a different unit, that is surfaced rather than silently replaced
 * — a file saying "tonnes" against a metric stored in kg is a real
 * disagreement about the number's magnitude.
 */
function stageMetricRow(
  ctx: StagingContext,
  resolved: Record<string, string | null>,
  adjustments: ProposedAdjustment[],
  warnings: string[],
): void {
  const family = ctx.family as Exclude<EntryFamily, 'emissions'>;
  const metric = resolved.metric;

  if (!metric) {
    adjustments.push({
      field: 'metric', from: null, to: null,
      reason: 'Choose a metric.', requiresConfirmation: true,
    });
    return;
  }

  const available = metricsForFamily(family, ctx.catalog);
  // The catalog's labels are the ones the template's dropdown offers, so they
  // have to resolve here too. Built per call because the catalog is injected.
  const byLabel = new Map(available.map((m) => [m.label.toLowerCase(), m.sourceType]));
  const canonicalMetric = canonicalVocabularyValue(metric, byLabel);
  const hit = available.find((m) => m.sourceType === canonicalMetric);
  if (hit) resolved.metric = hit.sourceType;

  if (!hit) {
    adjustments.push({
      field: 'metric',
      from: metric,
      to: null,
      reason: `"${metric}" is not a ${family} metric. Pick one from the list.`,
      requiresConfirmation: true,
    });
    return;
  }

  resolved.metric_type = hit.metricType;

  const canonical = canonicalUnitFor(hit.metricType, hit.sourceType, ctx.catalog);
  const stated = resolved.unit;
  if (canonical && stated && stated !== canonical) {
    adjustments.push({
      field: 'unit',
      from: stated,
      to: null,
      reason:
        `${hit.label} is stored in ${canonical}, and this row says ${stated}. ` +
        'Confirm the figure is in the stored unit, or convert it — the two differ by more than a label.',
      requiresConfirmation: true,
    });
  } else if (canonical && !stated) {
    adjustments.push({
      field: 'unit',
      from: null,
      to: canonical,
      reason: `${hit.label} is stored in ${canonical}.`,
      requiresConfirmation: false,
    });
  }

  if (isPointInTime(hit.metricType, hit.sourceType, ctx.catalog)) {
    warnings.push(
      `${hit.label} is a point-in-time figure, not a flow. Twelve monthly rows ` +
      'do not add up to a year — reporting takes the latest reading in the period.',
    );
  }
}

function fail(
  lineNumber: number,
  raw: Record<string, string>,
  resolved: Record<string, string | null>,
  error: string,
): StagedRow {
  return {
    lineNumber, raw, resolved,
    status: 'error', error, adjustments: [], warnings: [],
  };
}

// ─── Applying a reviewer's decision ──────────────────────────────────────────

/** One recorded change, ready to be written to `import_row_adjustments`. */
export interface RecordedAdjustment {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  origin: 'auto' | 'user';
  reason: string | null;
}

/**
 * Apply a value to a staged row and produce the record of having done so.
 *
 * Returns null when nothing changed. A no-op adjustment is refused by a CHECK
 * on the table anyway, and a trail full of them hides the real ones.
 */
export function applyValue(
  row: StagedRow,
  field: string,
  value: string | null,
  origin: 'auto' | 'user',
  reason: string | null,
): RecordedAdjustment | null {
  const before = row.resolved[field] ?? null;
  const after = value === '' ? null : value;
  if (before === after) return null;

  row.resolved[field] = after;
  row.adjustments = row.adjustments.filter((a) => a.field !== field);

  return { field, oldValue: before, newValue: after, origin, reason };
}

/**
 * Whether a row may be committed.
 *
 * A row is blocked only by an unconfirmed proposal or a hard error — warnings
 * never block, because a point-in-time metric recorded monthly is legitimate
 * data and refusing it would teach people to work around the importer.
 */
export function isCommittable(row: StagedRow): boolean {
  if (row.status === 'error') return false;
  return !row.adjustments.some((a) => a.requiresConfirmation);
}
