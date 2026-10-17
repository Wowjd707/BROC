import { createServerClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { ImportReviewClient } from './ImportReviewClient';
import { FAMILY_COLUMNS, type EntryFamily } from '@/lib/staged-import-core';

/**
 * The review screen for a staged batch.
 *
 * Everything shown here is still uncommitted. The page fetches the rows, the
 * adjustments already recorded against them, and the vocabulary the dropdowns
 * need, so the client component never has to guess what a valid value is.
 */
export default async function ImportReviewPage({ params }: { params: Promise<{ batchId: string }> }) {
  // A Promise since Next 15; Next 16 removed the synchronous shim, so reading
  // `params.batchId` directly is undefined and every batch 404s.
  const { batchId } = await params;
  const supabase = await createServerClient();

  const { data: batch } = await supabase
    .from('import_batches')
    .select('id, family, filename, status, row_count, committed_count, created_at')
    .eq('id', batchId)
    .single();

  if (!batch) notFound();

  const { data: rows } = await supabase
    .from('import_batch_rows')
    .select('id, line_number, raw, resolved, status, error')
    .eq('batch_id', batchId)
    .order('line_number');

  const { data: adjustments } = await supabase
    .from('import_row_adjustments')
    .select('id, row_id, field, old_value, new_value, origin, reason, adjusted_at, users(first_name, last_name)')
    .in('row_id', (rows ?? []).map((r) => r.id))
    .order('adjusted_at');

  const { data: sites } = await supabase
    .from('sites').select('id, name').eq('is_active', true).order('name');

  const { data: metrics } = await supabase
    .from('sustainability_metrics')
    .select('metric_type, source_type, label, canonical_unit, aggregation')
    .eq('is_active', true);

  const family = batch.family as EntryFamily;

  return (
    <ImportReviewClient
      batch={{
        id: batch.id,
        family,
        filename: batch.filename,
        status: batch.status,
        rowCount: batch.row_count,
        committedCount: batch.committed_count,
      }}
      columns={FAMILY_COLUMNS[family]}
      rows={(rows ?? []).map((r) => ({
        id: r.id,
        lineNumber: r.line_number,
        raw: (r.raw ?? {}) as Record<string, string>,
        resolved: (r.resolved ?? {}) as Record<string, string | null>,
        status: r.status,
        error: r.error,
      }))}
      adjustments={(adjustments ?? []).map((a) => {
        const u = a.users as { first_name: string | null; last_name: string | null } | null;
        return {
          id: a.id,
          rowId: a.row_id,
          field: a.field,
          oldValue: a.old_value,
          newValue: a.new_value,
          origin: a.origin as 'auto' | 'user',
          reason: a.reason,
          adjustedAt: a.adjusted_at,
          adjustedBy: u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || null : null,
        };
      })}
      sites={(sites ?? []).map((s) => ({ id: s.id, name: s.name }))}
      catalog={(metrics ?? []).map((m) => ({
        metricType: m.metric_type,
        sourceType: m.source_type,
        label: m.label,
        canonicalUnit: m.canonical_unit,
        aggregation: m.aggregation as 'sum' | 'point_in_time' | 'average',
      }))}
    />
  );
}
