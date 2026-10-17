import 'server-only';
import { createServerClient } from './supabase/server';
import { resolveOrgContext } from './org-context';
import { parseCsvToObjects } from './csv';
import { parseWorkbook } from './workbook-parse';
import { createEmissionEntry, createEhsEntry } from './entries';
import {
  stageRow, applyValue, isCommittable,
  type EntryFamily, type StagedRow, type StagingContext,
} from './staged-import-core';
import type { MetricCatalogEntry } from './import-cascade-core';

/**
 * Server orchestration for staged imports.
 *
 * Staging writes nothing to the entry tables. A batch sits in `draft` until
 * somebody commits it, and committing runs each row through the same
 * `createEmissionEntry` / `createEhsEntry` path the single-entry UI uses — so
 * factor lookup, CO₂e calculation, RLS and the audit trigger all apply
 * identically. An importer with its own insert path would be an importer whose
 * numbers cannot be reconciled with hand entry, which is the one thing a
 * reporting tool cannot afford.
 */

export interface BatchSummary {
  id: string;
  family: EntryFamily;
  filename: string | null;
  status: string;
  rowCount: number;
  committedCount: number;
  createdAt: string;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/**
 * The organization a staged batch belongs to.
 *
 * Deliberately the ACTIVE organization, not the home one. `auth_org_id()` is
 * `COALESCE(active_organization_id, organization_id)` since migration 032, and
 * every policy on the import tables funnels through it. Writing the home org
 * while in practice mode would supply an id the WITH CHECK rejects, so a
 * sandbox user could not stage a file at all — and the sandbox exists
 * precisely so people can practise this.
 */
async function resolveContext(): Promise<Result<{
  userId: string;
  organizationId: string;
  siteIdByName: Map<string, string>;
  catalog: MetricCatalogEntry[];
}>> {
  const ctx = await resolveOrgContext(['admin', 'editor']);
  if (!ctx.ok) {
    return {
      ok: false,
      status: ctx.status,
      error: ctx.status === 403 && ctx.error.startsWith('Insufficient')
        ? 'Insufficient role to import data.'
        : ctx.error,
    };
  }
  const organizationId = ctx.data.activeOrganizationId;

  const supabase = await createServerClient();
  const { data: sites } = await supabase
    .from('sites').select('id, name').eq('is_active', true);

  const { data: metrics } = await supabase
    .from('sustainability_metrics')
    .select('metric_type, source_type, label, canonical_unit, aggregation')
    .eq('is_active', true);

  return {
    ok: true,
    data: {
      userId: ctx.data.userId,
      organizationId,
      siteIdByName: new Map((sites ?? []).map((s) => [s.name.toLowerCase(), s.id])),
      catalog: (metrics ?? []).map((m) => ({
        metricType: m.metric_type,
        sourceType: m.source_type,
        label: m.label,
        canonicalUnit: m.canonical_unit,
        aggregation: m.aggregation as MetricCatalogEntry['aggregation'],
      })),
    },
  };
}

/**
 * Parse a file into a draft batch.
 *
 * Every row is stored, including ones that cannot commit. A row the importer
 * rejected is exactly the row an operator needs to see in context, and a
 * summary count of failures sends them back to the spreadsheet to guess which.
 */
export async function createStagedBatch(
  family: EntryFamily,
  filename: string | null,
  csvText: string,
): Promise<Result<{ batchId: string; rows: number; needsReview: number }>> {
  return stageParsedRows(family, filename, parseCsvToObjects(csvText).rows);
}

/**
 * Stage a filled-in .xlsx template.
 *
 * Converges on the same rows a CSV produces, so everything downstream — the
 * cascade, the review screen, the adjustment trail — is unchanged. The only
 * difference a workbook makes is that its dropdowns were enforced at typing
 * time rather than at review time.
 */
export async function createStagedBatchFromWorkbook(
  family: EntryFamily,
  filename: string | null,
  buffer: Buffer,
): Promise<Result<{ batchId: string; rows: number; needsReview: number }>> {
  let parsed;
  try {
    parsed = await parseWorkbook(buffer);
  } catch (e) {
    return {
      ok: false,
      status: 400,
      error: `That file could not be read as a spreadsheet: ${(e as Error).message}`,
    };
  }
  return stageParsedRows(family, filename, parsed.rows);
}

async function stageParsedRows(
  family: EntryFamily,
  filename: string | null,
  parsed: Record<string, string>[],
): Promise<Result<{ batchId: string; rows: number; needsReview: number }>> {
  const ctx = await resolveContext();
  if (!ctx.ok) return ctx;

  const supabase = await createServerClient();
  if (parsed.length === 0) {
    return { ok: false, status: 400, error: 'That file has a header row and no data rows.' };
  }

  const staging: StagingContext = {
    family,
    siteIdByName: ctx.data.siteIdByName,
    catalog: ctx.data.catalog,
  };
  const staged = parsed.map((r, i) => stageRow(i + 1, r, staging));

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      organization_id: ctx.data.organizationId,
      family,
      filename,
      status: 'draft',
      row_count: staged.length,
      uploaded_by: ctx.data.userId,
    })
    .select('id')
    .single();

  if (batchError || !batch) {
    return { ok: false, status: 500, error: batchError?.message ?? 'Could not create the batch.' };
  }

  const { error: rowsError } = await supabase.from('import_batch_rows').insert(
    staged.map((r) => ({
      batch_id: batch.id,
      organization_id: ctx.data.organizationId,
      line_number: r.lineNumber,
      raw: r.raw,
      resolved: toJson(r),
      status: r.status,
      error: r.error,
    })),
  );

  if (rowsError) {
    // Leaving a batch with no rows behind would show as an empty review screen
    // with no explanation, so take it back out.
    await supabase.from('import_batches').delete().eq('id', batch.id);
    return { ok: false, status: 500, error: rowsError.message };
  }

  // Machine-proposed values are logged at staging time, before anyone has seen
  // them. That is the point of `origin: 'auto'` — a value nobody confirmed is
  // findable afterwards precisely because it was recorded as unconfirmed.
  await recordAutoAdjustments(staged, batch.id, ctx.data.organizationId);

  return {
    ok: true,
    data: {
      batchId: batch.id,
      rows: staged.length,
      needsReview: staged.filter((r) => !isCommittable(r)).length,
    },
  };
}

async function recordAutoAdjustments(
  staged: StagedRow[],
  batchId: string,
  organizationId: string,
): Promise<void> {
  const supabase = await createServerClient();
  const { data: rows } = await supabase
    .from('import_batch_rows')
    .select('id, line_number')
    .eq('batch_id', batchId);

  const idByLine = new Map((rows ?? []).map((r) => [r.line_number, r.id]));

  const records = staged.flatMap((r) =>
    r.adjustments
      .filter((a) => a.to !== null && !a.requiresConfirmation)
      .map((a) => ({
        row_id: idByLine.get(r.lineNumber)!,
        organization_id: organizationId,
        field: a.field,
        old_value: a.from,
        new_value: a.to,
        origin: 'auto' as const,
        reason: a.reason,
        adjusted_by: null,
      }))
      .filter((rec) => rec.row_id !== undefined),
  );

  if (records.length > 0) {
    await supabase.from('import_row_adjustments').insert(records);
  }
}

/**
 * Record a reviewer's decision about one field.
 *
 * The adjustment is written before the row, so a failure leaves a logged change
 * that did not take effect rather than a silent change nobody can account for.
 * Of the two ways to be wrong, an over-recorded trail is the recoverable one.
 */
export async function applyRowEdit(
  rowId: string,
  field: string,
  value: string | null,
): Promise<Result<{ status: string }>> {
  const ctx = await resolveContext();
  if (!ctx.ok) return ctx;

  const supabase = await createServerClient();
  const { data: row } = await supabase
    .from('import_batch_rows')
    .select('id, resolved, status, batch_id')
    .eq('id', rowId)
    .single();

  if (!row) return { ok: false, status: 404, error: 'No such row.' };

  const resolved = (row.resolved ?? {}) as Record<string, string | null>;
  const before = resolved[field] ?? null;
  const after = value === '' ? null : value;
  if (before === after) return { ok: true, data: { status: row.status } };

  const { error: adjError } = await supabase.from('import_row_adjustments').insert({
    row_id: rowId,
    organization_id: ctx.data.organizationId,
    field,
    old_value: before,
    new_value: after,
    origin: 'user',
    reason: null,
    adjusted_by: ctx.data.userId,
  });
  if (adjError) return { ok: false, status: 500, error: adjError.message };

  resolved[field] = after;

  const { error: rowError } = await supabase
    .from('import_batch_rows')
    .update({ resolved, status: 'valid', updated_at: new Date().toISOString() })
    .eq('id', rowId);

  if (rowError) return { ok: false, status: 500, error: rowError.message };
  return { ok: true, data: { status: 'valid' } };
}

/**
 * Write every committable row.
 *
 * Best-effort per row rather than one transaction, matching the previous
 * importer: a mostly-good file should land, with the rest left staged and
 * explained. A single failing row rolling back nine hundred good ones is the
 * behaviour that makes people stop using an importer.
 */
export async function commitBatch(batchId: string): Promise<Result<{
  committed: number;
  skipped: number;
  failures: { line: number; message: string }[];
}>> {
  const ctx = await resolveContext();
  if (!ctx.ok) return ctx;

  const supabase = await createServerClient();
  const { data: batch } = await supabase
    .from('import_batches')
    .select('id, family, status')
    .eq('id', batchId)
    .single();

  if (!batch) return { ok: false, status: 404, error: 'No such batch.' };
  if (batch.status !== 'draft') {
    return { ok: false, status: 409, error: `This batch is already ${batch.status}.` };
  }

  const { data: rows } = await supabase
    .from('import_batch_rows')
    .select('id, line_number, resolved, status')
    .eq('batch_id', batchId)
    .in('status', ['valid', 'needs_review'])
    .order('line_number');

  const family = batch.family as EntryFamily;
  const failures: { line: number; message: string }[] = [];
  let committed = 0;
  let skipped = 0;

  for (const row of rows ?? []) {
    if (row.status !== 'valid') { skipped++; continue; }

    const r = (row.resolved ?? {}) as Record<string, string | null>;
    const result = family === 'emissions'
      ? await commitEmissionRow(r)
      : await commitMetricRow(family, r);

    if (result.ok) {
      committed++;
      await supabase.from('import_batch_rows').update({
        status: 'committed',
        created_entry_id: result.id,
        created_entry_table: family === 'emissions' ? 'emission_entries' : 'ehs_entries',
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
    } else {
      failures.push({ line: row.line_number, message: result.error });
      await supabase.from('import_batch_rows').update({
        status: 'error', error: result.error, updated_at: new Date().toISOString(),
      }).eq('id', row.id);
    }
  }

  await supabase.from('import_batches').update({
    status: 'committed',
    committed_count: committed,
    committed_at: new Date().toISOString(),
  }).eq('id', batchId);

  return { ok: true, data: { committed, skipped, failures } };
}

async function commitEmissionRow(
  r: Record<string, string | null>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const result = await createEmissionEntry({
    siteId: r.site_id ?? '',
    scope: (r.scope ?? 'scope1') as 'scope1' | 'scope2',
    sourceType: r.source_type ?? '',
    scope1Category: r.scope1_category ?? undefined,
    refrigerantCode: r.refrigerant_code ?? undefined,
    quantity: Number(r.quantity ?? 0),
    unit: r.unit ?? '',
    entryDate: r.entry_date ?? '',
    accountingMethod: (r.accounting_method ?? undefined) as
      'location_based' | 'market_based' | undefined,
    instrumentType: r.instrument_type ?? undefined,
    supplierFactor: r.supplier_factor ? Number(r.supplier_factor) : undefined,
    notes: r.notes ?? undefined,
  });
  return normalize(result);
}

async function commitMetricRow(
  family: EntryFamily,
  r: Record<string, string | null>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // metric_type comes from the catalog during staging, never from the file:
  // `safety` and `workforce` both arrive under the "social" family and only the
  // metric itself says which.
  const result = await createEhsEntry({
    siteId: r.site_id ?? undefined,
    metricType: (r.metric_type ?? family) as Parameters<typeof createEhsEntry>[0]['metricType'],
    sourceType: r.metric ?? '',
    quantity: Number(r.quantity ?? 0),
    unit: r.unit ?? '',
    entryDate: r.entry_date ?? '',
    notes: r.notes ?? undefined,
  });
  return normalize(result);
}

function normalize(
  result: { ok: true; data: unknown } | { ok: false; error: string; status?: number },
): { ok: true; id: string } | { ok: false; error: string } {
  if (!result.ok) return { ok: false, error: result.error };
  const id = (result.data as { id?: string } | null)?.id;
  return id
    ? { ok: true, id }
    : { ok: false, error: 'The entry was written but returned no id.' };
}

/** Abandon a batch without deleting it — an upload that was backed out is a fact. */
export async function discardBatch(batchId: string): Promise<Result<null>> {
  const ctx = await resolveContext();
  if (!ctx.ok) return ctx;

  const supabase = await createServerClient();
  const { error } = await supabase
    .from('import_batches')
    .update({ status: 'discarded' })
    .eq('id', batchId)
    .eq('status', 'draft');

  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, data: null };
}

function toJson(r: StagedRow): Record<string, string | null> {
  return { ...r.resolved };
}

export { applyValue, isCommittable };
