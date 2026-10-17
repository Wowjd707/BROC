import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import { sanitisePatch, type PatchValue } from '@/lib/regulatory-watch-core';
import type { Database } from '@/lib/supabase/types';

/** Nullable text columns accept a string or null; an array never belongs here. */
function asNullableText(value: PatchValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Review a proposed regulatory change.
 *
 * This is the only path from a proposal to `regulatory_items`, and it runs
 * exactly once per human decision. Two things it does that the runner cannot:
 *
 *   • The reviewer states the CONFIDENCE themselves. A model never sets it, and
 *     the patch may not carry it (enforced in `sanitisePatch` and again by a
 *     CHECK constraint in migration 025).
 *   • `last_verified` is stamped with today's date on approval. That field is
 *     what the tracker's whole freshness and confidence-decay mechanism rests
 *     on, so it must mean "a person read the source on this date" and nothing
 *     else. Approving without reading the source defeats the entire design —
 *     which is why the reviewer is shown the source link, not just the summary.
 */

const CONFIDENCE_VALUES = ['confirmed', 'high', 'medium', 'low'];

export async function POST(request: NextRequest) {
  let body: {
    proposalId?: string;
    action?: 'approve' | 'reject';
    confidence?: string;
    note?: string;
    patch?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only an admin can approve a regulatory change.' },
      { status: 403 },
    );
  }

  if (typeof body.proposalId !== 'string') {
    return NextResponse.json({ error: 'proposalId is required.' }, { status: 400 });
  }
  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject.' }, { status: 400 });
  }

  const service = createServiceClient();

  const { data: proposal } = await service
    .from('regulatory_change_proposals')
    .select('id, item_code, source_url, status, proposed_patch')
    .eq('id', body.proposalId)
    .maybeSingle();

  if (!proposal) return NextResponse.json({ error: 'Unknown proposal.' }, { status: 404 });
  if (proposal.status !== 'pending') {
    return NextResponse.json(
      { error: `This proposal has already been ${proposal.status}.` },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();

  if (body.action === 'reject') {
    await service.from('regulatory_change_proposals').update({
      status: 'rejected',
      reviewed_by: user.id,
      reviewed_at: now,
      review_note: body.note ?? null,
    }).eq('id', proposal.id);

    return NextResponse.json({ status: 'rejected' });
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  // The reviewer's edited patch wins over the stored suggestion: they may have
  // corrected the model, or written the change themselves from the source.
  const source = body.patch !== undefined ? body.patch : proposal.proposed_patch;
  const { patch, rejectedKeys } = sanitisePatch(source);

  if (typeof body.confidence !== 'string' || !CONFIDENCE_VALUES.includes(body.confidence)) {
    return NextResponse.json(
      { error: `A confidence rating is required on approval (${CONFIDENCE_VALUES.join(', ')}).` },
      { status: 400 },
    );
  }

  // Assembled field by field rather than spread. Verbose, but it is the step
  // that decides what a human approval writes into reference data, and being
  // able to read exactly that is worth the lines. It also enforces something a
  // spread would not: `stage` and `status_summary` are NOT NULL columns, so a
  // patch is never allowed to blank them.
  const update: Database['public']['Tables']['regulatory_items']['Update'] = {
    // Set here and only here. Never from a patch, never by the runner.
    confidence: body.confidence,
    last_verified: now.slice(0, 10),
    updated_at: now,
  };
  if (typeof patch.status_summary === 'string') update.status_summary = patch.status_summary;
  if (typeof patch.stage === 'string') update.stage = patch.stage;
  if (Array.isArray(patch.key_points)) update.key_points = [...patch.key_points];
  if ('next_milestone' in patch) update.next_milestone = asNullableText(patch.next_milestone);
  if ('next_milestone_date' in patch) update.next_milestone_date = asNullableText(patch.next_milestone_date);
  if ('next_milestone_note' in patch) update.next_milestone_note = asNullableText(patch.next_milestone_note);

  const { error: updateError } = await service
    .from('regulatory_items')
    .update(update)
    .eq('code', proposal.item_code);

  if (updateError) {
    return NextResponse.json(
      { error: `Could not apply the change: ${updateError.message}` },
      { status: 500 },
    );
  }

  await service.from('regulatory_change_proposals').update({
    status: 'approved',
    reviewed_by: user.id,
    reviewed_at: now,
    review_note: body.note ?? null,
    proposed_patch: { ...patch },
  }).eq('id', proposal.id);

  // Older pending proposals for the same source are now answered by this
  // decision. Left pending they would ask the reviewer to rule twice on a
  // question they have already settled.
  await service.from('regulatory_change_proposals').update({
    status: 'superseded',
  })
    .eq('item_code', proposal.item_code)
    .eq('source_url', proposal.source_url)
    .eq('status', 'pending')
    .neq('id', proposal.id);

  return NextResponse.json({
    status: 'approved',
    appliedFields: Object.keys(patch),
    rejectedKeys,
    lastVerified: update.last_verified,
  });
}
