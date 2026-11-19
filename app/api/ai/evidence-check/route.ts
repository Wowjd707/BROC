import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getAiProvider, AiProviderError } from '@/lib/ai';
import { buildReadDocumentPrompt, parseDocumentReading, AI_TASK_MAX_TOKENS } from '@/lib/ai/tasks';
import { compareEvidence, readableKind, mediaTypeFor, unreadableReason } from '@/lib/evidence-check-core';
import { entryKindInfo, type CheckableRecordType } from '@/lib/evidence-check';
import { EVIDENCE_BUCKET } from '@/lib/evidence-core';
import type { Json } from '@/lib/supabase/types';

/**
 * Check one entry against a document attached to it.
 *
 * 1. Load the entry and its attachment under the caller's RLS.
 * 2. Send the file to the configured model, which reports what the document
 *    says. It is not told what was entered.
 * 3. Compare in code (lib/evidence-check-core.ts) and record the result in
 *    evidence_checks, append-only.
 *
 * The entry itself is never changed. A difference is shown to the reviewer to
 * resolve through the normal edit path.
 */
export const maxDuration = 60;

const TABLES: Record<CheckableRecordType, 'emission_entries' | 'ehs_entries'> = {
  emission_entry: 'emission_entries',
  ehs_entry: 'ehs_entries',
};

export async function POST(request: NextRequest) {
  const provider = getAiProvider();
  if (!provider) {
    return NextResponse.json({ error: 'AI assistance is not configured on this deployment.' }, { status: 503 });
  }

  let body: { recordType?: unknown; recordId?: unknown; attachmentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const recordType = body.recordType;
  if ((recordType !== 'emission_entry' && recordType !== 'ehs_entry') || typeof body.recordId !== 'string') {
    return NextResponse.json({ error: 'recordType and recordId are required.' }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin' && profile?.role !== 'editor') {
    return NextResponse.json({ error: 'Only an admin or editor can check entries against documents.' }, { status: 403 });
  }

  const { data: entry } = await supabase
    .from(TABLES[recordType])
    .select(recordType === 'emission_entry'
      ? 'id, scope, source_type, entry_date, quantity, unit'
      : 'id, metric_type, source_type, entry_date, quantity, unit')
    .eq('id', body.recordId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!entry) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 });
  const row = entry as unknown as { scope?: string; metric_type?: string; source_type: string; entry_date: string; quantity: number; unit: string };

  const info = entryKindInfo(recordType, row);
  if (!info) {
    return NextResponse.json({ error: 'Only energy, fuel, refrigerant, water and waste entries can be checked against a document.' }, { status: 422 });
  }

  let query = supabase
    .from('evidence_attachments')
    .select('id, storage_path, file_name, content_type, size_bytes')
    .eq('record_type', recordType)
    .eq('record_id', body.recordId)
    .order('created_at');
  if (typeof body.attachmentId === 'string') query = query.eq('id', body.attachmentId);
  const { data: files } = await query;
  const file = (files ?? []).find((f) => !unreadableReason(f.content_type, f.file_name, f.size_bytes));
  if (!file) {
    const first = (files ?? [])[0];
    return NextResponse.json(
      { error: first ? unreadableReason(first.content_type, first.file_name, first.size_bytes) : 'No document is attached to this entry.' },
      { status: 422 },
    );
  }

  const { data: blob, error: downloadError } = await supabase.storage.from(EVIDENCE_BUCKET).download(file.storage_path);
  if (downloadError || !blob) {
    return NextResponse.json({ error: `Could not open ${file.file_name}: ${downloadError?.message ?? 'not found'}.` }, { status: 502 });
  }
  const bytes = Buffer.from(await blob.arrayBuffer());
  const sizeProblem = unreadableReason(file.content_type, file.file_name, bytes.byteLength);
  if (sizeProblem) return NextResponse.json({ error: sizeProblem }, { status: 422 });
  const kind = readableKind(file.content_type, file.file_name)!;

  const prompt = buildReadDocumentPrompt({ commodityLabel: info.label, unitCodes: info.unitCodes, fileName: file.file_name });

  try {
    const result = await provider.complete({
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxTokens: AI_TASK_MAX_TOKENS.read_evidence_document,
      attachments: [{ kind, mediaType: mediaTypeFor(kind, file.content_type, file.file_name), data: bytes.toString('base64'), fileName: file.file_name }],
    });
    if (result.stopReason === 'refusal') {
      return NextResponse.json({ error: 'The model declined to read this document.' }, { status: 422 });
    }

    const reading = parseDocumentReading(result.text, info.unitCodes.map((u) => u.code));
    const entryForCheck = { quantity: Number(row.quantity), unit: row.unit, entryDate: row.entry_date };
    const comparison = compareEvidence(entryForCheck, reading, info.normalize);

    const { error: insertError } = await supabase.from('evidence_checks').insert({
      record_type: recordType,
      record_id: body.recordId,
      attachment_id: file.id,
      file_name: file.file_name,
      outcome: comparison.outcome,
      summary: comparison.summary,
      entry_snapshot: { quantity: entryForCheck.quantity, unit: row.unit, entry_date: row.entry_date },
      // Plain JSON round-trip: both are data-only objects.
      document_reading: JSON.parse(JSON.stringify(reading)) as Json,
      comparison: JSON.parse(JSON.stringify(comparison)) as Json,
      provider: result.providerId,
      model: result.model,
      checked_by: user.id,
    });

    return NextResponse.json({
      outcome: comparison.outcome,
      summary: comparison.summary,
      comparison,
      reading,
      fileName: file.file_name,
      model: result.model,
      checkedAt: new Date().toISOString(),
      // The check still happened and is shown; only the record of it failed.
      recordError: insertError ? `The result could not be saved: ${insertError.message}` : null,
    });
  } catch (error) {
    if (error instanceof AiProviderError) {
      return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.retryable ? 503 : 502 });
    }
    throw error;
  }
}
