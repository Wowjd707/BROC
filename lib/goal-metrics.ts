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

  if (goal.target_value == null) return null;
  return calculateAbsoluteTarget(base, goal.target_value);
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
export function computeGoalProgress(goal: GoalLike, currentValue: number): GoalProgress {
  const metric = asGoalMetric(goal.metric);
  const baseValue = goalBaseline(goal);
  const targetValue = goalTargetValue(goal);

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
