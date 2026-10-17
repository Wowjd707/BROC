/**
 * Pure logic for bespoke supplier survey questionnaires.
 *
 * Built-in question sets (CBAM, EUDR, PFAS, general carbon) live in
 * lib/regulations as TypeScript, because they encode regulatory requirements
 * that must not drift per tenant. Bespoke questions are rows in
 * supplier_survey_questions, authored by the deploying organization.
 *
 * Both reach the supplier through the same `RegulationQuestionSet` shape, so
 * the public survey form has one rendering path and one visibility rule.
 *
 * No I/O here — see lib/survey-questions.ts for the server-side loader.
 */

import type {
  QuestionType,
  RegulationQuestionSet,
  SurveyQuestion,
} from './regulations';
import { getQuestionSet } from './regulations';

export const QUESTION_TYPES: QuestionType[] = [
  'text',
  'number',
  'select',
  'yes_no',
  'date',
  'file_or_text',
];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  text: 'Short text',
  number: 'Number',
  select: 'Choose from a list',
  yes_no: 'Yes / No',
  date: 'Date',
  file_or_text: 'Document reference or text',
};

/** A row of supplier_survey_questions, as stored. */
export interface SurveyQuestionRow {
  id: string;
  survey_id: string;
  position: number;
  question_key: string;
  label: string;
  question_type: string;
  required: boolean;
  unit: string | null;
  options: unknown;
  help_text: string | null;
  show_when_question_key: string | null;
  show_when_answer: string | null;
}

/**
 * A type alias rather than an interface on purpose: options are written to a
 * JSONB column, and only aliases pick up the implicit index signature that
 * makes them assignable to the generated `Json` type.
 */
export type QuestionOption = {
  value: string;
  label: string;
};

/** The editable shape the builder UI works with, before it becomes a row. */
export interface QuestionDraft {
  label: string;
  question_type: QuestionType;
  required: boolean;
  unit: string;
  options: QuestionOption[];
  help_text: string;
  show_when_question_key: string | null;
  show_when_answer: string | null;
}

export const EMPTY_QUESTION_DRAFT: QuestionDraft = {
  label: '',
  question_type: 'text',
  required: false,
  unit: '',
  options: [],
  help_text: '',
  show_when_question_key: null,
  show_when_answer: null,
};

// ─── Options parsing ─────────────────────────────────────────────────────────

/**
 * Options arrive from JSONB as `unknown`. Anything that is not a well-formed
 * {value,label} pair is dropped rather than rendered as a blank choice the
 * supplier cannot meaningfully pick.
 */
export function parseOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return [];
  const out: QuestionOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const value = (item as Record<string, unknown>).value;
    const label = (item as Record<string, unknown>).label;
    if (typeof value !== 'string' || value === '') continue;
    out.push({
      value,
      label: typeof label === 'string' && label !== '' ? label : value,
    });
  }
  return out;
}

function isQuestionType(value: string): value is QuestionType {
  return (QUESTION_TYPES as string[]).includes(value);
}

// ─── Row → question ──────────────────────────────────────────────────────────

/**
 * An unrecognised question_type falls back to 'text' rather than throwing. A
 * stored row is already past the CHECK constraint, so this only bites if the
 * constraint and the TypeScript union drift — and a text input is a recoverable
 * degradation where a crashed survey page is not.
 */
export function rowToSurveyQuestion(row: SurveyQuestionRow): SurveyQuestion {
  const type = isQuestionType(row.question_type) ? row.question_type : 'text';

  const question: SurveyQuestion = {
    id: row.question_key,
    label: row.label,
    type,
    required: row.required,
  };

  if (row.unit) question.unit = row.unit;
  if (row.help_text) question.helpText = row.help_text;
  if (type === 'select') question.options = parseOptions(row.options);
  if (row.show_when_question_key && row.show_when_answer !== null) {
    question.showWhen = {
      questionId: row.show_when_question_key,
      answer: row.show_when_answer,
    };
  }

  return question;
}

/** Stored order is `position`, with created order breaking ties. */
export function sortQuestionRows(rows: SurveyQuestionRow[]): SurveyQuestionRow[] {
  return [...rows].sort((a, b) => a.position - b.position);
}

export function buildCustomQuestionSet(
  survey: { title: string; notes?: string | null },
  rows: SurveyQuestionRow[],
): RegulationQuestionSet {
  return {
    regulationType: 'custom',
    title: survey.title,
    description: survey.notes ?? '',
    questions: sortQuestionRows(rows).map(rowToSurveyQuestion),
  };
}

/**
 * Resolve the question set a supplier should see.
 *
 * Bespoke questions win when they exist, for any regulation type. That lets a
 * deploying organization start from 'custom' — the intended path — without silently
 * overriding a CBAM survey that has no bespoke rows and must keep its
 * regulatory question set.
 */
export function resolveQuestionSet(
  survey: { title: string; regulation_type: string; notes?: string | null },
  customRows: SurveyQuestionRow[],
): RegulationQuestionSet | null {
  if (customRows.length > 0) return buildCustomQuestionSet(survey, customRows);
  return getQuestionSet(survey.regulation_type);
}

// ─── Question keys ───────────────────────────────────────────────────────────

const MAX_KEY_LENGTH = 40;

/**
 * Derive a stable, readable key from the question label.
 *
 * Readability matters because this key is what lands in the response export and
 * in supplier_survey_question_responses.question_id — a column an assurance
 * provider may read directly, long after the label has been reworded.
 */
export function slugifyQuestionKey(label: string, existingKeys: string[] = []): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, MAX_KEY_LENGTH)
      .replace(/_+$/, '') || 'question';

  const taken = new Set(existingKeys);
  if (!taken.has(base)) return base;

  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Returns a human-readable problem, or null when the draft is sound.
 *
 * `priorKeys` are the questions that appear *before* this one. A condition may
 * only reference an earlier question: the form paginates, so pointing at a
 * later answer produces a question that cannot be revealed until after the
 * supplier has already passed it.
 */
export function validateQuestionDraft(
  draft: QuestionDraft,
  priorKeys: string[] = [],
): string | null {
  if (!draft.label.trim()) return 'A question needs a label.';

  if (!isQuestionType(draft.question_type)) {
    return 'Unknown question type.';
  }

  if (draft.question_type === 'select') {
    const options = draft.options.filter(o => o.value.trim() !== '');
    if (options.length === 0) {
      return 'A "choose from a list" question needs at least one option.';
    }
    const values = options.map(o => o.value.trim());
    if (new Set(values).size !== values.length) {
      return 'Option values must be unique.';
    }
  }

  const hasKey = !!draft.show_when_question_key;
  const hasAnswer = draft.show_when_answer !== null && draft.show_when_answer !== '';
  if (hasKey !== hasAnswer) {
    return 'A conditional question needs both a question and the answer that reveals it.';
  }
  if (hasKey && !priorKeys.includes(draft.show_when_question_key!)) {
    return 'A question can only depend on one that comes before it.';
  }

  return null;
}

// ─── Reordering ──────────────────────────────────────────────────────────────

/**
 * Move a question one slot up or down, returning only the rows whose position
 * actually changed so the caller can issue a minimal write.
 */
export function reorderQuestions(
  rows: SurveyQuestionRow[],
  questionId: string,
  direction: 'up' | 'down',
): Array<{ id: string; position: number }> {
  const sorted = sortQuestionRows(rows);
  const index = sorted.findIndex(r => r.id === questionId);
  if (index === -1) return [];

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= sorted.length) return [];

  const reordered = [...sorted];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

  // Renumber densely from 0. Positions drift after deletions, and a dense
  // rewrite keeps a swap from being a no-op when two rows share a position.
  return reordered
    .map((row, position) => ({ id: row.id, position }))
    .filter((next, i) => sorted[i].id !== next.id || sorted[i].position !== next.position);
}

/** Next position for an appended question. */
export function nextPosition(rows: SurveyQuestionRow[]): number {
  if (rows.length === 0) return 0;
  return Math.max(...rows.map(r => r.position)) + 1;
}

/**
 * Questions that may be used as a condition for the question at `index` —
 * i.e. everything before it. A question being edited cannot depend on itself.
 */
export function conditionCandidates(
  rows: SurveyQuestionRow[],
  index: number,
): SurveyQuestionRow[] {
  return sortQuestionRows(rows).slice(0, Math.max(0, index));
}

/**
 * Questions whose condition points at a key that is no longer present. These
 * render as permanently hidden, so the builder should surface them rather than
 * let an organization send a survey with silently unreachable questions.
 */
export function danglingConditions(rows: SurveyQuestionRow[]): SurveyQuestionRow[] {
  const keys = new Set(rows.map(r => r.question_key));
  return rows.filter(
    r => r.show_when_question_key !== null && !keys.has(r.show_when_question_key),
  );
}

// ─── Answers ─────────────────────────────────────────────────────────────────

/**
 * Render a stored answer for display. Answers are stored as the raw submitted
 * string, so a 'select' holds the option *value* — showing that verbatim leaks
 * an internal token ("metric_tons") where the supplier saw "Metric Tons (t)".
 */
export function answerDisplayLabel(
  question: SurveyQuestion | undefined,
  answer: string | null,
): string {
  if (answer === null || answer.trim() === '') return '—';

  if (question?.type === 'select') {
    const match = question.options?.find(o => o.value === answer);
    if (match) return match.label;
  }

  if (question?.type === 'yes_no') {
    if (answer === 'yes') return 'Yes';
    if (answer === 'no') return 'No';
  }

  return question?.unit ? `${answer} ${question.unit}` : answer;
}

export interface AnsweredQuestion {
  questionId: string;
  label: string;
  answer: string;
  /** True when the answer has no matching question in the current set. */
  orphaned: boolean;
}

/**
 * Pair a submitted answer set against a question set for display.
 *
 * Answers whose question no longer exists are kept and flagged, never dropped:
 * a supplier's submitted data is a record of what they told you, and deleting a
 * question must not quietly erase it.
 */
export function pairAnswersWithQuestions(
  questionSet: RegulationQuestionSet | null,
  answers: Record<string, string | null>,
): AnsweredQuestion[] {
  const questions = questionSet?.questions ?? [];
  const byId = new Map(questions.map(q => [q.id, q]));

  const paired: AnsweredQuestion[] = questions
    .filter(q => q.id in answers)
    .map(q => ({
      questionId: q.id,
      label: q.label,
      answer: answerDisplayLabel(q, answers[q.id]),
      orphaned: false,
    }));

  for (const [questionId, answer] of Object.entries(answers)) {
    if (byId.has(questionId)) continue;
    paired.push({
      questionId,
      label: questionId,
      answer: answerDisplayLabel(undefined, answer),
      orphaned: true,
    });
  }

  return paired;
}

/** Group flat response rows into { [invitationId]: { [questionId]: answer } }. */
export function groupAnswersByInvitation(
  rows: Array<{ invitation_id: string; question_id: string; answer: string | null }>,
): Record<string, Record<string, string | null>> {
  const out: Record<string, Record<string, string | null>> = {};
  for (const row of rows) {
    (out[row.invitation_id] ??= {})[row.question_id] = row.answer;
  }
  return out;
}

// ─── Contact tracking ────────────────────────────────────────────────────────

export interface ContactState {
  /** ISO timestamp of the most recent outbound contact. */
  at: string;
  kind: 'invite' | 'reminder';
  reminderCount: number;
}

/**
 * When was this supplier last actually contacted?
 *
 * Returns null when nothing has been sent. That is reported as "never
 * contacted" rather than as a zero or a dash, following the standing decision
 * that a missing metric reports as missing — an invitation that was created but
 * whose email failed has genuinely never reached the supplier, and showing it
 * as contacted is the misstatement worth avoiding here.
 */
export function lastContactedAt(invitation: {
  sent_at: string | null;
  last_reminded_at?: string | null;
  reminder_count?: number | null;
}): ContactState | null {
  const { sent_at, last_reminded_at } = invitation;
  const reminderCount = invitation.reminder_count ?? 0;

  if (last_reminded_at && (!sent_at || last_reminded_at > sent_at)) {
    return { at: last_reminded_at, kind: 'reminder', reminderCount };
  }
  if (sent_at) return { at: sent_at, kind: 'invite', reminderCount };
  return null;
}

/** Whole days between a contact and `now`, floored. Negative clamps to 0. */
export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  const days = Math.floor((now.getTime() - then) / 86_400_000);
  return days < 0 ? 0 : days;
}
