'use client';

import { useState, useEffect } from 'react';
// API routes used for saves/submits (no direct Supabase client needed in public form)
import { formatDate } from '@/lib/utils';
import type { RegulationQuestionSet, SurveyQuestion } from '@/lib/regulations';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvitationInfo {
  id: string;
  token: string;
  supplier_name: string;
  email: string;
  status: string;
}

interface SurveyInfo {
  id: string;
  title: string;
  regulation_type: string;
  status: string;
  due_date: string | null;
  notes: string | null;
}

interface Props {
  invitation: InvitationInfo;
  survey: SurveyInfo;
  questionSet: RegulationQuestionSet | null;
  savedAnswers: Record<string, string>;
  alreadySubmitted: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const QUESTIONS_PER_PAGE = 5;

function isQuestionVisible(q: SurveyQuestion, answers: Record<string, string>): boolean {
  if (!q.showWhen) return true;
  return answers[q.showWhen.questionId] === q.showWhen.answer;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SurveyForm({
  invitation,
  survey,
  questionSet,
  savedAnswers,
  alreadySubmitted,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>(savedAnswers);
  const [page, setPage] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(alreadySubmitted);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const isClosed = survey.status === 'closed';
  const questions = questionSet?.questions ?? [];
  const visibleQuestions = questions.filter(q => isQuestionVisible(q, answers));

  // Paginate visible questions
  const totalPages = Math.ceil(visibleQuestions.length / QUESTIONS_PER_PAGE);
  const pageQuestions = visibleQuestions.slice(page * QUESTIONS_PER_PAGE, (page + 1) * QUESTIONS_PER_PAGE);
  const isLastPage = page === totalPages - 1;
  const progressPct = totalPages > 0 ? Math.round(((page + 1) / totalPages) * 100) : 100;

  async function handleAutoSave() {
    if (Object.keys(answers).length === 0) return;
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/survey/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: invitation.token, answers }),
      });
      // Only claim "saved" when the server said so. A redirect to a login page
      // also arrives as a 200 once fetch has followed it, so the response type
      // is checked too — that combination is how a broken save looked like a
      // working one.
      const isJson = res.headers.get('content-type')?.includes('application/json');
      setSaveStatus(res.ok && isJson ? 'saved' : 'idle');
    } catch {
      setSaveStatus('idle');
    }
  }

  // Auto-save 1.5 s after the last change. Declared after handleAutoSave so the
  // effect never reads it before it exists.
  useEffect(() => {
    if (submitted || isClosed) return;
    const timer = setTimeout(() => {
      void handleAutoSave();
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm on answer changes only
  }, [answers]);

  function setAnswer(questionId: string, value: string) {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
    setErrors(prev => { const n = { ...prev }; delete n[questionId]; return n; });
    setSaveStatus('idle');
  }

  function validatePage(): boolean {
    const errs: Record<string, string> = {};
    for (const q of pageQuestions) {
      if (q.required && !answers[q.id]?.trim()) {
        errs[q.id] = 'This field is required';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleNext() {
    if (!validatePage()) return;
    setPage(p => Math.min(p + 1, totalPages - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleBack() {
    setPage(p => Math.max(p - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit() {
    if (!validatePage()) return;
    setSubmitting(true);

    try {
      const resp = await fetch('/api/survey/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: invitation.token, answers }),
      });

      if (!resp.ok) {
        const body = await resp.json();
        setErrors({ _global: body.error ?? 'Submission failed. Please try again.' });
        setSubmitting(false);
        return;
      }

      setSubmitted(true);
    } catch (e) {
      setErrors({ _global: 'Network error. Please try again.' });
      setSubmitting(false);
    }
  }

  // ── Thank you screen ──────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-5">
            <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Survey submitted!</h1>
          <p className="text-gray-500 mb-4">
            Thank you for completing the <strong>{survey.title}</strong> survey.
            Your responses have been recorded.
          </p>
          <p className="text-sm text-gray-400">You can close this window.</p>
        </div>
      </div>
    );
  }

  // ── Closed survey ─────────────────────────────────────────────────────────
  if (isClosed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-5">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Survey closed</h1>
          <p className="text-gray-500">This survey is no longer accepting responses.</p>
        </div>
      </div>
    );
  }

  // ── No question set ───────────────────────────────────────────────────────
  if (!questionSet || questions.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-500">This survey has no questions configured.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="font-semibold text-gray-900 text-sm">{survey.title}</h1>
              <p className="text-xs text-gray-400">
                For: {invitation.supplier_name || invitation.email}
                {survey.due_date && ` · Due ${formatDate(survey.due_date)}`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">
                {page + 1} / {totalPages}
              </p>
              {saveStatus === 'saved' && (
                <p className="text-xs text-emerald-500">Saved</p>
              )}
              {saveStatus === 'saving' && (
                <p className="text-xs text-gray-400">Saving…</p>
              )}
            </div>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-gray-100 rounded-full h-1">
            <div
              className="h-1 rounded-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Form body */}
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        {/* Description (first page only) */}
        {page === 0 && questionSet.description && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
            {questionSet.description}
          </div>
        )}

        {/* Questions */}
        {pageQuestions.map(q => (
          <QuestionField
            key={q.id}
            question={q}
            value={answers[q.id] ?? ''}
            onChange={v => setAnswer(q.id, v)}
            error={errors[q.id]}
          />
        ))}

        {errors._global && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {errors._global}
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 pt-2">
          {page > 0 && (
            <button
              onClick={handleBack}
              className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
            >
              ← Back
            </button>
          )}
          {!isLastPage ? (
            <button
              onClick={handleNext}
              className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit survey'}
            </button>
          )}
        </div>

        {/* Legal footer */}
        <p className="text-xs text-gray-400 text-center">
          Your responses will only be shared with the organization that sent this survey.
          They will not be sold or shared with third parties.
        </p>
      </div>
    </div>
  );
}

// ─── Question Field ───────────────────────────────────────────────────────────

function QuestionField({
  question,
  value,
  onChange,
  error,
}: {
  question: SurveyQuestion;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const inputClass = `w-full px-3 py-2.5 rounded-xl border ${
    error ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'
  } text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`;

  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">
        {question.label}
        {question.required && <span className="text-red-500 ml-1">*</span>}
        {question.unit && <span className="text-gray-400 font-normal ml-1">({question.unit})</span>}
      </label>
      {question.helpText && (
        <p className="text-xs text-gray-500 mb-2">{question.helpText}</p>
      )}

      {question.type === 'text' && (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={3}
          className={inputClass}
          placeholder="Your answer…"
        />
      )}

      {question.type === 'number' && (
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={inputClass}
          placeholder="0"
        />
      )}

      {question.type === 'date' && (
        <input
          type="date"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={inputClass}
        />
      )}

      {question.type === 'yes_no' && (
        <div className="flex gap-3">
          {['yes', 'no'].map(opt => (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                value === opt
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {opt === 'yes' ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      )}

      {question.type === 'select' && question.options && (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className={inputClass}
        >
          <option value="">Select an option…</option>
          {question.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {question.type === 'file_or_text' && (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={3}
          className={inputClass}
          placeholder="Describe or paste relevant text / data here…"
        />
      )}

      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
