import { describe, it, expect } from 'vitest';
import {
  getMetricDefinition,
  isSocialGovernanceFamily,
  canonicaliseUnit,
  normalizeSocialInput,
  aggregateMetric,
  aggregateAll,
  deriveRates,
  inputsFromAggregates,
  SOCIAL_GOVERNANCE_METRICS,
  type MetricReading,
} from './social-metrics-core';

function reading(o: Partial<MetricReading> = {}): MetricReading {
  return {
    metricType: 'safety',
    sourceType: 'recordable_incidents',
    entryDate: '2026-01-31',
    quantityNormalized: 1,
    siteId: 'site-a',
    ...o,
  };
}

function rateNamed(rates: ReturnType<typeof deriveRates>, key: string) {
  const found = rates.find((r) => r.key === key);
  if (!found) throw new Error(`No rate "${key}"`);
  return found;
}

describe('the catalog', () => {
  it('defines every metric with a canonical unit and an aggregation rule', () => {
    for (const m of SOCIAL_GOVERNANCE_METRICS) {
      expect(m.canonicalUnit, m.sourceType).toBeTruthy();
      expect(['sum', 'point_in_time', 'average']).toContain(m.aggregation);
    }
  });

  it('has no duplicate metric keys', () => {
    const keys = SOCIAL_GOVERNANCE_METRICS.map((m) => `${m.metricType}:${m.sourceType}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('treats headcount and board seats as stocks, not flows', () => {
    // The single most likely way to produce a badly wrong social disclosure
    // from entirely correct data.
    expect(getMetricDefinition('workforce', 'headcount')?.aggregation).toBe('point_in_time');
    expect(getMetricDefinition('governance', 'board_seats')?.aggregation).toBe('point_in_time');
  });

  it('keeps water and waste out of the social families', () => {
    expect(isSocialGovernanceFamily('safety')).toBe(true);
    expect(isSocialGovernanceFamily('governance')).toBe(true);
    expect(isSocialGovernanceFamily('water')).toBe(false);
    expect(isSocialGovernanceFamily('waste')).toBe(false);
  });
});

describe('normalizeSocialInput', () => {
  it('accepts a unit synonym and stores the canonical one', () => {
    const r = normalizeSocialInput(1_500_000, 'hrs', 'safety', 'hours_worked');
    expect(r).toEqual({ quantityNormalized: 1_500_000, unitNormalized: 'hours' });
  });

  it('accepts counts under any of the count synonyms', () => {
    for (const unit of ['count', 'cases', 'incidents', 'each']) {
      expect(normalizeSocialInput(3, unit, 'safety', 'recordable_incidents').unitNormalized).toBe('count');
    }
  });

  it('refuses a unit that does not convert rather than coercing it', () => {
    // A silently accepted "12 days" against an hours metric produces a
    // plausible, wrong TRIR that nothing downstream can detect.
    expect(() => normalizeSocialInput(12, 'days', 'safety', 'hours_worked')).toThrow(/do not convert/);
  });

  it('refuses an unrecognised unit', () => {
    expect(() => normalizeSocialInput(5, 'widgets', 'safety', 'recordable_incidents')).toThrow(/Unsupported unit/);
  });

  it('refuses a fractional count', () => {
    expect(() => normalizeSocialInput(2.5, 'count', 'safety', 'recordable_incidents')).toThrow(/whole number/);
  });

  it('refuses an unknown metric', () => {
    expect(() => normalizeSocialInput(1, 'count', 'safety', 'invented_metric')).toThrow(/Unknown metric/);
  });

  it('canonicalises units case- and separator-insensitively', () => {
    expect(canonicaliseUnit('Man Hours')).toBe('hours');
    expect(canonicaliseUnit('CALENDAR_DAYS')).toBe('days');
    expect(canonicaliseUnit('nonsense')).toBeNull();
  });
});

describe('aggregateMetric', () => {
  it('sums a flow', () => {
    const value = aggregateMetric([
      reading({ quantityNormalized: 2, entryDate: '2026-01-31' }),
      reading({ quantityNormalized: 3, entryDate: '2026-02-28' }),
    ]);
    expect(value).toBe(5);
  });

  it('takes the latest reading for a stock at one site, never the sum', () => {
    const value = aggregateMetric([
      reading({ metricType: 'workforce', sourceType: 'headcount', quantityNormalized: 1000, entryDate: '2026-01-31' }),
      reading({ metricType: 'workforce', sourceType: 'headcount', quantityNormalized: 1040, entryDate: '2026-06-30' }),
      reading({ metricType: 'workforce', sourceType: 'headcount', quantityNormalized: 1020, entryDate: '2026-03-31' }),
    ]);
    expect(value).toBe(1040);
  });

  it('sums the latest reading FROM EACH SITE for a stock', () => {
    // The organization's headcount is every plant's current headcount added up.
    // Taking the latest reading overall would report HQ's 120 people as the
    // whole company, and — because separations are summed across all sites —
    // would then compute a turnover rate well over 100%.
    const value = aggregateMetric([
      reading({ metricType: 'workforce', sourceType: 'headcount', siteId: 'plant-a', quantityNormalized: 800, entryDate: '2026-06-30' }),
      reading({ metricType: 'workforce', sourceType: 'headcount', siteId: 'plant-b', quantityNormalized: 400, entryDate: '2026-06-30' }),
      reading({ metricType: 'workforce', sourceType: 'headcount', siteId: 'hq', quantityNormalized: 120, entryDate: '2026-07-31' }),
    ]);
    expect(value).toBe(1320);
  });

  it('uses only each site’s most recent stock reading', () => {
    const value = aggregateMetric([
      reading({ metricType: 'workforce', sourceType: 'headcount', siteId: 'plant-a', quantityNormalized: 700, entryDate: '2026-01-31' }),
      reading({ metricType: 'workforce', sourceType: 'headcount', siteId: 'plant-a', quantityNormalized: 800, entryDate: '2026-06-30' }),
      reading({ metricType: 'workforce', sourceType: 'headcount', siteId: 'plant-b', quantityNormalized: 400, entryDate: '2026-06-30' }),
    ]);
    expect(value).toBe(1200);
  });

  it('does not double count a duplicate stock reading for one site and date', () => {
    const value = aggregateMetric([
      reading({ metricType: 'workforce', sourceType: 'headcount', siteId: 'plant-a', quantityNormalized: 800, entryDate: '2026-06-30' }),
      reading({ metricType: 'workforce', sourceType: 'headcount', siteId: 'plant-a', quantityNormalized: 800, entryDate: '2026-06-30' }),
    ]);
    expect(value).toBe(800);
  });

  it('treats entity-level stock metrics as a single bucket', () => {
    // Board seats carry no site; they must not be summed across readings.
    const value = aggregateMetric([
      reading({ metricType: 'governance', sourceType: 'board_seats', siteId: null, quantityNormalized: 9, entryDate: '2026-01-31' }),
      reading({ metricType: 'governance', sourceType: 'board_seats', siteId: null, quantityNormalized: 11, entryDate: '2026-06-30' }),
    ]);
    expect(value).toBe(11);
  });

  it('still sums a flow across every site', () => {
    const value = aggregateMetric([
      reading({ sourceType: 'hours_worked', siteId: 'plant-a', quantityNormalized: 400000 }),
      reading({ sourceType: 'hours_worked', siteId: 'plant-b', quantityNormalized: 250000 }),
    ]);
    expect(value).toBe(650000);
  });

  it('produces a sane turnover rate across multiple sites', () => {
    // The regression this whole fix exists for.
    const agg = aggregateAll([
      reading({ metricType: 'workforce', sourceType: 'headcount', siteId: 'plant-a', quantityNormalized: 800, entryDate: '2026-06-30' }),
      reading({ metricType: 'workforce', sourceType: 'headcount', siteId: 'plant-b', quantityNormalized: 400, entryDate: '2026-06-30' }),
      reading({ metricType: 'workforce', sourceType: 'separations_voluntary', siteId: 'plant-a', quantityNormalized: 60 }),
      reading({ metricType: 'workforce', sourceType: 'separations_voluntary', siteId: 'plant-b', quantityNormalized: 60 }),
    ]);
    const rate = deriveRates(inputsFromAggregates(agg))
      .find((r) => r.key === 'turnover_voluntary')!;
    expect(rate.value).toBeCloseTo(10.0, 10);
  });

  it('returns null for no readings, not zero', () => {
    // "Not measured" and "measured as zero" are different disclosures.
    expect(aggregateMetric([])).toBeNull();
  });

  it('groups by metric so counts and hours are never added together', () => {
    const agg = aggregateAll([
      reading({ sourceType: 'hours_worked', quantityNormalized: 500_000 }),
      reading({ sourceType: 'recordable_incidents', quantityNormalized: 4 }),
    ]);
    expect(agg.get('safety:hours_worked')).toBe(500_000);
    expect(agg.get('safety:recordable_incidents')).toBe(4);
    expect(agg.size).toBe(2);
  });
});

describe('deriveRates', () => {
  it('computes TRIR on the OSHA 200,000-hour basis', () => {
    // 4 recordables over 400,000 hours = 2.0
    const r = rateNamed(deriveRates({ recordableIncidents: 4, hoursWorked: 400_000 }), 'trir');
    expect(r.value).toBeCloseTo(2.0, 10);
    expect(r.hoursBasis).toBe(200_000);
    expect(r.missing).toBe(false);
  });

  it('computes the same TRIR on the 1,000,000-hour basis GRI also permits', () => {
    const r = rateNamed(deriveRates({ recordableIncidents: 4, hoursWorked: 400_000 }, 1_000_000), 'trir');
    expect(r.value).toBeCloseTo(10.0, 10);
    expect(r.hoursBasis).toBe(1_000_000);
  });

  it('carries the basis on every injury rate so a report can state it', () => {
    const rates = deriveRates({ recordableIncidents: 1, hoursWorked: 200_000 });
    for (const key of ['trir', 'dart', 'ltir', 'severity', 'fatality_rate']) {
      expect(rateNamed(rates, key).hoursBasis, key).toBe(200_000);
    }
  });

  it('adds lost-time and restricted-duty cases for DART', () => {
    const r = rateNamed(
      deriveRates({ lostTimeIncidents: 3, restrictedDutyIncidents: 2, hoursWorked: 1_000_000 }),
      'dart',
    );
    expect(r.value).toBeCloseTo(1.0, 10);
  });

  it('reports a rate as missing rather than zero when hours worked are absent', () => {
    // Zero recordables against zero hours is an empty dataset, not a perfect
    // safety record.
    const r = rateNamed(deriveRates({ recordableIncidents: 0 }), 'trir');
    expect(r.value).toBeNull();
    expect(r.missing).toBe(true);
  });

  it('reports a rate as missing when the denominator is zero', () => {
    const r = rateNamed(deriveRates({ recordableIncidents: 2, hoursWorked: 0 }), 'trir');
    expect(r.value).toBeNull();
    expect(r.missing).toBe(true);
  });

  it('distinguishes a genuine zero numerator from an absent one', () => {
    const r = rateNamed(deriveRates({ recordableIncidents: 0, hoursWorked: 500_000 }), 'trir');
    expect(r.value).toBe(0);
    expect(r.missing).toBe(false);
  });

  it('computes turnover against headcount', () => {
    const rates = deriveRates({ separationsVoluntary: 60, separationsInvoluntary: 20, headcount: 800 });
    expect(rateNamed(rates, 'turnover_total').value).toBeCloseTo(10.0, 10);
    expect(rateNamed(rates, 'turnover_voluntary').value).toBeCloseTo(7.5, 10);
  });

  it('computes board independence', () => {
    const r = rateNamed(deriveRates({ boardSeats: 10, independentBoardSeats: 7 }), 'board_independence');
    expect(r.value).toBeCloseTo(70, 10);
    expect(r.unit).toBe('%');
  });

  it('names its inputs so the lineage is followable', () => {
    const r = rateNamed(deriveRates({ recordableIncidents: 1, hoursWorked: 200_000 }), 'trir');
    expect(r.inputs).toContain('safety:recordable_incidents');
    expect(r.inputs).toContain('safety:hours_worked');
    expect(r.formula).toMatch(/hours worked/);
  });

  it('returns every rate as missing when there is no data at all', () => {
    for (const r of deriveRates({})) {
      expect(r.value, r.key).toBeNull();
      expect(r.missing, r.key).toBe(true);
    }
  });
});

describe('inputsFromAggregates', () => {
  it('maps aggregated metric keys onto the rate inputs', () => {
    const agg = aggregateAll([
      reading({ sourceType: 'hours_worked', quantityNormalized: 200_000 }),
      reading({ sourceType: 'recordable_incidents', quantityNormalized: 3 }),
      reading({ metricType: 'workforce', sourceType: 'headcount', quantityNormalized: 100 }),
    ]);
    const inputs = inputsFromAggregates(agg);
    expect(inputs.hoursWorked).toBe(200_000);
    expect(inputs.recordableIncidents).toBe(3);
    expect(inputs.headcount).toBe(100);
    // Absent metrics come back null, so deriveRates can tell them from zero.
    expect(inputs.fatalities).toBeNull();

    expect(rateNamed(deriveRates(inputs), 'trir').value).toBeCloseTo(3.0, 10);
  });
});
