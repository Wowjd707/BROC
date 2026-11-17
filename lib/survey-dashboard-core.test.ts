import { describe, it, expect } from 'vitest';
import {
  buildDashboard, DEFAULT_FILTERS, topicKey, topicOptions, weekStart, summariseAnswers, questionGroupKey,
  type DashSurvey, type DashInvitation, type DashSupplier,
} from './survey-dashboard-core';
import { CBAM_QUESTIONS } from './regulations';

const now = new Date('2026-11-17T12:00:00Z');
const survey = (over: Partial<DashSurvey>): DashSurvey => ({
  id: 's1', title: 'CBAM 2026', regulation_type: 'cbam', custom_regulation_name: null, status: 'active',
  due_date: '2026-12-31', created_at: '2026-06-01T00:00:00Z', launched_at: '2026-06-14T00:00:00Z', ...over,
});
const inv = (over: Partial<DashInvitation>): DashInvitation => ({
  id: 'i1', survey_id: 's1', supplier_id: 'p1', supplier_name: 'Steelcore', status: 'sent',
  sent_at: '2026-06-14T00:00:00Z', submitted_at: null, reminder_count: 0, ...over,
});
const suppliers: DashSupplier[] = [
  { id: 'p1', name: 'Steelcore', country: 'Germany', tier: 1 },
  { id: 'p2', name: 'PackageTech', country: 'USA', tier: 2 },
  { id: 'p3', name: 'ElectroParts', country: 'Japan', tier: 1 },
];

const surveys = [
  survey({}),
  survey({ id: 's2', title: 'PFAS check', regulation_type: 'pfas', due_date: '2026-08-07', launched_at: '2026-07-01T00:00:00Z' }),
  survey({ id: 's3', title: 'Draft', status: 'draft', launched_at: null }),
  survey({ id: 's4', title: 'Conflict minerals', regulation_type: 'custom', custom_regulation_name: 'Conflict Minerals', launched_at: '2026-09-01T00:00:00Z' }),
];
const invitations = [
  inv({ id: 'a', status: 'submitted', submitted_at: '2026-06-23T10:00:00Z' }),
  inv({ id: 'b', supplier_id: 'p2', supplier_name: 'PackageTech', status: 'submitted', submitted_at: '2026-07-06T10:00:00Z', reminder_count: 1 }),
  inv({ id: 'c', supplier_id: 'p3', supplier_name: 'ElectroParts', reminder_count: 2 }),
  inv({ id: 'd', survey_id: 's2', supplier_id: 'p3', supplier_name: 'ElectroParts' }),
  inv({ id: 'e', survey_id: 's3', sent_at: null, status: 'pending' }),
  inv({ id: 'f', survey_id: 's4', supplier_id: 'p2', sent_at: null, status: 'pending' }),
];

describe('buildDashboard', () => {
  it('counts launched campaigns only by default', () => {
    const d = buildDashboard(surveys, invitations, suppliers, DEFAULT_FILTERS, now);
    expect(d.totals).toMatchObject({ campaigns: 3, invited: 5, emailed: 4, responded: 2, overdue: 1, reminders: 3 });
    expect(d.totals.rate).toBeCloseTo(2 / 5);
  });

  it('marks overdue only on active surveys past their due date', () => {
    const d = buildDashboard(surveys, invitations, suppliers, DEFAULT_FILTERS, now);
    expect(d.suppliers.find((r) => r.invitationId === 'd')?.status).toBe('overdue');
    expect(d.suppliers.find((r) => r.invitationId === 'c')?.status).toBe('waiting');
    expect(d.suppliers.find((r) => r.invitationId === 'f')?.status).toBe('not emailed');
    expect(d.suppliers[0].status).toBe('overdue');
  });

  it('filters by topic, campaign, launch date, tier and country', () => {
    expect(buildDashboard(surveys, invitations, suppliers, { ...DEFAULT_FILTERS, topic: 'pfas' }, now).totals.invited).toBe(1);
    expect(buildDashboard(surveys, invitations, suppliers, { ...DEFAULT_FILTERS, campaign: 's1' }, now).totals.invited).toBe(3);
    expect(buildDashboard(surveys, invitations, suppliers, { ...DEFAULT_FILTERS, launchedFrom: '2026-07-01' }, now).totals.campaigns).toBe(2);
    expect(buildDashboard(surveys, invitations, suppliers, { ...DEFAULT_FILTERS, launchedTo: '2026-06-30' }, now).totals.campaigns).toBe(1);
    expect(buildDashboard(surveys, invitations, suppliers, { ...DEFAULT_FILTERS, tier: '2' }, now).totals.invited).toBe(2);
    expect(buildDashboard(surveys, invitations, suppliers, { ...DEFAULT_FILTERS, country: 'Japan' }, now).totals.invited).toBe(2);
    expect(buildDashboard(surveys, invitations, suppliers, { ...DEFAULT_FILTERS, status: 'draft' }, now).totals.campaigns).toBe(1);
  });

  it('groups by topic, with custom surveys named by their regulation', () => {
    const d = buildDashboard(surveys, invitations, suppliers, DEFAULT_FILTERS, now);
    const labels = d.byTopic.map((t) => t.label);
    expect(labels).toEqual(['CBAM', 'Conflict Minerals', 'PFAS']);
    expect(d.byTopic[0]).toMatchObject({ invited: 3, responded: 2, campaigns: 1 });
  });

  it('counts responses by week and the median time to respond', () => {
    const d = buildDashboard(surveys, invitations, suppliers, DEFAULT_FILTERS, now);
    expect(d.weekly).toEqual([{ week: '2026-06-22', responses: 1 }, { week: '2026-07-06', responses: 1 }]);
    expect(d.totals.medianDaysToRespond).toBeCloseTo((9.4167 + 22.4167) / 2, 2);
  });
});

describe('topics and weeks', () => {
  it('treats custom surveys with the same name as one topic', () => {
    expect(topicKey({ regulation_type: 'custom', custom_regulation_name: ' Conflict Minerals ' }))
      .toBe(topicKey({ regulation_type: 'custom', custom_regulation_name: 'conflict minerals' }));
    expect(topicOptions(surveys).map((t) => t.label)).toEqual(['CBAM', 'Conflict Minerals', 'PFAS']);
  });
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-11-17T12:00:00Z')).toBe('2026-11-16');
    expect(weekStart('2026-11-16T00:00:00Z')).toBe('2026-11-16');
    expect(weekStart('2026-11-22T23:00:00Z')).toBe('2026-11-16');
  });
});

describe('summariseAnswers', () => {
  it('counts choices, summarises numbers and samples text', () => {
    const out = summariseAnswers(CBAM_QUESTIONS, [
      { supplier: 'A', answers: { q1: 'Steel coil', q2_quantity: '1200', q2_unit: 'metric_tons' } },
      { supplier: 'B', answers: { q1: 'Cement', q2_quantity: '300', q2_unit: 'metric_tons' } },
      { supplier: 'C', answers: { q2_quantity: '900', q2_unit: 'kg' } },
    ]);
    const text = out.find((q) => q.question.id === 'q1');
    const num = out.find((q) => q.question.id === 'q2_quantity');
    const choice = out.find((q) => q.question.id === 'q2_unit');
    expect(text).toMatchObject({ kind: 'text', answered: 2 });
    expect(num).toMatchObject({ kind: 'number', answered: 3, min: 300, median: 900, max: 1200 });
    expect(choice?.kind).toBe('choice');
    if (choice?.kind === 'choice') {
      expect(choice.options.find((o) => o.label === 'Metric Tons (t)')?.count).toBe(2);
      expect(choice.options.find((o) => o.label === 'Kilograms (kg)')?.count).toBe(1);
    }
  });
  it('keys built-in topics together and custom surveys apart', () => {
    expect(questionGroupKey(survey({}), false)).toBe('topic:cbam');
    expect(questionGroupKey(survey({}), true)).toBe('survey:s1');
    expect(questionGroupKey(survey({ id: 's4', regulation_type: 'custom' }), false)).toBe('survey:s4');
  });
});
