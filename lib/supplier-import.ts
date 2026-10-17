import 'server-only';
import { createServerClient } from './supabase/server';
import { parseCsvToObjects } from './csv';
import { parseWorkbook } from './workbook-parse';
import { resolveOrgContext } from './org-context';
import {
  mapSupplierRow, SUPPLIER_EXAMPLE_ROW_NOTE,
  type SupplierImportSummary,
} from './supplier-import-core';

export type { SupplierImportSummary } from './supplier-import-core';

/**
 * Bulk-create suppliers from a filled-in template or a CSV.
 *
 * Best-effort per row, matching every other importer here: a mostly-good file
 * should land with a precise list of what did not.
 *
 * Duplicates are checked against the list as it grows, not only against the
 * list as it was when the upload started. A file containing the same supplier
 * twice is the commonest way a list gets duplicated, and checking only the
 * initial state would let both rows through.
 */
export async function importSupplierFile(
  source: { kind: 'csv'; text: string } | { kind: 'xlsx'; buffer: Buffer },
): Promise<{ ok: true; data: SupplierImportSummary } | { ok: false; status: number; error: string }> {
  const ctx = await resolveOrgContext(['admin', 'editor']);
  if (!ctx.ok) {
    return {
      ok: false,
      status: ctx.status,
      error: ctx.status === 403 && ctx.error.startsWith('Insufficient')
        ? 'Only an admin or editor can import suppliers.'
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

  // RLS-scoped, so this is the caller's own list.
  const { data: existing } = await supabase
    .from('suppliers')
    .select('name, contact_email')
    .eq('is_active', true);

  const names = new Set((existing ?? []).map((s) => s.name.trim().toLowerCase()));
  const emails = new Set(
    (existing ?? []).flatMap((s) => {
      const e = s.contact_email?.trim().toLowerCase();
      return e ? [e] : [];
    }),
  );

  const summary: SupplierImportSummary = { imported: 0, skipped: 0, failed: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const line = i + 1;

    // The template's example row carries realistic values on purpose, which is
    // what makes a forgotten one dangerous — it would land as a real supplier
    // called Midwest Steel with a working-looking address.
    if ((rows[i].notes ?? '').trim() === SUPPLIER_EXAMPLE_ROW_NOTE) {
      summary.skipped++;
      continue;
    }

    const mapped = mapSupplierRow(rows[i], names, emails);

    if (!mapped.ok) {
      if ('duplicate' in mapped && mapped.duplicate) {
        summary.skipped++;
        // Recorded but not counted as a failure: it tells the operator which
        // rows did nothing, without implying they need fixing.
        summary.errors.push({ line, message: mapped.error });
      } else {
        summary.failed++;
        summary.errors.push({ line, message: mapped.error });
      }
      continue;
    }

    const s = mapped.supplier;
    const { error } = await supabase.from('suppliers').insert({
      // Explicit rather than leaning on the column's auth_org_id() default, for
      // the same reason as the site importer: a tenant key left implicit is what
      // made every write fail in practice mode before lib/org-context.ts. This
      // is the ACTIVE organization.
      organization_id: ctx.data.activeOrganizationId,
      name: s.name,
      contact_name: s.contactName,
      contact_email: s.contactEmail,
      country: s.country,
      industry: s.industry,
      tier: s.tier,
      spend_usd: s.spendUsd,
      notes: s.notes,
    });

    if (error) {
      summary.failed++;
      summary.errors.push({ line, message: error.message });
      continue;
    }

    summary.imported++;
    // Grow the comparison sets so a file listing the same supplier twice does
    // not insert it twice.
    names.add(s.name.toLowerCase());
    if (s.contactEmail) emails.add(s.contactEmail.toLowerCase());
  }

  return { ok: true, data: summary };
}
