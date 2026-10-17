/**
 * Social and governance metrics — definitions, normalization, and derived rates.
 *
 * The counterpart to `emission-factors.ts` + `calculations.ts` for the S and G
 * pillars. Mirrors `sustainability_metrics` (migration 023); that table is the
 * database's copy and this is the application's, the same two-copy contract
 * `evidence-core.ts` has with the `record_type` CHECK. The API validates
 * against this list, so a metric added to one must be added to the other.
 *
 * ─── Why no rate is ever stored ──────────────────────────────────────────────
 *
 * TRIR, DART, turnover and board independence are all computed here from raw
 * counts, and none of them is an enterable metric. A stored rate cannot be
 * traced to the numerator and denominator that produced it, cannot be
 * recomputed on a different hours basis when a framework demands one, and
 * cannot be assured. This is the same standing decision that keeps stakeholder
 * ratings out of materiality scores.
 *
 * ─── Why the hours basis is always returned with the rate ────────────────────
 *
 * A safety rate is meaningless without it. US OSHA recordkeeping uses 200,000
 * hours (100 full-time workers × 40 hours × 50 weeks). GRI 403-9 permits either
 * 200,000 or 1,000,000 and requires the reporter to state which was used, so
 * the basis travels with the number rather than being assumed downstream.
 *
 * Pure and dependency-free so it is unit-testable.
 */

// ─── Metric catalog ──────────────────────────────────────────────────────────

export type Pillar = 'environmental' | 'social' | 'governance';
export type Aggregation = 'sum' | 'point_in_time' | 'average';

/** Metric families `ehs_entries.metric_type` accepts after migration 023. */
export const METRIC_FAMILIES = [
  'water', 'waste',                          // environmental
  'safety', 'workforce', 'training',         // social
  'governance',                              // governance
] as const;

export type MetricFamily = (typeof METRIC_FAMILIES)[number];

export interface MetricDefinition {
  metricType: MetricFamily;
  sourceType: string;
  pillar: Pillar;
  label: string;
  canonicalUnit: string;
  aggregation: Aggregation;
  /** Entity-level metric: entered with no site. */
  orgLevel?: boolean;
}

/**
 * The social and governance metrics. Water and waste are deliberately absent:
 * their source types are open-ended (an organization names their own waste streams)
 * and are handled by `conversions.ts`, so listing a fixed subset here would
 * make this file look authoritative about something it does not govern.
 */
export const SOCIAL_GOVERNANCE_METRICS: MetricDefinition[] = [
  // Safety — GRI 403, ESRS S1-14
  { metricType: 'safety', sourceType: 'hours_worked', pillar: 'social', label: 'Hours worked', canonicalUnit: 'hours', aggregation: 'sum' },
  { metricType: 'safety', sourceType: 'recordable_incidents', pillar: 'social', label: 'Recordable work-related injuries', canonicalUnit: 'count', aggregation: 'sum' },
  { metricType: 'safety', sourceType: 'lost_time_incidents', pillar: 'social', label: 'Lost-time injuries', canonicalUnit: 'count', aggregation: 'sum' },
  { metricType: 'safety', sourceType: 'restricted_duty_incidents', pillar: 'social', label: 'Restricted-duty or job-transfer cases', canonicalUnit: 'count', aggregation: 'sum' },
  { metricType: 'safety', sourceType: 'lost_days', pillar: 'social', label: 'Days away from work', canonicalUnit: 'days', aggregation: 'sum' },
  { metricType: 'safety', sourceType: 'high_consequence_incidents', pillar: 'social', label: 'High-consequence work-related injuries', canonicalUnit: 'count', aggregation: 'sum' },
  { metricType: 'safety', sourceType: 'fatalities', pillar: 'social', label: 'Work-related fatalities', canonicalUnit: 'count', aggregation: 'sum' },
  { metricType: 'safety', sourceType: 'near_misses', pillar: 'social', label: 'Near misses reported', canonicalUnit: 'count', aggregation: 'sum' },

  // Workforce — GRI 401/2-7, ESRS S1-6
  { metricType: 'workforce', sourceType: 'headcount', pillar: 'social', label: 'Headcount', canonicalUnit: 'count', aggregation: 'point_in_time' },
  { metricType: 'workforce', sourceType: 'new_hires', pillar: 'social', label: 'New employee hires', canonicalUnit: 'count', aggregation: 'sum' },
  { metricType: 'workforce', sourceType: 'separations_voluntary', pillar: 'social', label: 'Voluntary separations', canonicalUnit: 'count', aggregation: 'sum' },
  { metricType: 'workforce', sourceType: 'separations_involuntary', pillar: 'social', label: 'Involuntary separations', canonicalUnit: 'count', aggregation: 'sum' },

  // Training — GRI 404/403-5, ESRS S1-13
  { metricType: 'training', sourceType: 'training_hours', pillar: 'social', label: 'Training hours delivered', canonicalUnit: 'hours', aggregation: 'sum' },
  { metricType: 'training', sourceType: 'ehs_training_hours', pillar: 'social', label: 'Health and safety training hours', canonicalUnit: 'hours', aggregation: 'sum' },

  // Governance — GRI 2/205, ESRS G1
  { metricType: 'governance', sourceType: 'board_seats', pillar: 'governance', label: 'Board seats', canonicalUnit: 'count', aggregation: 'point_in_time', orgLevel: true },
  { metricType: 'governance', sourceType: 'independent_board_seats', pillar: 'governance', label: 'Independent board seats', canonicalUnit: 'count', aggregation: 'point_in_time', orgLevel: true },
  { metricType: 'governance', sourceType: 'corruption_incidents_confirmed', pillar: 'governance', label: 'Confirmed incidents of corruption', canonicalUnit: 'count', aggregation: 'sum', orgLevel: true },
  { metricType: 'governance', sourceType: 'whistleblower_reports', pillar: 'governance', label: 'Reports received through grievance channels', canonicalUnit: 'count', aggregation: 'sum', orgLevel: true },
  { metricType: 'governance', sourceType: 'whistleblower_reports_substantiated', pillar: 'governance', label: 'Reports substantiated after investigation', canonicalUnit: 'count', aggregation: 'sum', orgLevel: true },
  { metricType: 'governance', sourceType: 'policy_training_completions', pillar: 'governance', label: 'Anti-corruption training completions', canonicalUnit: 'count', aggregation: 'sum', orgLevel: true },
];

const BY_KEY = new Map<string, MetricDefinition>(
  SOCIAL_GOVERNANCE_METRICS.map((m) => [`${m.metricType}:${m.sourceType}`, m]),
);

/** The social/governance families. Water and waste keep their existing path. */
export const SOCIAL_GOVERNANCE_FAMILIES = ['safety', 'workforce', 'training', 'governance'] as const;

export function isSocialGovernanceFamily(metricType: string): boolean {
  return (SOCIAL_GOVERNANCE_FAMILIES as readonly string[]).includes(metricType);
}

export function getMetricDefinition(metricType: string, sourceType: string): MetricDefinition | null {
  return BY_KEY.get(`${metricType}:${sourceType}`) ?? null;
}

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Counts, hours and days do not convert between each other, so "normalization"
 * here is a unit *check*, not a conversion: it confirms the submitted unit is
 * the one this metric is defined in and rejects anything else.
 *
 * Rejecting rather than coercing is deliberate. A silently accepted "12 days"
 * against a metric defined in hours would produce a plausible, wrong TRIR that
 * nothing downstream could detect.
 */
export interface SocialNormalizationResult {
  quantityNormalized: number;
  unitNormalized: string;
}

const UNIT_SYNONYMS: Record<string, string> = {
  // hours
  hours: 'hours', hour: 'hours', hrs: 'hours', hr: 'hours', h: 'hours',
  manhours: 'hours', workhours: 'hours',
  // counts
  count: 'count', counts: 'count', cases: 'count', case: 'count',
  incidents: 'count', incident: 'count', number: 'count', people: 'count',
  employees: 'count', persons: 'count', headcount: 'count', reports: 'count',
  seats: 'count', completions: 'count', each: 'count',
  // days
  days: 'days', day: 'days', calendardays: 'days', scheduleddays: 'days',
};

export function canonicaliseUnit(unit: string): string | null {
  const key = unit.toLowerCase().replace(/[\s_-]/g, '');
  return UNIT_SYNONYMS[key] ?? null;
}

export function normalizeSocialInput(
  quantity: number,
  unit: string,
  metricType: string,
  sourceType: string,
): SocialNormalizationResult {
  const def = getMetricDefinition(metricType, sourceType);
  if (!def) {
    throw new Error(`Unknown metric: ${metricType} / ${sourceType}.`);
  }

  const canonical = canonicaliseUnit(unit);
  if (!canonical) {
    throw new Error(`Unsupported unit "${unit}" for ${def.label}. Expected ${def.canonicalUnit}.`);
  }
  if (canonical !== def.canonicalUnit) {
    throw new Error(
      `${def.label} is recorded in ${def.canonicalUnit}, but "${unit}" was submitted. ` +
      `These units do not convert, so the value cannot be accepted.`,
    );
  }

  // Counts and days must be whole. A fractional injury count is a data-entry
  // error, and rounding it here would hide that from the data-review module.
  if ((canonical === 'count' || canonical === 'days') && !Number.isInteger(quantity)) {
    throw new Error(`${def.label} must be a whole number; received ${quantity}.`);
  }

  return { quantityNormalized: quantity, unitNormalized: def.canonicalUnit };
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

export interface MetricReading {
  metricType: string;
  sourceType: string;
  entryDate: string;
  quantityNormalized: number;
  /**
   * Which site reported it. Null for entity-level metrics.
   *
   * Required for correctness, not for display: a stock metric like headcount is
   * reported per site, so the organization's figure is the latest reading FROM
   * EACH SITE, added together. Without the site, "latest reading" collapses to
   * one site's number for the whole company.
   */
  siteId: string | null;
}

/**
 * Reduce a period's readings for ONE metric to a single figure, honouring the
 * metric's aggregation rule.
 *
 * `point_in_time` takes the latest reading rather than a sum. Summing twelve
 * monthly headcount readings reports twelve workforces — the single most
 * likely way to produce a badly wrong social disclosure from correct data.
 *
 * Returns null when there are no readings, never 0: a metric with no data is
 * "not measured", and reporting it as zero is a misstatement. This is the same
 * distinction `resolveMetric` draws with its `missing` flag.
 */
export function aggregateMetric(readings: MetricReading[]): number | null {
  if (readings.length === 0) return null;

  const def = getMetricDefinition(readings[0].metricType, readings[0].sourceType);
  const aggregation: Aggregation = def?.aggregation ?? 'sum';

  switch (aggregation) {
    case 'point_in_time': {
      // Latest PER SITE, then summed across sites.
      //
      // Taking the latest reading overall would report one site's headcount as
      // the whole organization's — and because separations and training hours
      // are summed across every site, that produces a turnover rate and a
      // training-hours-per-employee figure computed from a numerator covering
      // the company and a denominator covering one plant. Wrong numbers, not
      // merely incomplete ones.
      const latestPerSite = new Map<string, MetricReading>();
      for (const r of readings) {
        const key = r.siteId ?? '__org__';
        const held = latestPerSite.get(key);
        // ISO dates sort lexicographically. Ties keep the first seen, so a
        // duplicate reading for one site on one date cannot double count.
        if (!held || r.entryDate > held.entryDate) latestPerSite.set(key, r);
      }
      let total = 0;
      for (const r of latestPerSite.values()) total += r.quantityNormalized;
      return total;
    }
    case 'average': {
      // Mean of each site's latest, for the same reason: averaging every
      // reading would weight a site that reports weekly above one that reports
      // annually. No seeded metric uses this today.
      const latestPerSite = new Map<string, MetricReading>();
      for (const r of readings) {
        const key = r.siteId ?? '__org__';
        const held = latestPerSite.get(key);
        if (!held || r.entryDate > held.entryDate) latestPerSite.set(key, r);
      }
      const values = Array.from(latestPerSite.values());
      return values.reduce((sum, r) => sum + r.quantityNormalized, 0) / values.length;
    }
    case 'sum':
    default:
      return readings.reduce((s, r) => s + r.quantityNormalized, 0);
  }
}

/** Group readings by metric and aggregate each under its own rule. */
export function aggregateAll(readings: MetricReading[]): Map<string, number> {
  const groups = new Map<string, MetricReading[]>();
  for (const r of readings) {
    const key = `${r.metricType}:${r.sourceType}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }

  const out = new Map<string, number>();
  for (const [key, group] of groups) {
    const value = aggregateMetric(group);
    if (value !== null) out.set(key, value);
  }
  return out;
}

// ─── Derived rates ───────────────────────────────────────────────────────────

/**
 * Hours basis for injury rates. 200,000 is the US OSHA convention (100
 * full-time workers × 40 hours × 50 weeks). 1,000,000 is the alternative GRI
 * 403-9 permits. The reporter must state which; this type is what carries it.
 */
export type HoursBasis = 200_000 | 1_000_000;

export interface DerivedRate {
  key: string;
  label: string;
  /** Null when the inputs are absent or the denominator is zero. */
  value: number | null;
  unit: string;
  /** Present on injury rates. Belongs in the basis of preparation. */
  hoursBasis?: HoursBasis;
  /** Human-readable formula, for the report's methodology appendix. */
  formula: string;
  /** Which raw metrics produced it — the lineage an assurance provider follows. */
  inputs: string[];
  /** Set when an input is missing, so a rate is never shown as 0. */
  missing: boolean;
}

export interface SocialInputs {
  hoursWorked?: number | null;
  recordableIncidents?: number | null;
  lostTimeIncidents?: number | null;
  restrictedDutyIncidents?: number | null;
  lostDays?: number | null;
  fatalities?: number | null;
  headcount?: number | null;
  separationsVoluntary?: number | null;
  separationsInvoluntary?: number | null;
  trainingHours?: number | null;
  ehsTrainingHours?: number | null;
  newHires?: number | null;
  highConsequenceIncidents?: number | null;
  nearMisses?: number | null;
  boardSeats?: number | null;
  independentBoardSeats?: number | null;
  corruptionIncidentsConfirmed?: number | null;
  policyTrainingCompletions?: number | null;
  whistleblowerReports?: number | null;
  whistleblowerReportsSubstantiated?: number | null;
}

function rate(
  key: string,
  label: string,
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  multiplier: number,
  unit: string,
  formula: string,
  inputs: string[],
  hoursBasis?: HoursBasis,
): DerivedRate {
  const haveNumerator = numerator != null && Number.isFinite(numerator);
  const haveDenominator = denominator != null && Number.isFinite(denominator) && denominator > 0;

  if (!haveNumerator || !haveDenominator) {
    return { key, label, value: null, unit, hoursBasis, formula, inputs, missing: true };
  }
  return {
    key,
    label,
    value: (numerator * multiplier) / denominator,
    unit,
    hoursBasis,
    formula,
    inputs,
    missing: false,
  };
}

/**
 * Every rate the platform derives, computed from raw counts only.
 *
 * A rate whose inputs are absent comes back with `value: null` and
 * `missing: true` rather than 0 — zero recordables against zero hours worked is
 * not a perfect safety record, it is an empty dataset, and a report must be
 * able to tell those apart.
 */
export function deriveRates(
  inputs: SocialInputs,
  hoursBasis: HoursBasis = 200_000,
): DerivedRate[] {
  const dartCases =
    inputs.lostTimeIncidents == null && inputs.restrictedDutyIncidents == null
      ? null
      : (inputs.lostTimeIncidents ?? 0) + (inputs.restrictedDutyIncidents ?? 0);

  const separations =
    inputs.separationsVoluntary == null && inputs.separationsInvoluntary == null
      ? null
      : (inputs.separationsVoluntary ?? 0) + (inputs.separationsInvoluntary ?? 0);

  return [
    rate(
      'trir', 'Total recordable incident rate (TRIR)',
      inputs.recordableIncidents, inputs.hoursWorked, hoursBasis,
      `per ${hoursBasis.toLocaleString('en-US')} hours worked`,
      `recordable injuries × ${hoursBasis.toLocaleString('en-US')} ÷ hours worked`,
      ['safety:recordable_incidents', 'safety:hours_worked'], hoursBasis,
    ),
    rate(
      'dart', 'Days away, restricted, or transferred (DART) rate',
      dartCases, inputs.hoursWorked, hoursBasis,
      `per ${hoursBasis.toLocaleString('en-US')} hours worked`,
      `(lost-time + restricted-duty cases) × ${hoursBasis.toLocaleString('en-US')} ÷ hours worked`,
      ['safety:lost_time_incidents', 'safety:restricted_duty_incidents', 'safety:hours_worked'], hoursBasis,
    ),
    rate(
      'ltir', 'Lost-time injury rate',
      inputs.lostTimeIncidents, inputs.hoursWorked, hoursBasis,
      `per ${hoursBasis.toLocaleString('en-US')} hours worked`,
      `lost-time injuries × ${hoursBasis.toLocaleString('en-US')} ÷ hours worked`,
      ['safety:lost_time_incidents', 'safety:hours_worked'], hoursBasis,
    ),
    rate(
      'severity', 'Lost-day severity rate',
      inputs.lostDays, inputs.hoursWorked, hoursBasis,
      `days per ${hoursBasis.toLocaleString('en-US')} hours worked`,
      `days away × ${hoursBasis.toLocaleString('en-US')} ÷ hours worked`,
      ['safety:lost_days', 'safety:hours_worked'], hoursBasis,
    ),
    rate(
      'fatality_rate', 'Work-related fatality rate',
      inputs.fatalities, inputs.hoursWorked, hoursBasis,
      `per ${hoursBasis.toLocaleString('en-US')} hours worked`,
      `fatalities × ${hoursBasis.toLocaleString('en-US')} ÷ hours worked`,
      ['safety:fatalities', 'safety:hours_worked'], hoursBasis,
    ),
    rate(
      'turnover_total', 'Total turnover rate',
      separations, inputs.headcount, 100, '%',
      '(voluntary + involuntary separations) × 100 ÷ headcount',
      ['workforce:separations_voluntary', 'workforce:separations_involuntary', 'workforce:headcount'],
    ),
    rate(
      'turnover_voluntary', 'Voluntary turnover rate',
      inputs.separationsVoluntary, inputs.headcount, 100, '%',
      'voluntary separations × 100 ÷ headcount',
      ['workforce:separations_voluntary', 'workforce:headcount'],
    ),
    rate(
      'training_hours_per_employee', 'Average training hours per employee',
      inputs.trainingHours, inputs.headcount, 1, 'hours',
      'training hours ÷ headcount',
      ['training:training_hours', 'workforce:headcount'],
    ),
    rate(
      'board_independence', 'Board independence',
      inputs.independentBoardSeats, inputs.boardSeats, 100, '%',
      'independent seats × 100 ÷ total board seats',
      ['governance:independent_board_seats', 'governance:board_seats'],
    ),
    rate(
      'grievance_substantiation', 'Grievance substantiation rate',
      inputs.whistleblowerReportsSubstantiated, inputs.whistleblowerReports, 100, '%',
      'substantiated reports × 100 ÷ reports received',
      ['governance:whistleblower_reports_substantiated', 'governance:whistleblower_reports'],
    ),
  ];
}

/** Build `SocialInputs` from the aggregated map `aggregateAll` returns. */
export function inputsFromAggregates(agg: Map<string, number>): SocialInputs {
  const get = (k: string) => (agg.has(k) ? agg.get(k)! : null);
  return {
    hoursWorked: get('safety:hours_worked'),
    recordableIncidents: get('safety:recordable_incidents'),
    lostTimeIncidents: get('safety:lost_time_incidents'),
    restrictedDutyIncidents: get('safety:restricted_duty_incidents'),
    lostDays: get('safety:lost_days'),
    fatalities: get('safety:fatalities'),
    headcount: get('workforce:headcount'),
    separationsVoluntary: get('workforce:separations_voluntary'),
    separationsInvoluntary: get('workforce:separations_involuntary'),
    trainingHours: get('training:training_hours'),
    ehsTrainingHours: get('training:ehs_training_hours'),
    newHires: get('workforce:new_hires'),
    highConsequenceIncidents: get('safety:high_consequence_incidents'),
    nearMisses: get('safety:near_misses'),
    boardSeats: get('governance:board_seats'),
    independentBoardSeats: get('governance:independent_board_seats'),
    corruptionIncidentsConfirmed: get('governance:corruption_incidents_confirmed'),
    policyTrainingCompletions: get('governance:policy_training_completions'),
    whistleblowerReports: get('governance:whistleblower_reports'),
    whistleblowerReportsSubstantiated: get('governance:whistleblower_reports_substantiated'),
  };
}
