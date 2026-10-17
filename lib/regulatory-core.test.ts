import { describe, it, expect } from 'vitest';
import {
  staleness, effectiveConfidence, milestoneUrgency, upcomingMilestones,
  filterItems, groupByCategory, summarise, isBindingNow, allTopics,
  formatMilestoneDate, daysBetween, toRegulatoryItem,
  type RegulatoryItem,
} from './regulatory-core';

const TODAY = '2026-09-04';

function item(o: Partial<RegulatoryItem> = {}): RegulatoryItem {
  return {
    code: 'TEST', name: 'Test regime', category: 'carbon_border', framework_code: null,
    jurisdiction: 'European Union',
    topics: ['climate'], stage: 'in_force', status_summary: 'A summary.',
    key_points: ['A key point.'],
    next_milestone: 'Something happens', next_milestone_date: '2026-12-30',
    next_milestone_note: null,
    confidence: 'confirmed', confidence_note: null,
    sources: [{ label: 'Source', url: 'https://example.org', dated: '2026-01-01' }],
    last_verified: TODAY, display_order: 10,
    ...o,
  };
}

describe('daysBetween', () => {
  it('counts forward and backward', () => {
    expect(daysBetween('2026-09-04', '2026-09-14')).toBe(10);
    expect(daysBetween('2026-09-14', '2026-09-04')).toBe(-10);
  });
  it('returns NaN for an unparseable date rather than 0', () => {
    expect(Number.isNaN(daysBetween('not-a-date', TODAY))).toBe(true);
  });
});

describe('staleness', () => {
  it('is fresh when just verified', () => {
    expect(staleness(TODAY, TODAY)).toBe('fresh');
  });
  it('ages after six weeks', () => {
    expect(staleness('2026-07-15', TODAY)).toBe('ageing');
  });
  it('is stale after four months', () => {
    expect(staleness('2026-03-01', TODAY)).toBe('stale');
  });
  it('treats an unparseable date as stale, never as fresh', () => {
    // Failing safe matters more here than failing loudly: an entry whose age
    // cannot be established must not present as current.
    expect(staleness('garbage', TODAY)).toBe('stale');
  });
});

describe('effectiveConfidence', () => {
  it('leaves a freshly verified rating alone', () => {
    expect(effectiveConfidence('confirmed', TODAY, TODAY)).toBe('confirmed');
  });

  it('caps a confirmed entry that has aged', () => {
    // "Confirmed as of five months ago" is a different claim from "confirmed".
    expect(effectiveConfidence('confirmed', '2026-07-15', TODAY)).toBe('high');
    expect(effectiveConfidence('confirmed', '2026-03-01', TODAY)).toBe('medium');
  });

  it('never upgrades a low rating just because it was checked today', () => {
    expect(effectiveConfidence('low', TODAY, TODAY)).toBe('low');
    expect(effectiveConfidence('medium', TODAY, TODAY)).toBe('medium');
  });

  it('does not lift a rating below the staleness cap', () => {
    expect(effectiveConfidence('low', '2026-03-01', TODAY)).toBe('low');
  });
});

describe('milestoneUrgency', () => {
  it('flags a date inside 90 days as imminent', () => {
    expect(milestoneUrgency('2026-10-30', TODAY)).toBe('imminent');
  });
  it('flags a date inside a year as near', () => {
    expect(milestoneUrgency('2027-02-01', TODAY)).toBe('near');
  });
  it('flags a distant date as later', () => {
    expect(milestoneUrgency('2030-01-01', TODAY)).toBe('later');
  });
  it('flags a past date as past', () => {
    expect(milestoneUrgency('2026-08-12', TODAY)).toBe('past');
  });
  it('treats a null date as undated, not as unknown or urgent', () => {
    // "No date has been announced" is a real regulatory answer and must not be
    // rendered as though we simply failed to look it up.
    expect(milestoneUrgency(null, TODAY)).toBe('undated');
  });
});

describe('upcomingMilestones', () => {
  it('sorts soonest first and drops past and undated items', () => {
    const items = [
      item({ code: 'LATER', next_milestone_date: '2027-06-01' }),
      item({ code: 'PAST', next_milestone_date: '2026-01-01' }),
      item({ code: 'UNDATED', next_milestone_date: null }),
      item({ code: 'SOON', next_milestone_date: '2026-10-30' }),
    ];
    expect(upcomingMilestones(items, TODAY).map((i) => i.code)).toEqual(['SOON', 'LATER']);
  });
});

describe('isBindingNow', () => {
  it('counts in force and applying, and nothing else', () => {
    expect(isBindingNow('in_force')).toBe(true);
    expect(isBindingNow('applying')).toBe(true);
    expect(isBindingNow('adopted')).toBe(false);
    expect(isBindingNow('finalised')).toBe(false);
    expect(isBindingNow('enjoined')).toBe(false);
    expect(isBindingNow('proposed')).toBe(false);
  });
});

describe('filterItems', () => {
  const items = [
    item({ code: 'CBAM', name: 'Carbon Border Adjustment Mechanism', category: 'carbon_border', topics: ['climate', 'trade'], stage: 'applying' }),
    item({ code: 'SEC', name: 'SEC climate disclosure rule', category: 'disclosure', topics: ['disclosure'], stage: 'stayed',
           key_points: ['Never took effect; stayed since April 2024.'] }),
    item({ code: 'GHGP-S2', name: 'GHG Protocol Scope 2', category: 'carbon_accounting', topics: ['energy'], stage: 'consultation_closed',
           key_points: ['The headline proposal was hourly matching.'] }),
  ];
  const base = { category: 'all', topic: 'all', search: '', bindingOnly: false } as const;

  it('filters by category', () => {
    expect(filterItems(items, { ...base, category: 'carbon_border' }).map((i) => i.code)).toEqual(['CBAM']);
  });
  it('filters by topic', () => {
    expect(filterItems(items, { ...base, topic: 'trade' }).map((i) => i.code)).toEqual(['CBAM']);
  });
  it('filters to binding-now only', () => {
    expect(filterItems(items, { ...base, bindingOnly: true }).map((i) => i.code)).toEqual(['CBAM']);
  });
  it('searches key points, not just titles', () => {
    // Practitioners search for "hourly matching", which lives in the detail.
    expect(filterItems(items, { ...base, search: 'hourly matching' }).map((i) => i.code)).toEqual(['GHGP-S2']);
  });
  it('is case-insensitive and trims', () => {
    expect(filterItems(items, { ...base, search: '  CARBON border  ' }).map((i) => i.code)).toEqual(['CBAM']);
  });
  it('returns everything with no filters', () => {
    expect(filterItems(items, base)).toHaveLength(3);
  });
});

describe('groupByCategory', () => {
  it('orders groups consistently and omits empty ones', () => {
    const groups = groupByCategory([
      item({ code: 'A', category: 'disclosure' }),
      item({ code: 'B', category: 'carbon_accounting' }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(['carbon_accounting', 'disclosure']);
  });
  it('orders items within a group by display_order', () => {
    const groups = groupByCategory([
      item({ code: 'SECOND', category: 'carbon_border', display_order: 20 }),
      item({ code: 'FIRST', category: 'carbon_border', display_order: 10 }),
    ]);
    expect(groups[0].items.map((i) => i.code)).toEqual(['FIRST', 'SECOND']);
  });
});

describe('summarise', () => {
  it('counts binding, imminent and needs-reverification', () => {
    const s = summarise([
      item({ stage: 'applying', next_milestone_date: '2026-10-30', last_verified: TODAY }),
      item({ stage: 'proposed', next_milestone_date: null, last_verified: '2026-03-01' }),
      item({ stage: 'in_force', next_milestone_date: '2028-01-01', last_verified: TODAY }),
    ], TODAY);
    expect(s).toEqual({ total: 3, bindingNow: 2, imminent: 1, needsReverification: 1 });
  });
});

describe('allTopics', () => {
  it('returns a sorted deduplicated list', () => {
    expect(allTopics([
      item({ topics: ['climate', 'trade'] }),
      item({ topics: ['climate', 'chemicals'] }),
    ])).toEqual(['chemicals', 'climate', 'trade']);
  });
});

describe('formatMilestoneDate', () => {
  it('formats a date readably', () => {
    expect(formatMilestoneDate('2026-12-30')).toBe('30 December 2026');
  });
  it('says so plainly when there is no date', () => {
    expect(formatMilestoneDate(null)).toBe('No date announced');
    expect(formatMilestoneDate('nonsense')).toBe('No date announced');
  });
});

describe('toRegulatoryItem', () => {
  const row = {
    code: 'X', name: 'X regime', category: 'carbon_border', jurisdiction: 'EU',
    topics: ['climate'], stage: 'in_force', status_summary: 'Summary.',
    key_points: ['One', 'Two'],
    next_milestone: null, next_milestone_date: null, next_milestone_note: null,
    confidence: 'confirmed', confidence_note: null,
    sources: [{ label: 'A source', url: 'https://example.org', dated: '2026-01-01' }],
    last_verified: TODAY, display_order: 1,
  };

  it('passes a well-formed row through', () => {
    const out = toRegulatoryItem(row);
    expect(out.key_points).toEqual(['One', 'Two']);
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0].label).toBe('A source');
  });

  it('degrades malformed JSON to empty rather than throwing', () => {
    // This table is one deploying organizations are invited to UPDATE by hand, so a wrong
    // shape is a question of when, not whether. It must not crash the page.
    const out = toRegulatoryItem({ ...row, key_points: 'not an array', sources: 42 });
    expect(out.key_points).toEqual([]);
    expect(out.sources).toEqual([]);
  });

  it('drops non-string key points but keeps the good ones', () => {
    const out = toRegulatoryItem({ ...row, key_points: ['keep', 7, null, 'also keep'] });
    expect(out.key_points).toEqual(['keep', 'also keep']);
  });

  it('drops a source with no usable url', () => {
    // An unclickable citation looks like provenance without being provenance.
    const out = toRegulatoryItem({ ...row, sources: [
      { label: 'No url here' },
      { label: 'Empty', url: '' },
      { label: 'Good', url: 'https://example.org', dated: '2026-02-02' },
    ] });
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0].label).toBe('Good');
  });

  it('falls back to the url as the label when none is given', () => {
    const out = toRegulatoryItem({ ...row, sources: [{ url: 'https://example.org/doc' }] });
    expect(out.sources[0].label).toBe('https://example.org/doc');
    expect(out.sources[0].dated).toBe('');
  });

  it('treats null topics as an empty list', () => {
    expect(toRegulatoryItem({ ...row, topics: null }).topics).toEqual([]);
  });
});
