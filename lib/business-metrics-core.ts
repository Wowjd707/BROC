/**
 * Business metrics — what an organization measures itself by.
 *
 * Revenue, FTE, tonnes produced, room-nights, vehicle-km. These are the
 * denominators intensity is reported against, and until migration 027 the only
 * one this platform had was floor area.
 *
 * Pure and dependency-free so it is unit-testable.
 */

export type MetricAggregation = 'sum' | 'point_in_time' | 'average';

export interface BusinessMetricDefinition {
  metric_key: string;
  label: string;
  description: string | null;
  unit: string;
  category: string;
  aggregation: MetricAggregation;
  is_denominator: boolean;
  display_order: number;
  /** Null for a starter definition shared by every tenant. */
  organization_id: string | null;
}

export interface BusinessMetricValue {
  metric_key: string;
  reporting_year: number;
  site_id: string | null;
  as_of_date: string | null;
  value: number;
}

/**
 * Reduce a year's values for one metric to a single figure.
 *
 * The same trap as the social metrics in 023, and it bites harder here because
 * this number is a divisor: summing twelve monthly headcount readings inflates
 * the denominator twelvefold and shrinks the reported intensity to a twelfth of
 * the truth — an error in the flattering direction, which is the kind nobody
 * questions.
 *
 * Returns null rather than 0 for no data. A zero denominator and an absent one
 * are different, and only one of them should produce a dash on a report.
 */
export function aggregateMetricValues(
  values: BusinessMetricValue[],
  aggregation: MetricAggregation,
): number | null {
  if (values.length === 0) return null;

  // Bucket by site; a null site is the organization-wide bucket.
  const buckets = new Map<string, BusinessMetricValue[]>();
  for (const v of values) {
    const key = v.site_id ?? '__org__';
    const list = buckets.get(key) ?? [];
    list.push(v);
    buckets.set(key, list);
  }

  // One figure per bucket: the latest reading for a point-in-time metric, the
  // mean of the period's readings for an average (average headcount over the
  // year, not an average across sites, which means nothing as a denominator).
  const perBucket = (list: BusinessMetricValue[]): number => {
    if (aggregation === 'sum') return list.reduce((s, v) => s + v.value, 0);
    if (aggregation === 'average') return list.reduce((s, v) => s + v.value, 0) / list.length;
    return list.reduce((latest, v) => ((v.as_of_date ?? '') > (latest.as_of_date ?? '') ? v : latest)).value;
  };

  // An organization-wide figure (null site, migration 027) IS the total; site
  // figures are its parts. Adding both counted the organization twice. The stated total wins; the
  // sum of sites is used only when no organization-wide figure exists.
  const org = buckets.get('__org__');
  if (org) return perBucket(org);
  let total = 0;
  for (const list of buckets.values()) total += perBucket(list);
  return total;
}

export interface ResolvedDenominator {
  /** Null when the organization has not recorded the figure. */
  value: number | null;
  /** e.g. "revenue", "sq ft". Used in the reported unit string. */
  unit: string;
  label: string;
  /** True when this is the floor-area fallback rather than a chosen metric. */
  isFallback: boolean;
}

/**
 * Work out what to divide by.
 *
 * Falls back to floor area when no denominator has been chosen, which is what
 * every deployment predating migration 027 was doing implicitly. The fallback
 * is flagged so the UI can say which it used — an intensity figure whose
 * denominator is ambiguous is not much use to anyone.
 */
export function resolveDenominator(
  chosenKey: string | null,
  definitions: BusinessMetricDefinition[],
  values: BusinessMetricValue[],
  floorAreaTotal: number,
): ResolvedDenominator {
  if (!chosenKey) {
    return {
      value: floorAreaTotal > 0 ? floorAreaTotal : null,
      unit: 'sq ft',
      label: 'Floor area',
      isFallback: true,
    };
  }

  // An organization's own definition wins over a starter of the same key, so
  // redefining "revenue" locally does exactly what it looks like it does.
  const candidates = definitions.filter((d) => d.metric_key === chosenKey);
  const definition = candidates.find((d) => d.organization_id !== null) ?? candidates[0];

  if (!definition) {
    return { value: null, unit: '', label: chosenKey, isFallback: false };
  }

  const relevant = values.filter((v) => v.metric_key === chosenKey);
  return {
    value: aggregateMetricValues(relevant, definition.aggregation),
    unit: definition.unit,
    label: definition.label,
    isFallback: false,
  };
}

/** Denominator options for a picker: starters plus the organization's own. */
export function denominatorOptions(
  definitions: BusinessMetricDefinition[],
): BusinessMetricDefinition[] {
  const byKey = new Map<string, BusinessMetricDefinition>();
  for (const d of definitions) {
    if (!d.is_denominator || !d.metric_key) continue;
    const held = byKey.get(d.metric_key);
    // The organization's own definition shadows the starter.
    if (!held || (d.organization_id !== null && held.organization_id === null)) {
      byKey.set(d.metric_key, d);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.display_order - b.display_order);
}
