import { describe, it, expect } from 'vitest';
import {
  activeFractionOfYear, inServiceDate, prorateProject, summarisePipeline, gapToTarget,
  type PipelineProject,
} from './pipeline';

function project(overrides: Partial<PipelineProject> = {}): PipelineProject {
  return {
    id: 'p1',
    name: 'Test project',
    status: 'approved',
    pipeline_inclusion_status: 'forecasted',
    estimated_co2e_reduction_kg_per_year: 100_000,
    actual_co2e_reduction_kg_per_year: null,
    start_date: '2026-01-01',
    completion_date: null,
    ...overrides,
  };
}

describe('activeFractionOfYear', () => {
  it('is 1 for a project already live at the start of the year', () => {
    expect(activeFractionOfYear('2025-06-01', 2026, 1)).toBe(1);
    expect(activeFractionOfYear('2026-01-01', 2026, 1)).toBe(1);
  });

  it('is 0 for a project starting after the year ends', () => {
    expect(activeFractionOfYear('2027-03-01', 2026, 1)).toBe(0);
  });

  it('is roughly half for a project going live at the start of July', () => {
    const f = activeFractionOfYear('2026-07-01', 2026, 1);
    expect(f).toBeGreaterThan(0.49);
    expect(f).toBeLessThan(0.51);
  });

  it('treats an undated project as contributing nothing', () => {
    // An undated project is a plan, not a saving.
    expect(activeFractionOfYear(null, 2026, 1)).toBe(0);
  });

  it('handles an invalid date without throwing', () => {
    expect(activeFractionOfYear('not-a-date', 2026, 1)).toBe(0);
  });

  it('respects a non-January fiscal year start', () => {
    // FY2026 starting April runs Apr 2026 -> Mar 2027.
    expect(activeFractionOfYear('2026-04-01', 2026, 4)).toBe(1);
    expect(activeFractionOfYear('2026-02-01', 2026, 4)).toBe(1); // before FY start
    expect(activeFractionOfYear('2027-05-01', 2026, 4)).toBe(0); // after FY end
  });

  it('accounts for leap years', () => {
    // 2028 is a leap year; a mid-year start should still be a sane fraction.
    const f = activeFractionOfYear('2028-07-01', 2028, 1);
    expect(f).toBeGreaterThan(0.49);
    expect(f).toBeLessThan(0.51);
  });
});

describe('inServiceDate', () => {
  it('uses completion date for completed projects', () => {
    expect(inServiceDate(project({
      status: 'completed', start_date: '2025-02-01', completion_date: '2025-08-15',
    }))).toBe('2025-08-15');
  });

  it('uses start date for in-flight projects', () => {
    expect(inServiceDate(project({ status: 'in_progress', start_date: '2026-03-01' })))
      .toBe('2026-03-01');
  });

  it('falls back when the preferred date is absent', () => {
    expect(inServiceDate(project({ status: 'completed', completion_date: null, start_date: '2025-01-01' })))
      .toBe('2025-01-01');
  });
});

describe('prorateProject', () => {
  it('pro-rates a mid-year project — the reported bug', () => {
    // 100 t/yr starting 1 July should show ~50 t this year, not 100 t.
    const r = prorateProject(project({ start_date: '2026-07-01' }), 2026, 1);
    expect(r.annualValue).toBe(100_000);
    expect(r.currentYearValue).toBeGreaterThan(49_000);
    expect(r.currentYearValue).toBeLessThan(51_000);
  });

  it('gives a full year to a project live since before the year', () => {
    const r = prorateProject(project({ start_date: '2025-01-01' }), 2026, 1);
    expect(r.currentYearValue).toBe(100_000);
  });

  it('prefers actual savings for completed projects', () => {
    const r = prorateProject(project({
      status: 'completed',
      estimated_co2e_reduction_kg_per_year: 100_000,
      actual_co2e_reduction_kg_per_year: 86_000,
      completion_date: '2025-01-01',
    }), 2026, 1);
    expect(r.annualValue).toBe(86_000);
  });

  it('treats a missing savings figure as zero', () => {
    const r = prorateProject(project({ estimated_co2e_reduction_kg_per_year: null }), 2026, 1);
    expect(r.annualValue).toBe(0);
    expect(r.currentYearValue).toBe(0);
  });
});

describe('summarisePipeline', () => {
  const projects = [
    project({ id: 'a', status: 'completed', completion_date: '2025-06-01',
              actual_co2e_reduction_kg_per_year: 200_000 }),
    project({ id: 'b', status: 'in_progress', start_date: '2026-07-01',
              estimated_co2e_reduction_kg_per_year: 100_000 }),
    project({ id: 'c', status: 'approved', start_date: '2027-01-01',
              estimated_co2e_reduction_kg_per_year: 300_000 }),
    project({ id: 'd', status: 'idea', start_date: '2026-01-01',
              estimated_co2e_reduction_kg_per_year: 500_000 }),
    project({ id: 'e', status: 'cancelled', start_date: '2026-01-01',
              estimated_co2e_reduction_kg_per_year: 900_000 }),
  ];

  it('excludes cancelled and idea-stage projects by default', () => {
    const s = summarisePipeline(projects, 2026, 1);
    expect(s.projects.map(p => p.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('can include ideas when explicitly asked', () => {
    const s = summarisePipeline(projects, 2026, 1, { includeIdeas: true });
    expect(s.projects.map(p => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('separates current-year delivery from annualised run-rate', () => {
    const s = summarisePipeline(projects, 2026, 1);
    // a delivers fully (200k), b about half (50k), c nothing yet
    expect(s.currentYearValue).toBeGreaterThan(248_000);
    expect(s.currentYearValue).toBeLessThan(252_000);
    expect(s.annualisedValue).toBe(600_000);
    // future = b's un-delivered half + all of c
    expect(s.futureValue).toBeGreaterThan(348_000);
    expect(s.futureValue).toBeLessThan(352_000);
  });

  it('returns zeros for an empty pipeline', () => {
    const s = summarisePipeline([], 2026, 1);
    expect(s).toMatchObject({ currentYearValue: 0, annualisedValue: 0, futureValue: 0 });
  });
});

describe('metric selection', () => {
  const multiMetric = project({
    start_date: '2025-01-01',
    estimated_co2e_reduction_kg_per_year: 100_000,
    estimated_water_reduction_gal_per_year: 40_000,
    estimated_waste_reduction_kg_per_year: 7_500,
  });

  it('defaults to GHG', () => {
    expect(prorateProject(multiMetric, 2026, 1).annualValue).toBe(100_000);
  });

  it('reads the water column when asked for water', () => {
    expect(prorateProject(multiMetric, 2026, 1, 'water').annualValue).toBe(40_000);
  });

  it('reads the waste column when asked for waste', () => {
    expect(prorateProject(multiMetric, 2026, 1, 'waste').annualValue).toBe(7_500);
  });

  it('prefers the actual over the estimate for a completed project, per metric', () => {
    const done = project({
      status: 'completed',
      completion_date: '2025-01-01',
      estimated_water_reduction_gal_per_year: 40_000,
      actual_water_reduction_gal_per_year: 31_000,
    });
    expect(prorateProject(done, 2026, 1, 'water').annualValue).toBe(31_000);
  });

  it('counts a project with no figure for the metric as zero, not as excluded', () => {
    // The project is still in the pipeline — it just saves nothing here. Both
    // facts matter: dropping it would hide that its water saving was never
    // estimated.
    const ghgOnly = project({ id: 'g', start_date: '2025-01-01' });
    const s = summarisePipeline([ghgOnly], 2026, 1, { metric: 'water' });
    expect(s.projects).toHaveLength(1);
    expect(s.annualisedValue).toBe(0);
  });

  it('reports which metric a summary is denominated in', () => {
    expect(summarisePipeline([multiMetric], 2026, 1, { metric: 'waste' }))
      .toMatchObject({ metric: 'waste', annualisedValue: 7_500 });
  });

  it('pro-rates water the same way it pro-rates carbon', () => {
    const midYear = project({
      start_date: '2026-07-01',
      estimated_water_reduction_gal_per_year: 40_000,
    });
    const r = prorateProject(midYear, 2026, 1, 'water');
    expect(r.currentYearValue).toBeGreaterThan(19_600);
    expect(r.currentYearValue).toBeLessThan(20_400);
  });
});

describe('gapToTarget', () => {
  it('reports the shortfall after achieved reductions and pipeline', () => {
    // base 1000, target 600 -> need 400. Achieved 100, pipeline 150 -> gap 150.
    const g = gapToTarget(1000, 600, 900, 150);
    expect(g.requiredReductionValue).toBe(400);
    expect(g.achievedValue).toBe(100);
    expect(g.gapValue).toBe(150);
    expect(g.coveragePct).toBeCloseTo(62.5, 6);
  });

  it('caps coverage at 100 and never reports a negative gap', () => {
    const g = gapToTarget(1000, 600, 500, 900);
    expect(g.gapValue).toBe(0);
    expect(g.coveragePct).toBe(100);
  });

  it('handles emissions having risen above the base year', () => {
    const g = gapToTarget(1000, 600, 1200, 0);
    expect(g.achievedValue).toBe(0); // not negative
    expect(g.gapValue).toBe(400);
  });

  it('returns 0 coverage when no reduction is required', () => {
    const g = gapToTarget(1000, 1000, 1000, 0);
    expect(g.requiredReductionValue).toBe(0);
    expect(g.coveragePct).toBe(0);
  });
});
