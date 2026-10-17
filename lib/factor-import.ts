import 'server-only';
import { createServerClient } from './supabase/server';
import { parseCsvToObjects } from './csv';
import { mapFactorCsvRow } from './factor-import-core';
import type { ImportSummary, ImportRowError } from './import-core';

/**
 * Bulk-import Scope 3 emission factors into the organization's library.
 *
 * Unlike activity-data import, factors are inserted in a single batch: a factor
 * library is a coherent published set, and a half-loaded library would silently
 * produce entries calculated against an incomplete reference. So all rows are
 * validated first, and nothing is written unless every row is valid.
 */
export async function importScope3FactorCsv(csvText: string): Promise<ImportSummary> {
  const { rows } = parseCsvToObjects(csvText);

  const errors: ImportRowError[] = [];
  const mapped = [];

  for (let i = 0; i < rows.length; i++) {
    const result = mapFactorCsvRow(rows[i]);
    if (result.ok) mapped.push(result.row);
    else errors.push({ line: i + 1, message: result.error });
  }

  // All-or-nothing: refuse to load a partial library.
  if (errors.length > 0) {
    return { imported: 0, failed: errors.length, errors };
  }
  if (mapped.length === 0) {
    return { imported: 0, failed: 1, errors: [{ line: 0, message: 'No data rows found in the file.' }] };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.from('scope3_factors').insert(mapped);

  if (error) {
    return { imported: 0, failed: mapped.length, errors: [{ line: 0, message: error.message }] };
  }

  return { imported: mapped.length, failed: 0, errors: [] };
}
