import 'server-only';
import { createServerClient } from './supabase/server';
import { parseCsvToObjects } from './csv';
import { parseWorkbook } from './workbook-parse';
import { resolveOrgContext } from './org-context';
import {
  mapProjectRow, canonicalizeProjectRow, PROJECT_EXAMPLE_ROW_NOTE,
  PROJECT_COLUMN_LABELS, type ProjectImportSummary,
} from './project-import-core';

export type { ProjectImportSummary } from './project-import-core';

/**
 * Bulk-create projects from a filled-in template or a CSV.
 *
 * Site and goal resolve by name. An unmatched name leaves the project unlinked
 * and is reported, rather than failing the row: a project with a misspelled site
 * is still a real project, and the link is a field somebody can fix in one click.
 * Neither sites nor goals are created here — a project file inventing a site
 * would put emissions somewhere nobody chose.
 */
export async function importProjectFile(
  source: { kind: 'csv'; text: string } | { kind: 'xlsx'; buffer: Buffer },
): Promise<{ ok: true; data: ProjectImportSummary } | { ok: false; status: number; error: string }> {
  const ctx = await resolveOrgContext(['admin', 'editor']);
  if (!ctx.ok) {
    return {
      ok: false,
      status: ctx.status,
      error: ctx.status === 403 && ctx.error.startsWith('Insufficient')
        ? 'Only an admin or editor can import projects.'
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

  const [{ data: existing }, { data: sites }, { data: goals }] = await Promise.all([
    supabase.from('projects').select('name'),
    supabase.from('sites').select('id, name').eq('is_active', true),
    supabase.from('goals').select('id, name'),
  ]);

  const names = new Set((existing ?? []).map((p) => p.name.trim().toLowerCase()));
  const siteIdByName = new Map((sites ?? []).map((s) => [s.name.trim().toLowerCase(), s.id]));
  const goalIdByName = new Map((goals ?? []).map((g) => [g.name.trim().toLowerCase(), g.id]));

  const summary: ProjectImportSummary = {
    imported: 0, skipped: 0, failed: 0, errors: [], warnings: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const line = i + 1;
    const row = canonicalizeProjectRow(rows[i]);

    if ((row.name ?? '').includes(PROJECT_EXAMPLE_ROW_NOTE)) {
      summary.skipped++;
      continue;
    }

    const mapped = mapProjectRow(row, names);
    if (!mapped.ok) {
      if ('duplicate' in mapped && mapped.duplicate) summary.skipped++;
      else summary.failed++;
      summary.errors.push({ line, message: mapped.error });
      continue;
    }

    const p = mapped.project;
    const warnings = [...p.warnings];

    let siteId: string | null = null;
    if (p.siteName) {
      siteId = siteIdByName.get(p.siteName.toLowerCase()) ?? null;
      if (!siteId) {
        warnings.push(
          `${p.name}: no ${PROJECT_COLUMN_LABELS.site} called "${p.siteName}", so the project is `
          + 'not attached to one. Link it in Projects, or add the site first.',
        );
      }
    }

    let goalId: string | null = null;
    if (p.goalName) {
      goalId = goalIdByName.get(p.goalName.toLowerCase()) ?? null;
      if (!goalId) {
        warnings.push(
          `${p.name}: no ${PROJECT_COLUMN_LABELS.goal} called "${p.goalName}", so its savings `
          + 'are not counted toward any goal.',
        );
      }
    }

    const { error } = await supabase.from('projects').insert({
      organization_id: ctx.data.activeOrganizationId,
      name: p.name,
      description: p.description,
      category: p.category,
      status: p.status,
      site_id: siteId,
      goal_id: goalId,
      // The _per_year columns are the ones the pipeline reads; 007 added them
      // and the pre-007 columns remain only for rows written before it.
      estimated_co2e_reduction_kg_per_year: p.estimatedCo2eKg,
      actual_co2e_reduction_kg_per_year: p.actualCo2eKg,
      estimated_water_reduction_gal_per_year: p.estimatedWaterGal,
      estimated_waste_reduction_kg_per_year: p.estimatedWasteKg,
      estimated_cost_usd: p.estimatedCostUsd,
      start_date: p.startDate,
      target_completion_date: p.targetCompletionDate,
      pipeline_inclusion_status: p.pipelineStatus,
    });

    if (error) {
      summary.failed++;
      summary.errors.push({ line, message: error.message });
      continue;
    }

    summary.imported++;
    names.add(p.name.toLowerCase());
    for (const w of warnings) summary.warnings.push({ line, message: w });
  }

  return { ok: true, data: summary };
}
