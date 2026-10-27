import 'server-only';
import { asGoalMetric } from './goal-metrics';
import { createServerClient } from './supabase/server';
import { reportingYearRange } from './utils';
import { totalsByCategory } from './scope3';
import type { InventoryInput } from './disclosure-metrics-core';
import {
  isSocialGovernanceFamily,
  aggregateAll,
  inputsFromAggregates,
} from './social-metrics-core';
import {
  boundaryMap, shareForEntry, describeBoundaryEffect, summariseDataQuality,
  type ConsolidationApproach,
} from './consolidation-core';
import { resolveDenominator } from './business-metrics-core';

export * from './disclosure-metrics-core';

export interface ProvenanceSummary {
  factorSources: string[];
  dataQualityMix: { primary: number; secondary: number; estimated: number };
  scope3CategoriesWithData: number;
}

/**
 * Every distinct emission-factor source that fed the reporting year, plus the
 * Scope 3 data-quality mix. This backs the report's basis-of-preparation
 * appendix — a report whose figures cannot be traced to their factors is not
 * assurable, so this is gathered for every report, not on request.
 */
export async function getProvenanceForYear(
  year: number,
  fyStart: number,
): Promise<ProvenanceSummary> {
  const supabase = await createServerClient();
  const { startDate, endDate } = reportingYearRange(year, fyStart);

  const [{ data: emissions }, { data: scope3 }] = await Promise.all([
    supabase
      .from('emission_entries')
      .select('emission_factor_source')
      .gte('entry_date', startDate).lte('entry_date', endDate).is('deleted_at', null),
    supabase
      .from('scope3_entries')
      .select('factor_source, category_number, co2e_kg, data_quality')
      .gte('entry_date', startDate).lte('entry_date', endDate).is('deleted_at', null),
  ]);

  const sources = new Set<string>();
  for (const e of emissions ?? []) {
    if (e.emission_factor_source) sources.add(e.emission_factor_source);
  }
  for (const s of scope3 ?? []) {
    if (s.factor_source) sources.add(s.factor_source);
  }

  const mix = { primary: 0, secondary: 0, estimated: 0 };
  const categories = new Set<number>();
  for (const s of scope3 ?? []) {
    categories.add(s.category_number);
    if (s.data_quality === 'primary') mix.primary += s.co2e_kg;
    else if (s.data_quality === 'estimated') mix.estimated += s.co2e_kg;
    else mix.secondary += s.co2e_kg;
  }

  return {
    factorSources: Array.from(sources).sort(),
    dataQualityMix: mix,
    scope3CategoriesWithData: categories.size,
  };
}

/**
 * Assemble the reporting-year inventory that framework disclosures draw on.
 * One query pass feeds every framework — that is the point of the mapping
 * layer: TCFD, IFRS S2, ESRS E1 and GRI 305 all read the same numbers.
 */
export async function getInventoryForYear(
  year: number,
  fyStart: number,
): Promise<InventoryInput> {
  const supabase = await createServerClient();
  const { startDate, endDate } = reportingYearRange(year, fyStart);

  const [{ data: emissions }, { data: scope3 }, { data: ehs }, { data: sites }, { data: goals },
    { data: org }, { data: metricDefs }, { data: metricValues }] =
    await Promise.all([
      supabase
        .from('emission_entries')
        .select('scope, co2e_kg, co2e_kg_location_based, source_type, quantity_normalized, unit_normalized, site_id, data_quality')
        .gte('entry_date', startDate).lte('entry_date', endDate).is('deleted_at', null),
      supabase
        .from('scope3_entries')
        .select('category_number, co2e_kg')
        .gte('entry_date', startDate).lte('entry_date', endDate).is('deleted_at', null),
      supabase
        .from('ehs_entries')
        // source_type and entry_date are needed as well as the quantity: the
        // social families hold several metrics in different units under one
        // metric_type, and headcount is aggregated by latest reading rather
        // than summed. Selecting only (metric_type, quantity_normalized) here
        // would make both of those impossible to get right.
        .select('metric_type, source_type, entry_date, quantity_normalized, site_id')
        .gte('entry_date', startDate).lte('entry_date', endDate).is('deleted_at', null),
      supabase.from('sites').select('id, floor_area_sqft, ownership_percent, is_controlled').eq('is_active', true),
      supabase.from('goals').select('name, metric, target_year, target_reduction_pct, status'),
      supabase.from('organizations').select('consolidation_approach, intensity_metric_key').limit(1).maybeSingle(),
      supabase.from('business_metrics')
        .select('metric_key, label, description, unit, category, aggregation, is_denominator, display_order, organization_id')
        .eq('is_active', true),
      supabase.from('business_metric_values')
        .select('metric_key, reporting_year, site_id, as_of_date, value')
        .eq('reporting_year', year).is('deleted_at', null),
    ]);

  const rows = emissions ?? [];

  // ── Organizational boundary ────────────────────────────────────────────────
  // Every Scope 1 and 2 figure below is multiplied by the site's consolidation
  // share, so a 50% joint venture contributes half under equity share and
  // nothing under a control approach it falls outside. The defaults (operational
  // control, 100% owned, controlled) make every share exactly 1, so no existing
  // deployment's numbers move until somebody records an ownership stake.
  //
  // Scope 3 is deliberately NOT adjusted. The GHG Protocol expects value-chain
  // accounting to be consistent with the chosen boundary, but Scope 3 entries
  // here are frequently organization-level with no site to attribute a share
  // to, and applying the factor to only the site-bearing subset would produce a
  // total belonging to neither boundary. It is reported on the full operational
  // boundary and the basis of preparation says so.
  const approach = (org?.consolidation_approach ?? 'operational_control') as ConsolidationApproach;
  const boundarySites = (sites ?? []).map((x) => ({
    id: x.id as string,
    ownership_percent: Number(x.ownership_percent ?? 100),
    is_controlled: x.is_controlled ?? true,
  }));
  const boundaries = boundaryMap(boundarySites);
  const share = (siteId: string | null) => shareForEntry(siteId, boundaries, approach);

  const scope1Kg = rows
    .filter((e) => e.scope === 'scope1')
    .reduce((s, e) => s + e.co2e_kg * share(e.site_id), 0);
  const scope2LocationKg = rows
    .filter((e) => e.scope === 'scope2')
    .reduce((s, e) => s + (e.co2e_kg_location_based ?? e.co2e_kg) * share(e.site_id), 0);
  const scope2MarketKg = rows
    .filter((e) => e.scope === 'scope2')
    .reduce((s, e) => s + e.co2e_kg * share(e.site_id), 0);

  // Electricity is stored normalized to kWh; combustion to MMBtu. Only kWh rows
  // are summed here so the reported energy figure stays in one honest unit.
  const energyKwh = rows
    .filter((e) => e.unit_normalized === 'kWh')
    .reduce((s, e) => s + e.quantity_normalized * share(e.site_id), 0);

  const scope3Rows = (scope3 ?? []).map((r) => ({
    category_number: r.category_number,
    co2e_kg: r.co2e_kg,
  }));
  const scope3Kg = scope3Rows.reduce((s, r) => s + r.co2e_kg, 0);
  const scope3ByCategory = totalsByCategory(scope3Rows).map((t) => ({
    categoryNumber: t.categoryNumber,
    name: t.name,
    co2eKg: t.co2eKg,
  }));

  const waterGallons = (ehs ?? [])
    .filter((e) => e.metric_type === 'water')
    .reduce((s, e) => s + e.quantity_normalized, 0);
  const wasteKg = (ehs ?? [])
    .filter((e) => e.metric_type === 'waste')
    .reduce((s, e) => s + e.quantity_normalized, 0);

  // Social and governance: aggregated per metric under each metric's own rule,
  // never summed across a whole family. Water and waste keep their simple
  // family sums above because each of those IS a single metric in a single
  // unit; 'safety' is not.
  const socialReadings = (ehs ?? [])
    .filter((e) => isSocialGovernanceFamily(e.metric_type))
    .map((e) => ({
      metricType: e.metric_type,
      sourceType: e.source_type,
      entryDate: e.entry_date,
      quantityNormalized: e.quantity_normalized,
      siteId: e.site_id,
    }));
  const social = inputsFromAggregates(aggregateAll(socialReadings));

  const floorArea = (sites ?? []).reduce((s, x) => s + (x.floor_area_sqft ?? 0), 0);
  const missingFloorArea = (sites ?? []).filter(
    (x) => x.floor_area_sqft === null || x.floor_area_sqft === 0,
  ).length;

  // ── Intensity denominator ──────────────────────────────────────────────────
  // Whatever the organization actually measures itself by — revenue, FTE,
  // tonnes produced — falling back to floor area when nothing has been chosen,
  // which is what every deployment before migration 027 was doing implicitly.
  const denominator = resolveDenominator(
    org?.intensity_metric_key ?? null,
    (metricDefs ?? []) as never,
    (metricValues ?? []) as never,
    floorArea,
  );

  // The floor-area completeness caveat applies only when floor area is what is
  // being divided by. A revenue denominator does not care that a warehouse has
  // no square footage recorded.
  const denominatorMissingSites = denominator.isFallback ? missingFloorArea : 0;

  const dataQuality = summariseDataQuality(
    rows.map((e) => ({ data_quality: e.data_quality, co2e_kg: e.co2e_kg * share(e.site_id) })),
  );
  const boundaryEffect = describeBoundaryEffect(boundarySites, approach);

  return {
    scope1Kg,
    scope2LocationKg,
    scope2MarketKg,
    scope3Kg,
    scope3ByCategory,
    energyKwh,
    waterGallons,
    wasteKg,
    intensityDenominator: denominator.value,
    intensityDenominatorUnit: denominator.unit,
    intensityDenominatorLabel: denominator.label,
    intensityDenominatorMissingSites: denominatorMissingSites,
    dataQuality,
    consolidation: {
      approach,
      partialSiteCount: boundaryEffect.partialSites.length,
      excludedSiteCount: boundaryEffect.excludedSites.length,
    },
    social,
    // OSHA's 200,000. Made explicit rather than defaulted silently, because
    // GRI 403-9 requires the reporter to state the basis and a report cannot
    // state what the platform never decided.
    hoursBasis: 200_000,
    // Climate targets only: a water or waste goal answering ESRS E1-4 or the
    // TCFD targets disclosure is a misstatement. And a reduction percentage or
    // nothing — target_value is an absolute amount in kg or gallons, and
    // falling back to it printed "30,283 % reduction".
    targets: (goals ?? [])
      .filter((g) => g.status === 'active' && asGoalMetric(g.metric) === 'ghg')
      .map((g) => ({
        name: g.name,
        targetYear: g.target_year,
        targetReductionPct: g.target_reduction_pct ?? null,
        status: g.status,
      })),
  };
}
