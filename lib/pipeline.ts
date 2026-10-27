/**
 * Reduction-project pipeline maths.
 *
 * A project's savings figure is an ANNUALISED rate ("this saves 100 t/yr"),
 * but a project that goes live in July only delivers part of that in its first
 * year. Counting the full annual figure against the current year overstates
 * the pipeline — and, because the pipeline is what gets compared to a target,
 * overstates progress toward that target. This module pro-rates by in-service
 * date so the current-year view is honest, while still reporting the full
 * annualised run-rate separately.
 *
 * Pure and dependency-free so it is unit-testable.
 */

/**
 * Which metric family a pipeline question is about. Savings are stored in the
 * same canonical unit as the entries they offset — carbon in kg CO₂e, water in
 * US gallons, waste in kg — so a pipeline figure and a measured total are
 * directly comparable with no conversion between them.
 */
export type PipelineMetric = 'ghg' | 'water' | 'waste';

export interface PipelineProject {
  id: string;
  name: string;
  status: string;
  pipeline_inclusion_status: string;
  estimated_co2e_reduction_kg_per_year: number | null;
  actual_co2e_reduction_kg_per_year: number | null;
  estimated_water_reduction_gal_per_year?: number | null;
  actual_water_reduction_gal_per_year?: number | null;
  estimated_waste_reduction_kg_per_year?: number | null;
  actual_waste_reduction_kg_per_year?: number | null;
  start_date: string | null;
  completion_date: string | null;
}

/** The estimate/actual column pair backing each metric. */
const METRIC_FIELDS: Record<PipelineMetric, { estimated: keyof PipelineProject; actual: keyof PipelineProject }> = {
  ghg:   { estimated: 'estimated_co2e_reduction_kg_per_year',   actual: 'actual_co2e_reduction_kg_per_year' },
  water: { estimated: 'estimated_water_reduction_gal_per_year', actual: 'actual_water_reduction_gal_per_year' },
  waste: { estimated: 'estimated_waste_reduction_kg_per_year',  actual: 'actual_waste_reduction_kg_per_year' },
};

/**
 * Values below are in the requested metric's canonical unit — kg CO₂e, US
 * gallons, or kg — never a mixture. The fields are named `…Value` rather than
 * `…Kg` for exactly that reason: a water figure sitting in a field called
 * `annualKg` is the kind of quiet unit error this codebase exists to prevent.
 */
export interface ProratedProject {
  id: string;
  name: string;
  status: string;
  /** Full annualised run-rate, once the project is live for a whole year. */
  annualValue: number;
  /** Portion realistically delivered inside the reporting year. */
  currentYearValue: number;
  /** Fraction of the year the project is in service (0–1). */
  activeFraction: number;
  /** The date savings are taken to begin, if known. */
  inServiceFrom: string | null;
}

/** Days in a reporting year beginning at `fyStart` month, accounting for leap years. */
function reportingYearBounds(year: number, fyStart: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, fyStart - 1, 1));
  const end = new Date(Date.UTC(fyStart === 1 ? year + 1 : year + 1, fyStart - 1, 1));
  return { start, end };
}

/**
 * Fraction of the reporting year for which a project is in service.
 * Returns 1 when it is live for the whole year, 0 when it never starts within
 * it, and the remaining share when it starts partway through.
 *
 * A project with no in-service date is treated as delivering nothing in the
 * current year: an undated project is a plan, not a saving, and assuming a
 * full year for it is exactly the optimism this function exists to remove.
 */
export function activeFractionOfYear(
  inServiceDate: string | null,
  year: number,
  fyStart: number = 1,
): number {
  if (!inServiceDate) return 0;

  const { start, end } = reportingYearBounds(year, fyStart);
  const live = new Date(`${inServiceDate}T00:00:00Z`);
  if (Number.isNaN(live.getTime())) return 0;

  if (live <= start) return 1;      // already running at the start of the year
  if (live >= end) return 0;        // does not start until a later year

  const totalMs = end.getTime() - start.getTime();
  const activeMs = end.getTime() - live.getTime();
  return activeMs / totalMs;
}

/**
 * The date a project's savings begin. Completed projects deliver from their
 * completion date (the retrofit is not saving anything while it is being
 * installed); everything else from its planned start.
 */
export function inServiceDate(p: PipelineProject): string | null {
  if (p.status === 'completed') return p.completion_date ?? p.start_date;
  return p.start_date ?? p.completion_date;
}

/**
 * A project's annualised saving for one metric. A completed project reports its
 * measured actual where one exists and falls back to the estimate; anything
 * still in flight can only offer the estimate.
 */
export function annualSavingFor(p: PipelineProject, metric: PipelineMetric): number {
  const { estimated, actual } = METRIC_FIELDS[metric];
  const est = (p[estimated] as number | null | undefined) ?? null;
  const act = (p[actual] as number | null | undefined) ?? null;
  return (p.status === 'completed' ? act ?? est : est) ?? 0;
}

/** Pro-rate one project against a reporting year. */
export function prorateProject(
  p: PipelineProject,
  year: number,
  fyStart: number = 1,
  metric: PipelineMetric = 'ghg',
): ProratedProject {
  const annualValue = annualSavingFor(p, metric);

  const from = inServiceDate(p);
  const activeFraction = activeFractionOfYear(from, year, fyStart);

  return {
    id: p.id,
    name: p.name,
    status: p.status,
    annualValue,
    currentYearValue: annualValue * activeFraction,
    activeFraction,
    inServiceFrom: from,
  };
}

export interface PipelineSummary {
  /** Which metric these figures are denominated in. */
  metric: PipelineMetric;
  /** Pro-rated savings landing inside the reporting year. */
  currentYearValue: number;
  /** Full annualised run-rate of everything in the pipeline. */
  annualisedValue: number;
  /** Annualised run-rate of projects not yet contributing this year. */
  futureValue: number;
  projects: ProratedProject[];
}

/**
 * Summarise a pipeline for a reporting year: the reductions still to come.
 *
 * `cancelled` projects, and projects whose `pipeline_inclusion_status` is
 * `excluded`, are left out. `idea`-stage projects are excluded by default, since an unapproved idea should not count toward a target.
 * `completed` projects are excluded by default too: their savings are already
 * in the measured emissions, so counting them here as well added them twice —
 * once in "achieved" (base minus current) and again as "pipeline" — and
 * overstated how much of a target is covered.
 *
 * `metric` selects which savings column is summed. A project with no figure for
 * the requested metric contributes zero rather than being dropped — the project
 * count and the savings total answer different questions, and a water project
 * with no stated water saving is a gap in the data worth seeing.
 */
export function summarisePipeline(
  projects: PipelineProject[],
  year: number,
  fyStart: number = 1,
  options: {
    includeIdeas?: boolean;
    includeCompleted?: boolean;
    /**
     * Keep completed projects whose completion date falls after this date
     * (the end of the latest measured year). Their savings are not yet in any
     * measured figure, so dropping them left them in neither "achieved" nor
     * "pipeline" and understated coverage.
     */
    completedAfter?: string;
    metric?: PipelineMetric;
  } = {},
): PipelineSummary {
  const metric = options.metric ?? 'ghg';

  const keepCompleted = (p: PipelineProject) =>
    options.includeCompleted
    || (options.completedAfter != null && p.completion_date != null && p.completion_date > options.completedAfter);

  const eligible = projects.filter(
    (p) =>
      p.status !== 'cancelled' &&
      // 'excluded' means the project's savings count for nothing, as the
      // project import documents. It was ignored here.
      p.pipeline_inclusion_status !== 'excluded' &&
      (options.includeIdeas ? true : p.status !== 'idea') &&
      (p.status !== 'completed' || keepCompleted(p)),
  );

  const prorated = eligible.map((p) => prorateProject(p, year, fyStart, metric));

  return {
    metric,
    currentYearValue: prorated.reduce((s, p) => s + p.currentYearValue, 0),
    annualisedValue: prorated.reduce((s, p) => s + p.annualValue, 0),
    futureValue: prorated
      .filter((p) => p.activeFraction < 1)
      .reduce((s, p) => s + p.annualValue * (1 - p.activeFraction), 0),
    projects: prorated,
  };
}

// ─── Gap to target ───────────────────────────────────────────────────────────

/** All values in the metric's canonical unit — see the note on ProratedProject. */
export interface GapToTarget {
  baseYearValue: number;
  targetValue: number;
  /** Reduction still required from the base year to hit the target. */
  requiredReductionValue: number;
  /** Reduction already achieved (base year minus current actual). */
  achievedValue: number;
  /** Annualised pipeline that counts toward the remaining gap. */
  pipelineValue: number;
  /** What is still unaccounted for after achieved + pipeline. */
  gapValue: number;
  /** Share of the required reduction covered by achieved + pipeline (0–100). */
  coveragePct: number;
}

/**
 * How far achieved reductions plus the committed pipeline get toward a target.
 * Uses the ANNUALISED pipeline, not the pro-rated current-year figure: the
 * question "will we hit a 2030 target" is about run-rate at that date, not
 * about how much lands this calendar year.
 *
 * Metric-agnostic: caller supplies base, target, current and pipeline already
 * in one consistent unit, and gets the gap back in that same unit.
 */
export function gapToTarget(
  baseYearValue: number,
  targetValue: number,
  currentActualValue: number,
  annualisedPipelineValue: number,
): GapToTarget {
  const requiredReductionValue = Math.max(0, baseYearValue - targetValue);
  const achievedValue = Math.max(0, baseYearValue - currentActualValue);
  const gapValue = Math.max(0, requiredReductionValue - achievedValue - annualisedPipelineValue);
  const coveragePct =
    requiredReductionValue > 0
      ? Math.min(100, ((achievedValue + annualisedPipelineValue) / requiredReductionValue) * 100)
      : 0;

  return {
    baseYearValue,
    targetValue,
    requiredReductionValue,
    achievedValue,
    pipelineValue: annualisedPipelineValue,
    gapValue,
    coveragePct,
  };
}
