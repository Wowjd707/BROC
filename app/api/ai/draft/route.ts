import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getAiProvider, AiProviderError } from '@/lib/ai';
import { buildDisclosureNarrativePrompt, AI_TASK_MAX_TOKENS } from '@/lib/ai/tasks';
import { findUngroundedFigures, describeUngrounded } from '@/lib/ai/grounding';
import { getInventoryForYear } from '@/lib/disclosure-metrics';
import { resolveMetric } from '@/lib/disclosure-metrics-core';
import { activeOrg } from '@/lib/active-org';

/**
 * Draft a disclosure narrative.
 *
 * The endpoint takes a requirement id, not a prompt. Everything the model sees
 * is assembled here from data the caller can already read under RLS — which is
 * what stops this from being a general-purpose prompt proxy running on the
 * organization's API key.
 *
 * Nothing is saved. The draft comes back for the user to edit and save through
 * the normal path, so the model can never write to a reported figure.
 */

export async function POST(request: NextRequest) {
  const provider = getAiProvider();
  if (!provider) {
    return NextResponse.json(
      { error: 'AI assistance is not configured on this deployment.' },
      { status: 503 },
    );
  }

  let body: { requirementId?: string; reportingYear?: number; existingNarrative?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('role, organizations!users_organization_id_fkey(name, reporting_year_start), active_organization:organizations!users_active_organization_id_fkey(name, reporting_year_start)')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin' && profile?.role !== 'editor') {
    return NextResponse.json(
      { error: 'Only an admin or editor can draft disclosure narratives.' },
      { status: 403 },
    );
  }

  const org = activeOrg(profile);

  if (typeof body.requirementId !== 'string' || typeof body.reportingYear !== 'number') {
    return NextResponse.json(
      { error: 'requirementId and reportingYear are required.' },
      { status: 400 },
    );
  }

  const { data: requirement } = await supabase
    .from('disclosure_requirements')
    .select('requirement_code, title, description, metric_key, disclosure_frameworks(name)')
    .eq('id', body.requirementId)
    .maybeSingle();

  if (!requirement) {
    return NextResponse.json({ error: 'Unknown disclosure requirement.' }, { status: 404 });
  }

  // Facts come from the same resolver the disclosure page uses, so the model is
  // given the platform's own computed figures rather than asked to recall any.
  const inventory = await getInventoryForYear(body.reportingYear, org?.reporting_year_start ?? 1);
  const facts: { label: string; value: string }[] = [];

  if (requirement.metric_key) {
    const metric = resolveMetric(requirement.metric_key, inventory);
    if (metric && !metric.missing && metric.value != null) {
      facts.push({ label: metric.label, value: `${metric.value} ${metric.unit}` });
      for (const part of metric.breakdown ?? []) {
        facts.push({ label: part.label, value: `${part.value} ${part.unit}` });
      }
    } else if (metric) {
      // Stated explicitly. "Not measured" is a fact the narrative may report,
      // and leaving it out invites the model to fill the gap.
      facts.push({ label: metric.label, value: 'not measured in this reporting period' });
    }
  }

  const framework = (requirement as { disclosure_frameworks?: { name: string } | null })
    .disclosure_frameworks;

  const prompt = buildDisclosureNarrativePrompt({
    organizationName: org?.name ?? 'The undertaking',
    reportingYear: body.reportingYear,
    frameworkName: framework?.name ?? 'the reporting framework',
    requirementCode: requirement.requirement_code,
    requirementTitle: requirement.title,
    requirementDescription: requirement.description,
    facts,
    existingNarrative: body.existingNarrative?.trim() || null,
  });

  try {
    const result = await provider.complete({
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxTokens: AI_TASK_MAX_TOKENS.draft_disclosure_narrative,
    });

    if (result.stopReason === 'refusal') {
      return NextResponse.json(
        { error: 'The model declined to answer this request. Write the narrative manually.' },
        { status: 422 },
      );
    }
    if (!result.text) {
      return NextResponse.json({ error: 'The model returned an empty draft.' }, { status: 502 });
    }

    // Checked against the exact text the model was given, not against the whole
    // prompt — a figure the model echoed from a requirement code is not a claim
    // about the undertaking's data.
    const ungrounded = findUngroundedFigures(result.text, prompt.context);

    return NextResponse.json({
      draft: result.text,
      truncated: result.stopReason === 'max_tokens',
      provider: result.providerId,
      model: result.model,
      ungrounded,
      warning: describeUngrounded(ungrounded),
      factCount: facts.length,
    });
  } catch (error) {
    if (error instanceof AiProviderError) {
      return NextResponse.json(
        { error: error.message, retryable: error.retryable },
        { status: error.retryable ? 503 : 502 },
      );
    }
    throw error;
  }
}
