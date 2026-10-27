'use client';

import { useState, useTransition } from 'react';
import type { TablesInsert } from '@/lib/supabase/types';
import { Upload, Paperclip } from 'lucide-react';
import { GoalImportDialog } from './GoalImportDialog';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtCO2e } from '@/lib/utils';
import { calculateSBTiTarget } from '@/lib/calculations';
import { gapToTarget } from '@/lib/pipeline';
import { formatMetric, convertFromDisplay, unitLabel } from '@/lib/units';
import { GOAL_SCOPE_LABELS } from '@/lib/goal-import-core';
import { measurementCaption, type GoalMeasurement } from '@/lib/goal-period-core';
import {
  GOAL_METRICS, GOAL_METRIC_LABELS, GOAL_METRIC_FAMILY,
  GOAL_TYPES_BY_METRIC, asGoalMetric, computeGoalProgress, goalBaseline, goalTargetValue,
  progressColor, goalGhgValue, type GoalMetric, type ScopeTotals,
} from '@/lib/goal-metrics';
import { useUnits } from '@/components/layout/UnitPreferences';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Goal {
  id: string;
  name: string;
  goal_type: string;
  metric: string | null;
  scope: string | null;
  base_year: number;
  base_year_emissions_kg: number | null;
  base_year_value: number | null;
  target_year: number;
  target_value: number | null;
  target_unit: string | null;
  current_value: number | null;
  progress_pct: number | null;
  scope2_accounting_method: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

interface Props {
  goals: Goal[];
  /** Boundary-adjusted Scope 1 and both Scope 2 totals for the measured year. */
  currentGhg: ScopeTotals;
  currentWaterGal: number;
  currentWasteKg: number;
  /** Which year (and whether partial) each metric's current value covers. */
  measuredIn: Record<'ghg' | 'water' | 'waste', GoalMeasurement | null>;
  pipelineKg: number;
  pipelineCurrentYearKg: number;
  pipelineWaterGal: number;
  pipelineWasteKg: number;
  currentYear: number;
  orgBaseYear: number;
  userRole: string;
  /** Attachment counts per goal; documents are managed on the goal's page. */
  evidenceCounts: Record<string, number>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GOAL_TYPE_LABELS: Record<string, string> = {
  absolute: 'Absolute Reduction',
  intensity: 'Intensity Target',
  net_zero: 'Net Zero',
  sbti_15c: 'SBTi 1.5°C',
};

const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'destructive' | 'warning' | 'blue'> = {
  active: 'default',
  achieved: 'blue',
  missed: 'destructive',
  draft: 'secondary',
};

// ─── Create Goal Form ─────────────────────────────────────────────────────────

interface CreateGoalForm {
  name: string;
  metric: GoalMetric;
  goal_type: string;
  scope: string;
  base_year: string;
  base_year_value: string;
  target_year: string;
  target_value: string;
  scope2_accounting_method: string;
  notes: string;
}

const EMPTY_FORM: CreateGoalForm = {
  name: '',
  metric: 'ghg',
  goal_type: 'absolute',
  scope: 'scope1_2',
  base_year: '',
  base_year_value: '',
  target_year: '',
  target_value: '',
  scope2_accounting_method: 'market_based',
  notes: '',
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function GoalsClient({
  goals: initialGoals,
  currentGhg,
  currentWaterGal,
  currentWasteKg,
  measuredIn,
  pipelineKg,
  pipelineCurrentYearKg,
  pipelineWaterGal,
  pipelineWasteKg,
  currentYear,
  orgBaseYear,
  userRole,
  evidenceCounts,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { units } = useUnits();
  const [goals, setGoals] = useState<Goal[]>(initialGoals);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateGoalForm>({ ...EMPTY_FORM, base_year: String(orgBaseYear) });
  const [formError, setFormError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [showImport, setShowImport] = useState(false);
  const canEdit = userRole === 'admin' || userRole === 'editor';

  const setField = (key: keyof CreateGoalForm, value: string) =>
    setForm(f => ({ ...f, [key]: value }));

  /** Changing metric can invalidate the goal type, so it resets to absolute. */
  function setMetric(metric: GoalMetric) {
    setForm(f => ({
      ...f,
      metric,
      goal_type: GOAL_TYPES_BY_METRIC[metric].some(t => t.value === f.goal_type)
        ? f.goal_type
        : 'absolute',
    }));
  }

  /** The base-year figure as typed (display unit) → canonical stored unit. */
  function baseValueCanonical(typed: string): number {
    const family = GOAL_METRIC_FAMILY[form.metric];
    return convertFromDisplay(parseFloat(typed), family, units[family]);
  }

  async function handleCreate() {
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    if (!form.base_year) { setFormError('Base year is required'); return; }
    if (!form.target_year) { setFormError('Target year is required'); return; }
    if (form.goal_type === 'absolute' && !form.target_value) {
      setFormError('Reduction % is required for absolute targets'); return;
    }
    if (form.goal_type === 'sbti_15c' && !form.base_year_value) {
      setFormError('An SBTi target cannot be derived without a base year value'); return;
    }
    setFormError('');

    const payload: TablesInsert<'goals'> = {
      name: form.name.trim(),
      metric: form.metric,
      goal_type: form.goal_type,
      scope: form.metric === 'ghg' ? form.scope : null,
      base_year: parseInt(form.base_year),
      target_year: parseInt(form.target_year),
      scope2_accounting_method: form.scope2_accounting_method,
      notes: form.notes || null,
      status: 'active',
    };

    if (form.base_year_value) {
      // Typed in the user's display unit (t CO₂e, m³, t…); stored canonically.
      payload.base_year_value = baseValueCanonical(form.base_year_value);
      // base_year_emissions_kg is the GHG-only predecessor column that reports
      // still read. Written in step for GHG goals so the two can never disagree;
      // left null for water and waste, where it would be a unit lie.
      if (form.metric === 'ghg') payload.base_year_emissions_kg = payload.base_year_value;
    }
    if (form.goal_type === 'absolute' && form.target_value) {
      payload.target_value = parseFloat(form.target_value);
      payload.target_unit = 'pct_reduction';
    }
    if (form.goal_type === 'sbti_15c' && payload.base_year_value) {
      const { reductionPct } = calculateSBTiTarget(
        payload.base_year_value,
        payload.base_year,
        payload.target_year,
      );
      payload.target_value = reductionPct;
      payload.target_unit = 'pct_reduction';
    }

    startTransition(async () => {
      const { data, error } = await supabase
        .from('goals')
        .insert(payload)
        .select()
        .single();

      if (error) { setFormError(error.message); return; }
      setGoals(gs => [data as Goal, ...gs]);
      setShowCreate(false);
      setForm({ ...EMPTY_FORM, base_year: String(orgBaseYear) });
      router.refresh();
    });
  }

  /**
   * The measured current value a goal is judged against, in its own metric's
   * canonical unit. For GHG the accounting method still decides which Scope 2
   * total applies; water and waste have no such split.
   */
  function getCurrentValue(goal: Goal): number {
    switch (asGoalMetric(goal.metric)) {
      case 'water': return currentWaterGal;
      case 'waste': return currentWasteKg;
      // Only the scope the goal covers, under its own Scope 2 method.
      default: return goalGhgValue(currentGhg, goal.scope, goal.scope2_accounting_method ?? 'market_based');
    }
  }

  /** Annualised pipeline for the goal's metric. */
  function getPipelineValue(goal: Goal): number {
    switch (asGoalMetric(goal.metric)) {
      case 'water': return pipelineWaterGal;
      case 'waste': return pipelineWasteKg;
      default: return pipelineKg;
    }
  }

  /** Format a value in the goal's own metric family and the user's unit. */
  function fmtForGoal(goal: Goal, value: number | null | undefined): string {
    return formatMetric(value, GOAL_METRIC_FAMILY[asGoalMetric(goal.metric)],
      units[GOAL_METRIC_FAMILY[asGoalMetric(goal.metric)]]);
  }

  const activeGoals = goals.filter(g => g.status === 'active');
  const otherGoals = goals.filter(g => g.status !== 'active');

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Goals</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track progress against emissions, water and waste commitments</p>
        </div>
        {canEdit && (
          <Button variant="outline" onClick={() => setShowImport(true)} className="mr-2">
            <Upload size={14} className="mr-1.5 text-emerald-600" />
            Import
          </Button>
        )}
        {canEdit && (
          <Button onClick={() => setShowCreate(true)}>
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Goal
          </Button>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Active Goals</p>
            <p className="text-2xl font-bold text-gray-900">{activeGoals.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Measured Emissions</p>
            <p className="text-2xl font-bold text-gray-900">{measuredIn.ghg ? fmtCO2e(currentGhg.scope1 + currentGhg.scope2Market) : '—'}</p>
            <p className="text-xs text-gray-400">
              {measuredIn.ghg
                ? `Scope 1+2, market-based, ${measuredIn.ghg.year}${measuredIn.ghg.partial ? ' to date' : ''}`
                : 'No Scope 1 or 2 data yet'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Pipeline Reduction</p>
            <p className="text-2xl font-bold text-emerald-600">{fmtCO2e(pipelineKg)}</p>
            <p className="text-xs text-gray-400">
              at full run-rate · {fmtCO2e(pipelineCurrentYearKg)} lands in {currentYear}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Achieved</p>
            <p className="text-2xl font-bold text-gray-900">
              {goals.filter(g => g.status === 'achieved').length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gap to target — does the pipeline actually get us there? Each goal is
          measured against its own metric's pipeline: a water target compared to
          carbon savings would be meaningless. */}
      {activeGoals.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Path to target</h2>
          {/* Says which year progress is judged on: an annual target against a
              part year always looks on track. */}
          {[...new Set(
            activeGoals.map((g) => measurementCaption(measuredIn[asGoalMetric(g.metric)])),
          )].map((caption) => (
            <p key={caption} className="text-xs text-gray-500">{caption}</p>
          ))}
          {activeGoals.map(goal => {
            const current = getCurrentValue(goal);
            // Reuse the same target derivation the progress bars use, so the
            // two views can never disagree about what the target is.
            const base = goalBaseline(goal);
            const target = goalTargetValue(goal);
            if (base == null || target == null) return null;
            const gap = gapToTarget(base, target, current, getPipelineValue(goal));
            const f = (v: number) => fmtForGoal(goal, v);
            return (
              <Card key={goal.id}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900">{goal.name}</p>
                        <Badge variant="secondary" className="text-[10px]">
                          {GOAL_METRIC_LABELS[asGoalMetric(goal.metric)]}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {f(base)} ({goal.base_year}) → {f(target)} ({goal.target_year})
                        · {f(gap.requiredReductionValue)} reduction required
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${gap.gapValue > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {gap.coveragePct.toFixed(0)}%
                      </p>
                      <p className="text-xs text-gray-500">of the reduction covered</p>
                    </div>
                  </div>

                  {/* Achieved / pipeline / gap */}
                  <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 mb-2">
                    <div className="bg-emerald-500" style={{ width: `${Math.min(100, (gap.achievedValue / Math.max(gap.requiredReductionValue, 1)) * 100)}%` }} />
                    <div className="bg-emerald-300" style={{ width: `${Math.min(100, (gap.pipelineValue / Math.max(gap.requiredReductionValue, 1)) * 100)}%` }} />
                  </div>
                  <div className="flex gap-4 flex-wrap text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                      Achieved {f(gap.achievedValue)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-300 inline-block" />
                      Pipeline {f(gap.pipelineValue)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-gray-200 inline-block" />
                      {gap.gapValue > 0
                        ? <>Unidentified gap <strong className="text-amber-700">{f(gap.gapValue)}</strong></>
                        : <span className="text-emerald-700">Fully covered by identified projects</span>}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Active Goals */}
      {activeGoals.length === 0 && otherGoals.length === 0 ? (
        <Card>
          <CardContent className="py-20 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900 mb-1">No goals yet</p>
            <p className="text-sm text-gray-500 mb-4">Set your first climate or EHS target to track progress over time.</p>
            {canEdit && (
              <Button onClick={() => setShowCreate(true)}>Create your first goal</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {activeGoals.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Active</h2>
              <div className="space-y-3">
                {activeGoals.map(goal => {
                  const current = getCurrentValue(goal);
                  const progress = computeGoalProgress(goal, current);
                  return (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      progressPct={progress.progressPct}
                      currentValue={current}
                      targetValue={progress.targetValue}
                      format={(v) => fmtForGoal(goal, v)}
                      currentYear={currentYear}
                      documentCount={evidenceCounts[`goal:${goal.id}`] ?? 0}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {otherGoals.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Other</h2>
              <div className="space-y-3">
                {otherGoals.map(goal => {
                  const current = getCurrentValue(goal);
                  const progress = computeGoalProgress(goal, current);
                  return (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      progressPct={progress.progressPct}
                      currentValue={current}
                      targetValue={progress.targetValue}
                      format={(v) => fmtForGoal(goal, v)}
                      currentYear={currentYear}
                      documentCount={evidenceCounts[`goal:${goal.id}`] ?? 0}
                    />
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      <GoalImportDialog open={showImport} onClose={() => setShowImport(false)} />

      {/* Create Goal Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Goal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label required>Goal Name</Label>
              <Input
                value={form.name}
                onChange={e => setField('name', e.target.value)}
                placeholder="e.g. 50% absolute reduction by 2030"
              />
            </div>
            {/* Metric first: it decides which goal shapes are even offered. */}
            <div>
              <Label required>Metric</Label>
              <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
                {GOAL_METRICS.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMetric(m)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      form.metric === m
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {GOAL_METRIC_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label required>Type</Label>
                <Select value={form.goal_type} onValueChange={v => setField('goal_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GOAL_TYPES_BY_METRIC[form.metric].map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.metric !== 'ghg' && (
                  <p className="text-xs text-gray-400 mt-1">
                    Net-zero and SBTi pathways are defined on emissions only.
                  </p>
                )}
              </div>
              {form.metric === 'ghg' ? (
                <div>
                  <Label required>Scope</Label>
                  <Select value={form.scope} onValueChange={v => setField('scope', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scope1_2">Scope 1 + 2</SelectItem>
                      <SelectItem value="scope1">Scope 1 only</SelectItem>
                      <SelectItem value="scope2">Scope 2 only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : <div />}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label required>Base Year</Label>
                <Input
                  type="number"
                  value={form.base_year}
                  onChange={e => setField('base_year', e.target.value)}
                  placeholder="2020"
                />
              </div>
              <div>
                <Label required>Target Year</Label>
                <Input
                  type="number"
                  value={form.target_year}
                  onChange={e => setField('target_year', e.target.value)}
                  placeholder="2030"
                />
              </div>
            </div>
            <div>
              <Label>Base Year Value ({unitLabel(GOAL_METRIC_FAMILY[form.metric], units[GOAL_METRIC_FAMILY[form.metric]])})</Label>
              <Input
                type="number"
                value={form.base_year_value}
                onChange={e => setField('base_year_value', e.target.value)}
                placeholder={`Your ${form.base_year || 'base-year'} total`}
              />
              <p className="text-xs text-gray-500 mt-1">
                The measured total for the base year, in the unit shown. Without it no target can be
                derived, and progress falls back to a manually entered percentage.
              </p>
            </div>
            {form.goal_type === 'absolute' && (
              <div>
                <Label required>Reduction Target (%)</Label>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={form.target_value}
                  onChange={e => setField('target_value', e.target.value)}
                  placeholder="e.g. 50"
                />
              </div>
            )}
            {form.goal_type === 'sbti_15c' && form.base_year && form.target_year && form.base_year_value && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
                <p className="font-medium mb-0.5">SBTi 1.5°C Pathway</p>
                <p>
                  At 4.2% of base-year emissions per year (linear, the SBTi 1.5°C minimum), the target for {form.target_year} would be{' '}
                  <strong>
                    {fmtCO2e(
                      calculateSBTiTarget(
                        baseValueCanonical(form.base_year_value),
                        parseInt(form.base_year),
                        parseInt(form.target_year),
                      ).targetEmissionsKg,
                    )}
                  </strong>
                  {' '}(
                  {calculateSBTiTarget(
                    baseValueCanonical(form.base_year_value),
                    parseInt(form.base_year),
                    parseInt(form.target_year),
                  ).reductionPct.toFixed(1)}
                  % reduction).
                </p>
              </div>
            )}
            {/* Only GHG has a location/market split to choose between. */}
            {form.metric === 'ghg' && (
              <div>
                <Label>Scope 2 Accounting Method</Label>
                <Select
                  value={form.scope2_accounting_method}
                  onValueChange={v => setField('scope2_accounting_method', v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="market_based">Market-Based</SelectItem>
                    <SelectItem value="location_based">Location-Based</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {formError && <p className="text-sm text-red-600">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={isPending}>
              {isPending ? 'Creating…' : 'Create Goal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Goal Card ────────────────────────────────────────────────────────────────

function GoalCard({
  goal,
  progressPct,
  currentValue,
  targetValue,
  format,
  currentYear,
  documentCount,
}: {
  goal: Goal;
  progressPct: number;
  currentValue: number;
  targetValue: number | null;
  /** Formats a value in this goal's own metric family and display unit. */
  format: (value: number) => string;
  currentYear: number;
  documentCount: number;
}) {
  const yearsLeft = goal.target_year - currentYear;
  const pct = Math.round(progressPct);
  const metric = asGoalMetric(goal.metric);
  const base = goalBaseline(goal);

  return (
    <Link href={`/goals/${goal.id}`} className="block">
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h3 className="font-semibold text-gray-900 truncate">{goal.name}</h3>
                <Badge variant="secondary" className="text-xs shrink-0">
                  {GOAL_METRIC_LABELS[metric]}
                </Badge>
                <Badge variant={STATUS_BADGE[goal.status] ?? 'secondary'} className="text-xs shrink-0">
                  {goal.status}
                </Badge>
              </div>
              <p className="text-sm text-gray-500">
                {GOAL_TYPE_LABELS[goal.goal_type] ?? goal.goal_type}
                {goal.scope && <>{' · '}{GOAL_SCOPE_LABELS[goal.scope] ?? goal.scope}</>}
                {' · '}
                Base {goal.base_year} → Target {goal.target_year}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold text-gray-900">{pct}%</p>
              <p className="text-xs text-gray-400">{yearsLeft > 0 ? `${yearsLeft} yr left` : yearsLeft === 0 ? 'Target year' : 'Overdue'}</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${progressColor(pct)}`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          </div>

          {/* Metrics row */}
          <div className="flex items-center gap-6 text-sm text-gray-600 flex-wrap">
            {base != null && (
              <span>
                <span className="text-gray-400">Base:</span>{' '}
                <span className="font-medium">{format(base)}</span>
              </span>
            )}
            <span>
              <span className="text-gray-400">Now:</span>{' '}
              <span className="font-medium">{format(currentValue)}</span>
            </span>
            {targetValue !== null && (
              <span>
                <span className="text-gray-400">Target:</span>{' '}
                <span className="font-medium">{format(targetValue)}</span>
              </span>
            )}
            {goal.goal_type === 'absolute' && goal.target_value && (
              <span>
                <span className="text-gray-400">Target:</span>{' '}
                <span className="font-medium">{goal.target_value}% reduction</span>
              </span>
            )}
            <span
              className={`ml-auto inline-flex items-center gap-1 text-xs ${documentCount > 0 ? 'text-emerald-600' : 'text-gray-300'}`}
              title={documentCount > 0
                ? `${documentCount} supporting document${documentCount === 1 ? '' : 's'}`
                : 'No supporting documents — attach them on the goal page'}
            >
              <Paperclip size={12} />
              {documentCount > 0 && documentCount}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
