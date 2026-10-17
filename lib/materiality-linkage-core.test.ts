import { describe, it, expect } from 'vitest';
import {
  concludeTopics,
  statusByTopic,
  requirementApplicability,
  linksByRequirement,
  summariseScope,
  pickGatingAssessment,
  type TopicStatus,
} from './materiality-linkage-core';
import { isAssessed, type TopicAssessmentInput } from './materiality-core';

const ALL_TOPICS = ['E1', 'E2', 'E3', 'E4', 'E5', 'S1', 'S2', 'S3', 'S4', 'G1'];

/** A clearly-material topic: severe, widespread, irremediable, actual. */
function material(topicCode: string): TopicAssessmentInput {
  return {
    topicCode,
    impact: {
      scale: 5, scope: 5, irremediability: 4, likelihood: 5,
      isActual: true, isNegative: true,
    },
    financial: { magnitude: 4, likelihood: 5 },
  };
}

/** Assessed, but well under the threshold on both dimensions. */
function immaterial(topicCode: string): TopicAssessmentInput {
  return {
    topicCode,
    impact: {
      scale: 1, scope: 1, irremediability: 1, likelihood: 1,
      isActual: true, isNegative: true,
    },
    financial: { magnitude: 1, likelihood: 1 },
  };
}

/** A row that exists but has never been touched — all defaults. */
function untouched(topicCode: string): TopicAssessmentInput {
  return {
    topicCode,
    impact: {
      scale: 0, scope: 0, irremediability: 0, likelihood: 0,
      isActual: true, isNegative: true,
    },
    financial: { magnitude: 0, likelihood: 0 },
  };
}

describe('isAssessed', () => {
  it('treats an all-zero row as no conclusion', () => {
    expect(isAssessed(untouched('E1'))).toBe(false);
  });

  it('treats any non-zero sub-score as a conclusion', () => {
    expect(isAssessed(immaterial('E1'))).toBe(true);
  });

  it('counts a potential impact that scores 0 through likelihood as assessed', () => {
    // Severity is real but likelihood is 0, so impactScore is 0. The topic was
    // still assessed — this is the case a score-based check would get wrong.
    const input: TopicAssessmentInput = {
      topicCode: 'E4',
      impact: {
        scale: 4, scope: 4, irremediability: 3, likelihood: 0,
        isActual: false, isNegative: true,
      },
    };
    expect(isAssessed(input)).toBe(true);
    expect(concludeTopics(['E4'], [input])[0].status).toBe('not_material');
  });
});

describe('concludeTopics', () => {
  it('classifies material, not material, and unassessed separately', () => {
    const conclusions = concludeTopics(
      ['E1', 'E2', 'E3'],
      [material('E1'), immaterial('E2')],
    );
    const byCode = statusByTopic(conclusions);
    expect(byCode.get('E1')).toBe('material');
    expect(byCode.get('E2')).toBe('not_material');
    // E3 has no row at all.
    expect(byCode.get('E3')).toBe('unassessed');
  });

  it('does not mistake an untouched row for a "not material" conclusion', () => {
    const byCode = statusByTopic(concludeTopics(['E5'], [untouched('E5')]));
    expect(byCode.get('E5')).toBe('unassessed');
  });

  it('carries the basis through for the audit trail', () => {
    const [c] = concludeTopics(['E1'], [material('E1')]);
    expect(c.basis).toBe('both');
    expect(c.impactScore).toBeGreaterThan(0);
    expect(c.financialScore).toBeGreaterThan(0);
  });

  it('honours the assessment threshold', () => {
    const input = {
      topicCode: 'E3',
      impact: {
        scale: 3, scope: 3, irremediability: 3, likelihood: 5,
        isActual: true, isNegative: true,
      },
    } satisfies TopicAssessmentInput;
    expect(statusByTopic(concludeTopics(['E3'], [input], 3)).get('E3')).toBe('material');
    expect(statusByTopic(concludeTopics(['E3'], [input], 4)).get('E3')).toBe('not_material');
  });

  it('returns a conclusion for every topic in the catalog', () => {
    expect(concludeTopics(ALL_TOPICS, [material('E1')])).toHaveLength(ALL_TOPICS.length);
  });
});

describe('requirementApplicability', () => {
  const statuses = new Map<string, TopicStatus>([
    ['E1', 'material'],
    ['E2', 'not_material'],
    ['E3', 'unassessed'],
  ]);

  it('never gates anything when there is no assessment', () => {
    // Every linked topic reads "not material" here, and it still must not gate.
    const empty = new Map<string, TopicStatus>();
    expect(requirementApplicability(['E2'], statuses, false).applicability).toBe('required');
    expect(requirementApplicability(['E2'], empty, false).applicability).toBe('required');
  });

  it('always requires a requirement with no topic links', () => {
    // ESRS 2 cross-cutting disclosures, and every non-ESRS framework.
    expect(requirementApplicability([], statuses, true).applicability).toBe('required');
  });

  it('requires a requirement whose topic is material', () => {
    expect(requirementApplicability(['E1'], statuses, true).applicability).toBe('required');
  });

  it('excludes a requirement whose only topic was concluded not material', () => {
    const result = requirementApplicability(['E2'], statuses, true);
    expect(result.applicability).toBe('excluded_immaterial');
    expect(result.immaterialTopics).toEqual(['E2']);
  });

  it('requires a multi-topic requirement if ANY topic is material', () => {
    const result = requirementApplicability(['E1', 'E2'], statuses, true);
    expect(result.applicability).toBe('required');
    expect(result.materialTopics).toEqual(['E1']);
    expect(result.immaterialTopics).toEqual(['E2']);
  });

  it('leaves a requirement undetermined when a linked topic was not assessed', () => {
    const result = requirementApplicability(['E2', 'E3'], statuses, true);
    expect(result.applicability).toBe('undetermined');
    expect(result.unassessedTopics).toEqual(['E3']);
  });

  it('prefers material over undetermined', () => {
    expect(requirementApplicability(['E1', 'E3'], statuses, true).applicability).toBe('required');
  });

  it('treats an unknown topic code as unassessed, never as immaterial', () => {
    const result = requirementApplicability(['E2', 'X9'], statuses, true);
    expect(result.applicability).toBe('undetermined');
    expect(result.unassessedTopics).toEqual(['X9']);
  });
});

describe('linksByRequirement', () => {
  it('groups the flat join rows by requirement', () => {
    const map = linksByRequirement([
      { requirement_id: 'a', topic_code: 'E1' },
      { requirement_id: 'a', topic_code: 'E5' },
      { requirement_id: 'b', topic_code: 'S1' },
    ]);
    expect(map.get('a')).toEqual(['E1', 'E5']);
    expect(map.get('b')).toEqual(['S1']);
    expect(map.get('c')).toBeUndefined();
  });
});

describe('summariseScope', () => {
  it('counts each applicability and collects the unassessed topics', () => {
    const statuses = new Map<string, TopicStatus>([
      ['E1', 'material'], ['E2', 'not_material'], ['E3', 'unassessed'], ['E4', 'unassessed'],
    ]);
    const summary = summariseScope(
      [
        requirementApplicability([], statuses, true),      // ESRS 2 — required
        requirementApplicability(['E1'], statuses, true),  // required
        requirementApplicability(['E2'], statuses, true),  // excluded
        requirementApplicability(['E3'], statuses, true),  // undetermined
        requirementApplicability(['E4'], statuses, true),  // undetermined
      ],
      true,
    );
    expect(summary).toEqual({
      isGated: true,
      required: 2,
      excluded: 1,
      undetermined: 2,
      unassessedTopics: ['E3', 'E4'],
    });
  });
});

describe('pickGatingAssessment', () => {
  const rows = [
    { id: 'a', reporting_year: 2025, status: 'final', updated_at: '2025-12-01T00:00:00Z' },
    { id: 'b', reporting_year: 2026, status: 'draft', updated_at: '2026-06-01T00:00:00Z' },
    { id: 'c', reporting_year: 2026, status: 'final', updated_at: '2026-03-01T00:00:00Z' },
    { id: 'd', reporting_year: 2026, status: 'draft', updated_at: '2026-07-01T00:00:00Z' },
  ];

  it('matches on the reporting year, not recency', () => {
    // 'd' is the newest row overall; the 2025 statement is still scoped by 'a'.
    expect(pickGatingAssessment(rows, 2025)?.id).toBe('a');
  });

  it('prefers a finalised assessment over a newer draft', () => {
    expect(pickGatingAssessment(rows, 2026)?.id).toBe('c');
  });

  it('falls back to the most recently updated draft', () => {
    const draftsOnly = rows.filter((r) => r.status !== 'final');
    expect(pickGatingAssessment(draftsOnly, 2026)?.id).toBe('d');
  });

  it('returns null when the year has no assessment, leaving the framework ungated', () => {
    expect(pickGatingAssessment(rows, 2024)).toBeNull();
  });

  it('does not mutate the input order', () => {
    const input = rows.slice();
    pickGatingAssessment(input, 2026);
    expect(input.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
