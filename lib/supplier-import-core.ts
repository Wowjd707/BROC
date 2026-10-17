/**
 * Pure mapping and validation for bulk supplier uploads.
 *
 * Simpler than the metrics importer on purpose. A supplier row carries no
 * emission factor, no scope and no unit, so there is nothing here that can
 * quietly land in the wrong total — which is why this does not go through the
 * staged review pipeline. Validate, insert, report what happened.
 *
 * What it does need is duplicate handling. `suppliers` has no unique constraint
 * on name or email, so re-uploading the same list would silently double it, and
 * a duplicated supplier splits that supplier's survey history in two.
 */

/**
 * The marker on the template's example row.
 *
 * Lives here rather than beside the generator because the importer has to
 * recognise it too, and the importer must not pull in a server-only module
 * carrying a spreadsheet library. A test keeps the two in step.
 */
export const SUPPLIER_EXAMPLE_ROW_NOTE = 'Example — delete this row';

export const SUPPLIER_IMPORT_COLUMNS = [
  'name', 'contact_name', 'contact_email', 'country', 'industry', 'tier',
  'spend_usd', 'notes',
] as const;

export type SupplierImportColumn = (typeof SUPPLIER_IMPORT_COLUMNS)[number];

/** What each column is called in the template and in the row errors. */
export const SUPPLIER_COLUMN_LABELS: Record<SupplierImportColumn, string> = {
  name: 'Supplier Name',
  contact_name: 'Contact Name',
  contact_email: 'Contact Email',
  country: 'Country',
  industry: 'Industry',
  tier: 'Tier',
  spend_usd: 'Annual Spend USD',
  notes: 'Notes',
};

export const SUPPLIER_IMPORT_HEADERS: string[] =
  SUPPLIER_IMPORT_COLUMNS.map((c) => SUPPLIER_COLUMN_LABELS[c]);

/**
 * Header spellings that do not survive `lib/csv.ts`, which lowercases and turns
 * whitespace runs into underscores, plus the ones people actually type.
 *
 * "Annual Spend USD" normalizes to `annual_spend_usd`, not `spend_usd`, so
 * without this the column would be silently absent — and spend is optional, so
 * nothing would complain. Every supplier would import with no spend and the
 * spend-weighted views would be empty for no visible reason.
 */
const HEADER_ALIASES: Record<string, SupplierImportColumn> = {
  annual_spend_usd: 'spend_usd',
  spend: 'spend_usd',
  supplier_name: 'name',
  supplier: 'name',
  email: 'contact_email',
  contact: 'contact_name',
  tier_level: 'tier',
};

export function canonicalizeSupplierRow(
  row: Record<string, string>,
): Record<string, string> {
  const out = { ...row };
  for (const [alias, canonical] of Object.entries(HEADER_ALIASES)) {
    if (out[alias] !== undefined && out[canonical] === undefined) {
      out[canonical] = out[alias];
    }
  }
  return out;
}

export interface MappedSupplier {
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  country: string | null;
  industry: string | null;
  tier: number | null;
  spendUsd: number | null;
  notes: string | null;
}

export type SupplierRowResult =
  | { ok: true; supplier: MappedSupplier }
  | { ok: false; error: string }
  /** Valid, but this supplier is already on the list. */
  | { ok: false; error: string; duplicate: true };

/**
 * Deliberately permissive about the shape of an email.
 *
 * A supplier contact address is typed by a human from a business card or an
 * email footer, and the cost of the two failure modes is not symmetric:
 * rejecting a valid address blocks a real supplier from being asked, while
 * accepting a malformed one produces a bounce that the invitation flow already
 * reports. So this catches the obvious mistakes — no @, spaces, no dot in the
 * domain — and lets the mailer be the judge of the rest.
 */
function looksLikeEmail(value: string): boolean {
  if (/\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

/**
 * Map one row.
 *
 * `existingNames` and `existingEmails` are the lowercased values already on the
 * organization's list. A row matching either comes back as a duplicate rather
 * than an error, because "already on your list" is not a mistake the person
 * needs to go and fix.
 */
export function mapSupplierRow(
  input: Record<string, string>,
  existingNames: Set<string>,
  existingEmails: Set<string>,
): SupplierRowResult {
  const row = canonicalizeSupplierRow(input);
  const text = (key: SupplierImportColumn): string => (row[key] ?? '').trim();

  const name = text('name');
  if (!name) return { ok: false, error: `Missing ${SUPPLIER_COLUMN_LABELS.name}.` };

  const email = text('contact_email');
  if (email && !looksLikeEmail(email)) {
    return {
      ok: false,
      error: `${SUPPLIER_COLUMN_LABELS.contact_email} does not look like an address: "${email}".`,
    };
  }

  if (existingNames.has(name.toLowerCase())) {
    return { ok: false, duplicate: true, error: `${name} is already on your supplier list.` };
  }
  if (email && existingEmails.has(email.toLowerCase())) {
    return {
      ok: false,
      duplicate: true,
      error: `A supplier with the contact ${email} is already on your list.`,
    };
  }

  let tier: number | null = null;
  const tierRaw = text('tier').replace(/^tier\s*/i, '');
  if (tierRaw) {
    const parsed = Number(tierRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3) {
      return {
        ok: false,
        error: `${SUPPLIER_COLUMN_LABELS.tier} must be 1, 2 or 3, got "${text('tier')}".`,
      };
    }
    tier = parsed;
  }

  let spendUsd: number | null = null;
  const spendRaw = text('spend_usd');
  if (spendRaw) {
    // Currency symbols and thousands separators are what a spreadsheet exports
    // when the cell is formatted as currency, and rejecting them would fail a
    // file that is entirely correct.
    const cleaned = spendRaw.replace(/[$,\s]/g, '');
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return {
        ok: false,
        error: `${SUPPLIER_COLUMN_LABELS.spend_usd} must be a number that is not negative, got "${spendRaw}".`,
      };
    }
    spendUsd = parsed;
  }

  return {
    ok: true,
    supplier: {
      name,
      contactName: text('contact_name') || null,
      contactEmail: email || null,
      country: text('country') || null,
      industry: text('industry') || null,
      tier,
      spendUsd,
      notes: text('notes') || null,
    },
  };
}

export interface SupplierImportSummary {
  imported: number;
  /** Already on the list; not an error, and not re-added. */
  skipped: number;
  failed: number;
  errors: { line: number; message: string }[];
}
