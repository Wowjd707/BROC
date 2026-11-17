import { createServerClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { groupAnswersByInvitation, type SurveyQuestionRow } from '@/lib/survey-questions-core';
import { ResponsesDashboardClient } from './ResponsesDashboardClient';

/**
 * Supplier survey responses across campaigns: response rates by topic and
 * campaign, who is overdue, and what suppliers answered. Everything is
 * RLS-scoped to the caller's workspace; the filtering is done client-side
 * from these rows (lib/survey-dashboard-core.ts).
 */
export default async function SupplierResponsesPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: surveys }, { data: suppliers }, { data: invitations }, { data: answerRows }, { data: questionRows }] =
    await Promise.all([
      supabase
        .from('supplier_surveys')
        .select('id, title, regulation_type, custom_regulation_name, status, due_date, created_at, launched_at, notes')
        .order('created_at', { ascending: false }),
      supabase.from('suppliers').select('id, name, country, tier'),
      fetchAll((from, to) => supabase
        .from('supplier_survey_invitations')
        .select('id, survey_id, supplier_id, supplier_name, status, sent_at, submitted_at, reminder_count')
        .order('id')
        .range(from, to)),
      fetchAll((from, to) => supabase
        .from('supplier_survey_question_responses')
        .select('invitation_id, question_id, answer')
        .order('id')
        .range(from, to)),
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
    <ResponsesDashboardClient
      surveys={surveys ?? []}
      suppliers={suppliers ?? []}
      invitations={invitations ?? []}
      answers={groupAnswersByInvitation(answerRows ?? [])}
      customQuestions={customQuestions}
    />
  );
}
