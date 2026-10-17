import { describe, it, expect } from 'vitest';
import {
  consolidationShare, shareForEntry, boundaryMap, isWholeBoundary,
  describeBoundaryEffect, summariseDataQuality,
  type SiteBoundary,
} from './consolidation-core';

const site = (o: Partial<SiteBoundary> = {}): SiteBoundary => ({
  id: 's1', ownership_percent: 100, is_controlled: true, ...o,
});

describe('consolidationShare', () => {
  it('takes the equity stake under equity share', () => {
    expect(consolidationShare(site({ ownership_percent: 50 }), 'equity_share')).toBe(0.5);
    expect(consolidationShare(site({ ownership_percent: 30 }), 'equity_share')).toBe(0.3);
  });

  it('ignores control under equity share', () => {
    // A 30% stake is 30% whether or not you run the place.
    expect(consolidationShare(site({ ownership_percent: 30, is_controlled: true }), 'equity_share')).toBe(0.3);
    expect(consolidationShare(site({ ownership_percent: 30, is_controlled: false }), 'equity_share')).toBe(0.3);
  });

  it('is all or nothing under the control approaches', () => {
    // A 50% JV you operate counts in full; one you do not counts for nothing.
    expect(consolidationShare(site({ ownership_percent: 50, is_controlled: true }), 'operational_control')).toBe(1);
    expect(consolidationShare(site({ ownership_percent: 50, is_controlled: false }), 'operational_control')).toBe(0);
    expect(consolidationShare(site({ ownership_percent: 100, is_controlled: false }), 'financial_control')).toBe(0);
  });

  it('clamps a nonsense percentage rather than scaling emissions up', () => {
    expect(consolidationShare(site({ ownership_percent: 150 }), 'equity_share')).toBe(1);
    expect(consolidationShare(site({ ownership_percent: -10 }), 'equity_share')).toBe(0);
  });

  it('falls back to the whole site when the percentage is unusable', () => {
    expect(consolidationShare(site({ ownership_percent: NaN }), 'equity_share')).toBe(1);
  });
});

describe('shareForEntry', () => {
  const map = boundaryMap([
    site({ id: 'owned' }),
    site({ id: 'jv', ownership_percent: 50, is_controlled: false }),
  ]);

  it('applies the site’s share', () => {
    expect(shareForEntry('jv', map, 'equity_share')).toBe(0.5);
    expect(shareForEntry('jv', map, 'operational_control')).toBe(0);
    expect(shareForEntry('owned', map, 'equity_share')).toBe(1);
  });

  it('includes an entity-level entry in full', () => {
    // It cannot be attributed to a part-owned operation, and halving it would
    // be a worse guess than reporting what the organization recorded.
    expect(shareForEntry(null, map, 'equity_share')).toBe(1);
  });

  it('includes an entry whose site is unknown in full, not zero', () => {
    // A missing site is a data problem. Zeroing it would understate the
    // inventory in the direction nobody checks.
    expect(shareForEntry('does-not-exist', map, 'operational_control')).toBe(1);
  });
});

describe('isWholeBoundary', () => {
  it('is true for a wholly owned, wholly controlled group', () => {
    expect(isWholeBoundary([site(), site({ id: 's2' })], 'operational_control')).toBe(true);
    expect(isWholeBoundary([site(), site({ id: 's2' })], 'equity_share')).toBe(true);
  });

  it('is false as soon as one site is partial or excluded', () => {
    expect(isWholeBoundary([site(), site({ id: 'jv', ownership_percent: 50 })], 'equity_share')).toBe(false);
    expect(isWholeBoundary([site(), site({ id: 'jv', is_controlled: false })], 'operational_control')).toBe(false);
  });
});

describe('describeBoundaryEffect', () => {
  it('separates partial from excluded operations', () => {
    const sites = [
      site({ id: 'owned' }),
      site({ id: 'jv50', ownership_percent: 50 }),
      site({ id: 'none', ownership_percent: 0 }),
    ];
    const eq = describeBoundaryEffect(sites, 'equity_share');
    expect(eq.partialSites).toEqual([{ id: 'jv50', share: 0.5 }]);
    expect(eq.excludedSites).toEqual(['none']);
  });

  it('reports no partials under a control approach — it is binary', () => {
    const sites = [site({ id: 'a' }), site({ id: 'b', ownership_percent: 40, is_controlled: false })];
    const oc = describeBoundaryEffect(sites, 'operational_control');
    expect(oc.partialSites).toEqual([]);
    expect(oc.excludedSites).toEqual(['b']);
  });
});

describe('summariseDataQuality', () => {
  it('weights by emissions, not by row count', () => {
    // Forty estimated small offices and one measured smelter is not a 97%
    // estimated inventory.
    const entries = [
      ...Array.from({ length: 40 }, () => ({ data_quality: 'estimated', co2e_kg: 100 })),
      { data_quality: 'measured', co2e_kg: 996_000 },
    ];
    const s = summariseDataQuality(entries);
    expect(s.estimatedPercent).toBeCloseTo(0.4, 1);
  });

  it('reports a genuinely estimated inventory as such', () => {
    const s = summariseDataQuality([
      { data_quality: 'estimated', co2e_kg: 700 },
      { data_quality: 'calculated', co2e_kg: 300 },
    ]);
    expect(s.estimatedPercent).toBeCloseTo(70, 10);
    expect(s.estimated).toBe(700);
    expect(s.calculated).toBe(300);
  });

  it('treats a missing quality as calculated, matching the column default', () => {
    const s = summariseDataQuality([{ co2e_kg: 500 }, { data_quality: null, co2e_kg: 500 }]);
    expect(s.calculated).toBe(1000);
    expect(s.estimatedPercent).toBe(0);
  });

  it('treats an unrecognised quality as calculated rather than dropping it', () => {
    const s = summariseDataQuality([{ data_quality: 'nonsense', co2e_kg: 200 }]);
    expect(s.calculated).toBe(200);
    expect(s.total).toBe(200);
  });

  it('returns 0% rather than dividing by zero on an empty inventory', () => {
    expect(summariseDataQuality([]).estimatedPercent).toBe(0);
  });
});
