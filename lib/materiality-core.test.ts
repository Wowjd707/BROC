import { describe, it, expect } from 'vitest';
import {
  severityScore, impactScore, financialScore, assessTopic, assessAll,
  quadrantOf, summariseStakeholderInput, stakeholderDivergence,
  DEFAULT_THRESHOLD,
  type ImpactAssessment, type TopicAssessmentInput,
} from './materiality-core';

function impact(o: Partial<ImpactAssessment> = {}): ImpactAssessment {
  return {
    scale: 4, scope: 4, irremediability: 4, likelihood: 5,
    isActual: true, isNegative: true,
    ...o,
  };
}

describe('severityScore', () => {
  it('averages scale, scope and irremediability for negative impacts', () => {
    expect(severityScore(impact({ scale: 3, scope: 4, irremediability: 5 }))).toBe(4);
  });

  it('excludes irremediability for positive impacts', () => {
    // Counting it as zero would drag every positive impact down by a third and
    // hide genuinely material positive contributions.
    const positive = impact({ scale: 4, scope: 4, irremediability: 0, isNegative: false });
    expect(severityScore(positive)).toBe(4);
  });

  it('ignores unassessed (0) components rather than averaging them in', () => {
    expect(severityScore(impact({ scale: 4, scope: 0, irremediability: 0 }))).toBe(4);
  });

  it('returns 0 when nothing is assessed', () => {
    expect(severityScore(impact({ scale: 0, scope: 0, irremediability: 0 }))).toBe(0);
  });
});

describe('impactScore', () => {
  it('uses severity alone for an actual impact', () => {
    // An impact that has occurred is certain; weighting by likelihood would
    // understate it.
    expect(impactScore(impact({ scale: 4, scope: 4, irremediability: 4, isActual: true, likelihood: 1 })))
      .toBe(4);
  });

  it('tempers a potential impact by likelihood', () => {
    expect(impactScore(impact({ scale: 4, scope: 4, irremediability: 4, isActual: false, likelihood: 5 })))
      .toBe(4);
    expect(impactScore(impact({ scale: 4, scope: 4, irremediability: 4, isActual: false, likelihood: 1 })))
      .toBeCloseTo(0.8, 6);
  });

  it('returns 0 for a potential impact with no likelihood assessed', () => {
    expect(impactScore(impact({ isActual: false, likelihood: 0 }))).toBe(0);
  });
});

describe('financialScore', () => {
  it('scales magnitude by likelihood', () => {
    expect(financialScore({ magnitude: 5, likelihood: 5 })).toBe(5);
    expect(financialScore({ magnitude: 4, likelihood: 3 })).toBeCloseTo(2.4, 6);
  });

  it('returns 0 if either component is unassessed', () => {
    expect(financialScore({ magnitude: 0, likelihood: 5 })).toBe(0);
    expect(financialScore({ magnitude: 5, likelihood: 0 })).toBe(0);
  });
});

describe('assessTopic', () => {
  it('is material when EITHER dimension crosses the threshold', () => {
    // The defining rule of double materiality — requiring both would silently
    // drop topics an undertaking is obliged to report.
    const impactOnly = assessTopic({
      topicCode: 'E1',
      impact: impact({ scale: 5, scope: 5, irremediability: 5 }),
      financial: { magnitude: 1, likelihood: 1 },
    });
    expect(impactOnly.isMaterial).toBe(true);
    expect(impactOnly.basis).toBe('impact');

    const financialOnly = assessTopic({
      topicCode: 'E2',
      impact: impact({ scale: 1, scope: 1, irremediability: 1 }),
      financial: { magnitude: 5, likelihood: 5 },
    });
    expect(financialOnly.isMaterial).toBe(true);
    expect(financialOnly.basis).toBe('financial');
  });

  it('records "both" when each dimension is material', () => {
    const r = assessTopic({
      topicCode: 'E1',
      impact: impact({ scale: 5, scope: 5, irremediability: 5 }),
      financial: { magnitude: 5, likelihood: 5 },
    });
    expect(r.basis).toBe('both');
  });

  it('is not material when neither crosses', () => {
    const r = assessTopic({
      topicCode: 'E4',
      impact: impact({ scale: 1, scope: 1, irremediability: 1 }),
      financial: { magnitude: 1, likelihood: 1 },
    });
    expect(r.isMaterial).toBe(false);
    expect(r.basis).toBe('none');
  });

  it('handles a topic assessed on only one dimension', () => {
    const r = assessTopic({ topicCode: 'S1', impact: impact({ scale: 5, scope: 5, irremediability: 5 }) });
    expect(r.financialScore).toBe(0);
    expect(r.isMaterial).toBe(true);
  });

  it('respects a custom threshold', () => {
    const input: TopicAssessmentInput = {
      topicCode: 'E3',
      financial: { magnitude: 3, likelihood: 5 },
    };
    expect(assessTopic(input, 3).isMaterial).toBe(true);
    expect(assessTopic(input, 4).isMaterial).toBe(false);
  });

  it('uses a default threshold of 3', () => {
    expect(DEFAULT_THRESHOLD).toBe(3);
  });
});

describe('assessAll', () => {
  it('ranks by the higher of the two dimensions', () => {
    const results = assessAll([
      { topicCode: 'low', financial: { magnitude: 1, likelihood: 1 } },
      { topicCode: 'high', impact: impact({ scale: 5, scope: 5, irremediability: 5 }) },
      { topicCode: 'mid', financial: { magnitude: 3, likelihood: 5 } },
    ]);
    expect(results.map(r => r.topicCode)).toEqual(['high', 'mid', 'low']);
  });
});

describe('quadrantOf', () => {
  it('places topics on the double-materiality matrix', () => {
    const both = assessTopic({
      topicCode: 'a',
      impact: impact({ scale: 5, scope: 5, irremediability: 5 }),
      financial: { magnitude: 5, likelihood: 5 },
    });
    expect(quadrantOf(both)).toBe('material_both');

    const impactOnly = assessTopic({ topicCode: 'b', impact: impact({ scale: 5, scope: 5, irremediability: 5 }) });
    expect(quadrantOf(impactOnly)).toBe('material_impact');

    const finOnly = assessTopic({ topicCode: 'c', financial: { magnitude: 5, likelihood: 5 } });
    expect(quadrantOf(finOnly)).toBe('material_financial');

    const neither = assessTopic({ topicCode: 'd' });
    expect(quadrantOf(neither)).toBe('not_material');
  });
});

describe('summariseStakeholderInput', () => {
  it('averages ratings per topic', () => {
    const s = summariseStakeholderInput([
      { topicCode: 'E1', rating: 5 },
      { topicCode: 'E1', rating: 3 },
      { topicCode: 'S1', rating: 2 },
    ]);
    expect(s.find(x => x.topicCode === 'E1')).toMatchObject({ averageRating: 4, responseCount: 2 });
  });

  it('applies weights', () => {
    const s = summariseStakeholderInput([
      { topicCode: 'E1', rating: 5, weight: 3 },
      { topicCode: 'E1', rating: 1, weight: 1 },
    ]);
    expect(s[0].averageRating).toBe(4); // (15+1)/4
  });

  it('ignores invalid ratings', () => {
    const s = summariseStakeholderInput([
      { topicCode: 'E1', rating: 0 },
      { topicCode: 'E1', rating: Number.NaN },
      { topicCode: 'E1', rating: 4 },
    ]);
    expect(s[0]).toMatchObject({ averageRating: 4, responseCount: 1 });
  });

  it('returns an empty list for no input', () => {
    expect(summariseStakeholderInput([])).toEqual([]);
  });
});

describe('stakeholderDivergence', () => {
  it('surfaces topics stakeholders rate materially higher than the organization', () => {
    const results = assessAll([
      { topicCode: 'E1', financial: { magnitude: 1, likelihood: 1 } }, // low internal
      { topicCode: 'E2', impact: impact({ scale: 5, scope: 5, irremediability: 5 }) },
    ]);
    const divergence = stakeholderDivergence(results, [
      { topicCode: 'E1', averageRating: 4.5, responseCount: 10 },
      { topicCode: 'E2', averageRating: 4.0, responseCount: 10 },
    ]);
    expect(divergence.map(d => d.topicCode)).toEqual(['E1']);
    expect(divergence[0].gap).toBeGreaterThan(4);
  });

  it('respects the minimum gap', () => {
    const results = assessAll([{ topicCode: 'E1', financial: { magnitude: 3, likelihood: 5 } }]);
    expect(stakeholderDivergence(results, [{ topicCode: 'E1', averageRating: 3.5, responseCount: 4 }], 1))
      .toEqual([]);
    expect(stakeholderDivergence(results, [{ topicCode: 'E1', averageRating: 3.5, responseCount: 4 }], 0.4))
      .toHaveLength(1);
  });
});
