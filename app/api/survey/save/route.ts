import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveSurveySession, readSurveyBody } from '@/lib/survey-session';
import { validateSurveyAnswers } from '@/lib/survey-answers-core';

/**
 * Save draft answers from the public survey page.
 *
 * Public by design — the supplier holds a token, not a session — so the token
 * is the whole of the authorization and the answers are validated against
 * that survey's own question set before anything is written. See
 * lib/survey-answers-core.ts for why each check exists.
 */
export async function POST(req: NextRequest) {
  const body = await readSurveyBody(req);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const session = await resolveSurveySession(body.token);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
  const { invitationId, invitationStatus, surveyStatus, questions } = session.data;

  // Already submitted: the answers are final, and a late autosave must not
  // rewrite them. Reported as success because the page has nothing to fix.
  if (invitationStatus === 'submitted') return NextResponse.json({ ok: true });

  if (surveyStatus === 'closed') {
    return NextResponse.json(
      { error: 'This survey is no longer accepting responses.' },
      { status: 400 },
    );
  }

  const validated = validateSurveyAnswers(questions, body.answers, 'save');
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  if (validated.rows.length > 0) {
    const { error } = await createServiceClient()
      .from('supplier_survey_question_responses')
      .upsert(
        validated.rows.map((r) => ({ invitation_id: invitationId, ...r })),
        { onConflict: 'invitation_id,question_id' },
      );
    if (error) {
      console.error('[survey] draft save failed:', error.message);
      return NextResponse.json({ error: 'Your answers could not be saved. Please try again.' }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
