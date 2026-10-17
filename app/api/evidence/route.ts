import { NextRequest, NextResponse } from 'next/server';
import { resolveOrgContext } from '@/lib/org-context';
import { createServerClient } from '@/lib/supabase/server';
import {
  isEvidenceRecordType,
  organizationIdFromPath,
  validateUpload,
  EVIDENCE_BUCKET,
  EVIDENCE_RECORD_TABLES,
} from '@/lib/evidence-core';

/**
 * Evidence attachment metadata.
 *
 * The file itself goes browser → Supabase Storage directly, under the storage
 * RLS policies from migration 019. Proxying 25 MB uploads through a route
 * handler would burn memory for nothing and breaks outright on hosts that cap
 * request bodies well below that. This endpoint records what landed, and is
 * where the checks the database cannot express are made: that the attachment
 * points at a record which actually exists in the caller's organization.
 */

interface PostBody {
  recordType?: string;
  recordId?: string;
  storagePath?: string;
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  description?: string;
}

export async function POST(request: NextRequest) {
  let body: PostBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const ctx = await resolveOrgContext(['admin', 'editor']);
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.status === 403 ? 'Only an admin or editor can attach evidence.' : ctx.error },
      { status: ctx.status },
    );
  }

  const { recordType, recordId, storagePath, fileName, contentType, sizeBytes } = body;

  if (!recordType || !isEvidenceRecordType(recordType)) {
    return NextResponse.json({ error: 'Unknown evidence record type.' }, { status: 400 });
  }
  if (typeof recordId !== 'string' || typeof storagePath !== 'string' || typeof fileName !== 'string') {
    return NextResponse.json({ error: 'recordId, storagePath and fileName are required.' }, { status: 400 });
  }

  const validation = validateUpload({
    fileName,
    sizeBytes: typeof sizeBytes === 'number' ? sizeBytes : 0,
    contentType: contentType ?? '',
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // The path is what storage RLS scopes on, so a row must not be able to claim
  // an object outside the caller's organization. Reading such an object would
  // fail anyway, but a table that records impossible locations is a table that
  // cannot be trusted as an audit record.
  // The ACTIVE organization, because the storage policies in 019 scope the
  // folder name by auth_org_id(): in practice mode the upload necessarily lands
  // under the sandbox id, so comparing against the home id rejected every
  // attachment a practice session could legitimately make.
  if (organizationIdFromPath(storagePath) !== ctx.data.activeOrganizationId) {
    return NextResponse.json(
      { error: 'The storage path is not scoped to your organization.' },
      { status: 400 },
    );
  }

  // Polymorphic attachment: the database has no foreign key to enforce this, so
  // an attachment pointing at a record that does not exist — or belongs to
  // another tenant — must be rejected here or nowhere. The lookup runs under
  // RLS, so it can only find records the caller may already see.
  const table = EVIDENCE_RECORD_TABLES[recordType];
  const { data: target, error: targetError } = await supabase
    .from(table).select('id').eq('id', recordId).maybeSingle();

  if (targetError) {
    return NextResponse.json({ error: targetError.message }, { status: 400 });
  }
  if (!target) {
    return NextResponse.json(
      { error: 'The record this evidence attaches to does not exist.' },
      { status: 404 },
    );
  }

  const { data, error } = await supabase
    .from('evidence_attachments')
    .insert({
      record_type: recordType,
      record_id: recordId,
      storage_path: storagePath,
      file_name: fileName,
      content_type: contentType ?? null,
      size_bytes: typeof sizeBytes === 'number' ? sizeBytes : null,
      description: body.description?.trim() || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ attachment: data });
}

/**
 * Detach evidence: the row first, then the object.
 *
 * That order is deliberate. Losing the object while the row survives would
 * leave an attachment that renders as available and 404s when an auditor opens
 * it. The reverse leaves an unreferenced object, which costs storage and
 * nothing else. The row's deletion is captured in audit_log either way, so the
 * fact that evidence existed and was removed survives its removal.
 */
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'An attachment id is required.' }, { status: 400 });

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  // Checked here as well as by RLS. A refused RLS delete is not an error — it
  // simply matches no rows — so without this a viewer or auditor got
  // `{ ok: true }` for a document that was still attached.
  const ctx = await resolveOrgContext(['admin', 'editor']);
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.status === 403 ? 'Only an admin or editor can remove evidence.' : ctx.error },
      { status: ctx.status },
    );
  }

  const { data: attachment } = await supabase
    .from('evidence_attachments').select('id, storage_path').eq('id', id).maybeSingle();

  if (!attachment) {
    return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('evidence_attachments').delete().eq('id', id).select('id');
  if (deleteError || !deleted?.length) {
    return NextResponse.json(
      { error: deleteError?.message ?? 'The attachment could not be removed.' },
      { status: 403 },
    );
  }

  // Best-effort: the row is already gone and audit-logged. A failure here means
  // an orphaned object, which is recoverable and invisible to the user, so it
  // must not present as a failed deletion.
  const { error: storageError } = await supabase
    .storage.from(EVIDENCE_BUCKET).remove([attachment.storage_path]);

  return NextResponse.json({ ok: true, objectRemoved: !storageError });
}
