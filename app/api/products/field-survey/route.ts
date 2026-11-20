import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { fieldSurveyPlan } from '@/lib/compliance-core';
import { isRegulationKey } from '@/lib/compliance-catalog';

/**
 * POST { regulation: 'cbam' | 'eudr' | 'ppwr' }
 *
 * Create an active survey with one question per compliance field of that
 * regulation, each mapped to its field, so "Ask supplier" works without
 * building the questions by hand. Runs on the caller's session: RLS decides
 * whether they may create surveys. The survey is ordinary afterwards — edit,
 * close or extend it on the Suppliers page like any other.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { regulation?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body.regulation !== 'string' || !isRegulationKey(body.regulation)) {
    return NextResponse.json({ error: 'Unknown regulation.' }, { status: 400 });
  }

  const plan = fieldSurveyPlan(body.regulation);
  const { data: survey, error } = await supabase
    .from('supplier_surveys')
    .insert(plan.survey)
    .select('id, title')
    .single();
  if (error || !survey) {
    return NextResponse.json({ error: error?.message ?? 'The survey could not be created.' }, { status: 400 });
  }

  const { error: qError } = await supabase
    .from('supplier_survey_questions')
    .insert(plan.questions.map((q) => ({ ...q, survey_id: survey.id })));
  if (qError) {
    // Leave no half-built survey behind: without its questions it would ask
    // the built-in set and save nothing to products.
    await supabase.from('supplier_surveys').delete().eq('id', survey.id);
    return NextResponse.json({ error: `The questions could not be created: ${qError.message}` }, { status: 400 });
  }

  return NextResponse.json({ id: survey.id, title: survey.title, questions: plan.questions.length });
}
