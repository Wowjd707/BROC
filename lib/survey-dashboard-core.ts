/**
 * Aggregations for the supplier-survey response dashboard. Pure; no I/O.
 *
 * Every figure is counted from invitation rows, so the dashboard and the
 * survey cards on the Suppliers page agree:
 *   invited     invitation rows (one per supplier asked)
 *   emailed     invitations whose email actually went out (sent_at set)
 *   responded   invitations with status 'submitted'
 *   rate        responded / invited, the same ratio the survey card shows
 *   overdue     not submitted, on an active survey whose due date has passed
 *
 * "Topic" is the regulation a survey is about: CBAM, EUDR, PFAS, general
 * carbon, or the name given to a custom one. Two custom surveys with the same
 * name are the same topic.
 */

import type { RegulationQuestionSet, SurveyQuestion } from './regulations';
import { regulationLabel } from './regulations';
import { answerDisplayLabel } from './survey-questions-core';

export interface DashSurvey {
  id: string;
  title: string;
  regulation_type: string;
  custom_regulation_name: string | null;
  status: string;
  due_date: string | null;
  created_at: string;
  launched_at: string | null;
}

export interface DashInvitation {
  id: string;
  survey_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  status: string;
  sent_at: string | null;
  submitted_at: string | null;
  reminder_count: number | null;
}

export interface DashSupplier {
  id: string;
  name: string;
  country: string | null;
  tier: number | null;
}

export interface DashFilters {
  /** Topic key from topicKey(), or 'all'. */
  topic: string;
  /** Survey id, or 'all'. */
  campaign: string;
  /** 'launched' = active or closed. */
  status: 'launched' | 'active' | 'closed' | 'draft' | 'all';
  /** Inclusive YYYY-MM-DD bounds on the launch date; '' for no bound. */
  launchedFrom: string;
  launchedTo: string;
  /** '1' | '2' | '3' | 'all' */
  tier: string;
  /** Country name, or 'all'. */
  country: string;
}

export const DEFAULT_FILTERS: DashFilters = {
  topic: 'all',
  campaign: 'all',
  status: 'launched',
  launchedFrom: '',
  launchedTo: '',
  tier: 'all',
  country: 'all',
};

export function topicKey(s: Pick<DashSurvey, 'regulation_type' | 'custom_regulation_name'>): string {
  if (s.regulation_type === 'custom') {
    return `custom:${(s.custom_regulation_name ?? '').trim().toLowerCase()}`;
  }
  return s.regulation_type;
}

export function topicOptions(surveys: DashSurvey[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const s of surveys) {
    const key = topicKey(s);
    if (!seen.has(key)) seen.set(key, regulationLabel(s.regulation_type, s.custom_regulation_name));
  }
  return [...seen.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The launch date, falling back to creation for rows predating migration 041. */
export function launchDate(s: DashSurvey): string | null {
  if (s.status === 'draft') return null;
  return s.launched_at ?? s.created_at;
}

function surveyMatches(s: DashSurvey, f: DashFilters): boolean {
  if (f.topic !== 'all' && topicKey(s) !== f.topic) return false;
  if (f.campaign !== 'all' && s.id !== f.campaign) return false;
  if (f.status === 'launched' && s.status === 'draft') return false;
  if (f.status !== 'launched' && f.status !== 'all' && s.status !== f.status) return false;
  const launched = launchDate(s)?.slice(0, 10) ?? null;
  if (f.launchedFrom && (!launched || launched < f.launchedFrom)) return false;
  if (f.launchedTo && (!launched || launched > f.launchedTo)) return false;
  return true;
}

function supplierMatches(inv: DashInvitation, suppliers: Map<string, DashSupplier>, f: DashFilters): boolean {
  if (f.tier === 'all' && f.country === 'all') return true;
  const sup = inv.supplier_id ? suppliers.get(inv.supplier_id) : undefined;
  if (f.tier !== 'all' && String(sup?.tier ?? '') !== f.tier) return false;
  if (f.country !== 'all' && (sup?.country ?? '') !== f.country) return false;
  return true;
}

export interface Counts {
  invited: number;
  emailed: number;
  responded: number;
  overdue: number;
  reminders: number;
  /** responded / invited, or null when nobody was invited. */
  rate: number | null;
}

function emptyCounts(): Counts {
  return { invited: 0, emailed: 0, responded: 0, overdue: 0, reminders: 0, rate: null };
}

function addInvitation(c: Counts, inv: DashInvitation, survey: DashSurvey, today: string) {
  c.invited++;
  if (inv.sent_at) c.emailed++;
  if (inv.status === 'submitted') c.responded++;
  else if (survey.status === 'active' && survey.due_date && survey.due_date.slice(0, 10) < today) c.overdue++;
  c.reminders += inv.reminder_count ?? 0;
}

function finish(c: Counts): Counts {
  return { ...c, rate: c.invited > 0 ? c.responded / c.invited : null };
}

export interface CampaignRow extends Counts {
  survey: DashSurvey;
  topic: string;
  launched: string | null;
}

export interface TopicRow extends Counts {
  key: string;
  label: string;
  campaigns: number;
}

export interface SupplierRow {
  invitationId: string;
  supplier: string;
  country: string | null;
  tier: number | null;
  campaign: string;
  topic: string;
  status: 'responded' | 'overdue' | 'waiting' | 'not emailed';
  emailedAt: string | null;
  respondedAt: string | null;
  reminders: number;
}

export interface DashboardData {
  totals: Counts & { campaigns: number; medianDaysToRespond: number | null };
  byTopic: TopicRow[];
  byCampaign: CampaignRow[];
  /** Responses per week, by the Monday that starts the week. */
  weekly: { week: string; responses: number }[];
  suppliers: SupplierRow[];
  /** Surveys and invitations that passed the filters, for the answer view. */
  surveys: DashSurvey[];
  invitations: DashInvitation[];
}

/** Monday of the ISO week containing the date, as YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildDashboard(
  surveys: DashSurvey[],
  invitations: DashInvitation[],
  suppliers: DashSupplier[],
  filters: DashFilters,
  now: Date = new Date(),
): DashboardData {
  const today = now.toISOString().slice(0, 10);
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const kept = surveys.filter((s) => surveyMatches(s, filters));
  const surveyById = new Map(kept.map((s) => [s.id, s]));
  const invs = invitations.filter(
    (i) => surveyById.has(i.survey_id) && supplierMatches(i, supplierById, filters),
  );

  const totals = emptyCounts();
  const campaign = new Map<string, Counts>(kept.map((s) => [s.id, emptyCounts()]));
  const topic = new Map<string, { counts: Counts; label: string; campaigns: Set<string> }>();
  const weekly = new Map<string, number>();
  const daysToRespond: number[] = [];
  const supplierRows: SupplierRow[] = [];

  for (const s of kept) {
    const key = topicKey(s);
    if (!topic.has(key)) {
      topic.set(key, { counts: emptyCounts(), label: regulationLabel(s.regulation_type, s.custom_regulation_name), campaigns: new Set() });
    }
    topic.get(key)!.campaigns.add(s.id);
  }

  for (const inv of invs) {
    const s = surveyById.get(inv.survey_id)!;
    addInvitation(totals, inv, s, today);
    addInvitation(campaign.get(s.id)!, inv, s, today);
    addInvitation(topic.get(topicKey(s))!.counts, inv, s, today);

    if (inv.status === 'submitted' && inv.submitted_at) {
      const wk = weekStart(inv.submitted_at);
      weekly.set(wk, (weekly.get(wk) ?? 0) + 1);
      if (inv.sent_at) {
        const days = (new Date(inv.submitted_at).getTime() - new Date(inv.sent_at).getTime()) / 86_400_000;
        if (days >= 0) daysToRespond.push(days);
      }
    }

    const sup = inv.supplier_id ? supplierById.get(inv.supplier_id) : undefined;
    const overdue = inv.status !== 'submitted' && s.status === 'active' && !!s.due_date && s.due_date.slice(0, 10) < today;
    supplierRows.push({
      invitationId: inv.id,
      supplier: sup?.name ?? inv.supplier_name ?? 'Unknown supplier',
      country: sup?.country ?? null,
      tier: sup?.tier ?? null,
      campaign: s.title,
      topic: regulationLabel(s.regulation_type, s.custom_regulation_name),
      status: inv.status === 'submitted' ? 'responded' : overdue ? 'overdue' : inv.sent_at ? 'waiting' : 'not emailed',
      emailedAt: inv.sent_at,
      respondedAt: inv.status === 'submitted' ? inv.submitted_at : null,
      reminders: inv.reminder_count ?? 0,
    });
  }

  const order: Record<SupplierRow['status'], number> = { overdue: 0, waiting: 1, 'not emailed': 2, responded: 3 };
  supplierRows.sort((a, b) => order[a.status] - order[b.status] || a.supplier.localeCompare(b.supplier));

  const byCampaign: CampaignRow[] = kept
    .map((s) => ({ ...finish(campaign.get(s.id)!), survey: s, topic: regulationLabel(s.regulation_type, s.custom_regulation_name), launched: launchDate(s) }))
    .sort((a, b) => (b.launched ?? '').localeCompare(a.launched ?? ''));

  const byTopic: TopicRow[] = [...topic.entries()]
    .map(([key, t]) => ({ ...finish(t.counts), key, label: t.label, campaigns: t.campaigns.size }))
    .sort((a, b) => b.invited - a.invited || a.label.localeCompare(b.label));

  return {
    totals: { ...finish(totals), campaigns: kept.length, medianDaysToRespond: median(daysToRespond) },
    byTopic,
    byCampaign,
    weekly: [...weekly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, responses]) => ({ week, responses })),
    suppliers: supplierRows,
    surveys: kept,
    invitations: invs,
  };
}

// ─── Answers ─────────────────────────────────────────────────────────────────

/**
 * Surveys can only be compared answer by answer when they asked the same
 * questions: every survey on a built-in topic shares that topic's question
 * set, while each custom survey has its own. So answers are summarised for
 * one question group at a time.
 */
export function questionGroupKey(s: DashSurvey, hasCustomQuestions: boolean): string {
  return hasCustomQuestions || s.regulation_type === 'custom' ? `survey:${s.id}` : `topic:${s.regulation_type}`;
}

export type QuestionSummary =
  | { kind: 'choice'; question: SurveyQuestion; answered: number; options: { label: string; count: number }[] }
  | { kind: 'number'; question: SurveyQuestion; answered: number; min: number; median: number; max: number }
  | { kind: 'text'; question: SurveyQuestion; answered: number; samples: { supplier: string; answer: string }[] };

export function summariseAnswers(
  questionSet: RegulationQuestionSet,
  respondents: { supplier: string; answers: Record<string, string | null> }[],
  sampleSize = 5,
): QuestionSummary[] {
  return questionSet.questions.map((q) => {
    const given = respondents
      .map((r) => ({ supplier: r.supplier, answer: r.answers[q.id] ?? null }))
      .filter((a): a is { supplier: string; answer: string } => a.answer !== null && a.answer.trim() !== '');

    if (q.type === 'select' || q.type === 'yes_no') {
      const counts = new Map<string, number>();
      if (q.type === 'yes_no') { counts.set('Yes', 0); counts.set('No', 0); }
      for (const o of q.options ?? []) counts.set(o.label, 0);
      for (const a of given) {
        const label = answerDisplayLabel(q, a.answer);
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      return {
        kind: 'choice' as const,
        question: q,
        answered: given.length,
        options: [...counts.entries()].map(([label, count]) => ({ label, count })),
      };
    }

    if (q.type === 'number') {
      const nums = given.map((a) => Number(a.answer)).filter((n) => Number.isFinite(n));
      if (nums.length > 0) {
        return {
          kind: 'number' as const,
          question: q,
          answered: nums.length,
          min: Math.min(...nums),
          median: median(nums)!,
          max: Math.max(...nums),
        };
      }
    }

    return {
      kind: 'text' as const,
      question: q,
      answered: given.length,
      samples: given.slice(0, sampleSize).map((a) => ({ supplier: a.supplier, answer: answerDisplayLabel(q, a.answer) })),
    };
  });
}
