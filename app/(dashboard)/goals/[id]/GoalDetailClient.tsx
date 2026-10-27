'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EvidencePanel } from '@/components/evidence/EvidencePanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getSBTiPathway, calculateSBTiTarget, calculateAbsoluteTarget } from '@/lib/calculations';
import { formatMetric, convertForDisplay, unitLabel } from '@/lib/units';
import { fmtAxis } from '@/lib/utils';
import { measurementCaption, type GoalMeasurement } from '@/lib/goal-period-core';
import { GOAL_SCOPE_LABELS } from '@/lib/goal-import-core';
import {
  GOAL_METRIC_LABELS, GOAL_METRIC_FAMILY, asGoalMetric, goalBaseline,
} from '@/lib/goal-metrics';
import { useUnits } from '@/components/layout/UnitPreferences';

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
  scope2_accounting_method: string | null;
  status: string;
  notes: string | null;
}

interface Props {
  goal: Goal;
  yearlyData: Array<{ year: number; actualValue: number | null }>;
  currentYear: number;
  currentValue: number;
  /** Which year currentValue covers, and whether it is a partial year. */
  measurement: GoalMeasurement | null;
  pipelineValue: number;
  userRole: string;
  /** Active organization; null only if the profile lookup failed. */
  organizationId: string | null;
  evidenceCount: number;
}

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

// ─── Main Component ───────────────────────────────────────────────────────────

export function GoalDetailClient({
  goal,
  yearlyData,
  currentYear,
  currentValue,
  measurement,
  pipelineValue,
  userRole,
  organizationId,
  evidenceCount,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { units } = useUnits();
  const [updating, setUpdating] = useState(false);
  const [docCount, setDocCount] = useState(evidenceCount);
  const canEdit = userRole === 'admin' || userRole === 'editor';

  // Every figure on this page is denominated in the goal's own metric — kg
  // CO₂e, US gallons or kg. `fmtValue` is the only formatter used, so a water
  // goal can never render a gallons figure labelled "kg CO₂e".
  const metric = asGoalMetric(goal.metric);
  const family = GOAL_METRIC_FAMILY[metric];
  const fmtValue = (v: number | null | undefined) => formatMetric(v, family, units[family]);
  // The chart axis in the same display unit as the figures beside it — it used
  // to tick in raw kg and gallons (1.5M, 3.0M) next to values in t and m³.
  const axisUnit = unitLabel(family, units[family]);
  const fmtTick = (v: number) => fmtAxis(convertForDisplay(v, family, units[family]));

  const baseValue = goalBaseline(goal) ?? yearlyData[0]?.actualValue ?? 0;

  // ── Compute the target, in the goal's own metric ──────────────────────────
  let targetValue: number | null = null;
  let pathway: Array<{ year: number; targetValue: number }> = [];

  if (goal.goal_type === 'sbti_15c' && baseValue > 0) {
    // getSBTiPathway is emissions-specific and names its field targetKg; SBTi
    // goals are GHG-only, so kg is correct here and only the shape is adapted.
    pathway = getSBTiPathway(baseValue, goal.base_year, goal.target_year)
      .map((p) => ({ year: p.year, targetValue: p.targetKg }));
    targetValue = calculateSBTiTarget(baseValue, goal.base_year, goal.target_year).targetEmissionsKg;
  } else if (goal.goal_type === 'absolute' && baseValue > 0 && goal.target_value != null) {
    targetValue = calculateAbsoluteTarget(baseValue, goal.target_value);
    // Linear pathway
    for (let y = goal.base_year; y <= goal.target_year; y++) {
      const frac = (y - goal.base_year) / (goal.target_year - goal.base_year);
      pathway.push({ year: y, targetValue: Math.round(baseValue - frac * (baseValue - targetValue)) });
    }
  } else if (goal.goal_type === 'net_zero' && baseValue > 0) {
    targetValue = 0;
    for (let y = goal.base_year; y <= goal.target_year; y++) {
      const frac = (y - goal.base_year) / (goal.target_year - goal.base_year);
      pathway.push({ year: y, targetValue: Math.round(baseValue * (1 - frac)) });
    }
  }

  // ── Build chart data ──────────────────────────────────────────────────────
  // Merge actual data with pathway projections
  const allYears = new Set([
    ...yearlyData.map(d => d.year),
    ...pathway.map(p => p.year),
    goal.target_year,
  ]);
  const sortedYears = Array.from(allYears).sort((a, b) => a - b);

  const actualMap = new Map(yearlyData.map(d => [d.year, d.actualValue]));
  const pathwayMap = new Map(pathway.map(p => [p.year, p.targetValue]));

  // With-pipeline forecast: measured value minus the annualised pipeline,
  // projected from the year the measurement covers.
  const forecastValue = Math.max(0, currentValue - pipelineValue);
  const anchorYear = measurement?.year ?? currentYear;

  // The year in progress is left off the actual line unless it is the only
  // measurement there is: a part year plotted beside whole years reads as a
  // sudden drop in emissions.
  const plotYear = (year: number) =>
    year !== currentYear || (measurement?.partial ?? false);

  const chartData = sortedYears.map(year => ({
    year,
    actual: actualMap.has(year) && plotYear(year) ? (actualMap.get(year) ?? null) : null,
    pathway: pathwayMap.get(year) ?? null,
    forecast: year >= anchorYear && year <= goal.target_year && goal.target_year > anchorYear
      ? Math.round(
          forecastValue +
          (targetValue !== null
            ? ((targetValue - forecastValue) / (goal.target_year - anchorYear)) * (year - anchorYear)
            : 0),
        )
      : null,
  }));

  // ── Progress calculation ──────────────────────────────────────────────────
  let progressPct = 0;
  if (baseValue > 0 && targetValue !== null) {
    const reduction = baseValue - currentValue;
    const neededReduction = baseValue - targetValue;
    progressPct = neededReduction > 0 ? Math.min(100, (reduction / neededReduction) * 100) : 0;
    progressPct = Math.max(0, progressPct);
  }

  const gapValue = targetValue !== null ? Math.max(0, currentValue - targetValue) : null;
  const yearsLeft = goal.target_year - currentYear;

  async function handleStatusChange(newStatus: string) {
    setUpdating(true);
    await supabase.from('goals').update({ status: newStatus }).eq('id', goal.id);
    setUpdating(false);
    router.refresh();
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Back + header */}
      <div>
        <Link href="/goals" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-4">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Goals
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-2xl font-semibold text-gray-900">{goal.name}</h1>
              <Badge variant="secondary">{GOAL_METRIC_LABELS[metric]}</Badge>
              <Badge variant={STATUS_BADGE[goal.status] ?? 'secondary'}>{goal.status}</Badge>
            </div>
            {/* Scope and the Scope 2 method are GHG concepts; showing them on a
                water goal would imply a boundary that does not apply. */}
            <p className="text-sm text-gray-500">
              {GOAL_TYPE_LABELS[goal.goal_type] ?? goal.goal_type}
              {metric === 'ghg' && (
                <>
                  {goal.scope && <>{' · '}{GOAL_SCOPE_LABELS[goal.scope] ?? goal.scope}</>}
                  {goal.scope2_accounting_method && (
                    <>{' · '}{goal.scope2_accounting_method.replace(/_/g, '-')} Scope 2</>
                  )}
                </>
              )}
              {' · '}
              Base {goal.base_year} → {goal.target_year}
            </p>
          </div>
          {canEdit && goal.status === 'active' && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleStatusChange('achieved')}
                disabled={updating}
              >
                Mark Achieved
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleStatusChange('missed')}
                disabled={updating}
              >
                Mark Missed
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Progress</p>
            <p className="text-2xl font-bold text-gray-900">{Math.round(progressPct)}%</p>
            <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${progressPct >= 75 ? 'bg-emerald-500' : progressPct >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                style={{ width: `${Math.min(100, progressPct)}%` }}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Measured</p>
            <p className="text-2xl font-bold text-gray-900">{measurement ? fmtValue(currentValue) : '—'}</p>
            <p className="text-xs text-gray-400">
              {measurement ? `${measurement.year}${measurement.partial ? ' to date (partial)' : ''}` : 'No data yet'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Target</p>
            <p className="text-2xl font-bold text-gray-900">
              {targetValue !== null ? fmtValue(targetValue) : '—'}
            </p>
            <p className="text-xs text-gray-400">{goal.target_year}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Gap to Target</p>
            <p className={`text-2xl font-bold ${gapValue === 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {gapValue !== null ? (gapValue === 0 ? 'On track' : fmtValue(gapValue)) : '—'}
            </p>
            <p className="text-xs text-gray-400">
              {yearsLeft > 0 ? `${yearsLeft} yr to close` : yearsLeft === 0 ? 'Target year' : 'Past deadline'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Progress chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Progress vs Pathway</CardTitle>
          <p className="text-xs text-gray-500">
            Actual {GOAL_METRIC_LABELS[metric].toLowerCase()} (blue) vs{' '}
            {goal.goal_type === 'sbti_15c' ? 'SBTi 1.5°C pathway' : 'reduction pathway'} (dashed)
            {pipelineValue > 0 && ' · Pipeline forecast (green)'}
            {' · '}{axisUnit}
          </p>
          <p className="text-xs text-gray-500">{measurementCaption(measurement)}</p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={fmtTick}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  fmtValue(value),
                  name === 'actual' ? 'Actual' : name === 'pathway' ? 'Pathway' : 'Forecast w/ Pipeline',
                ]}
              />
              <Legend
                iconSize={10}
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value) =>
                  value === 'actual' ? 'Actual' : value === 'pathway' ? 'Pathway' : 'Forecast w/ Pipeline'
                }
              />
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#3b82f6"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                connectNulls={false}
                activeDot={{ r: 5 }}
              />
              {pathway.length > 0 && (
                <Line
                  type="monotone"
                  dataKey="pathway"
                  stroke="#9ca3af"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                />
              )}
              {pipelineValue > 0 && (
                <Line
                  type="monotone"
                  dataKey="forecast"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                />
              )}
              <ReferenceLine
                x={currentYear}
                stroke="#d1d5db"
                strokeDasharray="3 3"
                label={{ value: 'Today', position: 'top', fontSize: 11, fill: '#9ca3af' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Gap analysis */}
      {gapValue !== null && baseValue > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Gap Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div>
                <p className="text-xs text-gray-500 mb-1">Reduction achieved</p>
                <p className="text-xl font-bold text-gray-900">
                  {fmtValue(Math.max(0, baseValue - currentValue))}
                </p>
                <p className="text-xs text-gray-400">
                  {baseValue > 0
                    ? `${(((baseValue - currentValue) / baseValue) * 100).toFixed(1)}% from base`
                    : ''}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Still needed</p>
                <p className={`text-xl font-bold ${gapValue === 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {gapValue === 0 ? 'None — on track!' : fmtValue(gapValue)}
                </p>
                {yearsLeft > 0 && gapValue > 0 && (
                  <p className="text-xs text-gray-400">
                    ~{fmtValue(gapValue / yearsLeft)}/yr required
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Pipeline contribution</p>
                <p className="text-xl font-bold text-emerald-600">{fmtValue(pipelineValue)}</p>
                <p className="text-xs text-gray-400">
                  {gapValue > 0
                    ? `covers ${Math.min(100, (pipelineValue / gapValue) * 100).toFixed(0)}% of gap`
                    : 'from approved projects'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Supporting evidence: the board approval, the SBTi validation letter,
          the baseline recalculation memo — whatever makes the target and its
          base year defensible to an assurance provider. */}
      {organizationId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Supporting documents
              {docCount > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-400">({docCount})</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EvidencePanel
              recordType="goal"
              recordId={goal.id}
              organizationId={organizationId}
              canEdit={canEdit}
              onCountChange={setDocCount}
            />
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {goal.notes && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{goal.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
