import { describe, it, expect } from 'vitest';
import {
  asGoalMetric, goalBaseline, goalTargetValue, computeGoalProgress,
  GOAL_TYPES_BY_METRIC, type GoalLike,
} from './goal-metrics';

function goal(overrides: Partial<GoalLike> = {}): GoalLike {
  return {
    goal_type: 'absolute',
    metric: 'ghg',
    base_year: 2020,
    target_year: 2030,
    base_year_value: 1_000_000,
    target_value: 42,
    ...overrides,
  };
}

describe('asGoalMetric', () => {
  it('passes through the known metrics', () => {
    expect(asGoalMetric('water')).toBe('water');
    expect(asGoalMetric('waste')).toBe('waste');
    expect(asGoalMetric('ghg')).toBe('ghg');
  });

  it('defaults anything unrecognised to GHG', () => {
    // Every goal that existed before the metric column was a GHG goal.
    expect(asGoalMetric(null)).toBe('ghg');
    expect(asGoalMetric(undefined)).toBe('ghg');
    expect(asGoalMetric('energy')).toBe('ghg');
  });
});

describe('goalBaseline', () => {
  it('prefers the general column', () => {
    expect(goalBaseline(goal({ base_year_value: 500, base_year_emissions_kg: 900 }))).toBe(500);
  });

  it('falls back to the legacy GHG column', () => {
    // A goal written before migration 021 populated only the old column.
    expect(goalBaseline(goal({ base_year_value: null, base_year_emissions_kg: 900 }))).toBe(900);
  });

  it('is null when neither is set', () => {
    expect(goalBaseline(goal({ base_year_value: null, base_year_emissions_kg: null }))).toBeNull();
  });
});

describe('goalTargetValue', () => {
  it('applies a percentage reduction for absolute goals', () => {
    expect(goalTargetValue(goal({ target_value: 42 }))).toBeCloseTo(580_000, 6);
  });

  it('works identically for a water goal', () => {
    const t = goalTargetValue(goal({ metric: 'water', base_year_value: 20_000_000, target_value: 25 }));
    expect(t).toBeCloseTo(15_000_000, 6);
  });

  it('targets zero for net zero', () => {
    expect(goalTargetValue(goal({ goal_type: 'net_zero', target_value: null }))).toBe(0);
  });

  it('derives an SBTi target from the pathway', () => {
    const t = goalTargetValue(goal({ goal_type: 'sbti_15c', target_value: null }))!;
    // 4.2%/yr compounded over 10 years leaves roughly 65% of the baseline.
    expect(t).toBeGreaterThan(640_000);
    expect(t).toBeLessThan(660_000);
  });

  it('refuses an SBTi target for a non-GHG metric', () => {
    // The 1.5C pathway is defined on emissions. Applying it to a water volume
    // would invent a methodology, so no target is derived at all.
    expect(goalTargetValue(goal({ metric: 'water', goal_type: 'sbti_15c', target_value: null }))).toBeNull();
  });

  it('is null when the baseline is unknown', () => {
    expect(goalTargetValue(goal({ base_year_value: null, base_year_emissions_kg: null }))).toBeNull();
  });

  it('is null when an absolute goal has no percentage', () => {
    expect(goalTargetValue(goal({ target_value: null }))).toBeNull();
  });
});

describe('computeGoalProgress', () => {
  it('measures delivered reduction against required reduction', () => {
    // 1,000,000 -> 580,000 needs 420,000. At 900,000 we have delivered 100,000.
    const p = computeGoalProgress(goal(), 900_000);
    expect(p.requiredReduction).toBeCloseTo(420_000, 6);
    expect(p.achievedReduction).toBe(100_000);
    expect(p.progressPct).toBeCloseTo(23.81, 1);
    expect(p.isComputable).toBe(true);
  });

  it('does not report progress above 100 or below 0', () => {
    expect(computeGoalProgress(goal(), 100_000).progressPct).toBe(100);
    // Above the baseline is backwards, not negative progress.
    expect(computeGoalProgress(goal(), 1_500_000).progressPct).toBe(0);
  });

  it('carries the metric through', () => {
    expect(computeGoalProgress(goal({ metric: 'waste' }), 0).metric).toBe('waste');
  });

  it('falls back to the stored percentage and flags it as not computed', () => {
    const p = computeGoalProgress(
      goal({ base_year_value: null, base_year_emissions_kg: null, progress_pct: 61 }),
      0,
    );
    expect(p.progressPct).toBe(61);
    expect(p.isComputable).toBe(false);
  });

  it('reports zero rather than dividing by zero when no reduction is required', () => {
    const p = computeGoalProgress(goal({ target_value: 0 }), 1_000_000);
    expect(p.requiredReduction).toBe(0);
    expect(p.progressPct).toBe(0);
  });
});

describe('GOAL_TYPES_BY_METRIC', () => {
  it('offers emissions-only shapes for GHG alone', () => {
    const ghg = GOAL_TYPES_BY_METRIC.ghg.map(t => t.value);
    expect(ghg).toContain('sbti_15c');
    expect(ghg).toContain('net_zero');

    for (const metric of ['water', 'waste'] as const) {
      const values = GOAL_TYPES_BY_METRIC[metric].map(t => t.value);
      expect(values).not.toContain('sbti_15c');
      expect(values).not.toContain('net_zero');
    }
  });
});
