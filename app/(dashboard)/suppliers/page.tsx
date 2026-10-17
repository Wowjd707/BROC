import { createServerClient } from '@/lib/supabase/server';
import { evidenceOrganizationId, loadEvidenceCounts } from '@/lib/evidence';
import { groupAnswersByInvitation, type SurveyQuestionRow } from '@/lib/survey-questions-core';
import { SuppliersClient } from './SuppliersClient';

export default async function SuppliersPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userProfile } = await supabase
    .from('users')
    .select('organization_id, active_organization_id, role')
    .eq('id', user.id)
    .single();

  const userRole: string = userProfile?.role ?? 'viewer';

  const [{ data: suppliers }, { data: surveys }, { data: invitations }] = await Promise.all([
    supabase.from('suppliers').select('*').order('name'),
    supabase.from('supplier_surveys').select('*').order('created_at', { ascending: false }),
    supabase.from('supplier_survey_invitations').select('*'),
  ]);

  const evidenceCounts = await loadEvidenceCounts('supplier', (suppliers ?? []).map((s) => s.id));

  // Submitted answers and bespoke question definitions. Both are RLS-scoped to
  // the caller's org, so no extra filtering is needed here. Until now these
  // were only reachable as a CSV export from Reports — the answers a supplier
  // gave were collected but never shown back in the app that asked for them.
  const [{ data: answerRows }, { data: questionRows }] = await Promise.all([
    supabase
      .from('supplier_survey_question_responses')
      .select('invitation_id, question_id, answer'),
    supabase
      .from('supplier_survey_questions')
      .select(
        'id, survey_id, position, question_key, label, question_type, required, unit, options, help_text, show_when_question_key, show_when_answer',
      )
      .order('position'),
  ]);

  const customQuestions: Record<string, SurveyQuestionRow[]> = {};
  for (const row of (questionRows ?? []) as SurveyQuestionRow[]) {
    (customQuestions[row.survey_id] ??= []).push(row);
  }

  return (
    <SuppliersClient
      initialSuppliers={suppliers ?? []}
      initialSurveys={surveys ?? []}
      initialInvitations={invitations ?? []}
      initialAnswers={groupAnswersByInvitation(answerRows ?? [])}
      initialCustomQuestions={customQuestions}
      userRole={userRole}
      organizationId={evidenceOrganizationId(userProfile)}
      evidenceCounts={evidenceCounts}
    />
  );
}
