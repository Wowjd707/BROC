/**
 * Goals across metric families.
 *
 * A goal used to be an emissions target and nothing else. Water and waste were
 * measured but untargetable, so a dashboard could report a water number without
 * ever saying whether it was good. This module generalises the target and
 * progress maths over three metric families while keeping one definition of
 * "progress" — the Goals page and the dashboard both call in here, so the two
 * views cannot drift into disagreeing about the same target.
 *
 * Units: values are in the family's canonical stored unit (kg CO₂e, US gallons,
 * kg) end to end. Display conversion happens at the edge, in lib/units.ts.
 *
 * Deliberately NOT here: an SBTi-style pathway for water or waste. The 4.2%/yr
 * 1.5°C trajectory is defined on greenhouse gases; applying it to a water
 * volume would be a fabricated methodology wearing a credible name.
 *
 * Pure and dependency-free so it is unit-testable.
 */

import { calculateSBTiTarget, calculateAbsoluteTarget } from './calculations';
import type { MetricFamily } from './units';

export type GoalMetric = 'ghg' | 'water' | 'waste';

export const GOAL_METRICS: GoalMetric[] = ['ghg', 'water', 'waste'];

export const GOAL_METRIC_LABELS: Record<GoalMetric, string> = {
  ghg: 'Emissions',
  water: 'Water',
  waste: 'Waste',
};

/** The lib/units.ts family a goal metric formats with. */
export const GOAL_METRIC_FAMILY: Record<GoalMetric, MetricFamily> = {
  ghg: 'carbon',
  water: 'water',
  waste: 'waste',
};

/** Canonical stored unit, spelled out for form hints and axis labels. */
export const GOAL_METRIC_BASE_UNIT: Record<GoalMetric, string> = {
  ghg: 'kg CO₂e',
  water: 'US gallons',
  waste: 'kg',
};

/**
 * Goal shapes offered per metric. `net_zero` and `sbti_15c` are GHG-only:
 * "net zero water" has no agreed definition and an SBTi pathway is an emissions
 * construct. Offering them elsewhere would invite a target nobody can defend to
 * an assurance provider.
 */
export const GOAL_TYPES_BY_METRIC: Record<GoalMetric, { value: string; label: string }[]> = {
  ghg: [
    { value: 'absolute',  label: 'Absolute Reduction' },
    { value: 'intensity', label: 'Intensity Target' },
    { value: 'net_zero',  label: 'Net Zero' },
    { value: 'sbti_15c',  label: 'SBTi 1.5°C' },
  ],
  water: [
    { value: 'absolute',  label: 'Absolute Reduction' },
    { value: 'intensity', label: 'Intensity Target' },
  ],
  waste: [
    { value: 'absolute',  label: 'Absolute Reduction' },
    { value: 'intensity', label: 'Intensity Target' },
  ],
};

/** Narrow an arbitrary stored string to a known metric, defaulting to GHG. */
export function asGoalMetric(value: string | null | undefined): GoalMetric {
  return value === 'water' || value === 'waste' ? value : 'ghg';
}

/** The subset of a goal row this module needs. */
export interface GoalLike {
  goal_type: string;
  metric?: string | null;
  base_year: number;
  target_year: number;
  base_year_value?: number | null;
  base_year_emissions_kg?: number | null;
  target_value: number | null;
  progress_pct?: number | null;
}

/**
 * A goal's baseline.
 *
 * `base_year_value` is the general column; `base_year_emissions_kg` is the
 * original GHG-only one that predates it and is still written for GHG goals.
 * Reading the general one first means a goal saved before migration 021 — where
 * only the old column is populated — still resolves.
 */
export function goalBaseline(goal: GoalLike): number | null {
  const v = goal.base_year_value ?? goal.base_year_emissions_kg ?? null;
  return v != null && Number.isFinite(v) ? v : null;
}

/**
 * The absolute target a goal implies, in the metric's canonical unit, or null
 * when it cannot be derived. Null is returned rather than a guess: a progress
 * bar against an invented target is worse than no progress bar.
 */
export function goalTargetValue(goal: GoalLike): number | null {
  const base = goalBaseline(goal);
  if (base == null) return null;

  if (goal.goal_type === 'sbti_15c') {
    // GHG-only by construction; a non-GHG goal should never carry this type.
    if (asGoalMetric(goal.metric) !== 'ghg') return null;
    return calculateSBTiTarget(base, goal.base_year, goal.target_year).targetEmissionsKg;
  }

  if (goal.goal_type === 'net_zero') return 0;

  // An intensity target is a ratio (per unit of revenue, production, floor
  // area). Its percentage cannot be applied to an absolute baseline: that would
  // grade an intensity goal against absolute emissions, which is a different
  // target. Until a goal stores its numerator and denominator, it is not
  // computable and the entered progress is shown instead.
  if (goal.goal_type === 'intensity') return null;

  if (goal.target_value == null) return null;
  return calculateAbsoluteTarget(base, goal.target_value);
}

/** Which emissions a GHG goal covers. */
export type GoalScope = 'scope1' | 'scope2' | 'scope1_2';

/**
 * The current emissions a GHG goal is measured against: only the scope it
 * covers. A Scope 1 goal was being compared with Scope 1 + 2, so a site that
 * had cut Scope 1 by 40% showed no progress at all. `scope2Kg` should already
 * reflect the goal's Scope 2 method (location- or market-based).
 */
export function goalScopeEmissions(
  scope: string | null | undefined,
  scope1Kg: number,
  scope2Kg: number,
): number {
  if (scope === 'scope1') return scope1Kg;
  if (scope === 'scope2') return scope2Kg;
  return scope1Kg + scope2Kg;
}

/** Scope 1 and both Scope 2 totals for a period, boundary-adjusted. */
export interface ScopeTotals {
  scope1: number;
  scope2Market: number;
  scope2Location: number;
  /** Whether any rows fed each scope. Absent means "not measured", not 0. */
  hasScope1?: boolean;
  hasScope2?: boolean;
}

/**
 * Sum emission rows into Scope 1 and Scope 2 totals, each row multiplied by
 * its site's consolidation share — the same boundary the report, dashboard and
 * KPI page apply, so a 50% joint venture cannot count fully toward a goal and
 * half in the report. Null when the period has no Scope 1 or 2 rows (not
 * measured is not zero).
 */
export function scopeTotals(
  rows: { scope: string; co2e_kg: number; co2e_kg_location_based: number | null; site_id?: string | null }[] | null | undefined,
  share: (siteId: string | null) => number = () => 1,
): ScopeTotals | null {
  const s12 = (rows ?? []).filter((r) => r.scope === 'scope1' || r.scope === 'scope2');
  if (s12.length === 0) return null;
  const t: ScopeTotals = { scope1: 0, scope2Market: 0, scope2Location: 0, hasScope1: false, hasScope2: false };
  for (const r of s12) {
    const k = share(r.site_id ?? null);
    if (r.scope === 'scope1') { t.scope1 += Number(r.co2e_kg) * k; t.hasScope1 = true; }
    else {
      t.hasScope2 = true;
      t.scope2Market += Number(r.co2e_kg) * k;
      t.scope2Location += Number(r.co2e_kg_location_based ?? r.co2e_kg) * k;
    }
  }
  return t;
}

/**
 * A GHG goal's current value: its scope, under its Scope 2 method. Null when
 * the scope the goal covers has no rows in the period — a Scope 2 goal in a
 * year where only Scope 1 has been entered is not measured, and reading it as
 * 0 showed 100% progress. A Scope 1 + 2 goal needs both.
 */
export function goalGhgValue(
  totals: ScopeTotals | null | undefined,
  scope: string | null | undefined,
  scope2Method: string | null | undefined,
): number | null {
  if (!totals) return null;
  const has1 = totals.hasScope1 ?? true;
  const has2 = totals.hasScope2 ?? true;
  if (scope === 'scope1' && !has1) return null;
  if (scope === 'scope2' && !has2) return null;
  if (scope !== 'scope1' && scope !== 'scope2' && (!has1 || !has2)) return null;
  const s2 = scope2Method === 'location_based' ? totals.scope2Location : totals.scope2Market;
  return goalScopeEmissions(scope, totals.scope1, s2);
}

export interface GoalProgress {
  metric: GoalMetric;
  baseValue: number | null;
  targetValue: number | null;
  currentValue: number;
  /** Reduction required from the baseline to reach the target. */
  requiredReduction: number;
  /** Reduction delivered so far, floored at zero. */
  achievedReduction: number;
  /** Share of the required reduction delivered (0–100). */
  progressPct: number;
  /** True when the target is derivable; false means the bar is not meaningful. */
  isComputable: boolean;
  /** False when the period has no data for what the goal measures. */
  measured: boolean;
}

/**
 * Progress toward a goal.
 *
 * Progress is measured as delivered reduction over required reduction, not as
 * current-over-target: a goal to cut 1,000 t to 600 t is 25% done at 900 t, not
 * 150% done. The former is what a reader means by "progress toward the target".
 *
 * When the target cannot be derived, `progress_pct` stored on the row is used
 * as a fallback and `isComputable` reports false so the UI can say the number
 * is entered rather than calculated.
 */
export function computeGoalProgress(goal: GoalLike, measuredValue: number | null): GoalProgress {
  const metric = asGoalMetric(goal.metric);
  const baseValue = goalBaseline(goal);
  const targetValue = goalTargetValue(goal);

  // Not measured: no progress claimed, and no fallback to an entered figure
  // either — the bar shows nothing rather than a number from nowhere.
  if (measuredValue == null) {
    return {
      metric, baseValue, targetValue, currentValue: 0,
      requiredReduction: 0, achievedReduction: 0, progressPct: 0,
      isComputable: false, measured: false,
    };
  }
  const currentValue = measuredValue;

  if (baseValue == null || targetValue == null) {
    return {
      metric,
      baseValue,
      targetValue,
      currentValue,
      requiredReduction: 0,
      achievedReduction: 0,
      progressPct: goal.progress_pct ?? 0,
      isComputable: false,
      measured: true,
    };
  }

  const requiredReduction = Math.max(0, baseValue - targetValue);
  const achievedReduction = Math.max(0, baseValue - currentValue);
  const progressPct =
    requiredReduction > 0
      ? Math.max(0, Math.min(100, (achievedReduction / requiredReduction) * 100))
      : 0;

  return {
    metric,
    baseValue,
    targetValue,
    currentValue,
    requiredReduction,
    achievedReduction,
    progressPct,
    isComputable: true,
    measured: true,
  };
}

/**
 * Bar colour by progress. Kept here rather than in a component so the Goals
 * page and the dashboard shade the same percentage identically — two different
 * colours for one number reads as two different assessments.
 */
export function progressColor(pct: number): string {
  if (pct >= 75) return 'bg-emerald-500';
  if (pct >= 40) return 'bg-amber-400';
  return 'bg-red-400';
}
