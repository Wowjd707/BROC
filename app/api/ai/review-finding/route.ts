import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getAiProvider, AiProviderError } from '@/lib/ai';
import {
  buildReviewFindingPrompt, parseFindingExplanation, findingExplanationText, AI_TASK_MAX_TOKENS,
} from '@/lib/ai/tasks';
import { findUngroundedFigures, describeUngrounded } from '@/lib/ai/grounding';
import { resolveScope } from '@/lib/scope-filter';
import { buildAnomalyReport } from '@/lib/anomaly';
import { ANOMALY_KIND_LABELS } from '@/lib/anomaly-core';

/**
 * Explain a Data Review finding and draft the note to the site.
 *
 * The request names a finding — its id, the review month and the scope — and
 * the finding is rebuilt here from the caller's own data under RLS. The browser
 * never supplies the facts, so this cannot be used to send arbitrary text to
 * the organization's model, and the model only ever sees what the platform
 * computed.
 *
 * Nothing is saved. The reviewer copies the note, edits it and sends it from
 * their own mail.
 */
export async function POST(request: NextRequest) {
  const provider = getAiProvider();
  if (!provider) {
    return NextResponse.json({ error: 'AI assistance is not configured on this deployment.' }, { status: 503 });
  }

  let body: { findingId?: unknown; asOf?: unknown; scope?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.findingId !== 'string' || typeof body.asOf !== 'string' || !/^\d{4}-\d{2}$/.test(body.asOf)) {
    return NextResponse.json({ error: 'findingId and asOf (YYYY-MM) are required.' }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin' && profile?.role !== 'editor') {
    return NextResponse.json({ error: 'Only an admin or editor can use AI review.' }, { status: 403 });
  }

  const scope = await resolveScope(typeof body.scope === 'string' ? body.scope : undefined);
  const report = await buildAnomalyReport(scope.siteIds, body.asOf);
  const finding = report.findings.find((f) => f.id === body.findingId);
  if (!finding) {
    return NextResponse.json(
      { error: 'That finding is no longer raised for this month and scope. Reload the page.' },
      { status: 404 },
    );
  }

  const prompt = buildReviewFindingPrompt({
    kindLabel: ANOMALY_KIND_LABELS[finding.kind],
    severity: finding.severity,
    siteName: finding.siteName,
    businessUnitName: finding.businessUnitName,
    streamLabel: finding.streamLabel,
    period: finding.period,
    headline: finding.headline,
    detail: finding.detail,
    basis: finding.basis,
  });

  try {
    const result = await provider.complete({
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxTokens: AI_TASK_MAX_TOKENS.explain_review_finding,
    });
    if (result.stopReason === 'refusal') {
      return NextResponse.json({ error: 'The model declined to answer this request.' }, { status: 422 });
    }
    if (!result.text) {
      return NextResponse.json({ error: 'The model returned an empty answer.' }, { status: 502 });
    }

    const parsed = parseFindingExplanation(result.text);
    const ungrounded = findUngroundedFigures(findingExplanationText(parsed), prompt.context);

    return NextResponse.json({
      ...parsed,
      provider: result.providerId,
      model: result.model,
      ungrounded,
      warning: describeUngrounded(ungrounded),
    });
  } catch (error) {
    if (error instanceof AiProviderError) {
      return NextResponse.json({ error: error.message, retryable: error.retryable }, { status: error.retryable ? 503 : 502 });
    }
    throw error;
  }
}
