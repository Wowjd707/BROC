import 'server-only';
import { createServerClient } from './supabase/server';
import { parseCsvToObjects } from './csv';
import { parseWorkbook } from './workbook-parse';
import { resolveOrgContext } from './org-context';
import { validUntil } from './compliance-core';
import { FIELD_BY_KEY } from './compliance-catalog';
import { mapProductRow, PRODUCT_EXAMPLE_ROW_NOTE, type ProductImportSummary, type Lookups } from './product-import-core';

export type { ProductImportSummary } from './product-import-core';

/**
 * Create or refresh products from a spreadsheet or CSV. Best-effort per row,
 * like every importer here: a mostly-good file lands, with a precise list of
 * what did not.
 */
export async function importProductFile(
  source: { kind: 'csv'; text: string } | { kind: 'xlsx'; buffer: Buffer },
): Promise<{ ok: true; data: ProductImportSummary } | { ok: false; status: number; error: string }> {
  const ctx = await resolveOrgContext(['admin', 'editor']);
  if (!ctx.ok) {
    return {
      ok: false,
      status: ctx.status,
      error: ctx.status === 403 && ctx.error.startsWith('Insufficient') ? 'Only an admin or editor can import products.' : ctx.error,
    };
  }

  let rows: Record<string, string>[];
  try {
    rows = source.kind === 'csv' ? parseCsvToObjects(source.text).rows : (await parseWorkbook(source.buffer)).rows;
  } catch (e) {
    return { ok: false, status: 400, error: `That file could not be read: ${(e as Error).message}` };
  }
  if (rows.length === 0) return { ok: false, status: 400, error: 'That file has a header row and no data rows.' };

  const supabase = await createServerClient();
  const [{ data: suppliers }, { data: bus }, { data: sites }, { data: users }, { data: existing }] = await Promise.all([
    supabase.from('suppliers').select('id, name').eq('is_active', true),
    supabase.from('business_units').select('id, name'),
    supabase.from('sites').select('id, name'),
    supabase.from('users').select('id, email'),
    supabase.from('products').select('id, part_number'),
  ]);
  const byName = (list: { id: string; name: string }[] | null) =>
    new Map((list ?? []).map((x) => [x.name.trim().toLowerCase(), x.id]));
  const lookups: Lookups = {
    suppliers: byName(suppliers),
    businessUnits: byName(bus),
    sites: byName(sites),
    users: new Map((users ?? []).flatMap((u) => (u.email ? [[u.email.toLowerCase(), u.id]] : []))),
  };
  const parts = new Map((existing ?? []).map((p) => [p.part_number.trim().toLowerCase(), p.id as string]));

  const summary: ProductImportSummary = { imported: 0, skipped: 0, failed: 0, errors: [], warnings: [] };
  const today = new Date().toISOString().slice(0, 10);
  let valueCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const line = i + 1;
    if ((rows[i].notes ?? '').trim() === PRODUCT_EXAMPLE_ROW_NOTE) continue;

    const mapped = mapProductRow(rows[i], lookups);
    if (!mapped.ok) {
      summary.failed++;
      summary.errors.push({ line, message: mapped.error });
      continue;
    }
    const { partNumber, fields, values } = mapped.product;
    const key = partNumber.toLowerCase();
    let productId = parts.get(key);

    if (productId) {
      if (Object.keys(fields).length > 0) {
        const { error } = await supabase.from('products').update(fields).eq('id', productId);
        if (error) { summary.failed++; summary.errors.push({ line, message: error.message }); continue; }
      }
      summary.skipped++;
    } else {
      const { data, error } = await supabase
        .from('products')
        .insert({ organization_id: ctx.data.activeOrganizationId, part_number: partNumber, ...fields })
        .select('id')
        .single();
      if (error || !data) { summary.failed++; summary.errors.push({ line, message: error?.message ?? 'Could not be added.' }); continue; }
      productId = data.id as string;
      parts.set(key, productId);
      summary.imported++;
    }

    if (values.length > 0) {
      const { error } = await supabase.from('product_compliance_values').insert(values.map((v) => ({
        organization_id: ctx.data.activeOrganizationId,
        product_id: productId!,
        field_key: v.field_key,
        value: v.value,
        unit: v.unit,
        valid_from: today,
        valid_to: validUntil(today, FIELD_BY_KEY.get(v.field_key)?.validMonths ?? null),
        source: 'import' as const,
        recorded_by: ctx.data.userId,
      })));
      if (error) summary.warnings.push({ line, message: `${partNumber} was saved, but its compliance values were not: ${error.message}` });
      else valueCount += values.length;
    }
  }

  if (valueCount > 0) summary.warnings.unshift({ line: 0, message: `${valueCount} compliance value${valueCount === 1 ? '' : 's'} recorded from the file.` });
  return { ok: true, data: summary };
}
