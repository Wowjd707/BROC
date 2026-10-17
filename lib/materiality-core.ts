/**
 * Double materiality scoring.
 *
 * CSRD/ESRS requires assessing each sustainability topic from two directions:
 *
 *   Impact materiality    — the organization's effect on people and the
 *                           environment ("inside-out").
 *   Financial materiality — the effect of sustainability matters on the
 *                           organization's own value ("outside-in").
 *
 * A topic is material if EITHER dimension crosses the threshold. That "either"
 * is the whole point of double materiality, and getting it wrong (requiring
 * both) would silently drop topics an undertaking is obliged to report.
 *
 * Scoring follows ESRS 1 §3: impacts are assessed on severity — scale,
 * scope and irremediability — with likelihood applied to potential (not
 * actual) impacts. Financial materiality combines magnitude and likelihood.
 *
 * Pure and dependency-free so it is unit-testable.
 */

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** All sub-scores use a 1–5 scale; 0 means "not assessed". */
export type Score = 0 | 1 | 2 | 3 | 4 | 5;

export interface ImpactAssessment {
  /** How grave the impact is. */
  scale: Score;
  /** How widespread — geographically, or across people affected. */
  scope: Score;
  /**
   * How hard the harm is to put right. ESRS applies this to NEGATIVE impacts
   * only; remediability is not a meaningful concept for a positive impact.
   */
  irremediability: Score;
  /** Required for potential impacts; ignored for actual ones. */
  likelihood: Score;
  /** Actual impacts have occurred; potential ones might. */
  isActual: boolean;
  isNegative: boolean;
}

export interface FinancialAssessment {
  /** Size of the financial effect (risk or opportunity). */
  magnitude: Score;
  likelihood: Score;
}

export interface TopicAssessmentInput {
  topicCode: string;
  impact?: ImpactAssessment;
  financial?: FinancialAssessment;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/** Default threshold on the 1–5 scale at or above which a topic is material. */
export const DEFAULT_THRESHOLD = 3;

/**
 * Severity per ESRS 1: the average of scale, scope and — for negative impacts —
 * irremediability. Irremediability is excluded for positive impacts rather than
 * counted as zero, which would otherwise drag every positive impact down by a
 * third and hide genuinely material positive contributions.
 */
export function severityScore(impact: ImpactAssessment): number {
  const parts: number[] = impact.isNegative
    ? [impact.scale, impact.scope, impact.irremediability]
    : [impact.scale, impact.scope];
  const assessed = parts.filter((p) => p > 0);
  if (assessed.length === 0) return 0;
  return assessed.reduce((a, b) => a + b, 0) / assessed.length;
}

/**
 * Impact materiality score. For actual impacts this is severity alone — an
 * impact that has already occurred is certain, so weighting it by likelihood
 * would understate it. For potential impacts, severity is tempered by
 * likelihood.
 */
export function impactScore(impact: ImpactAssessment): number {
  const severity = severityScore(impact);
  if (severity === 0) return 0;
  if (impact.isActual) return severity;
  if (impact.likelihood === 0) return 0;
  return severity * (impact.likelihood / 5);
}

/** Financial materiality: magnitude tempered by likelihood of occurrence. */
export function financialScore(financial: FinancialAssessment): number {
  if (financial.magnitude === 0 || financial.likelihood === 0) return 0;
  return financial.magnitude * (financial.likelihood / 5);
}

export interface TopicResult {
  topicCode: string;
  impactScore: number;
  financialScore: number;
  /** The higher of the two — used for ranking on the matrix. */
  maxScore: number;
  isImpactMaterial: boolean;
  isFinanciallyMaterial: boolean;
  isMaterial: boolean;
  /** Which dimension(s) made it material, for the audit trail. */
  basis: 'impact' | 'financial' | 'both' | 'none';
}

export function assessTopic(
  input: TopicAssessmentInput,
  threshold: number = DEFAULT_THRESHOLD,
): TopicResult {
  const impact = input.impact ? impactScore(input.impact) : 0;
  const financial = input.financial ? financialScore(input.financial) : 0;

  const isImpactMaterial = impact >= threshold;
  const isFinanciallyMaterial = financial >= threshold;

  const basis: TopicResult['basis'] =
    isImpactMaterial && isFinanciallyMaterial ? 'both'
    : isImpactMaterial ? 'impact'
    : isFinanciallyMaterial ? 'financial'
    : 'none';

  return {
    topicCode: input.topicCode,
    impactScore: impact,
    financialScore: financial,
    maxScore: Math.max(impact, financial),
    isImpactMaterial,
    isFinanciallyMaterial,
    // Double materiality: EITHER dimension is sufficient.
    isMaterial: isImpactMaterial || isFinanciallyMaterial,
    basis,
  };
}

export function assessAll(
  inputs: TopicAssessmentInput[],
  threshold: number = DEFAULT_THRESHOLD,
): TopicResult[] {
  return inputs
    .map((i) => assessTopic(i, threshold))
    .sort((a, b) => b.maxScore - a.maxScore);
}

/**
 * Whether the assessment records a CONCLUSION for this topic, as opposed to
 * merely holding a row of untouched zeros.
 *
 * This is not the same question as `assessTopic(...).isMaterial === false`.
 * "We assessed climate and concluded it is not material" and "we never got to
 * climate" are different statements, and only the first one licenses omitting
 * the topic from a report. Every downstream scoping decision depends on telling
 * them apart, so it is asked of the raw sub-scores rather than inferred from a
 * computed score — a potential impact with likelihood 0 scores 0 despite having
 * been assessed.
 */
export function isAssessed(input: TopicAssessmentInput): boolean {
  const { impact, financial } = input;
  const scores: number[] = [
    impact?.scale ?? 0,
    impact?.scope ?? 0,
    impact?.irremediability ?? 0,
    impact?.likelihood ?? 0,
    financial?.magnitude ?? 0,
    financial?.likelihood ?? 0,
  ];
  return scores.some((s) => s > 0);
}

// ─── Matrix ──────────────────────────────────────────────────────────────────

export type MatrixQuadrant =
  | 'material_both'
  | 'material_impact'
  | 'material_financial'
  | 'not_material';

export function quadrantOf(result: TopicResult): MatrixQuadrant {
  if (result.isImpactMaterial && result.isFinanciallyMaterial) return 'material_both';
  if (result.isImpactMaterial) return 'material_impact';
  if (result.isFinanciallyMaterial) return 'material_financial';
  return 'not_material';
}

export const QUADRANT_LABELS: Record<MatrixQuadrant, string> = {
  material_both: 'Material — impact and financial',
  material_impact: 'Material — impact only',
  material_financial: 'Material — financial only',
  not_material: 'Not material',
};

// ─── Stakeholder input ───────────────────────────────────────────────────────

export interface StakeholderRating {
  topicCode: string;
  /** 1–5 importance rating from one stakeholder response. */
  rating: number;
  /** Optional weighting, e.g. by stakeholder group influence. */
  weight?: number;
}

export interface StakeholderSummary {
  topicCode: string;
  averageRating: number;
  responseCount: number;
}

/**
 * Aggregate stakeholder ratings per topic. ESRS expects stakeholder views to
 * inform the assessment, so these are reported ALONGSIDE the organization's own
 * scores rather than blended into them — an assessment that silently averaged
 * the two could not show which drove a conclusion.
 */
export function summariseStakeholderInput(
  ratings: StakeholderRating[],
): StakeholderSummary[] {
  const byTopic = new Map<string, { total: number; weight: number; count: number }>();

  for (const r of ratings) {
    if (!Number.isFinite(r.rating) || r.rating <= 0) continue;
    const w = r.weight ?? 1;
    const acc = byTopic.get(r.topicCode) ?? { total: 0, weight: 0, count: 0 };
    acc.total += r.rating * w;
    acc.weight += w;
    acc.count += 1;
    byTopic.set(r.topicCode, acc);
  }

  return Array.from(byTopic.entries())
    .map(([topicCode, acc]) => ({
      topicCode,
      averageRating: acc.weight > 0 ? acc.total / acc.weight : 0,
      responseCount: acc.count,
    }))
    .sort((a, b) => b.averageRating - a.averageRating);
}

/**
 * Topics where stakeholders rate materiality materially higher than the
 * organization does. These are the defensible challenges to an assessment, and
 * surfacing them is the point of consulting stakeholders at all.
 */
export function stakeholderDivergence(
  results: TopicResult[],
  stakeholder: StakeholderSummary[],
  minGap = 1,
): { topicCode: string; internalScore: number; stakeholderRating: number; gap: number }[] {
  const byTopic = new Map(results.map((r) => [r.topicCode, r]));
  return stakeholder
    .map((s) => {
      const internal = byTopic.get(s.topicCode)?.maxScore ?? 0;
      return {
        topicCode: s.topicCode,
        internalScore: internal,
        stakeholderRating: s.averageRating,
        gap: s.averageRating - internal,
      };
    })
    .filter((d) => d.gap >= minGap)
    .sort((a, b) => b.gap - a.gap);
}
