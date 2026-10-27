import 'server-only';
import { createServerClient } from './supabase/server';
import { applyScope } from './scope-filter';
import { fetchAll } from './fetch-all';
import { sourceLabel } from './source-labels';
import {
  analyzeData,
  shiftMonth,
  DEFAULT_ANOMALY_CONFIG,
  type Observation,
  type SiteMeta,
  type AnomalyReport,
  type AnomalyConfig,
} from './anomaly-core';

/**
 * Assembles the data-quality review.
 *
 * Runs server-side and ships only the findings: the analysis window spans two
 * years so year-on-year comparison has something to compare against, which can
 * be thousands of entries. Sending those to the browser to compute a few dozen
 * findings would be backwards.
 */

/** Two years, so the latest month has a same-month-last-year counterpart. */
const WINDOW_MONTHS = 24;

interface EmissionRow {
  id: string;
  site_id: string;
  scope: string;
  source_type: string;
  entry_date: string;
  quantity_normalized: number | null;
  unit_normalized: string | null;
  quantity: number;
  unit: string;
}

interface EhsRow {
  id: string;
  /** Null for entity-level metrics; those are excluded from site-based review. */
  site_id: string | null;
  metric_type: string;
  source_type: string;
  entry_date: string;
  quantity_normalized: number | null;
  unit_normalized: string | null;
  quantity: number;
  unit: string;
}

interface SiteRow {
  id: string;
  name: string;
  floor_area_sqft: number | null;
  business_unit_id: string | null;
  business_units: { name: string } | null;
}

/**
 * The normalized quantity is what makes entries comparable — an entry in
 * therms and one in MMBtu are the same stream only after normalization. Rows
 * without one are skipped rather than compared in mixed units, which would
 * manufacture variances that are pure unit confusion.
 */
function toObservation(
  row: { id: string; site_id: string; entry_date: string; quantity_normalized: number | null; unit_normalized: string | null },
  stream: string,
  streamLabel: string,
): Observation | null {
  if (row.quantity_normalized == null || !row.unit_normalized) return null;
  return {
    id: row.id,
    siteId: row.site_id,
    stream,
    streamLabel,
    entryDate: row.entry_date,
    quantity: Number(row.quantity_normalized),
    unit: row.unit_normalized,
  };
}

const SCOPE_LABEL: Record<string, string> = {
  scope1: 'Scope 1',
  scope2: 'Scope 2',
};

export async function buildAnomalyReport(
  scopeSiteIds: string[] | null,
  asOfMonth: string,
  config: AnomalyConfig = DEFAULT_ANOMALY_CONFIG,
): Promise<AnomalyReport> {
  const supabase = await createServerClient();

  const fromMonth = shiftMonth(asOfMonth, -(WINDOW_MONTHS - 1));
  const startDate = `${fromMonth}-01`;
  // Through the end of the as-of month; future-dated entries are caught by the
  // detector rather than filtered out, so the window deliberately runs wide.
  const endDate = `${shiftMonth(asOfMonth, 2)}-01`;

  const [{ data: sites }, { data: emissions }, { data: ehs }] = await Promise.all([
    applyScope(
      supabase
        .from('sites')
        .select('id, name, floor_area_sqft, business_unit_id, business_units(name)')
        .eq('is_active', true)
        .order('name'),
      scopeSiteIds,
      'id',
    ),
    // Paged — a 24-month window passes 1,000 entries quickly. See lib/fetch-all.ts.
    fetchAll((from, to) => applyScope(
      supabase
        .from('emission_entries')
        .select('id, site_id, scope, source_type, entry_date, quantity, unit, quantity_normalized, unit_normalized')
        .is('deleted_at', null)
        .gte('entry_date', startDate)
        .lt('entry_date', endDate),
      scopeSiteIds,
    ).order('id').range(from, to)),
    fetchAll((from, to) => applyScope(
      supabase
        .from('ehs_entries')
        .select('id, site_id, metric_type, source_type, entry_date, quantity, unit, quantity_normalized, unit_normalized')
        .is('deleted_at', null)
        .gte('entry_date', startDate)
        .lt('entry_date', endDate),
      scopeSiteIds,
    ).order('id').range(from, to)),
  ]);

  const siteMeta: SiteMeta[] = ((sites ?? []) as unknown as SiteRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    businessUnitId: s.business_unit_id,
    businessUnitName: s.business_units?.name ?? null,
    floorAreaSqft: s.floor_area_sqft,
  }));

  const observations: Observation[] = [];

  for (const row of ((emissions ?? []) as unknown as EmissionRow[])) {
    const label = `${sourceLabel(row.source_type)} (${SCOPE_LABEL[row.scope] ?? row.scope})`;
    const obs = toObservation(row, `${row.scope}:${row.source_type}`, label);
    if (obs) observations.push(obs);
  }

  for (const row of ((ehs ?? []) as unknown as EhsRow[])) {
    // Every check in this module is per-site: silent sites, cross-site
    // intensity, per-site cadence. An entity-level metric has no site to be
    // silent, and giving it a placeholder one would invent a finding. It is
    // excluded here rather than defaulted.
    if (!row.site_id) continue;
    const label = `${sourceLabel(row.source_type)} (${row.metric_type})`;
    const obs = toObservation({ ...row, site_id: row.site_id }, `${row.metric_type}:${row.source_type}`, label);
    if (obs) observations.push(obs);
  }

  return analyzeData(observations, siteMeta, asOfMonth, config);
}
