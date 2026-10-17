import 'server-only';
import { createServerClient } from './supabase/server';
import { parseCsvToObjects } from './csv';
import { parseWorkbook } from './workbook-parse';
import { resolveOrgContext } from './org-context';
import { calculateSBTiTarget } from './calculations';
import {
  mapGoalRow, canonicalizeGoalRow, GOAL_EXAMPLE_ROW_NOTE,
  type GoalImportSummary,
} from './goal-import-core';

export type { GoalImportSummary } from './goal-import-core';

/**
 * Bulk-create goals from a filled-in template or a CSV.
 *
 * The SBTi derivation is injected from lib/calculations.ts rather than
 * reimplemented, so an imported SBTi goal and one created through the goal
 * screen cannot disagree about the pathway. That matters more than it sounds:
 * two goals with the same name and different targets, one typed and one
 * imported, is the kind of discrepancy nobody finds until an assurance review.
 */
export async function importGoalFile(
  source: { kind: 'csv'; text: string } | { kind: 'xlsx'; buffer: Buffer },
): Promise<{ ok: true; data: GoalImportSummary } | { ok: false; status: number; error: string }> {
  const ctx = await resolveOrgContext(['admin', 'editor']);
  if (!ctx.ok) {
    return {
      ok: false,
      status: ctx.status,
      error: ctx.status === 403 && ctx.error.startsWith('Insufficient')
        ? 'Only an admin or editor can import goals.'
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
  const { data: existing } = await supabase.from('goals').select('name');
  const names = new Set((existing ?? []).map((g) => g.name.trim().toLowerCase()));

  const summary: GoalImportSummary = {
    imported: 0, skipped: 0, failed: 0, errors: [], warnings: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const line = i + 1;
    const row = canonicalizeGoalRow(rows[i]);

    if ((row.name ?? '').includes(GOAL_EXAMPLE_ROW_NOTE)) {
      summary.skipped++;
      continue;
    }

    const mapped = mapGoalRow(row, {
      existingNames: names,
      sbtiReductionPct: (base, baseYear, targetYear) =>
        calculateSBTiTarget(base, baseYear, targetYear).reductionPct,
    });

    if (!mapped.ok) {
      if ('duplicate' in mapped && mapped.duplicate) summary.skipped++;
      else summary.failed++;
      summary.errors.push({ line, message: mapped.error });
      continue;
    }

    const g = mapped.goal;

    const { error } = await supabase.from('goals').insert({
      organization_id: ctx.data.activeOrganizationId,
      name: g.name,
      metric: g.metric,
      goal_type: g.goalType,
      scope: g.scope,
      base_year: g.baseYear,
      target_year: g.targetYear,
      base_year_value: g.baseYearValue,
      // The GHG-only predecessor column, which several reports still read.
      // Migration 021 records that for a GHG goal the two are written together
      // so they cannot disagree, and that it stays null for water and waste —
      // gallons in a column named kg would be a unit lie.
      base_year_emissions_kg: g.metric === 'ghg' ? g.baseYearValue : null,
      target_value: g.targetValue,
      target_unit: g.targetUnit,
      scope2_accounting_method: g.scope2Method,
      notes: g.notes,
      status: 'active',
    });

    if (error) {
      summary.failed++;
      summary.errors.push({ line, message: error.message });
      continue;
    }

    summary.imported++;
    names.add(g.name.toLowerCase());
    for (const w of g.warnings) summary.warnings.push({ line, message: w });
  }

  return { ok: true, data: summary };
}
