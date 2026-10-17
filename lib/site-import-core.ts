/**
 * Pure mapping and validation for bulk site uploads.
 *
 * Two fields here are not the harmless metadata they look like, and both are
 * called out in the template's instructions as well as here.
 *
 * **Zip code decides the electricity factor.** getScope2LocationFactor() resolves
 * zip → eGRID subregion → national average, in that order. A site with no zip,
 * or a zip the factor set does not cover, therefore still calculates — it just
 * calculates against the national average, which for a plant on a coal-heavy or
 * a hydro-heavy grid is wrong by a wide margin and wrong silently.
 *
 * **Ownership and control decide whether a site counts at all.** Which of the
 * two is used depends on the organization's consolidation approach: equity share
 * reads ownership_percent, financial and operational control read is_controlled
 * and take either everything or nothing. Blank means 100% and controlled, which
 * matches the column defaults and the behaviour before migration 028 — right for
 * a wholly-owned group, wrong for a joint venture.
 */

export const SITE_IMPORT_COLUMNS = [
  'name', 'site_type', 'address', 'city', 'state', 'zip_code', 'country',
  'floor_area_sqft', 'business_unit', 'ownership_percent', 'is_controlled',
] as const;

export type SiteImportColumn = (typeof SITE_IMPORT_COLUMNS)[number];

export const SITE_COLUMN_LABELS: Record<SiteImportColumn, string> = {
  name: 'Site Name',
  site_type: 'Site Type',
  address: 'Address',
  city: 'City',
  state: 'State',
  zip_code: 'Zip Code',
  country: 'Country',
  floor_area_sqft: 'Floor Area Sqft',
  business_unit: 'Business Unit',
  ownership_percent: 'Ownership Percent',
  is_controlled: 'Operated Or Controlled',
};

export const SITE_IMPORT_HEADERS: string[] =
  SITE_IMPORT_COLUMNS.map((c) => SITE_COLUMN_LABELS[c]);

/** The marker on the template's example row. Shared with the generator. */
export const SITE_EXAMPLE_ROW_NOTE = 'Example row — delete before uploading';

/** Matches the CHECK on sites.site_type. */
export const SITE_TYPES = ['office', 'manufacturing', 'warehouse', 'data_center', 'other'] as const;

/** What the dropdown shows, and what the mapper accepts back. */
export const SITE_TYPE_LABELS: Record<string, string> = {
  office: 'Office',
  manufacturing: 'Manufacturing',
  warehouse: 'Warehouse',
  data_center: 'Data Center',
  other: 'Other',
};

const SITE_TYPE_BY_LABEL = new Map(
  Object.entries(SITE_TYPE_LABELS).map(([key, label]) => [label.toLowerCase(), key]),
);

/**
 * Header spellings that do not survive `lib/csv.ts`, which lowercases and turns
 * whitespace runs into underscores, plus the shorthand people type.
 *
 * Exactly two of the template's own labels fail to round-trip: "Site Name"
 * becomes site_name rather than name, and "Operated Or Controlled" becomes
 * operated_or_controlled rather than is_controlled. The first would fail loudly,
 * since name is required. The second would not — it would default every site to
 * controlled, which under a control-based consolidation approach decides whether
 * a joint venture contributes everything or nothing. That is the one this map
 * exists for; the rest are convenience.
 */
const HEADER_ALIASES: Record<string, SiteImportColumn> = {
  site_name: 'name',
  site: 'name',
  type: 'site_type',
  zip: 'zip_code',
  postal_code: 'zip_code',
  floor_area: 'floor_area_sqft',
  floor_area_sq_ft: 'floor_area_sqft',
  square_feet: 'floor_area_sqft',
  sqft: 'floor_area_sqft',
  business_unit_name: 'business_unit',
  ownership: 'ownership_percent',
  operated_or_controlled: 'is_controlled',
  controlled: 'is_controlled',
};

export function canonicalizeSiteRow(row: Record<string, string>): Record<string, string> {
  const out = { ...row };
  for (const [alias, canonical] of Object.entries(HEADER_ALIASES)) {
    if (out[alias] !== undefined && out[canonical] === undefined) {
      out[canonical] = out[alias];
    }
  }
  return out;
}

export interface MappedSite {
  name: string;
  siteType: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string;
  floorAreaSqft: number | null;
  /** The name as written; the server resolves it to a business_unit_id. */
  businessUnitName: string | null;
  ownershipPercent: number;
  isControlled: boolean;
  /** Non-blocking things the operator should see afterwards. */
  warnings: string[];
}

export type SiteRowResult =
  | { ok: true; site: MappedSite }
  | { ok: false; error: string }
  | { ok: false; error: string; duplicate: true };

/** Yes / No / TRUE / 1 — whatever a spreadsheet or a person actually produces. */
function parseBoolean(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (['yes', 'y', 'true', 't', '1'].includes(v)) return true;
  if (['no', 'n', 'false', 'f', '0'].includes(v)) return false;
  return null;
}

export function mapSiteRow(
  input: Record<string, string>,
  existingNames: Set<string>,
): SiteRowResult {
  const row = canonicalizeSiteRow(input);
  const text = (key: SiteImportColumn): string => (row[key] ?? '').trim();
  const warnings: string[] = [];

  const name = text('name');
  if (!name) return { ok: false, error: `Missing ${SITE_COLUMN_LABELS.name}.` };

  if (existingNames.has(name.toLowerCase())) {
    return { ok: false, duplicate: true, error: `${name} is already one of your sites.` };
  }

  // Site type accepts the label the dropdown offers or the stored key, and
  // defaults rather than failing — the column has a default too, and refusing a
  // row over a blank type would block an otherwise complete site.
  const typeRaw = text('site_type');
  let siteType = 'office';
  if (typeRaw) {
    const lower = typeRaw.toLowerCase();
    const resolved = (SITE_TYPES as readonly string[]).includes(lower)
      ? lower
      : SITE_TYPE_BY_LABEL.get(lower);
    if (!resolved) {
      return {
        ok: false,
        error: `Unknown ${SITE_COLUMN_LABELS.site_type} "${typeRaw}". Expected one of: `
          + Object.values(SITE_TYPE_LABELS).join(', ') + '.',
      };
    }
    siteType = resolved;
  }

  let floorAreaSqft: number | null = null;
  const areaRaw = text('floor_area_sqft');
  if (areaRaw) {
    const parsed = Number(areaRaw.replace(/[,\s]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        ok: false,
        error: `${SITE_COLUMN_LABELS.floor_area_sqft} must be a positive number, got "${areaRaw}".`,
      };
    }
    floorAreaSqft = parsed;
  }

  let ownershipPercent = 100;
  const ownRaw = text('ownership_percent');
  if (ownRaw) {
    const parsed = Number(ownRaw.replace(/[%\s]/g, ''));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      return {
        ok: false,
        error: `${SITE_COLUMN_LABELS.ownership_percent} must be between 0 and 100, got "${ownRaw}".`,
      };
    }
    ownershipPercent = parsed;
  }

  let isControlled = true;
  const ctrlRaw = text('is_controlled');
  if (ctrlRaw) {
    const parsed = parseBoolean(ctrlRaw);
    if (parsed === null) {
      return {
        ok: false,
        error: `${SITE_COLUMN_LABELS.is_controlled} must be Yes or No, got "${ctrlRaw}".`,
      };
    }
    isControlled = parsed;
  }

  const zipCode = text('zip_code');
  const country = text('country') || 'USA';

  // Warned, never blocked. A site with no zip still calculates — against the
  // national average — and that is a judgement for the person who knows whether
  // this site's grid resembles the national one, not for an importer.
  if (!zipCode && country.toUpperCase() === 'USA') {
    warnings.push(
      `${name}: no ${SITE_COLUMN_LABELS.zip_code}, so electricity will use the national average `
      + 'rather than this site’s grid.',
    );
  }
  if (!floorAreaSqft) {
    warnings.push(`${name}: no ${SITE_COLUMN_LABELS.floor_area_sqft}, so per-area intensity cannot be computed.`);
  }
  // Only worth saying when it departs from the default, because that is when
  // the consolidation approach starts changing the answer.
  if (ownershipPercent !== 100 || !isControlled) {
    warnings.push(
      `${name}: recorded at ${ownershipPercent}% ownership and `
      + `${isControlled ? 'controlled' : 'not controlled'}. Which of those counts depends on your `
      + 'consolidation approach in Settings.',
    );
  }

  return {
    ok: true,
    site: {
      name,
      siteType,
      address: text('address') || null,
      city: text('city') || null,
      state: text('state') || null,
      zipCode: zipCode || null,
      country,
      floorAreaSqft,
      businessUnitName: text('business_unit') || null,
      ownershipPercent,
      isControlled,
      warnings,
    },
  };
}

export interface SiteImportSummary {
  imported: number;
  /** Already one of your sites; not an error, and not re-added. */
  skipped: number;
  failed: number;
  errors: { line: number; message: string }[];
  /** Things worth seeing that did not stop a row landing. */
  warnings: { line: number; message: string }[];
}
