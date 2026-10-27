/**
 * Organizational boundary — the GHG Protocol consolidation approaches.
 *
 * Decides how much of a site's emissions belong to the reporting organization.
 * This is the first question an assurance provider asks and, until migration
 * 028, the platform had no way to answer it: every inventory was implicitly
 * 100% of everything, which is right for a wholly-owned group and wrong for
 * anyone with a joint venture.
 *
 * Pure and dependency-free so it is unit-testable, and so the same share is
 * applied by the report, the dashboard and the KPI page rather than each
 * deriving its own.
 */

export type ConsolidationApproach =
  | 'equity_share'
  | 'financial_control'
  | 'operational_control';

export const CONSOLIDATION_LABELS: Record<ConsolidationApproach, string> = {
  equity_share: 'Equity share',
  financial_control: 'Financial control',
  operational_control: 'Operational control',
};

export const CONSOLIDATION_DESCRIPTIONS: Record<ConsolidationApproach, string> = {
  equity_share:
    'Emissions are accounted for in proportion to the equity stake in each operation. A 50% joint venture contributes half its emissions.',
  financial_control:
    'All emissions from operations the organization financially controls are accounted for in full; operations it does not control are excluded entirely.',
  operational_control:
    'All emissions from operations over which the organization has the authority to introduce and implement its operating policies are accounted for in full; others are excluded entirely.',
};

export interface SiteBoundary {
  id: string;
  /** 0–100. Meaningful only under equity share. */
  ownership_percent: number;
  /** Meaningful only under the control approaches. */
  is_controlled: boolean;
}

/**
 * The fraction of a site's emissions that belong to the organization, 0–1.
 *
 * Both inputs are needed because neither approach family can express the other:
 * a percentage cannot say "we run it, so all of it counts", and a boolean
 * cannot say "we own 30% of it".
 */
export function consolidationShare(
  site: Pick<SiteBoundary, 'ownership_percent' | 'is_controlled'>,
  approach: ConsolidationApproach,
): number {
  if (approach === 'equity_share') {
    const pct = Number(site.ownership_percent);
    if (!Number.isFinite(pct)) return 1;
    return Math.min(100, Math.max(0, pct)) / 100;
  }
  return site.is_controlled ? 1 : 0;
}

/**
 * Share for an entry, given the site it belongs to.
 *
 * An entry with no site — an entity-level record — is included in full. It
 * cannot be attributed to a part-owned operation, and silently dropping or
 * halving it would be a worse guess than including what the organization
 * recorded about itself.
 *
 * An entry whose site is not in the map is also included in full, and that is
 * deliberate: a missing site is a data problem, and quietly zeroing emissions
 * because of one would understate the inventory in the direction nobody checks.
 */
export function shareForEntry(
  siteId: string | null,
  boundaries: Map<string, SiteBoundary>,
  approach: ConsolidationApproach,
): number {
  if (siteId === null) return 1;
  const site = boundaries.get(siteId);
  if (!site) return 1;
  return consolidationShare(site, approach);
}

export function boundaryMap(sites: SiteBoundary[]): Map<string, SiteBoundary> {
  return new Map(sites.map((s) => [s.id, s]));
}

/** True when the boundary changes nothing — the common case, worth short-circuiting. */
export function isWholeBoundary(
  sites: SiteBoundary[],
  approach: ConsolidationApproach,
): boolean {
  return sites.every((s) => consolidationShare(s, approach) === 1);
}

export interface BoundaryEffect {
  approach: ConsolidationApproach;
  /** Sites contributing less than their full emissions. */
  partialSites: { id: string; share: number }[];
  /** Sites contributing nothing at all. */
  excludedSites: string[];
}

/**
 * What the boundary actually does to this organization's sites.
 *
 * Feeds the basis of preparation. A reader needs to know not just which
 * approach was chosen but which operations it moved, because that is what makes
 * the total reproducible by someone else.
 */
export function describeBoundaryEffect(
  sites: SiteBoundary[],
  approach: ConsolidationApproach,
): BoundaryEffect {
  const partialSites: { id: string; share: number }[] = [];
  const excludedSites: string[] = [];
  for (const s of sites) {
    const share = consolidationShare(s, approach);
    if (share === 0) excludedSites.push(s.id);
    else if (share < 1) partialSites.push({ id: s.id, share });
  }
  return { approach, partialSites, excludedSites };
}

// ─── Data quality ────────────────────────────────────────────────────────────

export type DataQuality = 'measured' | 'calculated' | 'estimated';

export const DATA_QUALITY_LABELS: Record<DataQuality, string> = {
  measured: 'Measured',
  calculated: 'Calculated',
  estimated: 'Estimated',
};

export interface QualityCounts {
  measured: number;
  calculated: number;
  estimated: number;
  total: number;
  /** Share of the reported quantity that was estimated, 0–100. */
  estimatedPercent: number;
}

/**
 * How much of the inventory was estimated, weighted by emissions rather than
 * by row count.
 *
 * Row count would be misleading: forty estimated rows for small offices and one
 * measured row for a smelter is not a 97% estimated inventory. Frameworks and
 * assurance providers ask what share of the *number* rests on estimates, so
 * that is what this reports.
 */
export function summariseDataQuality(
  entries: { data_quality?: string | null; co2e_kg: number }[],
): QualityCounts {
  const counts = { measured: 0, calculated: 0, estimated: 0 };
  let total = 0;
  for (const e of entries) {
    const q = (e.data_quality ?? 'calculated') as DataQuality;
    const value = Number.isFinite(e.co2e_kg) ? e.co2e_kg : 0;
    if (q === 'measured' || q === 'calculated' || q === 'estimated') counts[q] += value;
    else counts.calculated += value;
    total += value;
  }
  return {
    ...counts,
    total,
    estimatedPercent: total > 0 ? (counts.estimated / total) * 100 : 0,
  };
}
