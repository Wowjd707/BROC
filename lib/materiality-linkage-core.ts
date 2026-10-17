/**
 * Scoping a disclosure framework by the double materiality assessment.
 *
 * ESRS treats materiality as a gate: the undertaking reports the topical
 * standards it concluded are material, and states which it concluded are not
 * (ESRS 2 IRO-2). This module turns a set of topic conclusions plus the
 * requirement → topic links (migration 017) into a per-requirement answer to
 * "is this actually demanded of us?".
 *
 * The rules, and why each one is the way it is:
 *
 *   • No assessment for the reporting year → NOTHING is gated. An organization
 *     that has not done the assessment has not concluded anything is
 *     immaterial, and quietly shrinking its obligations would be the worst
 *     possible failure mode.
 *
 *   • A requirement with no topic links is always required. That is how ESRS 2
 *     cross-cutting disclosures, and the non-ESRS frameworks, stay unaffected.
 *
 *   • ANY linked topic material → required. A requirement spanning two topics
 *     is demanded if either is material; requiring all of them would drop
 *     disclosures the undertaking owes.
 *
 *   • A linked topic that was never assessed leaves the requirement
 *     'undetermined' — still shown, still counted, but flagged. Treating
 *     "not yet assessed" as "not material" would let an unfinished assessment
 *     silently delete obligations.
 *
 *   • Only when EVERY linked topic was assessed and concluded immaterial is the
 *     requirement excluded — and even then it is listed in the report as an
 *     explicit omission rather than disappearing.
 *
 * Pure and dependency-free so it is unit-testable.
 */

import { assessTopic, isAssessed, DEFAULT_THRESHOLD, type TopicAssessmentInput } from './materiality-core';

// ─── Topic conclusions ───────────────────────────────────────────────────────

export type TopicStatus = 'material' | 'not_material' | 'unassessed';

export interface TopicConclusion {
  topicCode: string;
  status: TopicStatus;
  impactScore: number;
  financialScore: number;
  /** Which dimension made it material, carried through for the audit trail. */
  basis: 'impact' | 'financial' | 'both' | 'none';
}

/**
 * Score every topic in the catalog and classify it. Topics with no assessment
 * input at all, and topics whose input is still all zeros, come back
 * `unassessed` — see `isAssessed` for why that distinction is load-bearing.
 */
export function concludeTopics(
  topicCodes: string[],
  inputs: TopicAssessmentInput[],
  threshold: number = DEFAULT_THRESHOLD,
): TopicConclusion[] {
  const inputByTopic = new Map(inputs.map((i) => [i.topicCode, i]));

  return topicCodes.map((topicCode) => {
    const input = inputByTopic.get(topicCode);
    if (!input || !isAssessed(input)) {
      return {
        topicCode,
        status: 'unassessed' as const,
        impactScore: 0,
        financialScore: 0,
        basis: 'none' as const,
      };
    }
    const result = assessTopic(input, threshold);
    return {
      topicCode,
      status: (result.isMaterial ? 'material' : 'not_material') as TopicStatus,
      impactScore: result.impactScore,
      financialScore: result.financialScore,
      basis: result.basis,
    };
  });
}

export function statusByTopic(conclusions: TopicConclusion[]): Map<string, TopicStatus> {
  return new Map(conclusions.map((c) => [c.topicCode, c.status]));
}

// ─── Requirement applicability ───────────────────────────────────────────────

export type Applicability =
  /** Demanded: unlinked, ungated, or at least one linked topic is material. */
  | 'required'
  /** Every linked topic was assessed and concluded not material. */
  | 'excluded_immaterial'
  /** Linked to a topic the assessment has not reached a conclusion on. */
  | 'undetermined';

export interface ApplicabilityResult {
  applicability: Applicability;
  /** Linked topics by conclusion, so the UI and report can say *why*. */
  materialTopics: string[];
  immaterialTopics: string[];
  unassessedTopics: string[];
}

/**
 * Decide whether one requirement is demanded.
 *
 * `hasAssessment` is passed explicitly rather than inferred from an empty
 * status map: "no assessment exists" and "an assessment exists in which
 * nothing has been scored yet" both produce an all-unassessed map, but only the
 * first should leave the framework completely ungated.
 */
export function requirementApplicability(
  topicCodes: string[],
  statuses: ReadonlyMap<string, TopicStatus>,
  hasAssessment: boolean,
): ApplicabilityResult {
  const materialTopics: string[] = [];
  const immaterialTopics: string[] = [];
  const unassessedTopics: string[] = [];

  for (const code of topicCodes) {
    // An unknown topic code is treated as unassessed, never as immaterial.
    switch (statuses.get(code) ?? 'unassessed') {
      case 'material': materialTopics.push(code); break;
      case 'not_material': immaterialTopics.push(code); break;
      default: unassessedTopics.push(code); break;
    }
  }

  const base = { materialTopics, immaterialTopics, unassessedTopics };

  if (!hasAssessment) return { applicability: 'required', ...base };
  if (topicCodes.length === 0) return { applicability: 'required', ...base };
  if (materialTopics.length > 0) return { applicability: 'required', ...base };
  if (unassessedTopics.length > 0) return { applicability: 'undetermined', ...base };

  return { applicability: 'excluded_immaterial', ...base };
}

// ─── Framework scope summary ─────────────────────────────────────────────────

export interface RequirementLink {
  requirementId: string;
  topicCodes: string[];
}

/** Index requirement → topic codes from the flat join rows. */
export function linksByRequirement(
  rows: { requirement_id: string; topic_code: string }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    map.set(row.requirement_id, [...(map.get(row.requirement_id) ?? []), row.topic_code]);
  }
  return map;
}

export interface ScopeSummary {
  /** True when at least one requirement in the framework carries a topic link. */
  isGated: boolean;
  required: number;
  excluded: number;
  undetermined: number;
  /** Topic codes that left at least one requirement undetermined. */
  unassessedTopics: string[];
}

export function summariseScope(
  applicabilities: ApplicabilityResult[],
  isGated: boolean,
): ScopeSummary {
  const unassessed = new Set<string>();
  let required = 0;
  let excluded = 0;
  let undetermined = 0;

  for (const a of applicabilities) {
    if (a.applicability === 'excluded_immaterial') excluded += 1;
    else if (a.applicability === 'undetermined') {
      undetermined += 1;
      a.unassessedTopics.forEach((t) => unassessed.add(t));
    } else required += 1;
  }

  return {
    isGated,
    required,
    excluded,
    undetermined,
    unassessedTopics: Array.from(unassessed).sort(),
  };
}

// ─── Choosing the gating assessment ──────────────────────────────────────────

export interface AssessmentLike {
  id: string;
  reporting_year: number;
  status: string;
  updated_at: string;
}

/**
 * Pick the assessment that scopes a report for `reportingYear`.
 *
 * Deliberately matched on the year rather than "the most recent assessment":
 * a FY2026 statement is scoped by the FY2026 conclusions, and letting a newer
 * assessment retroactively re-scope a prior year's report would break the
 * reproducibility the whole audit trail rests on. A finalised assessment wins
 * over a draft; between equals, the most recently updated.
 *
 * Returns null when the year has no assessment — the caller must then leave the
 * framework ungated.
 */
export function pickGatingAssessment<T extends AssessmentLike>(
  assessments: T[],
  reportingYear: number,
): T | null {
  const candidates = assessments.filter((a) => a.reporting_year === reportingYear);
  if (candidates.length === 0) return null;

  return candidates.slice().sort((a, b) => {
    const aFinal = a.status === 'final' ? 0 : 1;
    const bFinal = b.status === 'final' ? 0 : 1;
    if (aFinal !== bFinal) return aFinal - bFinal;
    return b.updated_at.localeCompare(a.updated_at);
  })[0];
}
