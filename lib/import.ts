import 'server-only';
import { createServerClient } from './supabase/server';
import { parseCsvToObjects } from './csv';
import { mapEmissionCsvRow, type ImportRowError, type ImportSummary } from './import-core';
import { createEmissionEntry } from './entries';

export type { ImportRowError, ImportSummary } from './import-core';

/**
 * Bulk-import emission entries from CSV text. Each valid row is created through
 * the same server-side createEmissionEntry path as the single-entry UI, so all
 * factor lookup, CO₂e calculation, RLS scoping, and audit logging apply
 * identically. Invalid rows are reported with their line number and skipped;
 * the import is best-effort per row (not a single transaction), which lets a
 * mostly-good file succeed with a precise error list for the rest.
 */
export async function importEmissionCsv(csvText: string): Promise<ImportSummary> {
  const supabase = await createServerClient();

  // Site-name → id map for the caller's org (RLS-scoped).
  const { data: sites } = await supabase.from('sites').select('id, name').eq('is_active', true);
  const siteIdByName = new Map<string, string>(
    (sites ?? []).map((s) => [s.name.toLowerCase(), s.id]),
  );

  const { rows } = parseCsvToObjects(csvText);

  const errors: ImportRowError[] = [];
  let imported = 0;

  for (let i = 0; i < rows.length; i++) {
    const line = i + 1;
    const mapped = mapEmissionCsvRow(rows[i], siteIdByName);
    if (!mapped.ok) {
      errors.push({ line, message: mapped.error });
      continue;
    }
    const result = await createEmissionEntry(mapped.input);
    if (result.ok) imported++;
    else errors.push({ line, message: result.error });
  }

  return { imported, failed: errors.length, errors };
}
