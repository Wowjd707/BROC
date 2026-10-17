import 'server-only';
import { createServerClient } from './supabase/server';
import { parseCsvToObjects } from './csv';
import { parseWorkbook } from './workbook-parse';
import { resolveOrgContext } from './org-context';
import {
  mapUnitRow, canonicalizeUnitRow, findCycles, UNIT_EXAMPLE_ROW_NOTE,
  type MappedUnit, type UnitImportSummary,
} from './business-unit-import-core';

export type { UnitImportSummary } from './business-unit-import-core';

/**
 * Bulk-create business units from a filled-in template or a CSV.
 *
 * Two passes, because a flat file cannot be trusted to list parents first:
 *
 *   1. insert every valid row with no parent
 *   2. resolve each parent by name and link it
 *
 * The cost is that a unit exists briefly with no parent. That is acceptable —
 * parent_id is nullable and a top-level unit is a legitimate state, so an
 * interrupted import leaves a flat list rather than a broken tree. The
 * alternative, sorting the file into dependency order first, fails the moment
 * two rows disagree about which is the parent.
 *
 * Cycles are checked before anything is written. Migration 015's trigger would
 * refuse them anyway, but it would refuse them one row at a time with a message
 * naming a trigger — and by then half the file would be in. Better to refuse the
 * whole loop up front and name the rows.
 */
export async function importBusinessUnitFile(
  source: { kind: 'csv'; text: string } | { kind: 'xlsx'; buffer: Buffer },
): Promise<{ ok: true; data: UnitImportSummary } | { ok: false; status: number; error: string }> {
  const ctx = await resolveOrgContext(['admin']);
  if (!ctx.ok) {
    return {
      ok: false,
      status: ctx.status,
      // Units are the organizational structure, which is admin territory — the
      // same role the Settings screen requires to edit them.
      error: ctx.status === 403 && ctx.error.startsWith('Insufficient')
        ? 'Only an admin can import business units.'
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

  const { data: existing } = await supabase
    .from('business_units').select('id, name, parent_id');

  const idByName = new Map(
    (existing ?? []).map((u) => [u.name.trim().toLowerCase(), u.id]),
  );
  const nameById = new Map((existing ?? []).map((u) => [u.id, u.name.trim().toLowerCase()]));
  const existingNames = new Set(idByName.keys());

  const summary: UnitImportSummary = {
    imported: 0, skipped: 0, failed: 0, unresolvedParents: 0, errors: [], warnings: [],
  };

  // ── Map every row first, so cycles can be found before anything is written ──
  const staged: { line: number; unit: MappedUnit }[] = [];
  const seenInFile = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const line = i + 1;
    const row = canonicalizeUnitRow(rows[i]);

    if ((row.name ?? '').includes(UNIT_EXAMPLE_ROW_NOTE)) {
      summary.skipped++;
      continue;
    }

    const mapped = mapUnitRow(row, existingNames);
    if (!mapped.ok) {
      if ('duplicate' in mapped && mapped.duplicate) summary.skipped++;
      else summary.failed++;
      summary.errors.push({ line, message: mapped.error });
      continue;
    }

    // A file naming the same unit twice would otherwise insert it twice, since
    // there is no unique constraint on the column.
    const key = mapped.unit.name.toLowerCase();
    if (seenInFile.has(key)) {
      summary.skipped++;
      summary.errors.push({
        line,
        message: `${mapped.unit.name} appears more than once in this file; the first was used.`,
      });
      continue;
    }
    seenInFile.add(key);
    staged.push({ line, unit: mapped.unit });
  }

  // ── Cycle check across the file and the units already stored ───────────────
  const parentByName = new Map<string, string>();
  for (const { unit } of staged) {
    if (unit.parentName) parentByName.set(unit.name.toLowerCase(), unit.parentName.toLowerCase());
  }
  // Existing units' parents matter too: a new row can point at a stored unit
  // whose ancestry comes back into the file.
  for (const u of existing ?? []) {
    if (u.parent_id) {
      const parent = nameById.get(u.parent_id);
      if (parent) parentByName.set(u.name.trim().toLowerCase(), parent);
    }
  }

  const looped = findCycles(parentByName);
  const blocked = new Set<string>();
  if (looped.size > 0) {
    for (const { line, unit } of staged) {
      if (looped.has(unit.name.toLowerCase())) {
        blocked.add(unit.name.toLowerCase());
        summary.failed++;
        summary.errors.push({
          line,
          message: `${unit.name} is part of a loop in the Parent Unit column, so it was not `
            + 'imported. A unit cannot be its own ancestor.',
        });
      }
    }
  }

  // ── Pass 1: create every unit, parentless ─────────────────────────────────
  const createdIdByName = new Map<string, string>();

  for (const { line, unit } of staged) {
    if (blocked.has(unit.name.toLowerCase())) continue;

    const { data, error } = await supabase
      .from('business_units')
      .insert({
        // Explicit rather than relying on the auth_org_id() default, matching
        // the site and supplier importers.
        organization_id: ctx.data.activeOrganizationId,
        name: unit.name,
        code: unit.code,
        description: unit.description,
        sort_order: unit.sortOrder,
      })
      .select('id')
      .single();

    if (error || !data) {
      summary.failed++;
      summary.errors.push({ line, message: error?.message ?? 'Could not be created.' });
      continue;
    }

    summary.imported++;
    createdIdByName.set(unit.name.toLowerCase(), data.id);
  }

  // ── Pass 2: link parents, now that every name resolves ────────────────────
  for (const { line, unit } of staged) {
    if (!unit.parentName) continue;
    const childId = createdIdByName.get(unit.name.toLowerCase());
    if (!childId) continue; // it failed in pass 1; already reported

    const parentKey = unit.parentName.toLowerCase();
    const parentId = createdIdByName.get(parentKey) ?? idByName.get(parentKey) ?? null;

    if (!parentId) {
      summary.unresolvedParents++;
      summary.warnings.push({
        line,
        message: `${unit.name}: no unit called "${unit.parentName}" in this file or already `
          + 'stored, so it was left at the top level. Assign it in Settings.',
      });
      continue;
    }

    const { error } = await supabase
      .from('business_units')
      .update({ parent_id: parentId })
      .eq('id', childId);

    if (error) {
      // The cycle trigger is the likeliest cause, and reaching here means the
      // pre-check missed a case worth seeing rather than swallowing.
      summary.unresolvedParents++;
      summary.warnings.push({
        line,
        message: `${unit.name}: created, but could not be linked to "${unit.parentName}" — `
          + `${error.message}`,
      });
    }
  }

  return { ok: true, data: summary };
}
