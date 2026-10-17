import { describe, it, expect } from 'vitest';
import {
  evaluateProbe, evaluateCapabilities, summariseRegime, STATUS_META,
  type ReadinessFacts, type CapabilityRow,
} from './capability-readiness-core';

function facts(o: Partial<ReadinessFacts> = {}): ReadinessFacts {
  return {
    sitesTotal: 5,
    sitesWithCurrentYearEmissions: 5,
    scope3CategoriesWithData: 0,
    cbamCalculations: 0,
    surveysByType: {},
    suppliersCount: 0,
    frameworkCoverage: {},
    materialityExists: false,
    materialityComplete: false,
    socialMetricsWithData: [],
    ehsFamiliesWithData: [],
    evidence: { withEvidence: 0, total: 0 },
    goalsByMetric: {},
    ...o,
  };
}

function cap(o: Partial<CapabilityRow> = {}): CapabilityRow {
  return {
    item_code: 'CBAM', capability_key: 'k', label: 'A capability',
    description: 'd', route: '/x', probe: 'cbam_calculations', probe_arg: null,
    necessity: 'required', display_order: 10,
    ...o,
  };
}

describe('scope12_site_coverage', () => {
  it('is ready when every site has data', () => {
    const r = evaluateProbe('scope12_site_coverage', null, facts());
    expect(r.status).toBe('ready');
    expect(r.detail).toBe('5 of 5 sites have current-year data.');
  });

  it('is partial when some sites are missing', () => {
    const r = evaluateProbe('scope12_site_coverage', null,
      facts({ sitesWithCurrentYearEmissions: 3 }));
    expect(r.status).toBe('partial');
    expect(r.detail).toBe('3 of 5 sites have current-year data.');
  });

  it('is absent when no site has data', () => {
    expect(evaluateProbe('scope12_site_coverage', null,
      facts({ sitesWithCurrentYearEmissions: 0 })).status).toBe('absent');
  });

  it('says to add sites first when there are none', () => {
    const r = evaluateProbe('scope12_site_coverage', null,
      facts({ sitesTotal: 0, sitesWithCurrentYearEmissions: 0 }));
    expect(r.status).toBe('absent');
    expect(r.detail).toMatch(/add sites/i);
  });

  it('uses singular wording for one site', () => {
    expect(evaluateProbe('scope12_site_coverage', null,
      facts({ sitesTotal: 1, sitesWithCurrentYearEmissions: 1 })).detail)
      .toBe('1 of 1 site has current-year data.');
  });
});

describe('supplier_survey', () => {
  it('is absent when nothing was sent', () => {
    expect(evaluateProbe('supplier_survey', 'cbam', facts()).status).toBe('absent');
  });

  it('is partial when sent but unanswered', () => {
    const r = evaluateProbe('supplier_survey', 'cbam',
      facts({ surveysByType: { cbam: { sent: 40, responded: 0 } } }));
    expect(r.status).toBe('partial');
    expect(r.detail).toBe('0 of 40 sent questionnaires answered.');
  });

  it('is ready when all responded', () => {
    expect(evaluateProbe('supplier_survey', 'cbam',
      facts({ surveysByType: { cbam: { sent: 12, responded: 12 } } })).status).toBe('ready');
  });

  it('matches the survey type case-insensitively', () => {
    // Migrations seed both 'CBAM' and 'cbam'.
    expect(evaluateProbe('supplier_survey', 'CBAM',
      facts({ surveysByType: { cbam: { sent: 3, responded: 3 } } })).status).toBe('ready');
  });
});

describe('disclosure_coverage', () => {
  it('reports requirements answered', () => {
    const r = evaluateProbe('disclosure_coverage', 'CSRD',
      facts({ frameworkCoverage: { CSRD: { covered: 12, total: 40 } } }));
    expect(r.status).toBe('partial');
    expect(r.detail).toBe('12 of 40 requirements answered or satisfied by data.');
  });

  it('is unknown — not absent — when the framework was never loaded', () => {
    // "We can't tell" and "you have nothing" are different answers.
    const r = evaluateProbe('disclosure_coverage', 'NOT_LOADED', facts());
    expect(r.status).toBe('unknown');
    expect(r.detail).toMatch(/not loaded/i);
  });
});

describe('the honest probes', () => {
  it('records absence as its own status', () => {
    expect(evaluateProbe('not_built', null, facts()).status).toBe('not_built');
  });

  it('records deliberate inaction as its own status', () => {
    expect(evaluateProbe('no_action', null, facts()).status).toBe('no_action');
  });

  it('degrades an unimplemented probe to unknown rather than throwing', () => {
    const r = evaluateProbe('some_future_probe', null, facts());
    expect(r.status).toBe('unknown');
  });
});

describe('the remaining probes', () => {
  it('scope3_categories', () => {
    expect(evaluateProbe('scope3_categories', null, facts()).status).toBe('absent');
    expect(evaluateProbe('scope3_categories', null,
      facts({ scope3CategoriesWithData: 6 })).detail).toBe('6 of 15 categories have data.');
    expect(evaluateProbe('scope3_categories', null,
      facts({ scope3CategoriesWithData: 15 })).status).toBe('ready');
  });

  it('materiality_assessment distinguishes started from complete', () => {
    expect(evaluateProbe('materiality_assessment', null, facts()).status).toBe('absent');
    expect(evaluateProbe('materiality_assessment', null,
      facts({ materialityExists: true })).status).toBe('partial');
    expect(evaluateProbe('materiality_assessment', null,
      facts({ materialityExists: true, materialityComplete: true })).status).toBe('ready');
  });

  it('evidence_coverage', () => {
    expect(evaluateProbe('evidence_coverage', null,
      facts({ evidence: { withEvidence: 40, total: 200 } })).detail)
      .toBe('40 of 200 entries have a source document attached.');
    expect(evaluateProbe('evidence_coverage', null, facts()).status).toBe('absent');
  });

  it('sg_metric, ehs_metric, goal_for_metric, suppliers, cbam', () => {
    expect(evaluateProbe('sg_metric', 'safety:recordable_incidents',
      facts({ socialMetricsWithData: ['safety:recordable_incidents'] })).status).toBe('ready');
    expect(evaluateProbe('ehs_metric', 'waste',
      facts({ ehsFamiliesWithData: ['waste'] })).status).toBe('ready');
    expect(evaluateProbe('goal_for_metric', 'ghg',
      facts({ goalsByMetric: { ghg: 2 } })).detail).toBe('2 active targets.');
    expect(evaluateProbe('suppliers_registered', null,
      facts({ suppliersCount: 1 })).detail).toBe('1 supplier registered.');
    expect(evaluateProbe('cbam_calculations', null,
      facts({ cbamCalculations: 2 })).detail).toBe('2 calculations saved.');
  });
});

describe('summariseRegime', () => {
  it('picks the required gap with no data as the next action', () => {
    const evaluated = evaluateCapabilities([
      cap({ capability_key: 'calc', probe: 'cbam_calculations', necessity: 'required', display_order: 10 }),
      cap({ capability_key: 'survey', probe: 'supplier_survey', probe_arg: 'cbam', necessity: 'required', display_order: 20 }),
      cap({ capability_key: 'scope12', probe: 'scope12_site_coverage', necessity: 'supporting', display_order: 30 }),
    ], facts({ cbamCalculations: 2, sitesWithCurrentYearEmissions: 3 }));

    const s = summariseRegime(evaluated);
    // Survey is absent (worse than partial), so it outranks the partial scope 1&2.
    expect(s.biggestGap?.capability_key).toBe('survey');
    expect(s.counts.ready).toBe(1);
    expect(s.counts.absent).toBe(1);
    expect(s.counts.partial).toBe(1);
  });

  it('prefers a required gap over a supporting one at equal severity', () => {
    const evaluated = evaluateCapabilities([
      cap({ capability_key: 'supporting_gap', probe: 'cbam_calculations', necessity: 'supporting', display_order: 10 }),
      cap({ capability_key: 'required_gap', probe: 'suppliers_registered', necessity: 'required', display_order: 20 }),
    ], facts());
    expect(summariseRegime(evaluated).biggestGap?.capability_key).toBe('required_gap');
  });

  it('never offers not_built or no_action as the next action', () => {
    // Neither is something the user can act on in this tool.
    const evaluated = evaluateCapabilities([
      cap({ capability_key: 'gap', probe: 'not_built', label: null, route: null, necessity: 'required' }),
      cap({ capability_key: 'nothing', probe: 'no_action', label: null, route: null, necessity: 'informational' }),
    ], facts());
    const s = summariseRegime(evaluated);
    expect(s.biggestGap).toBeNull();
    expect(s.nothingBuilt).toBe(true);
  });

  it('reports no gap when everything is in place', () => {
    const evaluated = evaluateCapabilities([
      cap({ probe: 'cbam_calculations' }),
    ], facts({ cbamCalculations: 1 }));
    const s = summariseRegime(evaluated);
    expect(s.biggestGap).toBeNull();
    expect(s.nothingBuilt).toBe(false);
  });

  it('orders statuses so gaps rank ahead of readiness', () => {
    expect(STATUS_META.absent.rank).toBeLessThan(STATUS_META.partial.rank);
    expect(STATUS_META.partial.rank).toBeLessThan(STATUS_META.ready.rank);
  });
});
