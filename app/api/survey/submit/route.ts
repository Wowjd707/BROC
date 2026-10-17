import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveSurveySession, readSurveyBody } from '@/lib/survey-session';
import { validateSurveyAnswers } from '@/lib/survey-answers-core';

/**
 * Submit final answers from the public survey page.
 *
 * Public by design — the supplier holds a token, not a session. The answers
 * are checked against this survey's question set, including every required
 * question that is visible given the other answers, before the invitation is
 * marked submitted. See lib/survey-answers-core.ts.
 */
export async function POST(req: NextRequest) {
  const body = await readSurveyBody(req);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

  const session = await resolveSurveySession(body.token);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
  const { invitationId, invitationStatus, surveyStatus, questions } = session.data;

  if (surveyStatus === 'closed') {
    return NextResponse.json(
      { error: 'This survey is no longer accepting responses.' },
      { status: 400 },
    );
  }

  // Already submitted — idempotent.
  if (invitationStatus === 'submitted') return NextResponse.json({ ok: true });

  const validated = validateSurveyAnswers(questions, body.answers, 'submit');
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const supabase = createServiceClient();

  if (validated.rows.length > 0) {
    const { error: respError } = await supabase
      .from('supplier_survey_question_responses')
      .upsert(
        validated.rows.map((r) => ({ invitation_id: invitationId, ...r })),
        { onConflict: 'invitation_id,question_id' },
      );
    if (respError) {
      console.error('[survey] submit failed writing answers:', respError.message);
      return NextResponse.json({ error: 'Your answers could not be saved. Please try again.' }, { status: 500 });
    }
  }

  // Checked, not assumed: a supplier told "thank you" whose invitation never
  // flipped to submitted would be chased again for answers already given.
  const { error: statusError } = await supabase
    .from('supplier_survey_invitations')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', invitationId);
  if (statusError) {
    console.error('[survey] submit failed marking the invitation:', statusError.message);
    return NextResponse.json({ error: 'Your submission could not be completed. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
