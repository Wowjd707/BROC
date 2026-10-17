import { describe, it, expect } from 'vitest';
import {
  toRelationship, edgesFor, watchlist, relationshipConfidence,
  groupByFramework, ungrouped, sortGlossary,
  RELATION_LABELS,
  type RegulatoryRelationship, type RegulatoryFramework, type GlossaryTerm,
} from './regulatory-crosswalk-core';

const SOURCE = [{ label: 'CARB', url: 'https://ww2.arb.ca.gov/x', dated: '2026-09-01' }];

function rel(over: Partial<RegulatoryRelationship> = {}): RegulatoryRelationship {
  return {
    from_code: 'A', to_code: 'B', relation: 'references',
    title: 'A references B', note: 'note', bullets: [],
    is_watchlist: false, watchlist_detail: null,
    confidence: 'high', sources: SOURCE,
    last_verified: '2026-09-01', display_order: 10,
    ...over,
  };
}

function framework(over: Partial<RegulatoryFramework> = {}): RegulatoryFramework {
  return {
    code: 'GHGP', name: 'GHG Protocol', short_name: 'GHGP', publisher: 'WRI / WBCSD',
    domain: 'carbon_accounting', tagline: null, description: null,
    status_headline: null, accent_color: null, display_order: 10,
    ...over,
  };
}

const row = {
  from_code: 'A', to_code: 'B', relation: 'references', title: 't', note: 'n',
  bullets: ['one'], is_watchlist: false, watchlist_detail: null,
  confidence: 'high', sources: SOURCE, last_verified: '2026-09-01', display_order: 10,
};

describe('toRelationship', () => {
  it('coerces a well-formed row', () => {
    const r = toRelationship(row);
    expect(r?.relation).toBe('references');
    expect(r?.bullets).toEqual(['one']);
    expect(r?.sources).toHaveLength(1);
  });

  it('drops a relation kind this build does not understand', () => {
    // Rendering an unknown verb would assert something about two regimes that
    // nobody wrote, so the row is dropped rather than guessed at.
    expect(toRelationship({ ...row, relation: 'supersedes' })).toBeNull();
  });

  it('degrades malformed JSONB to empty instead of throwing', () => {
    const r = toRelationship({ ...row, bullets: 'not an array', sources: { nope: 1 } });
    expect(r?.bullets).toEqual([]);
    expect(r?.sources).toEqual([]);
  });

  it('drops a source with no usable url', () => {
    // An unclickable citation looks like provenance without being provenance.
    const r = toRelationship({
      ...row,
      sources: [{ label: 'No link' }, { label: 'Good', url: 'https://x.test' }],
    });
    expect(r?.sources.map((s) => s.url)).toEqual(['https://x.test']);
  });

  it('falls back to the url when a source has no label', () => {
    const r = toRelationship({ ...row, sources: [{ url: 'https://x.test' }] });
    expect(r?.sources[0].label).toBe('https://x.test');
  });
});

describe('edgesFor', () => {
  const rels = [
    rel({ from_code: 'CA', to_code: 'GHGP', relation: 'references', display_order: 20 }),
    rel({ from_code: 'GHGP', to_code: 'ISO', relation: 'merging_with', display_order: 10 }),
  ];

  it('reads a relationship from either end', () => {
    expect(edgesFor('GHGP', rels)).toHaveLength(2);
    expect(edgesFor('CA', rels)).toHaveLength(1);
    expect(edgesFor('NOBODY', rels)).toHaveLength(0);
  });

  it('flips the label when read from the far end', () => {
    // Direction is the meaning for `references`: California references the GHG
    // Protocol; the GHG Protocol is referenced by California.
    const fromCa = edgesFor('CA', rels)[0];
    expect(fromCa.outward).toBe(true);
    expect(fromCa.label).toBe('References');

    const fromGhgp = edgesFor('GHGP', rels).find((e) => e.otherCode === 'CA')!;
    expect(fromGhgp.outward).toBe(false);
    expect(fromGhgp.label).toBe('Referenced by');
  });

  it('reads the same both ways for a symmetric relation', () => {
    expect(RELATION_LABELS.merging_with.outward)
      .toBe(RELATION_LABELS.merging_with.inward);
  });

  it('puts conflicts first regardless of display order', () => {
    // If a team reads one line of this panel, it should be the one where two
    // rules disagree — even though this row sorts last by display_order.
    const withConflict = [
      ...rels,
      rel({ from_code: 'GHGP', to_code: 'US', relation: 'diverges_from', display_order: 99 }),
    ];
    const edges = edgesFor('GHGP', withConflict);
    expect(edges[0].tone).toBe('conflict');
    expect(edges[0].otherCode).toBe('US');
  });
});

describe('watchlist', () => {
  it('returns only flagged rows, in display order', () => {
    const rels = [
      rel({ is_watchlist: true, watchlist_detail: 'second', display_order: 20 }),
      rel({ is_watchlist: false, watchlist_detail: null, display_order: 5 }),
      rel({ is_watchlist: true, watchlist_detail: 'first', display_order: 10 }),
    ];
    expect(watchlist(rels).map((r) => r.watchlist_detail)).toEqual(['first', 'second']);
  });

  it('refuses a flagged row with no explanation of the bind', () => {
    // The database enforces this with a CHECK; repeating it here means a row
    // that slipped past somehow renders as nothing rather than as a warning
    // with no content.
    expect(watchlist([rel({ is_watchlist: true, watchlist_detail: null })])).toHaveLength(0);
    expect(watchlist([rel({ is_watchlist: true, watchlist_detail: '   ' })])).toHaveLength(0);
  });
});

describe('relationshipConfidence', () => {
  it('keeps a fresh rating', () => {
    expect(relationshipConfidence(
      rel({ confidence: 'confirmed', last_verified: '2026-09-01' }), '2026-09-10',
    )).toBe('confirmed');
  });

  it('caps a stale rating, as item confidence does', () => {
    // A crosswalk claim ages like any other: "confirmed" is a statement about
    // when somebody checked, not a permanent property of the relationship.
    expect(relationshipConfidence(
      rel({ confidence: 'confirmed', last_verified: '2026-01-01' }), '2026-09-10',
    )).toBe('medium');
  });

  it('never raises a rating that was already low', () => {
    expect(relationshipConfidence(
      rel({ confidence: 'low', last_verified: '2026-09-09' }), '2026-09-10',
    )).toBe('low');
  });
});

describe('groupByFramework', () => {
  const items = [
    { code: 'B', framework_code: 'GHGP', display_order: 20 },
    { code: 'A', framework_code: 'GHGP', display_order: 10 },
    { code: 'C', framework_code: 'PFAS', display_order: 10 },
    { code: 'D', framework_code: null, display_order: 10 },
  ];

  it('groups and orders frameworks and their items', () => {
    const groups = groupByFramework(
      [framework({ code: 'PFAS', display_order: 20 }), framework({ code: 'GHGP', display_order: 10 })],
      items,
    );
    expect(groups.map((g) => g.framework.code)).toEqual(['GHGP', 'PFAS']);
    expect(groups[0].items.map((i) => i.code)).toEqual(['A', 'B']);
  });

  it('hides a framework with nothing in it', () => {
    // An empty framework card reads as a gap in coverage rather than as a
    // heading nobody has filled in yet.
    const groups = groupByFramework([framework({ code: 'EMPTY' })], items);
    expect(groups).toHaveLength(0);
  });

  it('keeps unparented items reachable', () => {
    // A standalone instrument with no parent body is legitimate; dropping it
    // would make the tracker look like it covers less than it does.
    expect(ungrouped(items).map((i) => i.code)).toEqual(['D']);
  });
});

describe('sortGlossary', () => {
  it('puts acronyms first, each group alphabetical', () => {
    const terms: GlossaryTerm[] = [
      { term: 'Scope 1', expansion: null, definition: 'd', is_acronym: false },
      { term: 'SBTi', expansion: 'Science Based Targets initiative', definition: 'd', is_acronym: true },
      { term: 'Additionality', expansion: null, definition: 'd', is_acronym: false },
      { term: 'CBAM', expansion: 'Carbon Border Adjustment Mechanism', definition: 'd', is_acronym: true },
    ];
    expect(sortGlossary(terms).map((t) => t.term))
      .toEqual(['CBAM', 'SBTi', 'Additionality', 'Scope 1']);
  });

  it('does not mutate its input', () => {
    const terms: GlossaryTerm[] = [
      { term: 'B', expansion: null, definition: 'd', is_acronym: false },
      { term: 'A', expansion: null, definition: 'd', is_acronym: true },
    ];
    sortGlossary(terms);
    expect(terms.map((t) => t.term)).toEqual(['B', 'A']);
  });
});
