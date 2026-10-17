import 'server-only';
import { createServiceClient } from './supabase/server';
import { resolveQuestionSet, type SurveyQuestionRow } from './survey-questions-core';
import { isWellFormedToken } from './survey-answers-core';
import type { SurveyQuestion } from './regulations';

/**
 * Resolve a supplier survey token to what it is allowed to touch.
 *
 * Shared by the save and submit routes so both apply the same rules. The
 * service role is used because the caller holds a token, not a session — no
 * RLS policy can admit them — which is exactly why everything a token reaches
 * is looked up here, keyed by that token, and nothing else.
 */

export interface SurveySession {
  invitationId: string;
  invitationStatus: string;
  surveyStatus: string;
  questions: SurveyQuestion[];
}

export type SurveySessionResult =
  | { ok: true; data: SurveySession }
  | { ok: false; status: number; error: string };

export async function resolveSurveySession(token: unknown): Promise<SurveySessionResult> {
  if (!isWellFormedToken(token)) {
    return { ok: false, status: 404, error: 'Invalid survey link.' };
  }

  const supabase = createServiceClient();

  const { data: invitation } = await supabase
    .from('supplier_survey_invitations')
    .select('id, status, survey_id')
    .eq('token', token)
    .maybeSingle();
  if (!invitation) return { ok: false, status: 404, error: 'Invalid survey link.' };

  const { data: survey } = await supabase
    .from('supplier_surveys')
    .select('id, title, regulation_type, notes, status')
    .eq('id', invitation.survey_id)
    .maybeSingle();
  if (!survey) return { ok: false, status: 404, error: 'Invalid survey link.' };

  const { data: customRows } = await supabase
    .from('supplier_survey_questions')
    .select(
      'id, survey_id, position, question_key, label, question_type, required, unit, options, help_text, show_when_question_key, show_when_answer',
    )
    .eq('survey_id', survey.id)
    .order('position');

  const questionSet = resolveQuestionSet(survey, (customRows ?? []) as SurveyQuestionRow[]);

  return {
    ok: true,
    data: {
      invitationId: invitation.id,
      invitationStatus: invitation.status,
      surveyStatus: survey.status,
      questions: questionSet?.questions ?? [],
    },
  };
}

/** Parse a JSON body without letting a malformed one become a 500. */
export async function readSurveyBody(
  req: Request,
): Promise<{ token?: unknown; answers?: unknown } | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}
