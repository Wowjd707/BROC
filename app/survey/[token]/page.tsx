import { createServiceClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { SurveyForm } from './SurveyForm';
import { resolveQuestionSet, type SurveyQuestionRow } from '@/lib/survey-questions-core';

// `params` is a Promise in Next 16. Reading it synchronously still resolves via
// a compatibility shim, but logs a sync-dynamic-apis error on every request and
// is slated for removal — so it is awaited here.
export default async function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Use service client — this is a public page (no auth)
  const supabase = createServiceClient();

  // Look up invitation by token
  const { data: invitation } = await supabase
    .from('supplier_survey_invitations')
    .select('*, supplier_surveys(id, title, regulation_type, status, due_date, notes)')
    .eq('token', token)
    .single();

  if (!invitation) notFound();

  const survey = invitation.supplier_surveys;
  if (!survey) notFound();

  // Check if already submitted
  const alreadySubmitted = invitation.status === 'submitted';

  // Load the question set. Bespoke questions are read with the service client
  // for the same reason the invitation above is: this page is public, the
  // caller is holding a token rather than a session, and no RLS policy grants
  // the anon role access to another org's survey definitions.
  const { data: customQuestions } = await supabase
    .from('supplier_survey_questions')
    .select(
      'id, survey_id, position, question_key, label, question_type, required, unit, options, help_text, show_when_question_key, show_when_answer',
    )
    .eq('survey_id', survey.id)
    .order('position');

  const questionSet = resolveQuestionSet(survey, (customQuestions ?? []) as SurveyQuestionRow[]);

  // Load existing responses if any
  const { data: existingResponses } = await supabase
    .from('supplier_survey_question_responses')
    .select('question_id, answer')
    .eq('invitation_id', invitation.id);

  const savedAnswers = Object.fromEntries(
    (existingResponses ?? []).map(r => [r.question_id, r.answer ?? '']),
  );

  return (
    <SurveyForm
      invitation={{
        id: invitation.id,
        token: invitation.token,
        supplier_name: invitation.supplier_name ?? '',
        email: invitation.email ?? '',
        status: invitation.status,
      }}
      survey={{
        id: survey.id,
        title: survey.title,
        regulation_type: survey.regulation_type,
        status: survey.status,
        due_date: survey.due_date,
        notes: survey.notes,
      }}
      questionSet={questionSet}
      savedAnswers={savedAnswers}
      alreadySubmitted={alreadySubmitted}
    />
  );
}
