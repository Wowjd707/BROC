import { describe, it, expect } from 'vitest';
import {
  validateSurveyAnswers, isWellFormedToken, isQuestionVisible, MAX_ANSWER_LENGTH, MAX_ANSWERS,
} from './survey-answers-core';
import type { SurveyQuestion } from './regulations';

const QUESTIONS: SurveyQuestion[] = [
  { id: 'company', label: 'Company name', type: 'text', required: true },
  { id: 'has_data', label: 'Do you measure emissions?', type: 'select', required: true,
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
  { id: 'scope1', label: 'Scope 1 emissions', type: 'number', required: true,
    showWhen: { questionId: 'has_data', answer: 'yes' } },
  { id: 'notes', label: 'Notes', type: 'text', required: false },
];

describe('validateSurveyAnswers', () => {
  it('accepts a partial draft', () => {
    const r = validateSurveyAnswers(QUESTIONS, { company: 'Acme' }, 'save');
    expect(r).toEqual({ ok: true, rows: [{ question_id: 'company', answer: 'Acme' }] });
  });

  it('refuses a key that is not a question in this survey', () => {
    const r = validateSurveyAnswers(QUESTIONS, { company: 'Acme', injected: 'x' }, 'save');
    expect(r.ok).toBe(false);
  });

  it('refuses non-string answers', () => {
    expect(validateSurveyAnswers(QUESTIONS, { company: { a: 1 } }, 'save').ok).toBe(false);
    expect(validateSurveyAnswers(QUESTIONS, { company: 12 }, 'save').ok).toBe(false);
  });

  it('refuses a payload that is not an object', () => {
    for (const bad of [null, 'x', 3, ['company']]) {
      expect(validateSurveyAnswers(QUESTIONS, bad, 'save').ok).toBe(false);
    }
  });

  it('refuses an over-long answer', () => {
    const r = validateSurveyAnswers(QUESTIONS, { notes: 'x'.repeat(MAX_ANSWER_LENGTH + 1) }, 'save');
    expect(r.ok).toBe(false);
  });

  it('refuses too many keys before looking at them', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_ANSWERS + 1 }, (_, i) => [`q${i}`, '']));
    const r = validateSurveyAnswers(QUESTIONS, many, 'save');
    expect(r).toEqual({ ok: false, error: 'Too many answers in one request.' });
  });

  it('requires visible required questions on submit', () => {
    const r = validateSurveyAnswers(QUESTIONS, { company: 'Acme', has_data: 'yes' }, 'submit');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Scope 1 emissions');
  });

  it('does not require a question hidden by an earlier answer', () => {
    const r = validateSurveyAnswers(QUESTIONS, { company: 'Acme', has_data: 'no' }, 'submit');
    expect(r.ok).toBe(true);
  });

  it('treats whitespace as unanswered on submit', () => {
    const r = validateSurveyAnswers(QUESTIONS, { company: '   ', has_data: 'no' }, 'submit');
    expect(r.ok).toBe(false);
  });
});

describe('isQuestionVisible', () => {
  it('matches the page rule', () => {
    expect(isQuestionVisible(QUESTIONS[2], { has_data: 'yes' })).toBe(true);
    expect(isQuestionVisible(QUESTIONS[2], { has_data: 'no' })).toBe(false);
    expect(isQuestionVisible(QUESTIONS[0], {})).toBe(true);
  });
});

describe('isWellFormedToken', () => {
  it('accepts the 64-hex-character shape migration 001 generates', () => {
    expect(isWellFormedToken('a'.repeat(64))).toBe(true);
    expect(isWellFormedToken('0123456789abcdef'.repeat(4))).toBe(true);
  });
  it('accepts the shorter fixed tokens in seed.sql', () => {
    expect(isWellFormedToken('a1b2c3d4e5f60001a1b2c3d4e5f60001')).toBe(true);
  });
  it('rejects anything else before it reaches the database', () => {
    for (const bad of ['', 'abc', 'g'.repeat(64), 'a'.repeat(129), '../etc', null, 42, { token: 'x' }]) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
  });
});
