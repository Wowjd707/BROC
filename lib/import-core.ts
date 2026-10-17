/**
 * Pure mapping + validation for bulk emission-entry imports. No server or
 * Supabase imports, so it is unit-testable. The server orchestrator
 * (lib/import.ts) resolves site names to ids, then hands each mapped input to
 * the same authoritative createEmissionEntry path used by the single-entry UI.
 */

export interface MappedEmissionRow {
  siteId: string;
  scope: 'scope1' | 'scope2';
  sourceType: string;
  scope1Category?: string;
  refrigerantCode?: string;
  quantity: number;
  unit: string;
  entryDate: string;
  accountingMethod?: 'location_based' | 'market_based';
  instrumentType?: string;
  supplierFactor?: number;
  notes?: string;
}

export type RowResult =
  | { ok: true; input: MappedEmissionRow }
  | { ok: false; error: string };

export interface ImportRowError {
  line: number; // 1-based data-row number (excludes the header)
  message: string;
}

export interface ImportSummary {
  imported: number;
  failed: number;
  errors: ImportRowError[];
}

/** Columns accepted in the emission import CSV (normalized header keys). */
export const EMISSION_IMPORT_COLUMNS = [
  'site', 'entry_date', 'scope', 'source_type', 'scope1_category', 'refrigerant_code',
  'quantity', 'unit', 'accounting_method', 'instrument_type',
  'supplier_factor', 'notes',
] as const;

type EmissionImportColumn = (typeof EMISSION_IMPORT_COLUMNS)[number];

/**
 * What each column is called on screen and in the downloaded template.
 *
 * The keys above stay snake_case because that is what `parseCsvToObjects`
 * produces and what every validation branch reads. These are the labels a
 * person sees. Keeping the two apart means the header row can be made readable
 * without the parser or the tests needing to know.
 */
export const EMISSION_IMPORT_COLUMN_LABELS: Record<EmissionImportColumn, string> = {
  site: 'Site',
  entry_date: 'Entry Date',
  scope: 'Scope',
  source_type: 'Source Type',
  scope1_category: 'Scope 1 Category',
  refrigerant_code: 'Refrigerant Code',
  quantity: 'Quantity',
  unit: 'Unit',
  accounting_method: 'Accounting Method',
  instrument_type: 'Instrument Type',
  supplier_factor: 'Supplier Factor',
  notes: 'Notes',
};

/** The header row as written into the template. */
export const EMISSION_IMPORT_HEADERS: string[] =
  EMISSION_IMPORT_COLUMNS.map((c) => EMISSION_IMPORT_COLUMN_LABELS[c]);

/**
 * Header spellings that do not survive the round trip through
 * `parseCsvToObjects`, which lowercases and turns runs of whitespace into
 * underscores.
 *
 * "Scope 1 Category" normalizes to `scope_1_category`, not `scope1_category`,
 * so the label we now ship in the template would not have matched the key the
 * validator reads — the column would have been silently absent and every
 * Scope 1 row would have imported with no category. Mapping the variants is
 * cheaper than constraining the labels to whatever happens to round-trip.
 *
 * Old files written against the previous snake_case header row still parse:
 * those spellings already are the canonical keys.
 */
const HEADER_ALIASES: Record<string, EmissionImportColumn> = {
  scope_1_category: 'scope1_category',
  scope1category: 'scope1_category',
  date: 'entry_date',
  site_name: 'site',
};

/**
 * Fold alias spellings onto canonical keys. An explicit key already present
 * wins, so a file carrying both spellings is not silently reinterpreted.
 */
function canonicalizeRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...row };
  for (const [alias, canonical] of Object.entries(HEADER_ALIASES)) {
    if (out[alias] !== undefined && out[canonical] === undefined) {
      out[canonical] = out[alias];
    }
  }
  return out;
}

/** Name a column the way the operator's file and the template name it. */
function label(column: EmissionImportColumn): string {
  return EMISSION_IMPORT_COLUMN_LABELS[column];
}

const SCOPE1_CATEGORY_VALUES = [
  'stationary_combustion', 'mobile_combustion', 'process_emissions', 'fugitive_emissions',
];

/** A ready-to-download CSV template with a header row and one example line. */
export function emissionImportTemplate(): string {
  const header = EMISSION_IMPORT_HEADERS.join(',');
  const example = [
    'Main Plant', '2025-01-31', 'scope1', 'natural_gas', 'stationary_combustion', '',
    '1200', 'therms', '', '', '', 'January boiler gas',
  ].join(',');
  const example2 = [
    'HQ Office', '2025-01-31', 'scope2', 'electricity', '', '',
    '45000', 'kWh', 'location_based', '', '', 'January electricity',
  ].join(',');
  return `${header}\n${example}\n${example2}\n`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Map one normalized CSV row to an emission entry input. `siteIdByName` maps a
 * lowercased site name to its id. Returns a validation error string (not a
 * factor/CO₂e — those are computed server-side downstream).
 */
export function mapEmissionCsvRow(
  row: Record<string, string>,
  siteIdByName: Map<string, string>,
): RowResult {
  row = canonicalizeRow(row);

  const siteName = (row.site ?? '').trim();
  if (!siteName) return { ok: false, error: `Missing ${label('site')}.` };
  const siteId = siteIdByName.get(siteName.toLowerCase());
  if (!siteId) return { ok: false, error: `Unknown ${label('site')}: "${siteName}".` };

  const entryDate = (row.entry_date ?? '').trim();
  if (!ISO_DATE.test(entryDate)) return { ok: false, error: `Invalid ${label('entry_date')} (expected YYYY-MM-DD): "${entryDate}".` };

  const scope = (row.scope ?? '').trim().toLowerCase();
  if (scope !== 'scope1' && scope !== 'scope2') {
    return { ok: false, error: `${label('scope')} must be scope1 or scope2, got "${row.scope}".` };
  }

  const sourceType = (row.source_type ?? '').trim();
  if (!sourceType) return { ok: false, error: `Missing ${label('source_type')}.` };

  const quantity = Number((row.quantity ?? '').trim());
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: `${label('quantity')} must be a positive number, got "${row.quantity}".` };
  }

  const unit = (row.unit ?? '').trim();
  if (!unit) return { ok: false, error: `Missing ${label('unit')}.` };

  const isRefrigerant = sourceType === 'refrigerants';
  const refrigerantCode = (row.refrigerant_code ?? '').trim();
  if (isRefrigerant && !refrigerantCode) {
    return { ok: false, error: `${label('refrigerant_code')} is required when ${label('source_type')} is refrigerants.` };
  }

  const scope1CategoryRaw = (row.scope1_category ?? '').trim().toLowerCase();
  if (scope1CategoryRaw && !SCOPE1_CATEGORY_VALUES.includes(scope1CategoryRaw)) {
    return {
      ok: false,
      error: `Unknown ${label('scope1_category')} "${row.scope1_category}". Expected one of: ${SCOPE1_CATEGORY_VALUES.join(', ')}.`,
    };
  }

  let accountingMethod: 'location_based' | 'market_based' | undefined;
  const am = (row.accounting_method ?? '').trim().toLowerCase();
  if (am) {
    if (am !== 'location_based' && am !== 'market_based') {
      return { ok: false, error: `${label('accounting_method')} must be location_based or market_based, got "${row.accounting_method}".` };
    }
    accountingMethod = am;
  }

  let supplierFactor: number | undefined;
  const sf = (row.supplier_factor ?? '').trim();
  if (sf) {
    const parsed = Number(sf);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { ok: false, error: `${label('supplier_factor')} must be a non-negative number, got "${sf}".` };
    }
    supplierFactor = parsed;
  }

  return {
    ok: true,
    input: {
      siteId,
      scope,
      sourceType,
      scope1Category: scope === 'scope1' ? (scope1CategoryRaw || undefined) : undefined,
      refrigerantCode: isRefrigerant ? refrigerantCode : undefined,
      quantity,
      unit,
      entryDate,
      accountingMethod,
      instrumentType: (row.instrument_type ?? '').trim() || undefined,
      supplierFactor,
      notes: (row.notes ?? '').trim() || undefined,
    },
  };
}
