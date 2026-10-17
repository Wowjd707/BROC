import 'server-only';
import { createServerClient } from './supabase/server';
import { parseCsvToObjects } from './csv';
import { parseWorkbook } from './workbook-parse';
import { resolveOrgContext } from './org-context';
import {
  mapSiteRow, canonicalizeSiteRow, SITE_EXAMPLE_ROW_NOTE,
  type SiteImportSummary,
} from './site-import-core';

export type { SiteImportSummary } from './site-import-core';

/**
 * Bulk-create sites from a filled-in template or a CSV.
 *
 * Business units are resolved by name to an id. An unmatched name does not fail
 * the row: the site is real and correct, only its assignment is missing, and
 * leaving the site out because a unit name was misspelled would be a worse
 * outcome than importing it unassigned and saying so. Units are never created
 * from an import — inventing an organizational unit from a spreadsheet cell is
 * not a decision a file should be able to make.
 */
export async function importSiteFile(
  source: { kind: 'csv'; text: string } | { kind: 'xlsx'; buffer: Buffer },
): Promise<{ ok: true; data: SiteImportSummary } | { ok: false; status: number; error: string }> {
  const ctx = await resolveOrgContext(['admin', 'editor']);
  if (!ctx.ok) {
    return {
      ok: false,
      status: ctx.status,
      error: ctx.status === 403 && ctx.error.startsWith('Insufficient')
        ? 'Only an admin or editor can import sites.'
        : ctx.error,
    };
  }

  let rows: Record<string, string>[];
  try {
    rows = source.kind === 'csv'
      ? parseCsvToObjects(source.text).rows
      : (await parseWorkbook(source.buffer)).rows;
  } catch (e) {
    return { ok: false, status: 400, error: `That file could not be read: ${(e as Error).message}` };
  }

  if (rows.length === 0) {
    return { ok: false, status: 400, error: 'That file has a header row and no data rows.' };
  }

  const supabase = await createServerClient();

  // Both reads are RLS-scoped, so this is the caller's own organization.
  const [{ data: existing }, { data: units }] = await Promise.all([
    supabase.from('sites').select('name'),
    supabase.from('business_units').select('id, name'),
  ]);

  // Every site, not only the active ones: a soft-deleted site still holds the
  // name, and re-adding it would produce two records for one place.
  const names = new Set((existing ?? []).map((s) => s.name.trim().toLowerCase()));
  const unitIdByName = new Map(
    (units ?? []).map((u) => [u.name.trim().toLowerCase(), u.id]),
  );

  const summary: SiteImportSummary = {
    imported: 0, skipped: 0, failed: 0, errors: [], warnings: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const line = i + 1;
    const row = canonicalizeSiteRow(rows[i]);

    // The template's example row names itself. Matched by substring so that
    // trimming the parenthetical — which is what somebody editing the row in
    // place would do — turns it into a genuine site rather than a skip.
    if ((row.name ?? '').includes(SITE_EXAMPLE_ROW_NOTE)) {
      summary.skipped++;
      continue;
    }

    const mapped = mapSiteRow(row, names);

    if (!mapped.ok) {
      if ('duplicate' in mapped && mapped.duplicate) {
        summary.skipped++;
        summary.errors.push({ line, message: mapped.error });
      } else {
        summary.failed++;
        summary.errors.push({ line, message: mapped.error });
      }
      continue;
    }

    const site = mapped.site;

    let businessUnitId: string | null = null;
    if (site.businessUnitName) {
      businessUnitId = unitIdByName.get(site.businessUnitName.toLowerCase()) ?? null;
      if (!businessUnitId) {
        summary.warnings.push({
          line,
          message: `${site.name}: no business unit called "${site.businessUnitName}", so the site is `
            + 'unassigned. Assign it in Settings, or add the unit first and re-import.',
        });
      }
    }

    const { error } = await supabase.from('sites').insert({
      // Explicit rather than leaning on the column's auth_org_id() default.
      // The default would resolve correctly, but a tenant key left implicit is
      // exactly what made every write fail in practice mode before
      // lib/org-context.ts existed. This is the ACTIVE organization, so a site
      // added in practice mode stays in the sandbox.
      organization_id: ctx.data.activeOrganizationId,
      name: site.name,
      site_type: site.siteType,
      address: site.address,
      city: site.city,
      state: site.state,
      zip_code: site.zipCode,
      country: site.country,
      floor_area_sqft: site.floorAreaSqft,
      business_unit_id: businessUnitId,
      ownership_percent: site.ownershipPercent,
      is_controlled: site.isControlled,
    });

    if (error) {
      summary.failed++;
      summary.errors.push({ line, message: error.message });
      continue;
    }

    summary.imported++;
    names.add(site.name.toLowerCase());
    for (const w of site.warnings) summary.warnings.push({ line, message: w });
  }

  return { ok: true, data: summary };
}
