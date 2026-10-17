/**
 * Data-quality review for activity data.
 *
 * The failure mode this exists for is that **missing data does not announce
 * itself**. A wrong number looks wrong; a site that quietly stopped reporting
 * in March just makes the total look lower, and a reduction that is really a
 * reporting gap is a misstatement nobody catches until assurance.
 *
 * Everything here is a *review prompt*, never a verdict. A finding says "this
 * is unusual against this comparison" and carries the numbers behind the claim
 * in `basis`, because the reviewer — not the platform — knows whether a 300%
 * jump was a new production line or a units error.
 *
 * Three statistical choices are deliberate, and reversing one would quietly
 * make this worse than useless:
 *
 *   • **Median and MAD, not mean and standard deviation.** Activity data is
 *     skewed and a single bad entry inflates the standard deviation enough to
 *     hide itself — the classic masking problem, where the outlier raises the
 *     threshold past its own value. The median absolute deviation does not
 *     move much for one bad point, so the point stays visible.
 *
 *   • **A minimum history before saying anything.** Three readings cannot
 *     establish what is typical. Below the minimum the answer is "not enough
 *     history", not a confident z-score over noise — the same principle as
 *     metrics reporting "missing" rather than 0.
 *
 *   • **No percentage against a zero baseline.** Dividing by a zero prior
 *     period yields Infinity, which renders as a meaningless "∞% increase".
 *     Those are reported as resumed or new reporting instead.
 *
 * Pure and dependency-free so it is unit-testable.
 */

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface Observation {
  id: string;
  siteId: string;
  /** Stable key for the data stream, e.g. `scope2:electricity`. */
  stream: string;
  /** Display name for that stream. */
  streamLabel: string;
  /** ISO `YYYY-MM-DD`. */
  entryDate: string;
  /** Quantity in the stream's normalized base unit. */
  quantity: number;
  unit: string;
}

export interface SiteMeta {
  id: string;
  name: string;
  businessUnitId: string | null;
  businessUnitName: string | null;
  /** Denominator for cross-site intensity comparison; null when unknown. */
  floorAreaSqft: number | null;
}

export interface AnomalyConfig {
  /** Period-over-period change, in percent, that is worth a look. */
  varianceThresholdPct: number;
  /** Robust z beyond which a monthly total is called an outlier. */
  outlierZ: number;
  /** Monthly observations required before outlier statistics mean anything. */
  minHistoryMonths: number;
  /** Peer sites required before a cross-site comparison means anything. */
  minPeerSites: number;
  /** Silence, as a multiple of a stream's own cadence, before flagging. */
  gapToleranceMultiple: number;
  /**
   * A change must also be this fraction of the stream's own median to be
   * reported. Keeps a 2→5 kWh blip out of a report for a site that normally
   * uses 40,000 — technically a 150% rise, materially nothing.
   */
  materialityFraction: number;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
  varianceThresholdPct: 50,
  outlierZ: 3.5,
  minHistoryMonths: 6,
  minPeerSites: 4,
  gapToleranceMultiple: 2,
  materialityFraction: 0.1,
};

// ─── Findings ────────────────────────────────────────────────────────────────

export type AnomalyKind =
  | 'never_reported'
  | 'stream_stopped'
  | 'reporting_gap'
  | 'variance_mom'
  | 'variance_yoy'
  | 'value_outlier'
  | 'intensity_outlier'
  | 'duplicate_entry'
  | 'zero_quantity'
  | 'future_dated';

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  /** Stable across runs, so a reviewer can be given a way to dismiss one. */
  id: string;
  kind: AnomalyKind;
  severity: Severity;
  siteId: string | null;
  siteName: string;
  businessUnitId: string | null;
  businessUnitName: string | null;
  stream: string | null;
  streamLabel: string | null;
  /** `YYYY-MM` the finding concerns, when it concerns one. */
  period: string | null;
  headline: string;
  detail: string;
  /** The numbers behind the claim. Never a bare assertion. */
  basis: { label: string; value: string }[];
  entryIds: string[];
}

export const ANOMALY_KIND_LABELS: Record<AnomalyKind, string> = {
  never_reported: 'No data at all',
  stream_stopped: 'Reporting stopped',
  reporting_gap: 'Gap in reporting',
  variance_mom: 'Month-on-month change',
  variance_yoy: 'Year-on-year change',
  value_outlier: 'Unusual value',
  intensity_outlier: 'Intensity unlike peers',
  duplicate_entry: 'Possible duplicate',
  zero_quantity: 'Zero quantity',
  future_dated: 'Dated in the future',
};

// ─── Small statistics ────────────────────────────────────────────────────────

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Median absolute deviation — the robust spread measure. Returns 0 when every
 * value is identical, which callers must treat as "no variation to compare
 * against" rather than feeding it to `robustZ`.
 */
export function mad(values: number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/** Scaled so that, for normally distributed data, this matches a standard z. */
const MAD_TO_SIGMA = 0.6745;

/**
 * Robust z-score. Returns null when MAD is 0 — the distribution has no spread,
 * so "how many deviations away" has no answer. Returning Infinity there would
 * flag every site that happens to report a constant figure.
 */
export function robustZ(value: number, values: number[]): number | null {
  const spread = mad(values);
  if (spread === 0) return null;
  return (MAD_TO_SIGMA * (value - median(values))) / spread;
}

export interface Deviation {
  /** How the distance was measured — MAD was usable, or it was zero. */
  method: 'z' | 'ratio';
  /** Robust z-score, or fractional departure from the median. */
  value: number;
  /** Description of the distance for a finding's basis. */
  label: string;
  exceeds: boolean;
}

/**
 * How far a value sits from a set's centre, with the degenerate case handled.
 *
 * MAD is zero whenever **half or more of the values are identical** — a site
 * that meters exactly 1,000 every month, or a peer group of like-for-like
 * warehouses. That is not rare, and a z-score is undefined there: without this
 * fallback the genuinely extreme member of such a set scores `null` and is
 * silently passed over, which is the opposite of what a review is for.
 *
 * So when there is no spread, distance is expressed against the common value
 * instead. Returns null only when there is genuinely no basis — an all-zero
 * set, where "how far from zero, proportionally" has no answer.
 */
export function deviationFrom(
  value: number,
  values: number[],
  zThreshold: number,
  ratioThreshold = 0.5,
): Deviation | null {
  if (values.length === 0) return null;

  const centre = median(values);
  const spread = mad(values);

  if (spread > 0) {
    const z = (MAD_TO_SIGMA * (value - centre)) / spread;
    return {
      method: 'z',
      value: z,
      label: `robust z ${z.toFixed(1)}`,
      exceeds: Math.abs(z) >= zThreshold,
    };
  }

  if (centre === 0) return null;

  const ratio = (value - centre) / Math.abs(centre);
  return {
    method: 'ratio',
    value: ratio,
    label: `${ratio > 0 ? '+' : ''}${(ratio * 100).toFixed(0)}% from an otherwise uniform set`,
    exceeds: Math.abs(ratio) >= ratioThreshold,
  };
}

/** Percent change, or null when the baseline is zero and the ratio undefined. */
export function pctChange(from: number, to: number): number | null {
  if (from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

// ─── Period helpers ──────────────────────────────────────────────────────────

/** `YYYY-MM-DD` → `YYYY-MM`. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Months since year 0, so month arithmetic is plain subtraction. */
export function monthIndex(month: string): number {
  const [year, m] = month.split('-').map(Number);
  return year * 12 + (m - 1);
}

export function monthsBetween(from: string, to: string): number {
  return monthIndex(to) - monthIndex(from);
}

/** Shift a `YYYY-MM` by a number of months. */
export function shiftMonth(month: string, delta: number): string {
  const idx = monthIndex(month) + delta;
  const year = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

// ─── Grouping ────────────────────────────────────────────────────────────────

interface StreamSeries {
  siteId: string;
  stream: string;
  streamLabel: string;
  unit: string;
  /** Monthly totals, keyed `YYYY-MM`. */
  byMonth: Map<string, { total: number; entryIds: string[] }>;
}

function seriesKey(siteId: string, stream: string): string {
  return `${siteId}::${stream}`;
}

export function buildSeries(observations: Observation[]): Map<string, StreamSeries> {
  const series = new Map<string, StreamSeries>();

  for (const obs of observations) {
    const key = seriesKey(obs.siteId, obs.stream);
    let entry = series.get(key);
    if (!entry) {
      entry = {
        siteId: obs.siteId,
        stream: obs.stream,
        streamLabel: obs.streamLabel,
        unit: obs.unit,
        byMonth: new Map(),
      };
      series.set(key, entry);
    }
    const month = monthOf(obs.entryDate);
    const bucket = entry.byMonth.get(month) ?? { total: 0, entryIds: [] };
    bucket.total += obs.quantity;
    bucket.entryIds.push(obs.id);
    entry.byMonth.set(month, bucket);
  }

  return series;
}

// ─── Detectors ───────────────────────────────────────────────────────────────

interface Context {
  sites: Map<string, SiteMeta>;
  config: AnomalyConfig;
  /** `YYYY-MM` the review is run for — the last month expected to be complete. */
  asOfMonth: string;
}

function siteOf(ctx: Context, siteId: string): SiteMeta {
  return (
    ctx.sites.get(siteId) ?? {
      id: siteId,
      name: 'Unknown site',
      businessUnitId: null,
      businessUnitName: null,
      floorAreaSqft: null,
    }
  );
}

function finding(
  ctx: Context,
  siteId: string | null,
  parts: Omit<Finding, 'siteName' | 'businessUnitId' | 'businessUnitName' | 'siteId'>,
): Finding {
  const site = siteId ? siteOf(ctx, siteId) : null;
  return {
    ...parts,
    siteId,
    siteName: site?.name ?? '—',
    businessUnitId: site?.businessUnitId ?? null,
    businessUnitName: site?.businessUnitName ?? null,
  };
}

function num(value: number, unit?: string): string {
  const decimals = Math.abs(value) > 0 && Math.abs(value) < 100 ? 2 : 0;
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Sites with no activity data at all in the window.
 *
 * Listed first and rated high because it is the cheapest error to make — a site
 * onboarded but never wired up contributes nothing and looks like a site that
 * simply has low emissions.
 */
export function detectNeverReported(
  observations: Observation[],
  ctx: Context,
): Finding[] {
  const reporting = new Set(observations.map((o) => o.siteId));

  return Array.from(ctx.sites.values())
    .filter((site) => !reporting.has(site.id))
    .map((site) =>
      finding(ctx, site.id, {
        id: `never_reported:${site.id}`,
        kind: 'never_reported',
        severity: 'high',
        stream: null,
        streamLabel: null,
        period: null,
        headline: `${site.name} has no activity data`,
        detail:
          'This site is active but has submitted nothing in the review window. Its emissions are ' +
          'absent from every total rather than reported as zero.',
        basis: [{ label: 'Entries in window', value: '0' }],
        entryIds: [],
      }),
    );
}

/**
 * A stream that was being reported and then stopped, and interior gaps.
 *
 * The cadence is inferred from the stream's own history rather than assumed
 * monthly: a site that reports quarterly is not two months late in month two.
 */
export function detectReportingGaps(
  series: Map<string, StreamSeries>,
  ctx: Context,
): Finding[] {
  const findings: Finding[] = [];

  for (const s of series.values()) {
    const months = Array.from(s.byMonth.keys()).sort();
    // Two points give one interval — not enough to call anything typical.
    if (months.length < 3) continue;

    const gaps: number[] = [];
    for (let i = 1; i < months.length; i++) {
      gaps.push(monthsBetween(months[i - 1], months[i]));
    }
    const cadence = Math.max(1, median(gaps));
    const tolerance = cadence * ctx.config.gapToleranceMultiple;

    // Interior gaps: a silence in the middle of an otherwise regular series.
    for (let i = 1; i < months.length; i++) {
      const gap = monthsBetween(months[i - 1], months[i]);
      if (gap <= tolerance) continue;
      findings.push(
        finding(ctx, s.siteId, {
          id: `reporting_gap:${s.siteId}:${s.stream}:${months[i - 1]}`,
          kind: 'reporting_gap',
          severity: 'medium',
          stream: s.stream,
          streamLabel: s.streamLabel,
          period: months[i - 1],
          headline: `${gap - 1} month${gap - 1 === 1 ? '' : 's'} missing for ${s.streamLabel}`,
          detail:
            `Reporting jumps from ${months[i - 1]} to ${months[i]}, against a usual interval of ` +
            `${cadence} month${cadence === 1 ? '' : 's'}. Totals for the missing period are understated, ` +
            'not zero.',
          basis: [
            { label: 'Last before gap', value: months[i - 1] },
            { label: 'Next after gap', value: months[i] },
            { label: 'Usual interval', value: `${cadence} month${cadence === 1 ? '' : 's'}` },
          ],
          entryIds: [],
        }),
      );
    }

    // Trailing silence: reported regularly, then stopped.
    const last = months[months.length - 1];
    const silent = monthsBetween(last, ctx.asOfMonth);
    if (silent > tolerance && silent >= 2) {
      findings.push(
        finding(ctx, s.siteId, {
          id: `stream_stopped:${s.siteId}:${s.stream}`,
          kind: 'stream_stopped',
          severity: silent > cadence * 3 ? 'high' : 'medium',
          stream: s.stream,
          streamLabel: s.streamLabel,
          period: last,
          headline: `${s.streamLabel} last reported ${last}`,
          detail:
            `Nothing for ${silent} month${silent === 1 ? '' : 's'}, against a usual interval of ` +
            `${cadence} month${cadence === 1 ? '' : 's'}. Either the data is outstanding or the ` +
            'stream genuinely ended — both need saying before the period closes.',
          basis: [
            { label: 'Last reported', value: last },
            { label: 'Months silent', value: String(silent) },
            { label: 'Usual interval', value: `${cadence} month${cadence === 1 ? '' : 's'}` },
          ],
          entryIds: [],
        }),
      );
    }
  }

  return findings;
}

/** Month-on-month and year-on-year swings in a stream's monthly total. */
export function detectVariances(
  series: Map<string, StreamSeries>,
  ctx: Context,
): Finding[] {
  const findings: Finding[] = [];

  for (const s of series.values()) {
    const months = Array.from(s.byMonth.keys()).sort();
    if (months.length < 2) continue;

    const totals = months.map((m) => s.byMonth.get(m)!.total);
    const typical = median(totals);
    const floor = typical * ctx.config.materialityFraction;

    const latest = months[months.length - 1];
    const latestTotal = s.byMonth.get(latest)!.total;

    const comparisons: { kind: 'variance_mom' | 'variance_yoy'; month: string; label: string }[] = [
      { kind: 'variance_mom', month: shiftMonth(latest, -1), label: 'previous month' },
      { kind: 'variance_yoy', month: shiftMonth(latest, -12), label: 'same month last year' },
    ];

    for (const cmp of comparisons) {
      const prior = s.byMonth.get(cmp.month);
      if (!prior) continue;

      const change = pctChange(prior.total, latestTotal);
      const absolute = Math.abs(latestTotal - prior.total);

      // Immaterial in absolute terms — a large percentage of very little.
      if (absolute < floor) continue;

      if (change === null) {
        // Baseline of zero: a percentage would be Infinity and say nothing.
        findings.push(
          finding(ctx, s.siteId, {
            id: `${cmp.kind}:${s.siteId}:${s.stream}:${latest}`,
            kind: cmp.kind,
            severity: 'low',
            stream: s.stream,
            streamLabel: s.streamLabel,
            period: latest,
            headline: `${s.streamLabel} resumed after a zero ${cmp.label}`,
            detail:
              `${cmp.month} totalled zero, so no percentage comparison is meaningful. Confirm the ` +
              'zero was real and not a missing submission.',
            basis: [
              { label: cmp.month, value: num(prior.total, s.unit) },
              { label: latest, value: num(latestTotal, s.unit) },
            ],
            entryIds: s.byMonth.get(latest)!.entryIds,
          }),
        );
        continue;
      }

      if (Math.abs(change) < ctx.config.varianceThresholdPct) continue;

      findings.push(
        finding(ctx, s.siteId, {
          id: `${cmp.kind}:${s.siteId}:${s.stream}:${latest}`,
          kind: cmp.kind,
          severity: Math.abs(change) >= 200 ? 'high' : 'medium',
          stream: s.stream,
          streamLabel: s.streamLabel,
          period: latest,
          headline:
            `${s.streamLabel} ${change > 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(0)}% on the ${cmp.label}`,
          detail:
            'A swing this size is usually a real operational change, a unit entered incorrectly, or a ' +
            'duplicated submission. The entry detail will say which.',
          basis: [
            { label: cmp.month, value: num(prior.total, s.unit) },
            { label: latest, value: num(latestTotal, s.unit) },
            { label: 'Change', value: `${change > 0 ? '+' : ''}${change.toFixed(0)}%` },
            { label: 'Typical month', value: num(typical, s.unit) },
          ],
          entryIds: s.byMonth.get(latest)!.entryIds,
        }),
      );
    }
  }

  return findings;
}

/**
 * A monthly total far from the stream's own history.
 *
 * Catches the unit error that period-over-period comparison misses — a site
 * entering MWh where the platform expects kWh looks normal against the previous
 * month if it has been wrong for several months, but stands out against a
 * longer history.
 */
export function detectValueOutliers(
  series: Map<string, StreamSeries>,
  ctx: Context,
): Finding[] {
  const findings: Finding[] = [];

  for (const s of series.values()) {
    const months = Array.from(s.byMonth.keys()).sort();
    if (months.length < ctx.config.minHistoryMonths) continue;

    const totals = months.map((m) => s.byMonth.get(m)!.total);
    const centre = median(totals);

    for (const month of months) {
      const total = s.byMonth.get(month)!.total;
      const deviation = deviationFrom(total, totals, ctx.config.outlierZ);
      if (!deviation?.exceeds) continue;

      findings.push(
        finding(ctx, s.siteId, {
          id: `value_outlier:${s.siteId}:${s.stream}:${month}`,
          kind: 'value_outlier',
          severity: 'medium',
          stream: s.stream,
          streamLabel: s.streamLabel,
          period: month,
          headline: `${s.streamLabel} in ${month} is unlike its own history`,
          detail:
            'Compared against this site and stream across the whole window, using the median and ' +
            'median absolute deviation so one bad month cannot mask itself.',
          basis: [
            { label: month, value: num(total, s.unit) },
            { label: 'Typical month', value: num(centre, s.unit) },
            { label: 'Distance', value: deviation.label },
            { label: 'Months compared', value: String(months.length) },
          ],
          entryIds: s.byMonth.get(month)!.entryIds,
        }),
      );
    }
  }

  return findings;
}

export interface IntensityCoverage {
  stream: string;
  streamLabel: string;
  comparedSites: number;
  excludedForNoFloorArea: string[];
  /** False when too few peers to say anything. */
  sufficient: boolean;
}

/**
 * Cross-site intensity comparison — the "correlation skew" case.
 *
 * Sites are only comparable once normalized by something that scales with
 * consumption; floor area is the denominator the platform actually holds. A
 * site whose kWh per square foot is far from its peers is either genuinely
 * inefficient or mis-reporting, and both are worth knowing.
 *
 * Sites without a floor area cannot be compared at all. They are reported as
 * coverage rather than silently dropped — "we could not check these" is itself
 * the finding, and it is fixable by filling the field in.
 */
export function detectIntensityOutliers(
  series: Map<string, StreamSeries>,
  ctx: Context,
): { findings: Finding[]; coverage: IntensityCoverage[] } {
  const findings: Finding[] = [];
  const coverage: IntensityCoverage[] = [];

  // Total per site per stream across the window.
  const byStream = new Map<string, { streamLabel: string; unit: string; totals: Map<string, number> }>();
  for (const s of series.values()) {
    let bucket = byStream.get(s.stream);
    if (!bucket) {
      bucket = { streamLabel: s.streamLabel, unit: s.unit, totals: new Map() };
      byStream.set(s.stream, bucket);
    }
    const total = Array.from(s.byMonth.values()).reduce((sum, m) => sum + m.total, 0);
    bucket.totals.set(s.siteId, (bucket.totals.get(s.siteId) ?? 0) + total);
  }

  for (const [stream, bucket] of byStream) {
    const comparable: { siteId: string; intensity: number }[] = [];
    const excluded: string[] = [];

    for (const [siteId, total] of bucket.totals) {
      const site = siteOf(ctx, siteId);
      if (!site.floorAreaSqft || site.floorAreaSqft <= 0) {
        excluded.push(site.name);
        continue;
      }
      comparable.push({ siteId, intensity: total / site.floorAreaSqft });
    }

    const sufficient = comparable.length >= ctx.config.minPeerSites;
    coverage.push({
      stream,
      streamLabel: bucket.streamLabel,
      comparedSites: comparable.length,
      excludedForNoFloorArea: excluded.sort(),
      sufficient,
    });

    if (!sufficient) continue;

    const intensities = comparable.map((c) => c.intensity);
    const centre = median(intensities);

    for (const { siteId, intensity } of comparable) {
      const deviation = deviationFrom(intensity, intensities, ctx.config.outlierZ);
      if (!deviation?.exceeds) continue;

      findings.push(
        finding(ctx, siteId, {
          id: `intensity_outlier:${siteId}:${stream}`,
          kind: 'intensity_outlier',
          severity: 'low',
          stream,
          streamLabel: bucket.streamLabel,
          period: null,
          headline: `${bucket.streamLabel} per sq ft is ${intensity > centre ? 'far above' : 'far below'} peer sites`,
          detail:
            'Normalized by floor area and compared against the other sites in scope. A large gap is ' +
            'either a genuine efficiency difference or a reporting error — this cannot tell which, ' +
            'but it is the right place to look.',
          basis: [
            { label: 'This site', value: `${num(intensity)} ${bucket.unit}/sq ft` },
            { label: 'Peer median', value: `${num(centre)} ${bucket.unit}/sq ft` },
            { label: 'Distance', value: deviation.label },
            { label: 'Sites compared', value: String(comparable.length) },
          ],
          entryIds: [],
        }),
      );
    }
  }

  return { findings, coverage };
}

/**
 * Entries identical in site, stream, date and quantity.
 *
 * Rated high because a duplicate directly overstates: unlike a gap, which makes
 * a total too low and often gets noticed, a double-count reads as real data.
 */
export function detectDuplicates(observations: Observation[], ctx: Context): Finding[] {
  const groups = new Map<string, Observation[]>();

  for (const obs of observations) {
    const key = `${obs.siteId}::${obs.stream}::${obs.entryDate}::${obs.quantity.toFixed(6)}`;
    groups.set(key, [...(groups.get(key) ?? []), obs]);
  }

  return Array.from(groups.values())
    .filter((group) => group.length > 1)
    .map((group) => {
      const first = group[0];
      return finding(ctx, first.siteId, {
        id: `duplicate_entry:${first.siteId}:${first.stream}:${first.entryDate}:${first.quantity}`,
        kind: 'duplicate_entry',
        severity: 'high',
        stream: first.stream,
        streamLabel: first.streamLabel,
        period: monthOf(first.entryDate),
        headline: `${group.length} identical ${first.streamLabel} entries on ${first.entryDate}`,
        detail:
          'Same site, stream, date and quantity. If these are genuinely separate readings, a ' +
          'distinguishing note on each keeps them from reading as a double submission.',
        basis: [
          { label: 'Date', value: first.entryDate },
          { label: 'Quantity, each', value: num(first.quantity, first.unit) },
          { label: 'Copies', value: String(group.length) },
          { label: 'Overstated by', value: num(first.quantity * (group.length - 1), first.unit) },
        ],
        entryIds: group.map((o) => o.id),
      });
    });
}

/** Entries that are individually implausible regardless of history. */
export function detectEntryIssues(observations: Observation[], ctx: Context): Finding[] {
  const findings: Finding[] = [];
  // Last day of the as-of month, so a legitimately current-month entry is fine.
  const horizon = `${shiftMonth(ctx.asOfMonth, 1)}-01`;

  for (const obs of observations) {
    if (obs.quantity === 0) {
      findings.push(
        finding(ctx, obs.siteId, {
          id: `zero_quantity:${obs.id}`,
          kind: 'zero_quantity',
          severity: 'low',
          stream: obs.stream,
          streamLabel: obs.streamLabel,
          period: monthOf(obs.entryDate),
          headline: `Zero ${obs.streamLabel} recorded on ${obs.entryDate}`,
          detail:
            'A zero reading and an unmeasured period are different statements, and only one of them ' +
            'belongs in a total. Confirm the zero is a real measurement.',
          basis: [{ label: 'Quantity', value: num(0, obs.unit) }],
          entryIds: [obs.id],
        }),
      );
    }

    if (obs.entryDate >= horizon) {
      findings.push(
        finding(ctx, obs.siteId, {
          id: `future_dated:${obs.id}`,
          kind: 'future_dated',
          severity: 'medium',
          stream: obs.stream,
          streamLabel: obs.streamLabel,
          period: monthOf(obs.entryDate),
          headline: `${obs.streamLabel} dated ${obs.entryDate}, after the review period`,
          detail:
            'A future activity date lands the quantity in a period that has not happened, so it will ' +
            'be missing from the period it belongs to.',
          basis: [
            { label: 'Entry date', value: obs.entryDate },
            { label: 'Review through', value: ctx.asOfMonth },
          ],
          entryIds: [obs.id],
        }),
      );
    }
  }

  return findings;
}

// ─── Orchestration ───────────────────────────────────────────────────────────

export interface AnomalyReport {
  findings: Finding[];
  intensityCoverage: IntensityCoverage[];
  summary: {
    sitesInScope: number;
    sitesReporting: number;
    observations: number;
    /** `YYYY-MM` the review runs through. */
    asOfMonth: string;
    bySeverity: Record<Severity, number>;
  };
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function analyzeData(
  observations: Observation[],
  sites: SiteMeta[],
  asOfMonth: string,
  config: AnomalyConfig = DEFAULT_ANOMALY_CONFIG,
): AnomalyReport {
  const ctx: Context = {
    sites: new Map(sites.map((s) => [s.id, s])),
    config,
    asOfMonth,
  };

  const series = buildSeries(observations);
  const intensity = detectIntensityOutliers(series, ctx);

  const findings = [
    ...detectNeverReported(observations, ctx),
    ...detectDuplicates(observations, ctx),
    ...detectReportingGaps(series, ctx),
    ...detectVariances(series, ctx),
    ...detectValueOutliers(series, ctx),
    ...intensity.findings,
    ...detectEntryIssues(observations, ctx),
  ].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const bySite = a.siteName.localeCompare(b.siteName);
    if (bySite !== 0) return bySite;
    return a.kind.localeCompare(b.kind);
  });

  const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) bySeverity[f.severity] += 1;

  return {
    findings,
    intensityCoverage: intensity.coverage,
    summary: {
      sitesInScope: sites.length,
      sitesReporting: new Set(observations.map((o) => o.siteId)).size,
      observations: observations.length,
      asOfMonth,
      bySeverity,
    },
  };
}
