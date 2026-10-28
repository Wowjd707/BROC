import { describe, it, expect } from 'vitest';
import {
  median, mad, robustZ, pctChange, deviationFrom,
  monthOf, monthIndex, monthsBetween, shiftMonth,
  buildSeries, analyzeData, isEventCountStream,
  DEFAULT_ANOMALY_CONFIG,
  type Observation, type SiteMeta, type Finding, type AnomalyKind,
} from './anomaly-core';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function site(id: string, name: string, floorAreaSqft: number | null = 10_000): SiteMeta {
  return { id, name, businessUnitId: 'bu1', businessUnitName: 'Ops', floorAreaSqft };
}

let seq = 0;
function obs(
  siteId: string,
  entryDate: string,
  quantity: number,
  stream = 'scope2:electricity',
): Observation {
  seq += 1;
  return {
    id: `e${seq}`,
    siteId,
    stream,
    streamLabel: 'Electricity',
    entryDate,
    quantity,
    unit: 'kWh',
  };
}

/** A steady monthly series, for building a baseline to perturb. */
function steady(siteId: string, months: string[], value: number, jitter = 0): Observation[] {
  return months.map((m, i) =>
    obs(siteId, `${m}-15`, value + (i % 2 === 0 ? jitter : -jitter)),
  );
}

const MONTHS_2025 = [
  '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
];

function kinds(findings: Finding[]): AnomalyKind[] {
  return findings.map((f) => f.kind);
}

function ofKind(findings: Finding[], kind: AnomalyKind): Finding[] {
  return findings.filter((f) => f.kind === kind);
}

// ─── Statistics ──────────────────────────────────────────────────────────────

describe('median / mad / robustZ', () => {
  it('takes the middle value, and the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('is not dragged by an extreme value the way a mean is', () => {
    const values = [10, 10, 11, 10, 10_000];
    expect(median(values)).toBe(10);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(2000);
  });

  it('reports zero spread when every value is identical', () => {
    expect(mad([5, 5, 5, 5])).toBe(0);
  });

  it('returns null rather than Infinity when there is no spread', () => {
    // The whole reason MAD=0 is handled explicitly: a constant series would
    // otherwise make every subsequent reading infinitely anomalous.
    expect(robustZ(9, [5, 5, 5, 5])).toBeNull();
  });

  it('scores a clear outlier well beyond the default threshold', () => {
    const history = [100, 102, 98, 101, 99, 100];
    const z = robustZ(500, history);
    expect(z).not.toBeNull();
    expect(Math.abs(z!)).toBeGreaterThan(DEFAULT_ANOMALY_CONFIG.outlierZ);
  });

  it('does not flag ordinary variation', () => {
    const history = [100, 102, 98, 101, 99, 100];
    expect(Math.abs(robustZ(103, history)!)).toBeLessThan(DEFAULT_ANOMALY_CONFIG.outlierZ);
  });

  it('keeps a single bad point visible instead of letting it raise its own bar', () => {
    // Masking: with mean+stddev the 10000 inflates sigma so much its own
    // z-score falls under the threshold and it hides. MAD barely moves.
    const withOutlier = [100, 102, 98, 101, 99, 10_000];
    const mean = withOutlier.reduce((a, b) => a + b, 0) / withOutlier.length;
    const sd = Math.sqrt(
      withOutlier.reduce((s, v) => s + (v - mean) ** 2, 0) / withOutlier.length,
    );
    expect(Math.abs((10_000 - mean) / sd)).toBeLessThan(3.5); // hidden
    expect(Math.abs(robustZ(10_000, withOutlier)!)).toBeGreaterThan(3.5); // visible
  });
});

describe('deviationFrom', () => {
  it('uses a robust z when the set has spread', () => {
    const d = deviationFrom(500, [100, 102, 98, 101, 99, 100], 3.5)!;
    expect(d.method).toBe('z');
    expect(d.exceeds).toBe(true);
    expect(d.label).toContain('robust z');
  });

  it('falls back to a ratio when MAD is zero, instead of missing the outlier', () => {
    // Half or more identical is common in real data — a site that meters the
    // same figure monthly, or a group of like-for-like warehouses. Without the
    // fallback the extreme member scores null and is silently passed over.
    const d = deviationFrom(60, [1.2, 1.2, 1.2, 1.2, 60], 3.5)!;
    expect(d.method).toBe('ratio');
    expect(d.exceeds).toBe(true);
  });

  it('does not flag the uniform members of a no-spread set', () => {
    const d = deviationFrom(1.2, [1.2, 1.2, 1.2, 1.2, 60], 3.5)!;
    expect(d.method).toBe('ratio');
    expect(d.exceeds).toBe(false);
  });

  it('gives up when there is genuinely no basis for comparison', () => {
    expect(deviationFrom(5, [0, 0, 0, 0], 3.5)).toBeNull();
    expect(deviationFrom(5, [], 3.5)).toBeNull();
  });

  it('never produces a non-finite score', () => {
    for (const values of [[0, 0, 0], [1, 1, 1], [0, 1, 1, 1], [1e9, 1, 1, 1]]) {
      const d = deviationFrom(42, values, 3.5);
      if (d) expect(Number.isFinite(d.value)).toBe(true);
    }
  });
});

describe('pctChange', () => {
  it('computes a signed percentage', () => {
    expect(pctChange(100, 150)).toBe(50);
    expect(pctChange(100, 50)).toBe(-50);
  });

  it('returns null against a zero baseline rather than Infinity', () => {
    expect(pctChange(0, 100)).toBeNull();
  });
});

// ─── Period helpers ──────────────────────────────────────────────────────────

describe('month helpers', () => {
  it('extracts and shifts months across year boundaries', () => {
    expect(monthOf('2025-03-17')).toBe('2025-03');
    expect(shiftMonth('2025-01', -1)).toBe('2024-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2025-06', -12)).toBe('2024-06');
  });

  it('measures month distance across years', () => {
    expect(monthsBetween('2024-11', '2025-02')).toBe(3);
    expect(monthsBetween('2025-02', '2025-02')).toBe(0);
    expect(monthIndex('2025-01')).toBe(monthIndex('2024-12') + 1);
  });
});

// ─── buildSeries ─────────────────────────────────────────────────────────────

describe('buildSeries', () => {
  it('sums a month and keeps every contributing entry id', () => {
    const series = buildSeries([
      obs('s1', '2025-01-05', 100),
      obs('s1', '2025-01-20', 150),
      obs('s1', '2025-02-10', 200),
    ]);
    const s = series.get('s1::scope2:electricity')!;
    expect(s.byMonth.get('2025-01')!.total).toBe(250);
    expect(s.byMonth.get('2025-01')!.entryIds).toHaveLength(2);
    expect(s.byMonth.get('2025-02')!.total).toBe(200);
  });

  it('keeps sites and streams separate', () => {
    const series = buildSeries([
      obs('s1', '2025-01-05', 100),
      obs('s2', '2025-01-05', 100),
      obs('s1', '2025-01-05', 50, 'water:municipal'),
    ]);
    expect(series.size).toBe(3);
  });
});

// ─── Never reported ──────────────────────────────────────────────────────────

describe('never reported', () => {
  it('flags an active site with no data at all', () => {
    const report = analyzeData(
      steady('s1', MONTHS_2025, 1000),
      [site('s1', 'Austin'), site('s2', 'Reno')],
      '2025-12',
    );
    const found = ofKind(report.findings, 'never_reported');
    expect(found).toHaveLength(1);
    expect(found[0].siteName).toBe('Reno');
    expect(found[0].severity).toBe('high');
  });

  it('says nothing when every site reports', () => {
    const report = analyzeData(
      [...steady('s1', MONTHS_2025, 1000), ...steady('s2', MONTHS_2025, 900)],
      [site('s1', 'Austin'), site('s2', 'Reno')],
      '2025-12',
    );
    expect(ofKind(report.findings, 'never_reported')).toHaveLength(0);
  });
});

// ─── Reporting gaps ──────────────────────────────────────────────────────────

describe('reporting gaps', () => {
  it('flags a monthly reporter that stopped', () => {
    const report = analyzeData(
      steady('s1', ['2025-01', '2025-02', '2025-03', '2025-04'], 1000),
      [site('s1', 'Austin')],
      '2025-09',
    );
    const stopped = ofKind(report.findings, 'stream_stopped');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].period).toBe('2025-04');
    expect(stopped[0].severity).toBe('high'); // 5 months silent on a 1-month cadence
  });

  it('does not flag a quarterly reporter one quarter in', () => {
    // Cadence is inferred, so quarterly reporting is not two months late.
    const report = analyzeData(
      steady('s1', ['2025-01', '2025-04', '2025-07'], 3000),
      [site('s1', 'Austin')],
      '2025-09',
    );
    expect(ofKind(report.findings, 'stream_stopped')).toHaveLength(0);
  });

  it('flags a hole in the middle of an otherwise regular series', () => {
    const report = analyzeData(
      steady('s1', ['2025-01', '2025-02', '2025-06', '2025-07', '2025-08'], 1000),
      [site('s1', 'Austin')],
      '2025-08',
    );
    const gaps = ofKind(report.findings, 'reporting_gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].period).toBe('2025-02');
    expect(gaps[0].headline).toContain('3 months missing');
  });

  it('stays silent when history is too short to establish a cadence', () => {
    // Two points give one interval — nothing to call typical.
    const report = analyzeData(
      steady('s1', ['2025-01', '2025-02'], 1000),
      [site('s1', 'Austin')],
      '2025-12',
    );
    expect(ofKind(report.findings, 'stream_stopped')).toHaveLength(0);
    expect(ofKind(report.findings, 'reporting_gap')).toHaveLength(0);
  });
});

// ─── Variance ────────────────────────────────────────────────────────────────

describe('variance', () => {
  it('flags a large month-on-month rise', () => {
    const report = analyzeData(
      [...steady('s1', MONTHS_2025.slice(0, 11), 1000), obs('s1', '2025-12-10', 3000)],
      [site('s1', 'Austin')],
      '2025-12',
    );
    const mom = ofKind(report.findings, 'variance_mom');
    expect(mom).toHaveLength(1);
    expect(mom[0].headline).toContain('up 200%');
    expect(mom[0].severity).toBe('high');
  });

  it('compares against the same month a year earlier', () => {
    const report = analyzeData(
      [
        ...steady('s1', ['2024-12', '2025-10', '2025-11'], 1000),
        obs('s1', '2025-12-10', 2500),
      ],
      [site('s1', 'Austin')],
      '2025-12',
    );
    const yoy = ofKind(report.findings, 'variance_yoy');
    expect(yoy).toHaveLength(1);
    expect(yoy[0].basis.some((b) => b.label === '2024-12')).toBe(true);
  });

  it('ignores a large percentage of a trivial amount', () => {
    // 2 kWh → 5 kWh is +150% and means nothing at a site averaging 1000.
    const report = analyzeData(
      [...steady('s1', MONTHS_2025.slice(0, 10), 1000), obs('s1', '2025-11-10', 2), obs('s1', '2025-12-10', 5)],
      [site('s1', 'Austin')],
      '2025-12',
    );
    expect(ofKind(report.findings, 'variance_mom')).toHaveLength(0);
  });

  it('describes a zero baseline instead of reporting an infinite rise', () => {
    const report = analyzeData(
      [...steady('s1', MONTHS_2025.slice(0, 10), 1000), obs('s1', '2025-11-10', 0), obs('s1', '2025-12-10', 1000)],
      [site('s1', 'Austin')],
      '2025-12',
    );
    const mom = ofKind(report.findings, 'variance_mom');
    expect(mom).toHaveLength(1);
    expect(mom[0].headline).toContain('resumed');
    expect(JSON.stringify(mom[0])).not.toContain('Infinity');
  });

  it('does not flag steady reporting', () => {
    const report = analyzeData(
      steady('s1', MONTHS_2025, 1000, 20),
      [site('s1', 'Austin')],
      '2025-12',
    );
    expect(ofKind(report.findings, 'variance_mom')).toHaveLength(0);
    expect(ofKind(report.findings, 'variance_yoy')).toHaveLength(0);
  });
});

// ─── Value outliers ──────────────────────────────────────────────────────────

describe('value outliers', () => {
  it('flags a month far from the stream history', () => {
    const months = MONTHS_2025.slice(0, 11);
    const report = analyzeData(
      [...steady('s1', months, 1000, 10), obs('s1', '2025-12-10', 90_000)],
      [site('s1', 'Austin')],
      '2025-12',
    );
    const outliers = ofKind(report.findings, 'value_outlier');
    expect(outliers.some((f) => f.period === '2025-12')).toBe(true);
  });

  it('needs a minimum history before scoring anything', () => {
    const report = analyzeData(
      [...steady('s1', ['2025-10', '2025-11'], 1000), obs('s1', '2025-12-10', 90_000)],
      [site('s1', 'Austin')],
      '2025-12',
    );
    expect(ofKind(report.findings, 'value_outlier')).toHaveLength(0);
  });

  it('handles a perfectly constant history without an infinite score', () => {
    // MAD is 0 here; the relative fallback should catch the departure.
    const months = MONTHS_2025.slice(0, 11);
    const report = analyzeData(
      [...steady('s1', months, 1000), obs('s1', '2025-12-10', 5000)],
      [site('s1', 'Austin')],
      '2025-12',
    );
    const outliers = ofKind(report.findings, 'value_outlier');
    expect(outliers.some((f) => f.period === '2025-12')).toBe(true);
    expect(JSON.stringify(outliers)).not.toContain('Infinity');
    expect(JSON.stringify(outliers)).not.toContain('NaN');
  });
});

// ─── Intensity ───────────────────────────────────────────────────────────────

describe('intensity comparison', () => {
  const peers = ['s1', 's2', 's3', 's4'];

  it('flags a site whose intensity is unlike its peers', () => {
    const observations = [
      ...peers.flatMap((s) => steady(s, MONTHS_2025, 1000)),
      ...steady('s5', MONTHS_2025, 50_000),
    ];
    const report = analyzeData(
      observations,
      [...peers.map((s) => site(s, s.toUpperCase())), site('s5', 'Outlier Plant')],
      '2025-12',
    );
    const found = ofKind(report.findings, 'intensity_outlier');
    expect(found.some((f) => f.siteName === 'Outlier Plant')).toBe(true);
  });

  it('reports sites it could not compare rather than dropping them', () => {
    // Missing floor area is itself the finding — and it is fixable.
    const observations = [
      ...peers.flatMap((s) => steady(s, MONTHS_2025, 1000)),
      ...steady('s5', MONTHS_2025, 1000),
    ];
    const report = analyzeData(
      observations,
      [...peers.map((s) => site(s, s.toUpperCase())), site('s5', 'No Area Site', null)],
      '2025-12',
    );
    const coverage = report.intensityCoverage.find((c) => c.stream === 'scope2:electricity')!;
    expect(coverage.excludedForNoFloorArea).toEqual(['No Area Site']);
    expect(coverage.comparedSites).toBe(4);
    expect(coverage.sufficient).toBe(true);
  });

  it('declines to compare too few peers', () => {
    const report = analyzeData(
      [...steady('s1', MONTHS_2025, 1000), ...steady('s2', MONTHS_2025, 90_000)],
      [site('s1', 'A'), site('s2', 'B')],
      '2025-12',
    );
    const coverage = report.intensityCoverage.find((c) => c.stream === 'scope2:electricity')!;
    expect(coverage.sufficient).toBe(false);
    expect(ofKind(report.findings, 'intensity_outlier')).toHaveLength(0);
  });
});

// ─── Duplicates and entry issues ─────────────────────────────────────────────

describe('duplicates', () => {
  it('flags identical entries and states what they overstate by', () => {
    const report = analyzeData(
      [obs('s1', '2025-03-10', 500), obs('s1', '2025-03-10', 500)],
      [site('s1', 'Austin')],
      '2025-03',
    );
    const dupes = ofKind(report.findings, 'duplicate_entry');
    expect(dupes).toHaveLength(1);
    expect(dupes[0].severity).toBe('high');
    expect(dupes[0].entryIds).toHaveLength(2);
    expect(dupes[0].basis.some((b) => b.label === 'Overstated by')).toBe(true);
  });

  it('does not flag the same quantity on different dates', () => {
    const report = analyzeData(
      [obs('s1', '2025-03-10', 500), obs('s1', '2025-04-10', 500)],
      [site('s1', 'Austin')],
      '2025-04',
    );
    expect(ofKind(report.findings, 'duplicate_entry')).toHaveLength(0);
  });
});

describe('rare-event counts', () => {
  const injuries = (siteId: string, month: string, n: number): Observation => ({
    ...obs(siteId, `${month}-28`, n, 'safety:lost_time_incidents'),
    unit: 'count',
    eventCount: true,
  });

  it('knows which streams count rare events', () => {
    expect(isEventCountStream('safety:lost_time_incidents')).toBe(true);
    expect(isEventCountStream('safety:hours_worked')).toBe(false);
    expect(isEventCountStream('workforce:headcount')).toBe(false);
  });

  it('does not flag a month with zero injuries, or a 2 → 1 swing', () => {
    // Regression: on the demo data most findings were zero injury counts and
    // "down 50%" on two recordables.
    const rows = MONTHS_2025.map((m, i) => injuries('s1', m, [0, 1, 0, 2, 0, 0, 1, 0, 3, 0, 2, 1][i]));
    const report = analyzeData(rows, [site('s1', 'Austin')], '2025-12');
    expect(ofKind(report.findings, 'zero_quantity')).toHaveLength(0);
    expect(ofKind(report.findings, 'variance_mom')).toHaveLength(0);
    expect(ofKind(report.findings, 'value_outlier')).toHaveLength(0);
  });

  it('still flags a large jump in an event count', () => {
    const rows = MONTHS_2025.map((m, i) => injuries('s1', m, i === 11 ? 25 : 1));
    const report = analyzeData(rows, [site('s1', 'Austin')], '2025-12');
    expect(ofKind(report.findings, 'variance_mom')).toHaveLength(1);
  });
});

describe('entry issues', () => {
  it('flags a zero quantity as a statement needing confirmation', () => {
    const report = analyzeData(
      [obs('s1', '2025-03-10', 0)],
      [site('s1', 'Austin')],
      '2025-03',
    );
    expect(ofKind(report.findings, 'zero_quantity')).toHaveLength(1);
  });

  it('flags an entry dated after the review period', () => {
    const report = analyzeData(
      [obs('s1', '2026-05-10', 100)],
      [site('s1', 'Austin')],
      '2025-12',
    );
    expect(ofKind(report.findings, 'future_dated')).toHaveLength(1);
  });

  it('accepts an entry inside the as-of month', () => {
    const report = analyzeData(
      [obs('s1', '2025-12-31', 100)],
      [site('s1', 'Austin')],
      '2025-12',
    );
    expect(ofKind(report.findings, 'future_dated')).toHaveLength(0);
  });
});

// ─── Report shape ────────────────────────────────────────────────────────────

describe('analyzeData', () => {
  it('orders the most serious findings first', () => {
    const report = analyzeData(
      [obs('s1', '2025-03-10', 500), obs('s1', '2025-03-10', 500), obs('s1', '2025-03-11', 0)],
      [site('s1', 'Austin'), site('s2', 'Silent')],
      '2025-03',
    );
    const severities = report.findings.map((f) => f.severity);
    const rank = { high: 0, medium: 1, low: 2 } as const;
    for (let i = 1; i < severities.length; i++) {
      expect(rank[severities[i]]).toBeGreaterThanOrEqual(rank[severities[i - 1]]);
    }
  });

  it('summarises scope and severity counts', () => {
    const report = analyzeData(
      steady('s1', MONTHS_2025, 1000),
      [site('s1', 'Austin'), site('s2', 'Silent')],
      '2025-12',
    );
    expect(report.summary.sitesInScope).toBe(2);
    expect(report.summary.sitesReporting).toBe(1);
    expect(report.summary.observations).toBe(12);
    expect(report.summary.bySeverity.high).toBeGreaterThanOrEqual(1);
  });

  it('gives every finding a stable id and its supporting numbers', () => {
    const report = analyzeData(
      [obs('s1', '2025-03-10', 500), obs('s1', '2025-03-10', 500)],
      [site('s1', 'Austin')],
      '2025-03',
    );
    for (const f of report.findings) {
      expect(f.id).toBeTruthy();
      expect(f.basis.length).toBeGreaterThan(0);
      expect(f.headline).toBeTruthy();
    }
    // Stable across identical runs, so a dismissal could be persisted later.
    const again = analyzeData(
      [obs('s1', '2025-03-10', 500), obs('s1', '2025-03-10', 500)],
      [site('s1', 'Austin')],
      '2025-03',
    );
    expect(report.findings.map((f) => f.id)).toEqual(again.findings.map((f) => f.id));
  });

  it('returns a clean report for clean data', () => {
    const report = analyzeData(
      MONTHS_2025.flatMap((m) => [
        obs('s1', `${m}-15`, 1000),
        obs('s2', `${m}-15`, 1100),
      ]),
      [site('s1', 'Austin'), site('s2', 'Reno')],
      '2025-12',
    );
    expect(kinds(report.findings)).toEqual([]);
  });
});
