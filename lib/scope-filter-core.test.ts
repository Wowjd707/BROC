import { describe, it, expect } from 'vitest';
import {
  parseScope, encodeScope, buildUnitTree, flattenUnitTree,
  unitAndDescendantIds, resolveScopeToSiteIds, scopeLabel,
  type BusinessUnitLike, type SiteLike, type GroupMembership,
} from './scope-filter-core';

// division
//   ├─ region-eu
//   │    └─ plant-de
//   └─ region-us
const units: BusinessUnitLike[] = [
  { id: 'division',  parent_id: null,        name: 'Global' },
  { id: 'region-eu', parent_id: 'division',  name: 'EMEA', sort_order: 1 },
  { id: 'region-us', parent_id: 'division',  name: 'Americas', sort_order: 2 },
  { id: 'plant-de',  parent_id: 'region-eu', name: 'Germany' },
];

const sites: SiteLike[] = [
  { id: 's1', business_unit_id: 'plant-de' },
  { id: 's2', business_unit_id: 'region-eu' },
  { id: 's3', business_unit_id: 'region-us' },
  { id: 's4', business_unit_id: null },        // unassigned
];

const memberships: GroupMembership[] = [
  { group_id: 'g1', site_id: 's1' },
  { group_id: 'g1', site_id: 's3' },
  { group_id: 'g2', site_id: 's1' },           // s1 is in two groups
];

describe('parseScope / encodeScope', () => {
  it('round-trips each kind', () => {
    for (const s of [
      { kind: 'all' as const },
      { kind: 'site' as const, id: 's1' },
      { kind: 'business_unit' as const, id: 'region-eu' },
      { kind: 'group' as const, id: 'g1' },
    ]) {
      expect(parseScope(encodeScope(s))).toEqual(s.kind === 'all' ? { kind: 'all' } : s);
    }
  });

  it('falls back to all sites for anything malformed', () => {
    // A bad URL must show the whole org, never an arbitrary subset the user
    // could mistake for the full picture.
    for (const bad of [undefined, null, '', 'nonsense', 'site:', ':abc', 'unknown:1']) {
      expect(parseScope(bad)).toEqual({ kind: 'all' });
    }
  });

  it('keeps ids containing a colon intact', () => {
    expect(parseScope('site:a:b')).toEqual({ kind: 'site', id: 'a:b' });
  });
});

describe('buildUnitTree', () => {
  it('nests children under parents and assigns depth', () => {
    const roots = buildUnitTree(units);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('division');
    expect(roots[0].depth).toBe(0);
    expect(roots[0].children.map(c => c.id)).toEqual(['region-eu', 'region-us']);
    expect(roots[0].children[0].children[0].id).toBe('plant-de');
    expect(roots[0].children[0].children[0].depth).toBe(2);
  });

  it('orders siblings by sort_order then name', () => {
    const roots = buildUnitTree([
      { id: 'a', parent_id: null, name: 'Zed', sort_order: 1 },
      { id: 'b', parent_id: null, name: 'Alpha', sort_order: 2 },
      { id: 'c', parent_id: null, name: 'Beta', sort_order: 2 },
    ]);
    expect(roots.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('treats a unit with a missing parent as a root rather than dropping it', () => {
    // Losing a branch to one dangling reference would silently understate
    // every number beneath it.
    const roots = buildUnitTree([
      { id: 'orphan', parent_id: 'gone', name: 'Orphan' },
    ]);
    expect(roots.map(r => r.id)).toEqual(['orphan']);
  });

  it('flattens depth-first for an indented picker', () => {
    expect(flattenUnitTree(buildUnitTree(units)).map(n => n.id))
      .toEqual(['division', 'region-eu', 'plant-de', 'region-us']);
  });
});

describe('unitAndDescendantIds', () => {
  it('includes the unit and everything beneath it', () => {
    expect(unitAndDescendantIds(units, 'region-eu').sort()).toEqual(['plant-de', 'region-eu']);
    expect(unitAndDescendantIds(units, 'division').sort())
      .toEqual(['division', 'plant-de', 'region-eu', 'region-us']);
  });

  it('returns just the unit for a leaf', () => {
    expect(unitAndDescendantIds(units, 'plant-de')).toEqual(['plant-de']);
  });

  it('terminates on a cycle instead of hanging', () => {
    const cyclic: BusinessUnitLike[] = [
      { id: 'a', parent_id: 'b', name: 'A' },
      { id: 'b', parent_id: 'a', name: 'B' },
    ];
    expect(unitAndDescendantIds(cyclic, 'a').sort()).toEqual(['a', 'b']);
  });
});

describe('resolveScopeToSiteIds', () => {
  it('returns null for all sites, meaning "no filter"', () => {
    expect(resolveScopeToSiteIds({ kind: 'all' }, sites, units, memberships)).toBeNull();
  });

  it('resolves a single site', () => {
    expect(resolveScopeToSiteIds({ kind: 'site', id: 's2' }, sites, units, memberships)).toEqual(['s2']);
  });

  it('rolls a business unit up through its descendants', () => {
    expect(resolveScopeToSiteIds({ kind: 'business_unit', id: 'region-eu' }, sites, units, memberships)!.sort())
      .toEqual(['s1', 's2']);
    expect(resolveScopeToSiteIds({ kind: 'business_unit', id: 'division' }, sites, units, memberships)!.sort())
      .toEqual(['s1', 's2', 's3']);
  });

  it('excludes sites with no business unit from unit roll-ups', () => {
    const all = resolveScopeToSiteIds({ kind: 'business_unit', id: 'division' }, sites, units, memberships);
    expect(all).not.toContain('s4');
  });

  it('resolves a group, and a site may belong to several', () => {
    expect(resolveScopeToSiteIds({ kind: 'group', id: 'g1' }, sites, units, memberships)!.sort())
      .toEqual(['s1', 's3']);
    expect(resolveScopeToSiteIds({ kind: 'group', id: 'g2' }, sites, units, memberships))
      .toEqual(['s1']);
  });

  it('returns an empty array — not null — when a selection matches nothing', () => {
    // Empty must stay distinct from "no filter", or a filtered view would show
    // whole-organization totals under a unit's name.
    expect(resolveScopeToSiteIds({ kind: 'group', id: 'nope' }, sites, units, memberships)).toEqual([]);
    expect(resolveScopeToSiteIds({ kind: 'site', id: 'nope' }, sites, units, memberships)).toEqual([]);
    expect(resolveScopeToSiteIds({ kind: 'business_unit', id: 'nope' }, sites, units, memberships)).toEqual([]);
  });
});

describe('scopeLabel', () => {
  const s = [{ id: 's1', name: 'Main Plant' }];
  const u = [{ id: 'region-eu', name: 'EMEA' }];
  const g = [{ id: 'g1', name: 'Audit scope' }];

  it('names the current selection', () => {
    expect(scopeLabel({ kind: 'all' }, s, u, g)).toBe('All sites');
    expect(scopeLabel({ kind: 'site', id: 's1' }, s, u, g)).toBe('Main Plant');
    expect(scopeLabel({ kind: 'business_unit', id: 'region-eu' }, s, u, g)).toBe('EMEA');
    expect(scopeLabel({ kind: 'group', id: 'g1' }, s, u, g)).toBe('Audit scope');
  });

  it('does not pretend an unknown id is the whole organization', () => {
    expect(scopeLabel({ kind: 'site', id: 'gone' }, s, u, g)).toBe('Unknown site');
  });
});
