/**
 * Validating what a supplier sends back from the public survey page.
 *
 * The survey routes are the only unauthenticated writes in the application:
 * the caller holds a token, not a session, and the write goes through the
 * service role because no RLS policy can admit them. That makes this module
 * the whole of the input control on that path, so it is strict about shape:
 *
 *   - only question ids that belong to THIS survey's question set are stored;
 *     before, any key was written, so a token holder could fill the responses
 *     table with arbitrary rows that then appeared in the organization's
 *     export as if they were answers;
 *   - every answer is a string of bounded length — a JSON body of nested
 *     objects or a 50 MB string was otherwise passed straight to the database;
 *   - on submit, every required question that is visible given the other
 *     answers must be answered. The page checks this too, but a check that
 *     only runs in the supplier's browser is a suggestion.
 *
 * Pure and dependency-free so it is unit-testable.
 */
import type { SurveyQuestion } from './regulations';

/** Generous for a free-text answer; a CBAM methodology note fits many times over. */
export const MAX_ANSWER_LENGTH = 10_000;

/** No real question set comes near this; it bounds the work one request can cause. */
export const MAX_ANSWERS = 500;

export interface AnswerRow {
  question_id: string;
  answer: string;
}

export type AnswerValidation =
  | { ok: true; rows: AnswerRow[] }
  | { ok: false; error: string };

/** The same visibility rule the survey page applies. */
export function isQuestionVisible(q: SurveyQuestion, answers: Record<string, string>): boolean {
  if (!q.showWhen) return true;
  return answers[q.showWhen.questionId] === q.showWhen.answer;
}

/**
 * Check a raw `answers` payload against the survey's question set.
 *
 * `mode: 'save'` is a draft — partial answers are fine. `mode: 'submit'` is
 * final and additionally requires every visible required question.
 */
export function validateSurveyAnswers(
  questions: readonly SurveyQuestion[],
  raw: unknown,
  mode: 'save' | 'submit',
): AnswerValidation {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Answers must be an object of question id to answer.' };
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_ANSWERS) {
    return { ok: false, error: 'Too many answers in one request.' };
  }

  const known = new Set(questions.map((q) => q.id));
  const answers: Record<string, string> = {};

  for (const [id, value] of entries) {
    if (!known.has(id)) {
      return { ok: false, error: `"${id.slice(0, 60)}" is not a question in this survey.` };
    }
    if (typeof value !== 'string') {
      return { ok: false, error: 'Every answer must be text.' };
    }
    if (value.length > MAX_ANSWER_LENGTH) {
      return {
        ok: false,
        error: `An answer is longer than the ${MAX_ANSWER_LENGTH.toLocaleString('en-US')}-character limit.`,
      };
    }
    answers[id] = value;
  }

  if (mode === 'submit') {
    const missing = questions.filter(
      (q) => q.required && isQuestionVisible(q, answers) && !(answers[q.id] ?? '').trim(),
    );
    if (missing.length > 0) {
      const labels = missing.slice(0, 3).map((q) => `"${q.label}"`).join(', ');
      const more = missing.length > 3 ? ` and ${missing.length - 3} more` : '';
      return { ok: false, error: `Please answer the required question${missing.length === 1 ? '' : 's'} ${labels}${more}.` };
    }
  }

  return {
    ok: true,
    rows: Object.entries(answers).map(([question_id, answer]) => ({ question_id, answer })),
  };
}

/**
 * Invitation tokens are 32 random bytes, hex-encoded (migration 001). The
 * lower bound admits the shorter fixed tokens in `supabase/seed.sql`; the point
 * is to turn junk away before it costs a database round trip, not to pin one
 * generator.
 */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{32,128}$/i.test(token);
}
