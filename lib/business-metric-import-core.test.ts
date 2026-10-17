import { describe, it, expect } from 'vitest';
import {
  planBusinessMetricImport, businessMetricImportTemplate, valueKey,
  BUSINESS_METRIC_IMPORT_COLUMNS, type MetricImportContext,
} from './business-metric-import-core';

const YEAR = 2026;

const ctx = (over: Partial<MetricImportContext> = {}): MetricImportContext => ({
  knownMetricKeys: new Set(['revenue', 'headcount_fte', 'floor_area']),
  siteIdByName: new Map([['main plant', 'site-1'], ['hq office', 'site-2']]),
  ...over,
});

const H = BUSINESS_METRIC_IMPORT_COLUMNS.join(',');
const csv = (...lines: string[]) => [H, ...lines].join('\n') + '\n';

describe('planBusinessMetricImport', () => {
  it('maps an organization-wide figure', () => {
    const p = planBusinessMetricImport(csv('revenue,2026,,2026-12-31,48200000,Audited'), ctx(), YEAR);
    expect(p.errors).toEqual([]);
    expect(p.rows).toEqual([{
      metric_key: 'revenue', reporting_year: 2026, site_id: null,
      as_of_date: '2026-12-31', value: 48200000, notes: 'Audited',
    }]);
  });

  it('resolves a site name case-insensitively', () => {
    const p = planBusinessMetricImport(csv('headcount_fte,2026,MAIN PLANT,2026-12-31,312,'), ctx(), YEAR);
    expect(p.errors).toEqual([]);
    expect(p.rows[0].site_id).toBe('site-1');
  });

  it('treats a blank site as organization-wide, not as missing', () => {
    const p = planBusinessMetricImport(csv('revenue,2026,,2026-12-31,1,'), ctx(), YEAR);
    expect(p.errors).toEqual([]);
    expect(p.rows[0].site_id).toBeNull();
  });

  it('defaults the year and the date when omitted', () => {
    const p = planBusinessMetricImport(csv('revenue,,,,500,'), ctx(), YEAR);
    expect(p.errors).toEqual([]);
    expect(p.rows[0].reporting_year).toBe(2026);
    expect(p.rows[0].as_of_date).toBe('2026-12-31');
  });

  it('strips thousands separators from a spreadsheet export', () => {
    const p = planBusinessMetricImport(csv('revenue,2026,,2026-12-31,"48,200,000",'), ctx(), YEAR);
    expect(p.errors).toEqual([]);
    expect(p.rows[0].value).toBe(48200000);
  });

  it('accepts zero — a real figure for some metrics', () => {
    const p = planBusinessMetricImport(csv('revenue,2026,,2026-12-31,0,'), ctx(), YEAR);
    expect(p.errors).toEqual([]);
    expect(p.rows[0].value).toBe(0);
  });

  it('rejects a negative denominator', () => {
    const p = planBusinessMetricImport(csv('revenue,2026,,2026-12-31,-5,'), ctx(), YEAR);
    expect(p.rows).toHaveLength(0);
    expect(p.errors[0].message).toMatch(/negative/);
  });

  it('rejects an unknown metric key with a message about keys vs labels', () => {
    const p = planBusinessMetricImport(csv('Revenue (USD),2026,,2026-12-31,1,'), ctx(), YEAR);
    expect(p.errors[0].message).toMatch(/Unknown metric_key/);
    expect(p.errors[0].message).toMatch(/not the label/);
  });

  it('rejects an unknown site and points at the blank-means-org-wide rule', () => {
    const p = planBusinessMetricImport(csv('revenue,2026,Nowhere,2026-12-31,1,'), ctx(), YEAR);
    expect(p.errors[0].message).toMatch(/Unknown site "Nowhere"/);
    expect(p.errors[0].message).toMatch(/blank/);
  });

  it('rejects a non-numeric value and a bad date', () => {
    const p = planBusinessMetricImport(csv(
      'revenue,2026,,2026-12-31,lots,',
      'revenue,2026,,31-12-2026,1,',
    ), ctx(), YEAR);
    expect(p.rows).toHaveLength(0);
    expect(p.errors.map((e) => e.line)).toEqual([1, 2]);
    expect(p.errors[1].message).toMatch(/YYYY-MM-DD/);
  });

  it('allows a fiscal year straddling the calendar boundary', () => {
    const p = planBusinessMetricImport(csv('revenue,2026,,2027-03-31,1,'), ctx(), YEAR);
    expect(p.errors).toEqual([]);
  });

  it('catches a date years away from its reporting year', () => {
    const p = planBusinessMetricImport(csv('revenue,2026,,2019-12-31,1,'), ctx(), YEAR);
    expect(p.errors[0].message).toMatch(/not within a year/);
  });

  it('rejects an implausible year', () => {
    for (const y of ['1899', '2099', 'soon']) {
      const p = planBusinessMetricImport(csv(`revenue,${y},,2026-12-31,1,`), ctx(), YEAR);
      expect(p.errors[0].message, y).toMatch(/plausible year/);
    }
  });

  it('refuses to choose between two figures for the same slot', () => {
    const p = planBusinessMetricImport(csv(
      'revenue,2026,,2026-12-31,100,',
      'revenue,2026,,2026-12-31,200,',
    ), ctx(), YEAR);
    expect(p.rows).toHaveLength(1);
    expect(p.errors[0].line).toBe(2);
    expect(p.errors[0].message).toMatch(/duplicates row 1/);
  });

  it('allows the same metric on different sites and dates', () => {
    const p = planBusinessMetricImport(csv(
      'headcount_fte,2026,Main Plant,2026-12-31,312,',
      'headcount_fte,2026,HQ Office,2026-12-31,88,',
      'headcount_fte,2026,Main Plant,2026-06-30,305,',
    ), ctx(), YEAR);
    expect(p.errors).toEqual([]);
    expect(p.rows).toHaveLength(3);
  });

  it('loads the good rows and names the bad ones', () => {
    const p = planBusinessMetricImport(csv(
      'revenue,2026,,2026-12-31,100,ok',
      'nope,2026,,2026-12-31,1,',
      'headcount_fte,2026,Main Plant,2026-12-31,312,ok',
    ), ctx(), YEAR);
    expect(p.rows).toHaveLength(2);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0].line).toBe(2);
  });

  it('counts rows that replace an existing figure', () => {
    const existing = new Set(['revenue|2026||2026-12-31']);
    const p = planBusinessMetricImport(csv(
      'revenue,2026,,2026-12-31,100,',
      'headcount_fte,2026,Main Plant,2026-12-31,312,',
    ), ctx({ existingKeys: existing }), YEAR);
    expect(p.errors).toEqual([]);
    expect(p.replacing).toBe(1);
  });

  it('reports an empty file and a missing column rather than silently doing nothing', () => {
    expect(planBusinessMetricImport(H + '\n', ctx(), YEAR).errors[0].message).toMatch(/no data rows/);
    const p = planBusinessMetricImport('metric_key,reporting_year\nrevenue,2026\n', ctx(), YEAR);
    expect(p.errors[0].message).toMatch(/Missing required column "value"/);
  });

  it('accepts headers in any case or spacing', () => {
    const p = planBusinessMetricImport(
      'Metric Key,Reporting Year,Site,As Of Date,Value,Notes\nrevenue,2026,,2026-12-31,1,\n',
      ctx(), YEAR);
    expect(p.errors).toEqual([]);
    expect(p.rows).toHaveLength(1);
  });
});

describe('businessMetricImportTemplate', () => {
  it('round-trips through the planner cleanly', () => {
    const t = businessMetricImportTemplate(YEAR);
    const p = planBusinessMetricImport(t, ctx(), YEAR);
    expect(p.errors).toEqual([]);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0].site_id).toBeNull();
    expect(p.rows[1].site_id).toBe('site-1');
  });
});

describe('valueKey', () => {
  it('distinguishes org-wide from per-site', () => {
    const base = { metric_key: 'revenue', reporting_year: 2026, as_of_date: '2026-12-31', value: 1, notes: null };
    expect(valueKey({ ...base, site_id: null })).not.toBe(valueKey({ ...base, site_id: 'site-1' }));
  });
});
