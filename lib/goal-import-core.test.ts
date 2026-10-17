import { describe, it, expect } from 'vitest';
import {
  mapGoalRow, canonicalizeGoalRow,
  GOAL_IMPORT_HEADERS, GOAL_COLUMN_LABELS,
  type GoalMapContext,
} from './goal-import-core';
import { calculateSBTiTarget } from './calculations';

/** Wired to the real calculator, so a drift in either shows up here. */
const ctx = (existing: string[] = []): GoalMapContext => ({
  existingNames: new Set(existing),
  sbtiReductionPct: (base, baseYear, targetYear) =>
    calculateSBTiTarget(base, baseYear, targetYear).reductionPct,
});

const row = (over: Record<string, string> = {}): Record<string, string> => ({
  name: 'Halve Scope 1 and 2 by 2032',
  base_year: '2024',
  target_year: '2032',
  reduction_percent: '50',
  ...over,
});

describe('headers', () => {
  it('are spaced and capitalized, with no underscores', () => {
    expect(GOAL_IMPORT_HEADERS[0]).toBe('Goal Name');
    for (const h of GOAL_IMPORT_HEADERS) expect(h).not.toMatch(/_/);
  });
});

describe('canonicalizeGoalRow', () => {
  it('maps the numeral-bearing label that does not round-trip', () => {
    // "Scope 2 Method" becomes scope_2_method — the same trap the emissions
    // template hit with "Scope 1 Category", and optional in the same way.
    expect(canonicalizeGoalRow({ scope_2_method: 'Market-based' }).scope2_method)
      .toBe('Market-based');
    expect(canonicalizeGoalRow({ goal_name: 'A' }).name).toBe('A');
  });

  it('accepts the shorthand people type', () => {
    expect(canonicalizeGoalRow({ reduction_pct: '30' }).reduction_percent).toBe('30');
    expect(canonicalizeGoalRow({ baseline: '1000' }).base_year_value).toBe('1000');
  });
});

describe('mapGoalRow', () => {
  it('maps a straightforward absolute GHG goal', () => {
    const r = mapGoalRow(row({ base_year_value: '1200000' }), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.goal).toMatchObject({
        metric: 'ghg',
        goalType: 'absolute',
        scope: 'scope1_2',
        baseYear: 2024,
        targetYear: 2032,
        targetValue: 50,
        targetUnit: 'pct_reduction',
        scope2Method: 'market_based',
      });
    }
  });

  it('rejects a goal with no name', () => {
    const r = mapGoalRow(row({ name: '' }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(GOAL_COLUMN_LABELS.name);
  });

  it('flags a goal already on the list', () => {
    const r = mapGoalRow(row(), ctx(['halve scope 1 and 2 by 2032']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect('duplicate' in r && r.duplicate).toBe(true);
  });

  describe('years', () => {
    it('requires four-digit years', () => {
      expect(mapGoalRow(row({ base_year: '24' }), ctx()).ok).toBe(false);
      expect(mapGoalRow(row({ target_year: 'soon' }), ctx()).ok).toBe(false);
    });

    it('refuses a target year that is not after the base year', () => {
      // A target in the past or the same year makes every progress calculation
      // meaningless rather than merely wrong.
      expect(mapGoalRow(row({ base_year: '2030', target_year: '2030' }), ctx()).ok).toBe(false);
      expect(mapGoalRow(row({ base_year: '2030', target_year: '2025' }), ctx()).ok).toBe(false);
    });
  });

  describe('metric and goal type', () => {
    it('accepts a metric by label or key', () => {
      const a = mapGoalRow(row({ metric: 'Water (US gallons)' }), ctx());
      const b = mapGoalRow(row({ metric: 'water' }), ctx());
      if (a.ok) expect(a.goal.metric).toBe('water');
      if (b.ok) expect(b.goal.metric).toBe('water');
    });

    it('refuses SBTi on a water goal, and says why', () => {
      // Migration 021 is explicit: an SBTi pathway is defined on emissions, and
      // applying its 4.2%/yr to a water volume would invent a methodology. The
      // goal_type CHECK still accepts the combination, so this module refuses it.
      const r = mapGoalRow(
        row({ metric: 'water', goal_type: 'sbti_15c', base_year_value: '5000000' }),
        ctx(),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/greenhouse gas only/i);
    });

    it('refuses Net Zero on a waste goal for the same reason', () => {
      const r = mapGoalRow(row({ metric: 'waste', goal_type: 'net_zero' }), ctx());
      expect(r.ok).toBe(false);
    });

    it('allows absolute and intensity on every metric', () => {
      for (const metric of ['ghg', 'water', 'waste']) {
        expect(mapGoalRow(row({ metric, goal_type: 'absolute' }), ctx()).ok).toBe(true);
        expect(mapGoalRow(row({ metric, goal_type: 'intensity' }), ctx()).ok).toBe(true);
      }
    });
  });

  describe('SBTi targets are derived, not read', () => {
    it('computes the reduction from the baseline and the years', () => {
      const r = mapGoalRow(
        row({ goal_type: 'sbti_15c', base_year_value: '1000000', reduction_percent: '' }),
        ctx(),
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        const expected = calculateSBTiTarget(1000000, 2024, 2032).reductionPct;
        expect(r.goal.targetValue).toBeCloseTo(expected, 6);
        expect(r.goal.targetUnit).toBe('pct_reduction');
      }
    });

    it('ignores a typed percentage and says so', () => {
      // A number in that cell would be somebody's arithmetic wearing the name of
      // a standard, and would differ from the same goal made through the form.
      const r = mapGoalRow(
        row({ goal_type: 'sbti_15c', base_year_value: '1000000', reduction_percent: '90' }),
        ctx(),
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.goal.targetValue).not.toBe(90);
        expect(r.goal.warnings.some(w => /ignored/i.test(w))).toBe(true);
      }
    });

    it('refuses an SBTi goal with no baseline to derive from', () => {
      const r = mapGoalRow(row({ goal_type: 'sbti_15c', base_year_value: '' }), ctx());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/derived from the baseline/i);
    });
  });

  describe('absolute targets', () => {
    it('requires a reduction percent', () => {
      const r = mapGoalRow(row({ reduction_percent: '' }), ctx());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/required for an absolute/i);
    });

    it('rejects a percentage outside 0 to 100', () => {
      expect(mapGoalRow(row({ reduction_percent: '0' }), ctx()).ok).toBe(false);
      expect(mapGoalRow(row({ reduction_percent: '150' }), ctx()).ok).toBe(false);
    });

    it('accepts a percentage written with a sign', () => {
      const r = mapGoalRow(row({ reduction_percent: '42%' }), ctx());
      if (r.ok) expect(r.goal.targetValue).toBe(42);
    });
  });

  describe('scope belongs to GHG only', () => {
    it('defaults a GHG goal to scope 1 + 2', () => {
      const r = mapGoalRow(row({ scope: '' }), ctx());
      if (r.ok) expect(r.goal.scope).toBe('scope1_2');
    });

    it('resolves a scope by label', () => {
      const r = mapGoalRow(row({ scope: 'Scope 1 only' }), ctx());
      if (r.ok) expect(r.goal.scope).toBe('scope1');
    });

    it('drops a scope on a water goal and warns', () => {
      // Storing it would put a value in a column nothing reads for that metric.
      const r = mapGoalRow(row({ metric: 'water', scope: 'scope1_2' }), ctx());
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.goal.scope).toBeNull();
        expect(r.goal.warnings.some(w => /greenhouse gas goals only/i.test(w))).toBe(true);
      }
    });
  });

  it('warns when there is no baseline, because progress needs one', () => {
    const r = mapGoalRow(row({ base_year_value: '' }), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.goal.warnings.some(w => /progress cannot be measured/i.test(w))).toBe(true);
  });

  it('rejects an unreadable Scope 2 method rather than defaulting', () => {
    // It decides which electricity figure the goal is measured against, so
    // guessing would silently change what the goal is about.
    expect(mapGoalRow(row({ scope2_method: 'whichever' }), ctx()).ok).toBe(false);
  });
});
