import { describe, it, expect } from 'vitest';
import {
  parseOptions,
  rowToSurveyQuestion,
  sortQuestionRows,
  buildCustomQuestionSet,
  resolveQuestionSet,
  slugifyQuestionKey,
  validateQuestionDraft,
  reorderQuestions,
  nextPosition,
  conditionCandidates,
  danglingConditions,
  answerDisplayLabel,
  pairAnswersWithQuestions,
  groupAnswersByInvitation,
  lastContactedAt,
  daysSince,
  EMPTY_QUESTION_DRAFT,
  type SurveyQuestionRow,
  type QuestionDraft,
} from './survey-questions-core';

function row(over: Partial<SurveyQuestionRow> = {}): SurveyQuestionRow {
  return {
    id: 'r1',
    survey_id: 'sv1',
    position: 0,
    question_key: 'q_one',
    label: 'Question one',
    question_type: 'text',
    required: false,
    unit: null,
    options: [],
    help_text: null,
    show_when_question_key: null,
    show_when_answer: null,
    ...over,
  };
}

function draft(over: Partial<QuestionDraft> = {}): QuestionDraft {
  return { ...EMPTY_QUESTION_DRAFT, label: 'A question', ...over };
}

describe('parseOptions', () => {
  it('keeps well-formed option pairs', () => {
    expect(parseOptions([{ value: 'a', label: 'Alpha' }])).toEqual([{ value: 'a', label: 'Alpha' }]);
  });

  it('falls back to the value when the label is missing', () => {
    expect(parseOptions([{ value: 'a' }])).toEqual([{ value: 'a', label: 'a' }]);
  });

  it('drops entries with no usable value rather than rendering a blank choice', () => {
    expect(parseOptions([{ value: '' }, { label: 'orphan' }, null, 'nope', 7])).toEqual([]);
  });

  it('returns empty for non-array JSONB', () => {
    expect(parseOptions(null)).toEqual([]);
    expect(parseOptions({ value: 'a' })).toEqual([]);
  });
});

describe('rowToSurveyQuestion', () => {
  it('maps a plain row onto the SurveyQuestion shape', () => {
    expect(rowToSurveyQuestion(row({ label: 'Country', required: true }))).toEqual({
      id: 'q_one',
      label: 'Country',
      type: 'text',
      required: true,
    });
  });

  it('omits optional fields that are unset rather than emitting nulls', () => {
    const q = rowToSurveyQuestion(row());
    expect('unit' in q).toBe(false);
    expect('helpText' in q).toBe(false);
    expect('options' in q).toBe(false);
    expect('showWhen' in q).toBe(false);
  });

  it('carries unit, help text and options through', () => {
    const q = rowToSurveyQuestion(
      row({
        question_type: 'select',
        unit: '%',
        help_text: 'Pick one',
        options: [{ value: 'a', label: 'Alpha' }],
      }),
    );
    expect(q.unit).toBe('%');
    expect(q.helpText).toBe('Pick one');
    expect(q.options).toEqual([{ value: 'a', label: 'Alpha' }]);
  });

  it('only attaches options for select questions', () => {
    const q = rowToSurveyQuestion(row({ question_type: 'text', options: [{ value: 'a', label: 'A' }] }));
    expect('options' in q).toBe(false);
  });

  it('rebuilds the showWhen condition', () => {
    const q = rowToSurveyQuestion(
      row({ show_when_question_key: 'q_zero', show_when_answer: 'yes' }),
    );
    expect(q.showWhen).toEqual({ questionId: 'q_zero', answer: 'yes' });
  });

  it('treats an empty-string condition answer as a real condition', () => {
    const q = rowToSurveyQuestion(row({ show_when_question_key: 'q_zero', show_when_answer: '' }));
    expect(q.showWhen).toEqual({ questionId: 'q_zero', answer: '' });
  });

  it('degrades an unknown stored type to text instead of throwing', () => {
    expect(rowToSurveyQuestion(row({ question_type: 'signature' })).type).toBe('text');
  });
});

describe('sortQuestionRows', () => {
  it('orders by position without mutating the input', () => {
    const rows = [row({ id: 'b', position: 2 }), row({ id: 'a', position: 1 })];
    expect(sortQuestionRows(rows).map(r => r.id)).toEqual(['a', 'b']);
    expect(rows.map(r => r.id)).toEqual(['b', 'a']);
  });
});

describe('buildCustomQuestionSet', () => {
  it('builds a question set in stored order', () => {
    const set = buildCustomQuestionSet({ title: 'Packaging survey', notes: 'Annual' }, [
      row({ id: 'b', position: 2, question_key: 'k2', label: 'Second' }),
      row({ id: 'a', position: 1, question_key: 'k1', label: 'First' }),
    ]);
    expect(set.regulationType).toBe('custom');
    expect(set.title).toBe('Packaging survey');
    expect(set.description).toBe('Annual');
    expect(set.questions.map(q => q.label)).toEqual(['First', 'Second']);
  });

  it('tolerates a survey with no notes', () => {
    expect(buildCustomQuestionSet({ title: 'T', notes: null }, []).description).toBe('');
  });
});

describe('resolveQuestionSet', () => {
  const survey = { title: 'Bespoke', regulation_type: 'custom', notes: null };

  it('returns the bespoke set when custom questions exist', () => {
    const set = resolveQuestionSet(survey, [row()]);
    expect(set?.regulationType).toBe('custom');
    expect(set?.questions).toHaveLength(1);
  });

  it('returns null for a custom survey with no questions yet', () => {
    expect(resolveQuestionSet(survey, [])).toBeNull();
  });

  it('falls back to the built-in regulatory set when there are no custom rows', () => {
    const set = resolveQuestionSet({ ...survey, regulation_type: 'cbam' }, []);
    expect(set?.regulationType).toBe('cbam');
    expect(set!.questions.length).toBeGreaterThan(0);
  });

  it('lets bespoke questions override a built-in type when present', () => {
    const set = resolveQuestionSet({ ...survey, regulation_type: 'cbam' }, [row()]);
    expect(set?.regulationType).toBe('custom');
  });
});

describe('slugifyQuestionKey', () => {
  it('derives a readable key from the label', () => {
    expect(slugifyQuestionKey('What is your annual output?')).toBe('what_is_your_annual_output');
  });

  it('collapses punctuation and trims separators', () => {
    expect(slugifyQuestionKey('  CO₂e — per unit!  ')).toBe('co_e_per_unit');
  });

  it('falls back when the label has no alphanumerics', () => {
    expect(slugifyQuestionKey('???')).toBe('question');
  });

  it('suffixes on collision', () => {
    expect(slugifyQuestionKey('Country', ['country'])).toBe('country_2');
    expect(slugifyQuestionKey('Country', ['country', 'country_2'])).toBe('country_3');
  });

  it('caps length and does not end on a separator', () => {
    const key = slugifyQuestionKey('a'.repeat(60));
    expect(key.length).toBeLessThanOrEqual(40);
    expect(key.endsWith('_')).toBe(false);
  });
});

describe('validateQuestionDraft', () => {
  it('accepts a sound draft', () => {
    expect(validateQuestionDraft(draft())).toBeNull();
  });

  it('rejects a blank label', () => {
    expect(validateQuestionDraft(draft({ label: '   ' }))).toMatch(/label/i);
  });

  it('rejects a select with no options', () => {
    expect(validateQuestionDraft(draft({ question_type: 'select', options: [] }))).toMatch(/option/i);
  });

  it('rejects a select whose only option is blank', () => {
    const d = draft({ question_type: 'select', options: [{ value: '  ', label: 'x' }] });
    expect(validateQuestionDraft(d)).toMatch(/option/i);
  });

  it('rejects duplicate option values', () => {
    const d = draft({
      question_type: 'select',
      options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'Also A' }],
    });
    expect(validateQuestionDraft(d)).toMatch(/unique/i);
  });

  it('rejects half a condition', () => {
    expect(validateQuestionDraft(draft({ show_when_question_key: 'k1' }))).toMatch(/conditional/i);
    expect(validateQuestionDraft(draft({ show_when_answer: 'yes' }))).toMatch(/conditional/i);
  });

  it('rejects a condition on a question that does not come first', () => {
    const d = draft({ show_when_question_key: 'later', show_when_answer: 'yes' });
    expect(validateQuestionDraft(d, ['earlier'])).toMatch(/before/i);
  });

  it('accepts a condition on an earlier question', () => {
    const d = draft({ show_when_question_key: 'earlier', show_when_answer: 'yes' });
    expect(validateQuestionDraft(d, ['earlier'])).toBeNull();
  });
});

describe('reorderQuestions', () => {
  const rows = [
    row({ id: 'a', position: 0 }),
    row({ id: 'b', position: 1 }),
    row({ id: 'c', position: 2 }),
  ];

  it('swaps a question with the one above it', () => {
    expect(reorderQuestions(rows, 'b', 'up')).toEqual([
      { id: 'b', position: 0 },
      { id: 'a', position: 1 },
    ]);
  });

  it('swaps a question with the one below it', () => {
    expect(reorderQuestions(rows, 'b', 'down')).toEqual([
      { id: 'c', position: 1 },
      { id: 'b', position: 2 },
    ]);
  });

  it('is a no-op at the boundaries', () => {
    expect(reorderQuestions(rows, 'a', 'up')).toEqual([]);
    expect(reorderQuestions(rows, 'c', 'down')).toEqual([]);
  });

  it('is a no-op for an unknown question', () => {
    expect(reorderQuestions(rows, 'zzz', 'up')).toEqual([]);
  });

  it('renumbers densely when stored positions have drifted apart', () => {
    const sparse = [
      row({ id: 'a', position: 0 }),
      row({ id: 'b', position: 5 }),
      row({ id: 'c', position: 9 }),
    ];
    expect(reorderQuestions(sparse, 'c', 'up')).toEqual([
      { id: 'c', position: 1 },
      { id: 'b', position: 2 },
    ]);
  });

  it('still moves rows that share a position', () => {
    const tied = [row({ id: 'a', position: 0 }), row({ id: 'b', position: 0 })];
    expect(reorderQuestions(tied, 'b', 'up')).toEqual([
      { id: 'b', position: 0 },
      { id: 'a', position: 1 },
    ]);
  });
});

describe('nextPosition', () => {
  it('starts at zero for an empty survey', () => {
    expect(nextPosition([])).toBe(0);
  });

  it('appends after the highest position, not the count', () => {
    expect(nextPosition([row({ position: 0 }), row({ position: 7 })])).toBe(8);
  });
});

describe('conditionCandidates', () => {
  const rows = [
    row({ id: 'a', position: 0, question_key: 'k_a' }),
    row({ id: 'b', position: 1, question_key: 'k_b' }),
    row({ id: 'c', position: 2, question_key: 'k_c' }),
  ];

  it('offers only earlier questions', () => {
    expect(conditionCandidates(rows, 2).map(r => r.question_key)).toEqual(['k_a', 'k_b']);
  });

  it('offers nothing for the first question', () => {
    expect(conditionCandidates(rows, 0)).toEqual([]);
  });
});

describe('danglingConditions', () => {
  it('finds questions pointing at a removed key', () => {
    const rows = [
      row({ id: 'a', question_key: 'k_a' }),
      row({ id: 'b', question_key: 'k_b', show_when_question_key: 'gone', show_when_answer: 'yes' }),
    ];
    expect(danglingConditions(rows).map(r => r.id)).toEqual(['b']);
  });

  it('is empty when every condition resolves', () => {
    const rows = [
      row({ id: 'a', question_key: 'k_a' }),
      row({ id: 'b', question_key: 'k_b', show_when_question_key: 'k_a', show_when_answer: 'yes' }),
    ];
    expect(danglingConditions(rows)).toEqual([]);
  });
});

describe('answerDisplayLabel', () => {
  const select = {
    id: 'q',
    label: 'Unit',
    type: 'select' as const,
    required: true,
    options: [{ value: 'metric_tons', label: 'Metric Tons (t)' }],
  };

  it('resolves a select value to the label the supplier saw', () => {
    expect(answerDisplayLabel(select, 'metric_tons')).toBe('Metric Tons (t)');
  });

  it('falls back to the raw value for an option that no longer exists', () => {
    expect(answerDisplayLabel(select, 'furlongs')).toBe('furlongs');
  });

  it('renders yes/no in prose', () => {
    const q = { id: 'q', label: 'V', type: 'yes_no' as const, required: true };
    expect(answerDisplayLabel(q, 'yes')).toBe('Yes');
    expect(answerDisplayLabel(q, 'no')).toBe('No');
  });

  it('appends the unit for plain answers', () => {
    const q = { id: 'q', label: 'Share', type: 'number' as const, required: false, unit: '%' };
    expect(answerDisplayLabel(q, '40')).toBe('40 %');
  });

  it('reports an unanswered question as missing rather than as zero', () => {
    expect(answerDisplayLabel(undefined, null)).toBe('—');
    expect(answerDisplayLabel(undefined, '   ')).toBe('—');
  });

  it('passes through an answer with no known question', () => {
    expect(answerDisplayLabel(undefined, 'freeform')).toBe('freeform');
  });
});

describe('pairAnswersWithQuestions', () => {
  const set = {
    regulationType: 'custom',
    title: 'T',
    description: '',
    questions: [
      { id: 'k_a', label: 'First', type: 'text' as const, required: true },
      { id: 'k_b', label: 'Second', type: 'text' as const, required: false },
    ],
  };

  it('pairs answers in question order', () => {
    const paired = pairAnswersWithQuestions(set, { k_b: 'two', k_a: 'one' });
    expect(paired.map(p => p.label)).toEqual(['First', 'Second']);
    expect(paired.map(p => p.answer)).toEqual(['one', 'two']);
  });

  it('omits questions the supplier never answered', () => {
    expect(pairAnswersWithQuestions(set, { k_a: 'one' }).map(p => p.label)).toEqual(['First']);
  });

  it('keeps an answer whose question was deleted, and flags it', () => {
    const paired = pairAnswersWithQuestions(set, { k_a: 'one', removed: 'still here' });
    expect(paired).toHaveLength(2);
    const orphan = paired.find(p => p.orphaned);
    expect(orphan?.answer).toBe('still here');
    expect(orphan?.questionId).toBe('removed');
  });

  it('shows every answer as orphaned when no question set resolves', () => {
    const paired = pairAnswersWithQuestions(null, { k_a: 'one' });
    expect(paired).toHaveLength(1);
    expect(paired[0].orphaned).toBe(true);
  });
});

describe('groupAnswersByInvitation', () => {
  it('nests flat response rows by invitation', () => {
    expect(
      groupAnswersByInvitation([
        { invitation_id: 'i1', question_id: 'a', answer: '1' },
        { invitation_id: 'i1', question_id: 'b', answer: null },
        { invitation_id: 'i2', question_id: 'a', answer: '2' },
      ]),
    ).toEqual({ i1: { a: '1', b: null }, i2: { a: '2' } });
  });

  it('returns an empty map for no rows', () => {
    expect(groupAnswersByInvitation([])).toEqual({});
  });
});

describe('lastContactedAt', () => {
  it('reports never contacted when nothing has been sent', () => {
    expect(lastContactedAt({ sent_at: null, last_reminded_at: null })).toBeNull();
  });

  it('reports the original send when there are no reminders', () => {
    const state = lastContactedAt({ sent_at: '2026-01-01T00:00:00Z', last_reminded_at: null });
    expect(state).toEqual({ at: '2026-01-01T00:00:00Z', kind: 'invite', reminderCount: 0 });
  });

  it('prefers the reminder once one is newer', () => {
    const state = lastContactedAt({
      sent_at: '2026-01-01T00:00:00Z',
      last_reminded_at: '2026-02-01T00:00:00Z',
      reminder_count: 3,
    });
    expect(state).toEqual({ at: '2026-02-01T00:00:00Z', kind: 'reminder', reminderCount: 3 });
  });

  it('keeps the original send when it is the more recent of the two', () => {
    const state = lastContactedAt({
      sent_at: '2026-03-01T00:00:00Z',
      last_reminded_at: '2026-02-01T00:00:00Z',
    });
    expect(state?.kind).toBe('invite');
  });

  it('handles a reminder with no recorded original send', () => {
    const state = lastContactedAt({ sent_at: null, last_reminded_at: '2026-02-01T00:00:00Z' });
    expect(state?.kind).toBe('reminder');
  });
});

describe('daysSince', () => {
  const now = new Date('2026-01-11T00:00:00Z');

  it('counts whole elapsed days', () => {
    expect(daysSince('2026-01-01T00:00:00Z', now)).toBe(10);
  });

  it('floors a partial day to zero', () => {
    expect(daysSince('2026-01-10T18:00:00Z', now)).toBe(0);
  });

  it('clamps a future timestamp to zero rather than reporting negative days', () => {
    expect(daysSince('2026-06-01T00:00:00Z', now)).toBe(0);
  });

  it('returns zero for an unparseable timestamp', () => {
    expect(daysSince('not-a-date', now)).toBe(0);
  });
});
