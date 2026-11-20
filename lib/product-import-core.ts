/**
 * Pure mapping and validation for product / part uploads.
 *
 * The list usually comes from an ERP or customs-broker export and is refreshed
 * by re-uploading it, so a part number already on file is UPDATED rather than
 * skipped (unlike suppliers). Only the cells that are filled in change: a blank
 * cell leaves the stored value alone, so a partial export cannot wipe data.
 *
 * Supplier, business unit and site are matched by name. A name that does not
 * match is an error on that row, not a silent blank — a part quietly detached
 * from its supplier is a part nobody will ask about.
 *
 * Any column headed with a compliance field key (e.g. `ppwr.packaging_weight`)
 * is imported as a value for that field, with source "import". That is how a
 * facility's packaging spreadsheet becomes PPWR data without retyping.
 */

import { normalizeCn } from './compliance-core';
import { FIELD_BY_KEY, normalizeFieldValue } from './compliance-catalog';

export const PRODUCT_EXAMPLE_ROW_NOTE = 'Example — delete this row';

export const PRODUCT_IMPORT_COLUMNS = [
  'part_number', 'description', 'cn_code', 'supplier', 'country_of_origin',
  'business_unit', 'site', 'owner_email', 'notes',
] as const;

export type ProductImportColumn = (typeof PRODUCT_IMPORT_COLUMNS)[number];

export const PRODUCT_COLUMN_LABELS: Record<ProductImportColumn, string> = {
  part_number: 'Part Number',
  description: 'Description',
  cn_code: 'CN Code',
  supplier: 'Supplier',
  country_of_origin: 'Country of Origin',
  business_unit: 'Business Unit',
  site: 'Site',
  owner_email: 'Owner Email',
  notes: 'Notes',
};

export const PRODUCT_IMPORT_HEADERS: string[] = PRODUCT_IMPORT_COLUMNS.map((c) => PRODUCT_COLUMN_LABELS[c]);

const HEADER_ALIASES: Record<string, ProductImportColumn> = {
  part: 'part_number', part_no: 'part_number', sku: 'part_number', item: 'part_number', item_number: 'part_number',
  material_number: 'part_number',
  cn: 'cn_code', hs_code: 'cn_code', hts_code: 'cn_code', commodity_code: 'cn_code', tariff_code: 'cn_code',
  supplier_name: 'supplier', vendor: 'supplier', vendor_name: 'supplier',
  origin: 'country_of_origin', country: 'country_of_origin', coo: 'country_of_origin',
  bu: 'business_unit', owner: 'owner_email',
};

export function canonicalizeProductRow(row: Record<string, string>): Record<string, string> {
  const out = { ...row };
  for (const [alias, canonical] of Object.entries(HEADER_ALIASES)) {
    if (out[alias] !== undefined && out[canonical] === undefined) out[canonical] = out[alias];
  }
  return out;
}

export interface Lookups {
  /** lowercased name → id */
  suppliers: Map<string, string>;
  businessUnits: Map<string, string>;
  sites: Map<string, string>;
  /** lowercased email → user id */
  users: Map<string, string>;
}

/** Only the columns that were filled in; absent keys mean "leave as is". */
export interface MappedProduct {
  partNumber: string;
  fields: Partial<{
    description: string;
    cn_code: string | null;
    supplier_id: string;
    country_of_origin: string;
    business_unit_id: string;
    site_id: string;
    owner_user_id: string;
    notes: string;
  }>;
  values: { field_key: string; value: string; unit: string | null }[];
}

export type ProductRowResult = { ok: true; product: MappedProduct } | { ok: false; error: string };

export function mapProductRow(input: Record<string, string>, lookups: Lookups): ProductRowResult {
  const row = canonicalizeProductRow(input);
  const text = (k: string) => (row[k] ?? '').trim();

  const partNumber = text('part_number');
  if (!partNumber) return { ok: false, error: `Missing ${PRODUCT_COLUMN_LABELS.part_number}.` };

  const fields: MappedProduct['fields'] = {};
  if (text('description')) fields.description = text('description');
  if (text('cn_code')) {
    const cn = normalizeCn(text('cn_code'));
    if (!cn.ok) return { ok: false, error: cn.error };
    fields.cn_code = cn.value;
  }
  if (text('country_of_origin')) fields.country_of_origin = text('country_of_origin');
  if (text('notes')) fields.notes = text('notes');

  const lookup = (col: ProductImportColumn, map: Map<string, string>, what: string) => {
    const v = text(col);
    if (!v) return { ok: true as const, id: undefined };
    const id = map.get(v.toLowerCase());
    return id ? { ok: true as const, id } : { ok: false as const, error: `${what} "${v}" is not on file. Add it first, or fix the spelling.` };
  };
  const supplier = lookup('supplier', lookups.suppliers, 'Supplier');
  if (!supplier.ok) return supplier;
  if (supplier.id) fields.supplier_id = supplier.id;
  const bu = lookup('business_unit', lookups.businessUnits, 'Business unit');
  if (!bu.ok) return bu;
  if (bu.id) fields.business_unit_id = bu.id;
  const site = lookup('site', lookups.sites, 'Site');
  if (!site.ok) return site;
  if (site.id) fields.site_id = site.id;
  const owner = lookup('owner_email', lookups.users, 'Owner');
  if (!owner.ok) return owner;
  if (owner.id) fields.owner_user_id = owner.id;

  const values: MappedProduct['values'] = [];
  for (const [col, raw] of Object.entries(row)) {
    const field = FIELD_BY_KEY.get(col);
    if (!field || !raw?.trim()) continue;
    const norm = normalizeFieldValue(field, raw);
    if (!norm.ok) return { ok: false, error: norm.error };
    values.push({ field_key: field.key, value: norm.value, unit: field.unit ?? null });
  }

  return { ok: true, product: { partNumber, fields, values } };
}

/**
 * Shaped for the shared BulkImportDialog: `imported` is new parts, `skipped`
 * is parts already on file that were updated (the dialog labels it so).
 */
export interface ProductImportSummary {
  imported: number;
  skipped: number;
  failed: number;
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}
