import { describe, it, expect } from 'vitest';
import {
  aggregateMetricValues, resolveDenominator, denominatorOptions,
  type BusinessMetricValue, type BusinessMetricDefinition,
} from './business-metrics-core';

const val = (o: Partial<BusinessMetricValue> = {}): BusinessMetricValue => ({
  metric_key: 'revenue', reporting_year: 2026, site_id: null, as_of_date: null, value: 0, ...o,
});

const def = (o: Partial<BusinessMetricDefinition> = {}): BusinessMetricDefinition => ({
  metric_key: 'revenue', label: 'Revenue', description: null, unit: 'USD',
  category: 'financial', aggregation: 'sum', is_denominator: true,
  display_order: 10, organization_id: null, ...o,
});

describe('aggregateMetricValues', () => {
  it('sums a flow across sites', () => {
    expect(aggregateMetricValues([
      val({ site_id: 'a', value: 400 }), val({ site_id: 'b', value: 600 }),
    ], 'sum')).toBe(1000);
  });

  it('sums each site’s latest reading for a stock', () => {
    // Twelve monthly headcount readings summed would inflate the denominator
    // twelvefold and shrink reported intensity to a twelfth of the truth.
    expect(aggregateMetricValues([
      val({ site_id: 'a', as_of_date: '2026-01-31', value: 700 }),
      val({ site_id: 'a', as_of_date: '2026-12-31', value: 800 }),
      val({ site_id: 'b', as_of_date: '2026-12-31', value: 400 }),
    ], 'point_in_time')).toBe(1200);
  });

  it('uses an organization-wide figure as the total, never adding site figures to it', () => {
    // Regression: an org-wide headcount of 1,000 and a site's 300 reported
    // 1,300. A null site is the organization-wide figure (migration 027).
    expect(aggregateMetricValues([
      val({ site_id: null, as_of_date: '2026-12-31', value: 1000 }),
      val({ site_id: 'a', as_of_date: '2026-12-31', value: 300 }),
    ], 'point_in_time')).toBe(1000);
    expect(aggregateMetricValues([
      val({ site_id: null, value: 5_000_000 }),
      val({ site_id: 'a', value: 2_000_000 }),
    ], 'sum')).toBe(5_000_000);
  });

  it('averages over the period per site, then sums the sites', () => {
    // An average across sites is not a denominator; average headcount over
    // the year, per site, summed, is.
    expect(aggregateMetricValues([
      val({ site_id: 'a', as_of_date: '2026-01-31', value: 10 }),
      val({ site_id: 'a', as_of_date: '2026-12-31', value: 20 }),
      val({ site_id: 'b', as_of_date: '2026-12-31', value: 40 }),
    ], 'average')).toBe(55);
  });

  it('returns null for no data, never 0', () => {
    // A zero denominator and an absent one are different things.
    expect(aggregateMetricValues([], 'sum')).toBeNull();
    expect(aggregateMetricValues([], 'point_in_time')).toBeNull();
  });
});

describe('resolveDenominator', () => {
  it('falls back to floor area when nothing is chosen, and says so', () => {
    const r = resolveDenominator(null, [], [], 250_000);
    expect(r.value).toBe(250_000);
    expect(r.unit).toBe('sq ft');
    expect(r.isFallback).toBe(true);
  });

  it('reports no denominator when floor area is also absent', () => {
    expect(resolveDenominator(null, [], [], 0).value).toBeNull();
  });

  it('uses the chosen metric and its unit', () => {
    const r = resolveDenominator('revenue', [def()], [
      val({ site_id: 'a', value: 4_000_000 }), val({ site_id: 'b', value: 6_000_000 }),
    ], 250_000);
    expect(r.value).toBe(10_000_000);
    expect(r.unit).toBe('USD');
    expect(r.label).toBe('Revenue');
    expect(r.isFallback).toBe(false);
  });

  it('honours the metric’s aggregation rule', () => {
    const fte = def({ metric_key: 'headcount_fte', label: 'Headcount', unit: 'FTE', aggregation: 'point_in_time' });
    const r = resolveDenominator('headcount_fte', [fte], [
      val({ metric_key: 'headcount_fte', site_id: 'a', as_of_date: '2026-01-31', value: 700 }),
      val({ metric_key: 'headcount_fte', site_id: 'a', as_of_date: '2026-12-31', value: 800 }),
      val({ metric_key: 'headcount_fte', site_id: 'b', as_of_date: '2026-12-31', value: 400 }),
    ], 0);
    expect(r.value).toBe(1200);
  });

  it('lets an organization’s own definition shadow the starter', () => {
    const starter = def({ unit: 'currency' });
    const own = def({ unit: 'EUR', label: 'Group revenue', organization_id: 'org-1' });
    const r = resolveDenominator('revenue', [starter, own], [val({ value: 5 })], 0);
    expect(r.unit).toBe('EUR');
    expect(r.label).toBe('Group revenue');
  });

  it('ignores values belonging to a different metric', () => {
    const r = resolveDenominator('revenue', [def()], [
      val({ metric_key: 'revenue', value: 100 }),
      val({ metric_key: 'units_shipped', value: 999 }),
    ], 0);
    expect(r.value).toBe(100);
  });

  it('returns no value when the chosen metric has no definition', () => {
    const r = resolveDenominator('mystery', [def()], [], 100);
    expect(r.value).toBeNull();
    expect(r.isFallback).toBe(false);
  });

  it('returns null when the metric exists but has no data for the year', () => {
    expect(resolveDenominator('revenue', [def()], [], 250_000).value).toBeNull();
  });
});

describe('denominatorOptions', () => {
  it('excludes metrics not marked as denominators', () => {
    const opts = denominatorOptions([
      def({ metric_key: 'revenue' }),
      def({ metric_key: 'operating_hours', is_denominator: false }),
    ]);
    expect(opts.map((o) => o.metric_key)).toEqual(['revenue']);
  });

  it('shows an organization’s override once, not alongside the starter', () => {
    const opts = denominatorOptions([
      def({ metric_key: 'revenue', unit: 'currency' }),
      def({ metric_key: 'revenue', unit: 'EUR', organization_id: 'org-1' }),
    ]);
    expect(opts).toHaveLength(1);
    expect(opts[0].unit).toBe('EUR');
  });

  it('orders by display_order', () => {
    const opts = denominatorOptions([
      def({ metric_key: 'b', display_order: 20 }),
      def({ metric_key: 'a', display_order: 10 }),
    ]);
    expect(opts.map((o) => o.metric_key)).toEqual(['a', 'b']);
  });
});
