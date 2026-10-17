import { NextRequest, NextResponse } from 'next/server';
import { resolveOrgContext } from '@/lib/org-context';
import { isEvidenceRecordType } from '@/lib/evidence-core';
import { removeEvidenceForDeletedRecord, sweepOrphanedEvidence } from '@/lib/evidence';

/**
 * Remove documents whose record no longer exists.
 *
 *   { recordType, recordId }  — after deleting one record; admin or editor.
 *                               Refused while the record still exists.
 *   { sweep: true }           — every orphaned attachment in the organization;
 *                               admin only (Settings → Organization).
 *
 * Every removed row lands in audit_log through the evidence trigger, so the
 * fact that a document existed survives its removal.
 */
export async function POST(request: NextRequest) {
  let body: { recordType?: unknown; recordId?: unknown; sweep?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (body.sweep === true) {
    const ctx = await resolveOrgContext(['admin']);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    try {
      return NextResponse.json(await sweepOrphanedEvidence());
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Sweep failed.' }, { status: 500 });
    }
  }

  const ctx = await resolveOrgContext(['admin', 'editor']);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  if (typeof body.recordType !== 'string' || !isEvidenceRecordType(body.recordType)
      || typeof body.recordId !== 'string') {
    return NextResponse.json({ error: 'recordType and recordId are required.' }, { status: 400 });
  }

  const result = await removeEvidenceForDeletedRecord(body.recordType, body.recordId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result.data);
}
