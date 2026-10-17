'use client';

/**
 * Bespoke questionnaire builder.
 *
 * `regulation_type: 'custom'` has always been selectable, but lib/regulations
 * only ships question sets for the four regulatory surveys — so a custom survey
 * reached the supplier reading "This survey has no questions configured."
 * This panel is what fills that gap.
 *
 * Built-in regulatory sets are deliberately not editable here. They encode
 * CBAM / EUDR / PFAS requirements, and per CLAUDE.md regulatory content is not
 * something an organization should be able to reword by accident. Adding a bespoke
 * question to such a survey replaces the set wholesale, which the panel says
 * out loud rather than silently merging the two.
 */

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ChevronUp, ChevronDown, Plus, Trash2, AlertTriangle } from 'lucide-react';
import {
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  EMPTY_QUESTION_DRAFT,
  parseOptions,
  sortQuestionRows,
  slugifyQuestionKey,
  validateQuestionDraft,
  reorderQuestions,
  nextPosition,
  conditionCandidates,
  danglingConditions,
  type SurveyQuestionRow,
  type QuestionDraft,
  type QuestionOption,
} from '@/lib/survey-questions-core';
import { REGULATION_LABELS, type QuestionType } from '@/lib/regulations';

interface Props {
  surveyId: string;
  surveyTitle: string;
  regulationType: string;
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
  /** Lets the parent show a question count without re-querying. */
  onCountChange?: (surveyId: string, count: number) => void;
}

const SELECT_COLUMNS =
  'id, survey_id, position, question_key, label, question_type, required, unit, options, help_text, show_when_question_key, show_when_answer';

export function SurveyQuestionBuilder({
  surveyId,
  surveyTitle,
  regulationType,
  open,
  onClose,
  canEdit,
  onCountChange,
}: Props) {
  const supabase = createClient();

  const [rows, setRows] = useState<SurveyQuestionRow[]>([]);
  // Starts true so the first render shows the loading state without an effect
  // having to set it synchronously.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<QuestionDraft>(EMPTY_QUESTION_DRAFT);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchQuestions = useCallback(
    () =>
      supabase
        .from('supplier_survey_questions')
        .select(SELECT_COLUMNS)
        .eq('survey_id', surveyId)
        .order('position'),
    [supabase, surveyId],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    // The first statement is an await, so nothing is set synchronously in the
    // effect body. The cancel flag stops a slow response from writing state
    // after the dialog has been closed.
    (async () => {
      const { data, error: err } = await fetchQuestions();
      if (cancelled) return;

      if (err) setError(err.message);
      else {
        const loaded = (data ?? []) as SurveyQuestionRow[];
        setRows(loaded);
        setError('');
        onCountChange?.(surveyId, loaded.length);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [open, surveyId, fetchQuestions, onCountChange]);

  /** Re-sync from the server. Called from handlers, never from an effect. */
  async function reload() {
    const { data, error: err } = await fetchQuestions();
    if (err) { setError(err.message); return; }
    setRows((data ?? []) as SurveyQuestionRow[]);
  }

  const sorted = sortQuestionRows(rows);
  const dangling = new Set(danglingConditions(sorted).map(r => r.id));

  // ── Draft handling ────────────────────────────────────────────────────────

  function setField<K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) {
    setDraft(prev => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setDraft(EMPTY_QUESTION_DRAFT);
    setEditingId(null);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(row: SurveyQuestionRow) {
    setDraft({
      label: row.label,
      question_type: (QUESTION_TYPES as string[]).includes(row.question_type)
        ? (row.question_type as QuestionType)
        : 'text',
      required: row.required,
      unit: row.unit ?? '',
      options: parseOptions(row.options),
      help_text: row.help_text ?? '',
      show_when_question_key: row.show_when_question_key,
      show_when_answer: row.show_when_answer,
    });
    setEditingId(row.id);
    setFormError('');
    setShowForm(true);
  }

  /** Questions that may be used as a precondition for the one being edited. */
  function candidatesForDraft(): SurveyQuestionRow[] {
    const index = editingId ? sorted.findIndex(r => r.id === editingId) : sorted.length;
    return conditionCandidates(sorted, index === -1 ? sorted.length : index);
  }

  async function handleSave() {
    const priorKeys = candidatesForDraft().map(r => r.question_key);
    const problem = validateQuestionDraft(draft, priorKeys);
    if (problem) { setFormError(problem); return; }

    setFormError('');
    setSaving(true);

    const options = draft.question_type === 'select'
      ? draft.options.filter(o => o.value.trim() !== '')
      : [];

    const payload = {
      label: draft.label.trim(),
      question_type: draft.question_type,
      required: draft.required,
      unit: draft.unit.trim() || null,
      options,
      help_text: draft.help_text.trim() || null,
      show_when_question_key: draft.show_when_question_key || null,
      show_when_answer: draft.show_when_question_key ? (draft.show_when_answer ?? '') : null,
    };

    if (editingId) {
      // question_key is intentionally not updated: it is the join to already
      // submitted answers, and rewriting it would orphan them.
      const { data, error: err } = await supabase
        .from('supplier_survey_questions')
        .update(payload)
        .eq('id', editingId)
        .select(SELECT_COLUMNS)
        .single();
      if (err) { setFormError(err.message); setSaving(false); return; }
      setRows(rs => rs.map(r => (r.id === editingId ? (data as SurveyQuestionRow) : r)));
    } else {
      const question_key = slugifyQuestionKey(draft.label, rows.map(r => r.question_key));
      const { data, error: err } = await supabase
        .from('supplier_survey_questions')
        .insert({ ...payload, survey_id: surveyId, question_key, position: nextPosition(rows) })
        .select(SELECT_COLUMNS)
        .single();
      if (err) { setFormError(err.message); setSaving(false); return; }
      const next = [...rows, data as SurveyQuestionRow];
      setRows(next);
      onCountChange?.(surveyId, next.length);
    }

    setSaving(false);
    setShowForm(false);
  }

  async function handleMove(id: string, direction: 'up' | 'down') {
    const updates = reorderQuestions(rows, id, direction);
    if (updates.length === 0) return;

    // Optimistic: reordering is cheap to reverse and the list would otherwise
    // stutter through a round trip on every arrow press.
    setRows(rs => rs.map(r => {
      const update = updates.find(u => u.id === r.id);
      return update ? { ...r, position: update.position } : r;
    }));

    for (const update of updates) {
      const { error: err } = await supabase
        .from('supplier_survey_questions')
        .update({ position: update.position })
        .eq('id', update.id);
      if (err) { setError(err.message); reload(); return; }
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    const { error: err } = await supabase
      .from('supplier_survey_questions')
      .delete()
      .eq('id', deleteId);
    if (err) { setError(err.message); setDeleteId(null); return; }

    const next = rows.filter(r => r.id !== deleteId);
    setRows(next);
    onCountChange?.(surveyId, next.length);
    setDeleteId(null);
  }

  // ── Option rows (select questions) ────────────────────────────────────────

  function updateOption(index: number, patch: Partial<QuestionOption>) {
    setDraft(prev => ({
      ...prev,
      options: prev.options.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    }));
  }

  function addOption() {
    setDraft(prev => ({ ...prev, options: [...prev.options, { value: '', label: '' }] }));
  }

  function removeOption(index: number) {
    setDraft(prev => ({ ...prev, options: prev.options.filter((_, i) => i !== index) }));
  }

  const conditionTarget = sorted.find(r => r.question_key === draft.show_when_question_key);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Questions — {surveyTitle}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1 max-h-[65vh] overflow-y-auto">
            {regulationType !== 'custom' && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm text-amber-900">
                This is a <strong>{REGULATION_LABELS[regulationType] ?? regulationType}</strong> survey and already has a
                built-in question set covering that regulation&apos;s requirements. Adding a question
                here replaces that set entirely — the built-in questions will no longer be asked.
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            {loading ? (
              <p className="text-sm text-gray-500 py-6 text-center">Loading questions…</p>
            ) : sorted.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center">
                <p className="text-sm text-gray-500">No bespoke questions yet.</p>
                <p className="text-xs text-gray-400 mt-1">
                  {regulationType === 'custom'
                    ? 'A custom survey with no questions cannot be answered — suppliers see an empty form.'
                    : 'This survey will use its built-in question set until you add one.'}
                </p>
              </div>
            ) : (
              <ol className="space-y-2">
                {sorted.map((row, index) => (
                  <li key={row.id} className="rounded-xl border border-gray-100 p-3 hover:bg-gray-50/50">
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-gray-400 font-mono pt-1 w-5 shrink-0">{index + 1}</span>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-900">
                          {row.label}
                          {row.required && <span className="text-red-500 ml-1">*</span>}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                          <Badge variant="secondary">
                            {QUESTION_TYPE_LABELS[row.question_type as QuestionType] ?? row.question_type}
                          </Badge>
                          {row.unit && <span className="text-xs text-gray-400">in {row.unit}</span>}
                          {row.show_when_question_key && (
                            <span className="text-xs text-gray-500">
                              shown when <code className="text-gray-600">{row.show_when_question_key}</code>
                              {' = '}
                              <code className="text-gray-600">{row.show_when_answer || '(blank)'}</code>
                            </span>
                          )}
                          <code className="text-[11px] text-gray-400">{row.question_key}</code>
                        </div>
                        {dangling.has(row.id) && (
                          <p className="text-xs text-amber-700 mt-1.5 flex items-center gap-1">
                            <AlertTriangle size={12} />
                            Depends on a question that no longer exists, so it will never be shown.
                          </p>
                        )}
                      </div>

                      {canEdit && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => handleMove(row.id, 'up')}
                            disabled={index === 0}
                            aria-label="Move up"
                            className="p-1 text-gray-400 hover:text-gray-900 disabled:opacity-30"
                          >
                            <ChevronUp size={15} />
                          </button>
                          <button
                            onClick={() => handleMove(row.id, 'down')}
                            disabled={index === sorted.length - 1}
                            aria-label="Move down"
                            className="p-1 text-gray-400 hover:text-gray-900 disabled:opacity-30"
                          >
                            <ChevronDown size={15} />
                          </button>
                          <button
                            onClick={() => openEdit(row)}
                            className="text-xs text-emerald-700 hover:underline px-1.5"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteId(row.id)}
                            aria-label="Delete question"
                            className="p-1 text-gray-400 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <DialogFooter>
            {canEdit && (
              <Button variant="outline" onClick={openCreate} className="mr-auto">
                <Plus size={14} className="mr-1.5" />
                Add question
              </Button>
            )}
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / edit a single question */}
      <Dialog open={showForm} onOpenChange={(o) => { if (!o) setShowForm(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit question' : 'Add question'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
            <div>
              <Label required>Question</Label>
              <Textarea
                rows={2}
                value={draft.label}
                placeholder="e.g. What percentage of your packaging is recycled content?"
                onChange={(e) => setField('label', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label required>Answer type</Label>
                <Select
                  value={draft.question_type}
                  onValueChange={(v) => setField('question_type', v as QuestionType)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {QUESTION_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Unit (optional)</Label>
                <Input
                  value={draft.unit}
                  placeholder="%, kg, tonnes…"
                  onChange={(e) => setField('unit', e.target.value)}
                />
              </div>
            </div>

            {draft.question_type === 'select' && (
              <div>
                <Label required>Options</Label>
                <div className="space-y-2 mt-1">
                  {draft.options.map((option, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={option.label}
                        placeholder="Shown to the supplier"
                        onChange={(e) => updateOption(i, { label: e.target.value })}
                      />
                      <Input
                        value={option.value}
                        placeholder="stored_value"
                        className="font-mono text-xs"
                        onChange={(e) => updateOption(i, { value: e.target.value })}
                      />
                      <button
                        onClick={() => removeOption(i)}
                        aria-label="Remove option"
                        className="p-1 text-gray-400 hover:text-red-600 shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addOption}>
                    <Plus size={13} className="mr-1" />Add option
                  </Button>
                  <p className="text-xs text-gray-400">
                    The stored value is what lands in the export and cannot be changed later without
                    orphaning answers already given. Keep it short and stable.
                  </p>
                </div>
              </div>
            )}

            <div>
              <Label>Help text (optional)</Label>
              <Textarea
                rows={2}
                value={draft.help_text}
                placeholder="Guidance shown under the question."
                onChange={(e) => setField('help_text', e.target.value)}
              />
            </div>

            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={draft.required}
                onChange={(e) => setField('required', e.target.checked)}
                className="rounded border-gray-300 text-emerald-600"
              />
              Required — the supplier cannot submit without answering
            </label>

            {/* Conditional display */}
            <div className="rounded-xl border border-gray-100 p-3 space-y-3">
              <div>
                <Label>Only show this question when… (optional)</Label>
                <Select
                  value={draft.show_when_question_key ?? '__none__'}
                  onValueChange={(v) => {
                    if (v === '__none__') {
                      setDraft(prev => ({ ...prev, show_when_question_key: null, show_when_answer: null }));
                    } else {
                      setDraft(prev => ({ ...prev, show_when_question_key: v, show_when_answer: prev.show_when_answer ?? '' }));
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Always show" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Always show</SelectItem>
                    {candidatesForDraft().map(r => (
                      <SelectItem key={r.id} value={r.question_key}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {candidatesForDraft().length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">
                    A question can only depend on one that comes before it, and this is the first.
                  </p>
                )}
              </div>

              {draft.show_when_question_key && (
                <div>
                  <Label required>…is answered</Label>
                  {conditionTarget?.question_type === 'yes_no' ? (
                    <Select
                      value={draft.show_when_answer || 'yes'}
                      onValueChange={(v) => setField('show_when_answer', v)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">Yes</SelectItem>
                        <SelectItem value="no">No</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : conditionTarget?.question_type === 'select' ? (
                    <Select
                      value={draft.show_when_answer || ''}
                      onValueChange={(v) => setField('show_when_answer', v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {parseOptions(conditionTarget.options).map(o => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={draft.show_when_answer ?? ''}
                      placeholder="Exact answer that reveals this question"
                      onChange={(e) => setField('show_when_answer', e.target.value)}
                    />
                  )}
                </div>
              )}
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add question'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete this question?"
        description="Answers suppliers have already given to it are kept and stay visible in the responses view, marked as belonging to a removed question."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </>
  );
}
