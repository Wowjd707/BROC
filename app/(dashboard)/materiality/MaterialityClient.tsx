'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  assessAll, quadrantOf, summariseStakeholderInput, stakeholderDivergence, isAssessed,
  QUADRANT_LABELS, DEFAULT_THRESHOLD,
  type TopicAssessmentInput, type Score,
} from '@/lib/materiality-core';
import { Plus, AlertCircle, Info } from 'lucide-react';
import { EvidenceCell } from '@/components/evidence/EvidencePanel';

/** What a topic's conclusion means for the disclosure requirements it gates. */
function gatedRequirementNote(
  count: number,
  topic: { assessed: boolean; isMaterial: boolean },
): string {
  const reqs = `${count} disclosure requirement${count === 1 ? '' : 's'}`;
  if (!topic.assessed) return `${reqs} stay required until this topic is assessed.`;
  if (topic.isMaterial) return `Requires ${reqs}.`;
  return `${reqs} excluded from reports while this topic is below the threshold.`;
}

interface MaterialTopic {
  code: string; esrs_standard: string; category: string;
  name: string; description: string | null; sort_order: number;
}
interface Assessment {
  id: string; reporting_year: number; name: string;
  threshold: number; methodology: string | null; status: string;
}
interface TopicScore {
  id: string; assessment_id: string; topic_code: string;
  impact_scale: number; impact_scope: number; impact_irremediability: number;
  impact_likelihood: number; impact_is_actual: boolean; impact_is_negative: boolean;
  financial_magnitude: number; financial_likelihood: number;
  rationale: string | null;
}
interface Rating {
  id: string; topic_code: string; stakeholder_group: string;
  rating: number; weight: number;
}

interface Props {
  userRole: string;
  orgName: string;
  currentYear: number;
  topics: MaterialTopic[];
  assessments: Assessment[];
  activeAssessment: Assessment | null;
  topicScores: TopicScore[];
  stakeholderRatings: Rating[];
  /** Disclosure requirements gated by each topic, keyed by topic code. */
  gatedByTopic: Record<string, number>;
  loadError: string | null;
  /** Active organization; null only if the profile lookup failed. */
  organizationId: string | null;
  /** Documents attached to the active assessment. */
  evidenceCount: number;
}

const CATEGORY_BADGE: Record<string, 'default' | 'blue' | 'purple'> = {
  environmental: 'default',
  social: 'blue',
  governance: 'purple',
};

const QUADRANT_STYLE: Record<string, string> = {
  material_both: 'bg-emerald-600',
  material_impact: 'bg-emerald-400',
  material_financial: 'bg-blue-400',
  not_material: 'bg-gray-300',
};

export function MaterialityClient({
  userRole, orgName, currentYear, topics, assessments,
  activeAssessment, topicScores, stakeholderRatings, gatedByTopic, loadError,
  organizationId, evidenceCount,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const canEdit = userRole === 'admin' || userRole === 'editor';

  const [scores, setScores] = useState<TopicScore[]>(topicScores);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({
    name: `${currentYear} double materiality assessment`,
    reporting_year: String(currentYear),
    threshold: String(DEFAULT_THRESHOLD),
    methodology: '',
  });
  const [error, setError] = useState('');
  const [editingTopic, setEditingTopic] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const threshold = activeAssessment?.threshold ?? DEFAULT_THRESHOLD;
  const scoreByTopic = useMemo(() => new Map(scores.map(s => [s.topic_code, s])), [scores]);

  const results = useMemo(() => {
    const inputs: TopicAssessmentInput[] = topics.map((t) => {
      const s = scoreByTopic.get(t.code);
      if (!s) return { topicCode: t.code };
      return {
        topicCode: t.code,
        impact: {
          scale: s.impact_scale as Score,
          scope: s.impact_scope as Score,
          irremediability: s.impact_irremediability as Score,
          likelihood: s.impact_likelihood as Score,
          isActual: s.impact_is_actual,
          isNegative: s.impact_is_negative,
        },
        financial: {
          magnitude: s.financial_magnitude as Score,
          likelihood: s.financial_likelihood as Score,
        },
      };
    });
    return assessAll(inputs, threshold);
  }, [topics, scoreByTopic, threshold]);

  const resultByTopic = useMemo(() => new Map(results.map(r => [r.topicCode, r])), [results]);
  const materialCount = results.filter(r => r.isMaterial).length;

  /**
   * Topics an actual conclusion has been reached on. A row of untouched zeros
   * scores 0 on both dimensions and so looks identical to "assessed and found
   * immaterial" — but only the latter licenses excluding a disclosure.
   */
  const assessedTopics = useMemo(
    () => new Set(
      scores
        .filter(s => isAssessed({
          topicCode: s.topic_code,
          impact: {
            scale: s.impact_scale as Score,
            scope: s.impact_scope as Score,
            irremediability: s.impact_irremediability as Score,
            likelihood: s.impact_likelihood as Score,
            isActual: s.impact_is_actual,
            isNegative: s.impact_is_negative,
          },
          financial: {
            magnitude: s.financial_magnitude as Score,
            likelihood: s.financial_likelihood as Score,
          },
        }))
        .map(s => s.topic_code),
    ),
    [scores],
  );

  const stakeholderSummary = useMemo(
    () => summariseStakeholderInput(
      stakeholderRatings.map(r => ({ topicCode: r.topic_code, rating: r.rating, weight: r.weight })),
    ),
    [stakeholderRatings],
  );
  const divergence = useMemo(
    () => stakeholderDivergence(results, stakeholderSummary),
    [results, stakeholderSummary],
  );

  const topicName = (code: string) => topics.find(t => t.code === code)?.name ?? code;

  async function createAssessment() {
    if (!newForm.name.trim()) { setError('Name is required.'); return; }
    setError('');
    startTransition(async () => {
      const { error: err } = await supabase.from('materiality_assessments').insert({
        name: newForm.name.trim(),
        reporting_year: parseInt(newForm.reporting_year),
        threshold: parseFloat(newForm.threshold),
        methodology: newForm.methodology.trim() || null,
      });
      if (err) { setError(err.message); return; }
      setShowNew(false);
      router.refresh();
    });
  }

  async function saveTopicScore(code: string, patch: Partial<TopicScore>) {
    if (!activeAssessment) return;
    const existing = scoreByTopic.get(code);
    const row = {
      assessment_id: activeAssessment.id,
      topic_code: code,
      impact_scale: 0, impact_scope: 0, impact_irremediability: 0, impact_likelihood: 0,
      impact_is_actual: true, impact_is_negative: true,
      financial_magnitude: 0, financial_likelihood: 0,
      ...existing,
      ...patch,
    };
    delete (row as { id?: string }).id;

    const { data, error: err } = await supabase
      .from('topic_assessments')
      .upsert(row, { onConflict: 'assessment_id,topic_code' })
      .select().single();
    if (err) { setError(err.message); return; }

    setScores(prev => {
      const others = prev.filter(s => s.topic_code !== code);
      return [...others, data as TopicScore];
    });
  }

  if (loadError) {
    return (
      <div className="p-6 lg:p-8">
        <div className="rounded-xl bg-red-50 border border-red-200 p-4">
          <p className="text-sm font-medium text-red-800 mb-1">Could not load materiality assessments</p>
          <p className="text-sm text-red-700 font-mono">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Materiality</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            Double materiality per CSRD: each topic is assessed both for your impact on people and
            environment, and for the financial effect on the business. A topic is material if
            <strong> either</strong> dimension crosses the threshold. {orgName}
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowNew(true)}>
            <Plus size={14} className="mr-1.5" />New assessment
          </Button>
        )}
      </div>

      {!activeAssessment ? (
        <Card>
          <CardContent className="py-16 text-center">
            <AlertCircle size={22} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-600 mb-1">No materiality assessment yet</p>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              A double materiality assessment determines which ESRS topics you are obliged to report
              at all, so it is the starting point for a CSRD report — not an optional extra.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Assessment summary */}
          <Card>
            <CardContent className="py-4 flex flex-wrap items-center gap-x-8 gap-y-3">
              <div>
                <p className="text-xs text-gray-500">Assessment</p>
                <p className="text-sm font-medium text-gray-900">{activeAssessment.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Reporting year</p>
                <p className="text-sm font-medium text-gray-900">{activeAssessment.reporting_year}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Threshold</p>
                <p className="text-sm font-medium text-gray-900">{threshold} / 5</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Material topics</p>
                <p className="text-sm font-medium text-emerald-700">{materialCount} of {topics.length}</p>
              </div>
              <Badge variant={activeAssessment.status === 'final' ? 'default' : 'warning'}>
                {activeAssessment.status.replace('_', ' ')}
              </Badge>
              {/* The engagement record behind the scores: workshop notes,
                  survey results, interview summaries. An assurance provider
                  reviews the process behind a materiality conclusion, not
                  just the scores it produced. */}
              <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
                Supporting documents
                <EvidenceCell
                  key={activeAssessment.id}
                  recordType="materiality_assessment"
                  recordId={activeAssessment.id}
                  title={`${activeAssessment.name} · ${activeAssessment.reporting_year}`}
                  organizationId={organizationId}
                  canEdit={canEdit}
                  initialCount={evidenceCount}
                />
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="matrix">
            <TabsList className="mb-4">
              <TabsTrigger value="matrix">Matrix</TabsTrigger>
              <TabsTrigger value="assess">Assess topics</TabsTrigger>
              <TabsTrigger value="stakeholders">Stakeholders ({stakeholderRatings.length})</TabsTrigger>
            </TabsList>

            {/* ── Matrix ─────────────────────────────────────────────── */}
            <TabsContent value="matrix">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex gap-6">
                    {/* Plot */}
                    <div className="flex-1">
                      <div className="relative aspect-square max-w-xl mx-auto border-l-2 border-b-2 border-gray-300">
                        {/* Threshold guides */}
                        <div
                          className="absolute left-0 right-0 border-t border-dashed border-gray-300"
                          style={{ bottom: `${(threshold / 5) * 100}%` }}
                        />
                        <div
                          className="absolute top-0 bottom-0 border-l border-dashed border-gray-300"
                          style={{ left: `${(threshold / 5) * 100}%` }}
                        />
                        {results.map((r) => {
                          const q = quadrantOf(r);
                          return (
                            <div
                              key={r.topicCode}
                              title={`${topicName(r.topicCode)} — impact ${r.impactScore.toFixed(1)}, financial ${r.financialScore.toFixed(1)}`}
                              className={`absolute w-7 h-7 -ml-3.5 -mb-3.5 rounded-full ${QUADRANT_STYLE[q]} text-white text-[10px] font-semibold flex items-center justify-center shadow-sm`}
                              style={{
                                left: `${(r.financialScore / 5) * 100}%`,
                                bottom: `${(r.impactScore / 5) * 100}%`,
                              }}
                            >
                              {r.topicCode}
                            </div>
                          );
                        })}
                        <span className="absolute -left-8 top-1/2 -rotate-90 text-xs text-gray-500 whitespace-nowrap">
                          Impact materiality
                        </span>
                        <span className="absolute left-1/2 -bottom-6 -translate-x-1/2 text-xs text-gray-500">
                          Financial materiality
                        </span>
                      </div>
                    </div>

                    {/* Legend + ranked list */}
                    <div className="w-64 shrink-0 space-y-3">
                      <div className="space-y-1.5">
                        {Object.entries(QUADRANT_LABELS).map(([k, label]) => (
                          <div key={k} className="flex items-center gap-2 text-xs text-gray-600">
                            <span className={`w-3 h-3 rounded-full ${QUADRANT_STYLE[k]}`} />
                            {label}
                          </div>
                        ))}
                      </div>
                      <div className="pt-2 border-t border-gray-100 space-y-1 max-h-72 overflow-y-auto">
                        {results.map(r => (
                          <div key={r.topicCode} className="flex items-center justify-between gap-2 text-xs">
                            <span className={r.isMaterial ? 'text-gray-900 font-medium' : 'text-gray-400'}>
                              {r.topicCode} {topicName(r.topicCode)}
                            </span>
                            <span className="text-gray-400 tabular-nums shrink-0">
                              {r.maxScore.toFixed(1)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Assess ─────────────────────────────────────────────── */}
            <TabsContent value="assess">
              <Card>
                <CardContent className="p-0 divide-y divide-gray-50">
                  {topics.map(t => {
                    const s = scoreByTopic.get(t.code);
                    const r = resultByTopic.get(t.code);
                    const open = editingTopic === t.code;
                    return (
                      <div key={t.code}>
                        <button
                          onClick={() => setEditingTopic(open ? null : t.code)}
                          className="w-full text-left px-4 py-3 hover:bg-gray-50/50 flex items-start gap-3"
                        >
                          <span className="flex-1 min-w-0">
                            <span className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold text-gray-400">{t.code}</span>
                              <span className="text-sm text-gray-900">{t.name}</span>
                              <Badge variant={CATEGORY_BADGE[t.category] ?? 'secondary'}>{t.category}</Badge>
                              {r?.isMaterial && (
                                <Badge variant="default">
                                  Material ({r.basis === 'both' ? 'impact + financial' : r.basis})
                                </Badge>
                              )}
                            </span>
                            {t.description && <span className="block text-xs text-gray-400 mt-0.5">{t.description}</span>}
                            {r && (
                              <span className="block text-xs text-gray-500 mt-1">
                                Impact {r.impactScore.toFixed(1)} · Financial {r.financialScore.toFixed(1)}
                              </span>
                            )}
                            {/* The consequence of the conclusion, stated on the
                                row that decides it. An unassessed topic gates
                                nothing — "not yet assessed" is not a
                                conclusion of immateriality. */}
                            {(gatedByTopic[t.code] ?? 0) > 0 && (
                              <span className={`block text-xs mt-1 ${r?.isMaterial ? 'text-gray-500' : 'text-amber-700'}`}>
                                {gatedRequirementNote(gatedByTopic[t.code], {
                                  assessed: assessedTopics.has(t.code),
                                  isMaterial: r?.isMaterial ?? false,
                                })}
                              </span>
                            )}
                          </span>
                        </button>

                        {open && canEdit && (
                          <div className="px-4 pb-4 pl-8 grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-gray-700">Impact materiality</p>
                              {([
                                ['impact_scale', 'Scale — how grave'],
                                ['impact_scope', 'Scope — how widespread'],
                                ['impact_irremediability', 'Irremediability'],
                                ['impact_likelihood', 'Likelihood (potential impacts)'],
                              ] as const).map(([field, label]) => (
                                <ScoreRow
                                  key={field}
                                  label={label}
                                  value={(s?.[field] as number) ?? 0}
                                  disabled={field === 'impact_irremediability' && s?.impact_is_negative === false}
                                  onChange={(v) => saveTopicScore(t.code, { [field]: v } as Partial<TopicScore>)}
                                />
                              ))}
                              <div className="flex gap-4 pt-1">
                                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                                  <input
                                    type="checkbox"
                                    checked={s?.impact_is_actual ?? true}
                                    onChange={(e) => saveTopicScore(t.code, { impact_is_actual: e.target.checked })}
                                    className="rounded border-gray-300 text-emerald-600"
                                  />
                                  Actual (not potential)
                                </label>
                                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                                  <input
                                    type="checkbox"
                                    checked={s?.impact_is_negative ?? true}
                                    onChange={(e) => saveTopicScore(t.code, { impact_is_negative: e.target.checked })}
                                    className="rounded border-gray-300 text-emerald-600"
                                  />
                                  Negative impact
                                </label>
                              </div>
                              {s?.impact_is_negative === false && (
                                <p className="text-[11px] text-gray-400 flex items-start gap-1">
                                  <Info size={11} className="mt-0.5 shrink-0" />
                                  Irremediability is excluded for positive impacts — it is not a meaningful
                                  measure of a benefit.
                                </p>
                              )}
                            </div>

                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-gray-700">Financial materiality</p>
                              {([
                                ['financial_magnitude', 'Magnitude of financial effect'],
                                ['financial_likelihood', 'Likelihood'],
                              ] as const).map(([field, label]) => (
                                <ScoreRow
                                  key={field}
                                  label={label}
                                  value={(s?.[field] as number) ?? 0}
                                  onChange={(v) => saveTopicScore(t.code, { [field]: v } as Partial<TopicScore>)}
                                />
                              ))}
                              <div className="pt-2">
                                <Label>Rationale</Label>
                                <Textarea
                                  rows={3}
                                  defaultValue={s?.rationale ?? ''}
                                  onBlur={(e) => saveTopicScore(t.code, { rationale: e.target.value })}
                                  placeholder="Why this conclusion — evidence, stakeholder input, time horizon…"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Stakeholders ───────────────────────────────────────── */}
            <TabsContent value="stakeholders">
              <div className="space-y-4">
                <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800">
                  Stakeholder views are reported alongside your own scores, never blended into them —
                  an assessment that averaged the two could not show which drove a conclusion, and ESRS
                  expects stakeholder input to be evidenced.
                </div>

                {divergence.length > 0 && (
                  <Card>
                    <CardContent className="pt-5">
                      <p className="text-sm font-semibold text-gray-900 mb-1">Where stakeholders disagree</p>
                      <p className="text-xs text-gray-500 mb-3">
                        Topics stakeholders rate materially higher than your internal assessment. These are
                        the defensible challenges to your conclusions.
                      </p>
                      <div className="space-y-1.5">
                        {divergence.map(d => (
                          <div key={d.topicCode} className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-gray-900">{d.topicCode} {topicName(d.topicCode)}</span>
                            <span className="text-xs text-gray-500 tabular-nums">
                              internal {d.internalScore.toFixed(1)} · stakeholders {d.stakeholderRating.toFixed(1)}
                              <span className="text-amber-600 font-medium"> (+{d.gap.toFixed(1)})</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardContent className="p-0 overflow-x-auto">
                    {stakeholderSummary.length === 0 ? (
                      <div className="py-12 text-center text-sm text-gray-500 px-6">
                        <p className="mb-1">No stakeholder ratings recorded.</p>
                        <p className="text-xs text-gray-400">
                          Collect them however suits — the supplier survey tooling works for external
                          groups — and record them against this assessment.
                        </p>
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                            <th className="px-4 py-3 font-medium">Topic</th>
                            <th className="px-4 py-3 font-medium text-right">Avg rating</th>
                            <th className="px-4 py-3 font-medium text-right">Responses</th>
                            <th className="px-4 py-3 font-medium text-right">Your score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stakeholderSummary.map(s => (
                            <tr key={s.topicCode} className="border-b border-gray-50">
                              <td className="px-4 py-2.5 text-gray-900">{s.topicCode} {topicName(s.topicCode)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{s.averageRating.toFixed(1)}</td>
                              <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{s.responseCount}</td>
                              <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">
                                {(resultByTopic.get(s.topicCode)?.maxScore ?? 0).toFixed(1)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* New assessment */}
      <Dialog open={showNew} onOpenChange={(o) => { if (!o) setShowNew(false); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>New materiality assessment</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label required>Name</Label>
              <Input value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label required>Reporting year</Label>
                <Input type="number" value={newForm.reporting_year}
                  onChange={e => setNewForm(f => ({ ...f, reporting_year: e.target.value }))} />
              </div>
              <div>
                <Label required>Materiality threshold (1–5)</Label>
                <Input type="number" step="0.5" min="1" max="5" value={newForm.threshold}
                  onChange={e => setNewForm(f => ({ ...f, threshold: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Methodology</Label>
              <Textarea rows={3} value={newForm.methodology}
                placeholder="How topics were identified, who was consulted, time horizons considered…"
                onChange={e => setNewForm(f => ({ ...f, methodology: e.target.value }))} />
              <p className="text-xs text-gray-400 mt-1">
                ESRS requires the process to be described, not just its conclusions.
              </p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={createAssessment} disabled={isPending}>
              {isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScoreRow({
  label, value, onChange, disabled,
}: {
  label: string; value: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${disabled ? 'opacity-40' : ''}`}>
      <span className="text-xs text-gray-600 flex-1">{label}</span>
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            disabled={disabled}
            onClick={() => onChange(n)}
            className={`w-6 h-6 rounded text-[11px] font-medium transition-colors ${
              value === n
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            } ${disabled ? 'cursor-not-allowed' : ''}`}
          >
            {n === 0 ? '–' : n}
          </button>
        ))}
      </div>
    </div>
  );
}
