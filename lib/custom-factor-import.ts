import 'server-only';
import { createServerClient } from './supabase/server';
import { parseCsvToObjects } from './csv';
import {
  mapCustomFactorCsvRow,
  findDuplicateWindows,
  buildKeyLookup,
  windowKeyOf,
  type MappedCustomFactorRow,
  type FactorKeyLookups,
} from './custom-factor-import-core';
import type { ImportRowError, ImportSummary } from './import-core';

/**
 * Bulk-import organization-scoped custom emission factors.
 *
 * All-or-nothing, for the same reason the Scope 3 library import is: a factor
 * vintage is a coherent published set, and a half-loaded one silently produces
 * entries calculated against an incomplete reference — worse than a failed
 * import, because nothing surfaces it.
 *
 * Superseding last year's factors is an import with a later `effective_from`;
 * existing rows are never modified, so entries already calculated keep the
 * factor they were calculated with. That is the whole point of effective
 * dating and this importer must not undermine it.
 */
export async function importCustomFactorCsv(csvText: string): Promise<ImportSummary> {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return fail('Not authenticated.');
  }

  // RLS would reject a viewer's insert anyway, but a role error arriving as an
  // opaque policy violation after validation passed is a poor explanation.
  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin' && profile?.role !== 'editor') {
    return fail('Only an admin or editor can change emission factors.');
  }

  const { lookups, siteNameById } = await loadKeyLookups(supabase);

  const { rows } = parseCsvToObjects(csvText);
  const errors: ImportRowError[] = [];
  const mapped: { row: MappedCustomFactorRow; line: number }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const result = mapCustomFactorCsvRow(rows[i], lookups);
    if (result.ok) mapped.push({ row: result.row, line: i + 1 });
    else errors.push({ line: i + 1, message: result.error });
  }

  if (errors.length > 0) return { imported: 0, failed: errors.length, errors };
  if (mapped.length === 0) return fail('No data rows found in the file.');

  const duplicates = findDuplicateWindows(mapped);
  if (duplicates.length > 0) {
    return { imported: 0, failed: duplicates.length, errors: duplicates };
  }

  const collisions = await findExistingCollisions(supabase, mapped, siteNameById);
  if (collisions.length > 0) {
    return { imported: 0, failed: collisions.length, errors: collisions };
  }

  const { error } = await supabase
    .from('custom_emission_factors')
    .insert(mapped.map((m) => m.row));

  if (error) {
    return { imported: 0, failed: mapped.length, errors: [{ line: 0, message: error.message }] };
  }

  return { imported: mapped.length, failed: 0, errors: [] };
}

function fail(message: string): ImportSummary {
  return { imported: 0, failed: 1, errors: [{ line: 0, message }] };
}

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

/**
 * The keys a factor may be attached to. Fuels and refrigerants come from the
 * global reference tables; sites are the caller's own (RLS-scoped), keyed by
 * name because the stored `factor_key` is a site id.
 */
async function loadKeyLookups(
  supabase: ServerClient,
): Promise<{ lookups: FactorKeyLookups; siteNameById: Map<string, string> }> {
  const [{ data: fuels }, { data: refrigerants }, { data: sites }] = await Promise.all([
    supabase.from('scope1_emission_factors').select('fuel_type'),
    supabase.from('refrigerant_factors').select('refrigerant_code'),
    supabase.from('sites').select('id, name').eq('is_active', true),
  ]);

  return {
    lookups: {
      fuelTypes: buildKeyLookup((fuels ?? []).map((f) => ({ key: f.fuel_type, value: f.fuel_type }))),
      refrigerantCodes: buildKeyLookup(
        (refrigerants ?? []).map((r) => ({ key: r.refrigerant_code, value: r.refrigerant_code })),
      ),
      siteIdByName: buildKeyLookup((sites ?? []).map((s) => ({ key: s.name, value: s.id }))),
    },
    siteNameById: new Map((sites ?? []).map((s) => [s.id, s.name])),
  };
}

/**
 * Reject rows that would open a second window on a date an active factor
 * already opens on.
 *
 * Migration 018 enforces this with a unique index, so the insert would fail
 * regardless — but it would fail naming a raw site UUID and an index name.
 * Checking first lets the error say which row of the file is at fault, in the
 * terms the file used.
 */
async function findExistingCollisions(
  supabase: ServerClient,
  mapped: { row: MappedCustomFactorRow; line: number }[],
  siteNameById: ReadonlyMap<string, string>,
): Promise<ImportRowError[]> {
  const categories = Array.from(new Set(mapped.map((m) => m.row.factor_category)));
  const keys = Array.from(new Set(mapped.map((m) => m.row.factor_key)));

  const { data: existing } = await supabase
    .from('custom_emission_factors')
    .select('factor_category, factor_key, effective_from, factor_source')
    .eq('is_active', true)
    .in('factor_category', categories)
    .in('factor_key', keys);

  if (!existing || existing.length === 0) return [];

  const bySource = new Map(existing.map((e) => [windowKeyOf(e), e.factor_source]));

  const errors: ImportRowError[] = [];
  for (const { row, line } of mapped) {
    const source = bySource.get(windowKeyOf(row));
    if (source === undefined) continue;

    // Site ids are meaningless in an error message; show the name from the file.
    const shown = row.factor_category === 'scope2_location'
      ? siteNameById.get(row.factor_key) ?? row.factor_key
      : row.factor_key;

    errors.push({
      line,
      message: `An active factor for "${shown}" already takes effect on ${row.effective_from} (source: ${source}). Use a different effective_from to supersede it, or deactivate the existing factor first.`,
    });
  }

  return errors;
}
