'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/utils';
import { regulationLabel } from '@/lib/regulations';
import { resolveQuestionSet, type SurveyQuestionRow } from '@/lib/survey-questions-core';
import {
  buildDashboard,
  DEFAULT_FILTERS,
  questionGroupKey,
  summariseAnswers,
  topicKey,
  topicOptions,
  type DashFilters,
  type DashInvitation,
  type DashSupplier,
  type DashSurvey,
  type SupplierRow,
} from '@/lib/survey-dashboard-core';

interface Props {
  surveys: (DashSurvey & { notes: string | null })[];
  suppliers: DashSupplier[];
  invitations: DashInvitation[];
  answers: Record<string, Record<string, string | null>>;
  customQuestions: Record<string, SurveyQuestionRow[]>;
  /** Set when a query failed, so an empty page is never mistaken for "no surveys". */
  loadError?: string | null;
}

const STATUS_STYLE: Record<SupplierRow['status'], { label: string; variant: 'default' | 'secondary' | 'warning' | 'destructive' }> = {
  responded: { label: 'Responded', variant: 'default' },
  overdue: { label: 'Overdue', variant: 'destructive' },
  waiting: { label: 'Waiting', variant: 'warning' },
  'not emailed': { label: 'Not emailed', variant: 'secondary' },
};

function pct(rate: number | null): string {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`;
}

function fmtNum(n: number): string {
  return Math.abs(n) >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(Number(n.toPrecision(4)));
}

export function ResponsesDashboardClient({ surveys, suppliers, invitations, answers, customQuestions, loadError }: Props) {
  const [filters, setFilters] = useState<DashFilters>(DEFAULT_FILTERS);
  const [showAllSuppliers, setShowAllSuppliers] = useState(false);
  const [groupChoice, setGroupChoice] = useState<string | null>(null);
  const set = <K extends keyof DashFilters>(key: K, value: DashFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value, ...(key === 'topic' ? { campaign: 'all' } : {}) }));

  const topics = useMemo(() => topicOptions(surveys), [surveys]);
  const campaigns = useMemo(
    () => surveys.filter((s) => filters.topic === 'all' || topicKey(s) === filters.topic),
    [surveys, filters.topic],
  );
  const countries = useMemo(
    () => [...new Set(suppliers.map((s) => s.country).filter((c): c is string => !!c))].sort(),
    [suppliers],
  );

  const data = useMemo(() => buildDashboard(surveys, invitations, suppliers, filters), [surveys, invitations, suppliers, filters]);

  // Answer summaries: one question group at a time (see questionGroupKey).
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; surveyIds: string[] }>();
    for (const s of data.surveys) {
      const key = questionGroupKey(s, (customQuestions[s.id] ?? []).length > 0);
      const label = key.startsWith('topic:')
        ? `${regulationLabel(s.regulation_type, s.custom_regulation_name)} (all campaigns)`
        : s.title;
      if (!map.has(key)) map.set(key, { key, label, surveyIds: [] });
      map.get(key)!.surveyIds.push(s.id);
    }
    return [...map.values()];
  }, [data.surveys, customQuestions]);

  const activeGroup = groups.find((g) => g.key === groupChoice) ?? groups[0] ?? null;

  const answerSummary = useMemo(() => {
    if (!activeGroup) return null;
    const first = surveys.find((s) => s.id === activeGroup.surveyIds[0]);
    if (!first) return null;
    const questionSet = resolveQuestionSet(first, customQuestions[first.id] ?? []);
    if (!questionSet) return null;
    const supplierById = new Map(suppliers.map((s) => [s.id, s.name]));
    const respondents = data.invitations
      .filter((i) => activeGroup.surveyIds.includes(i.survey_id) && i.status === 'submitted')
      .map((i) => ({
        supplier: (i.supplier_id && supplierById.get(i.supplier_id)) || i.supplier_name || 'Supplier',
        answers: answers[i.id] ?? {},
      }));
    return { respondents: respondents.length, questions: summariseAnswers(questionSet, respondents) };
  }, [activeGroup, surveys, customQuestions, suppliers, data.invitations, answers]);

  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);
  const supplierRows = showAllSuppliers ? data.suppliers : data.suppliers.slice(0, 25);

  const topicChart = data.byTopic.map((t) => ({
    name: t.label,
    Responded: t.responded,
    'Not yet': t.invited - t.responded,
  }));

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/suppliers" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Suppliers
          </Link>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">Survey responses</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            How suppliers are responding across your campaigns, by topic, and what they told you.
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 items-end">
            <div>
              <Label className="text-xs">Topic</Label>
              <Select value={filters.topic} onValueChange={(v) => set('topic', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All topics</SelectItem>
                  {topics.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 md:col-span-1 xl:col-span-2">
              <Label className="text-xs">Campaign</Label>
              <Select value={filters.campaign} onValueChange={(v) => set('campaign', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All campaigns</SelectItem>
                  {campaigns.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filters.status} onValueChange={(v) => set('status', v as DashFilters['status'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="launched">Launched</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="draft">Drafts</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="launched-from">Launched from</Label>
              <Input id="launched-from" type="date" value={filters.launchedFrom} onChange={(e) => set('launchedFrom', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs" htmlFor="launched-to">Launched to</Label>
              <Input id="launched-to" type="date" value={filters.launchedTo} onChange={(e) => set('launchedTo', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Tier</Label>
                <Select value={filters.tier} onValueChange={(v) => set('tier', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Country</Label>
                <Select value={filters.country} onValueChange={(v) => set('country', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          {filtered && (
            <div className="mt-3">
              <Button size="sm" variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {loadError ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-red-700">
            Survey data could not be loaded: {loadError}. This usually means a database migration has not been
            applied; run <code>supabase/verify_install.sql</code> to see which.
          </CardContent>
        </Card>
      ) : surveys.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-gray-500">
            No surveys yet. Create one on the <Link className="text-emerald-700 hover:underline" href="/suppliers">Suppliers</Link> page.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Headline numbers */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            {[
              { label: 'Campaigns', value: String(data.totals.campaigns) },
              { label: 'Suppliers asked', value: String(data.totals.invited), sub: `${data.totals.emailed} emailed` },
              { label: 'Responded', value: String(data.totals.responded), sub: `${pct(data.totals.rate)} response rate` },
              { label: 'Overdue', value: String(data.totals.overdue), sub: 'past due, not submitted', warn: data.totals.overdue > 0 },
              { label: 'Reminders sent', value: String(data.totals.reminders) },
              {
                label: 'Median time to respond',
                value: data.totals.medianDaysToRespond == null ? '—' : `${Math.round(data.totals.medianDaysToRespond)} days`,
                sub: 'from invitation to submission',
              },
            ].map((t) => (
              <Card key={t.label}>
                <CardContent className="pt-5 pb-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{t.label}</p>
                  <p className={`text-2xl font-semibold mt-1 ${t.warn ? 'text-red-600' : 'text-gray-900'}`}>{t.value}</p>
                  {t.sub && <p className="text-xs text-gray-500 mt-0.5">{t.sub}</p>}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Responses by topic</CardTitle></CardHeader>
              <CardContent>
                {topicChart.length === 0 ? (
                  <p className="text-sm text-gray-500">No campaigns match these filters.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(160, topicChart.length * 44 + 60)}>
                    <BarChart data={topicChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Responded" stackId="a" fill="#10b981" />
                      <Bar dataKey="Not yet" stackId="a" fill="#e5e7eb" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Responses per week</CardTitle></CardHeader>
              <CardContent>
                {data.weekly.length === 0 ? (
                  <p className="text-sm text-gray-500">No responses yet for these filters.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.weekly.map((w) => ({ week: formatDate(w.week), Responses: w.responses }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="Responses" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Campaigns */}
          <Card>
            <CardHeader><CardTitle className="text-base">Campaigns</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-4 font-medium">Campaign</th>
                    <th className="py-2 pr-4 font-medium">Topic</th>
                    <th className="py-2 pr-4 font-medium">Launched</th>
                    <th className="py-2 pr-4 font-medium">Due</th>
                    <th className="py-2 pr-4 font-medium text-right">Asked</th>
                    <th className="py-2 pr-4 font-medium text-right">Responded</th>
                    <th className="py-2 pr-4 font-medium text-right">Rate</th>
                    <th className="py-2 pr-4 font-medium text-right">Overdue</th>
                    <th className="py-2 font-medium text-right">Reminders</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byCampaign.map((c) => (
                    <tr key={c.survey.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-2.5 pr-4">
                        <span className="font-medium text-gray-900">{c.survey.title}</span>
                        <Badge variant="secondary" className="ml-2 text-[10px]">{c.survey.status}</Badge>
                      </td>
                      <td className="py-2.5 pr-4 text-gray-600">{c.topic}</td>
                      <td className="py-2.5 pr-4 text-gray-600">{c.launched ? formatDate(c.launched) : 'Not launched'}</td>
                      <td className="py-2.5 pr-4 text-gray-600">{c.survey.due_date ? formatDate(c.survey.due_date) : '—'}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{c.invited}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{c.responded}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{pct(c.rate)}</td>
                      <td className={`py-2.5 pr-4 text-right tabular-nums ${c.overdue > 0 ? 'text-red-600 font-medium' : ''}`}>{c.overdue}</td>
                      <td className="py-2.5 text-right tabular-nums">{c.reminders}</td>
                    </tr>
                  ))}
                  {data.byCampaign.length === 0 && (
                    <tr><td colSpan={9} className="py-6 text-center text-gray-500">No campaigns match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Answers */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base">What suppliers answered</CardTitle>
                {groups.length > 1 && (
                  <Select value={activeGroup?.key} onValueChange={setGroupChoice}>
                    <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Campaigns on the same built-in topic ask the same questions, so their answers are combined. A campaign
                with its own questions is shown on its own.
              </p>
            </CardHeader>
            <CardContent>
              {!answerSummary ? (
                <p className="text-sm text-gray-500">No campaigns match these filters.</p>
              ) : answerSummary.respondents === 0 ? (
                <p className="text-sm text-gray-500">No responses yet for {activeGroup?.label}.</p>
              ) : (
                <div className="space-y-5">
                  <p className="text-sm text-gray-600">
                    {answerSummary.respondents} supplier{answerSummary.respondents === 1 ? '' : 's'} responded.
                  </p>
                  {answerSummary.questions.map((q) => (
                    <div key={q.question.id} className="border-t border-gray-100 pt-4 first:border-0 first:pt-0">
                      <p className="text-sm font-medium text-gray-900">{q.question.label}</p>
                      <p className="text-xs text-gray-500 mb-2">
                        {q.answered} of {answerSummary.respondents} answered
                      </p>
                      {q.kind === 'choice' && (
                        <div className="space-y-1.5 max-w-xl">
                          {q.options.map((o) => (
                            <div key={o.label} className="flex items-center gap-3 text-sm">
                              <span className="w-48 shrink-0 truncate text-gray-700" title={o.label}>{o.label}</span>
                              <div className="flex-1 h-2 rounded-full bg-gray-100">
                                <div
                                  className="h-2 rounded-full bg-emerald-500"
                                  style={{ width: `${q.answered ? (o.count / q.answered) * 100 : 0}%` }}
                                />
                              </div>
                              <span className="w-8 text-right tabular-nums text-gray-600">{o.count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {q.kind === 'number' && (
                        <p className="text-sm text-gray-700 tabular-nums">
                          Lowest {fmtNum(q.min)} · median {fmtNum(q.median)} · highest {fmtNum(q.max)}
                          {q.question.unit ? ` ${q.question.unit}` : ''}
                        </p>
                      )}
                      {q.kind === 'text' && (
                        q.samples.length === 0 ? (
                          <p className="text-sm text-gray-400">No answers yet.</p>
                        ) : (
                          <ul className="space-y-1">
                            {q.samples.map((sample, i) => (
                              <li key={i} className="text-sm text-gray-700">
                                <span className="text-gray-500">{sample.supplier}:</span> {sample.answer}
                              </li>
                            ))}
                            {q.answered > q.samples.length && (
                              <li className="text-xs text-gray-500">
                                and {q.answered - q.samples.length} more. The full set is in the export on the Reports page.
                              </li>
                            )}
                          </ul>
                        )
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Suppliers */}
          <Card>
            <CardHeader><CardTitle className="text-base">Suppliers</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-4 font-medium">Supplier</th>
                    <th className="py-2 pr-4 font-medium">Campaign</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Emailed</th>
                    <th className="py-2 pr-4 font-medium">Responded</th>
                    <th className="py-2 font-medium text-right">Reminders</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierRows.map((r) => (
                    <tr key={r.invitationId} className="border-b border-gray-50 last:border-0">
                      <td className="py-2.5 pr-4">
                        <span className="font-medium text-gray-900">{r.supplier}</span>
                        {(r.country || r.tier) && (
                          <span className="block text-xs text-gray-500">
                            {[r.country, r.tier ? `Tier ${r.tier}` : null].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-gray-600">
                        {r.campaign}
                        <span className="block text-xs text-gray-500">{r.topic}</span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge variant={STATUS_STYLE[r.status].variant} className="text-xs">{STATUS_STYLE[r.status].label}</Badge>
                      </td>
                      <td className="py-2.5 pr-4 text-gray-600">{r.emailedAt ? formatDate(r.emailedAt) : '—'}</td>
                      <td className="py-2.5 pr-4 text-gray-600">{r.respondedAt ? formatDate(r.respondedAt) : '—'}</td>
                      <td className="py-2.5 text-right tabular-nums">{r.reminders}</td>
                    </tr>
                  ))}
                  {data.suppliers.length === 0 && (
                    <tr><td colSpan={6} className="py-6 text-center text-gray-500">No suppliers match these filters.</td></tr>
                  )}
                </tbody>
              </table>
              {data.suppliers.length > 25 && (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAllSuppliers((v) => !v)}>
                  {showAllSuppliers ? 'Show fewer' : `Show all ${data.suppliers.length}`}
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
