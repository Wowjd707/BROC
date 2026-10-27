import { createServerClient } from '@/lib/supabase/server';
import { GoalsClient } from './GoalsClient';
import { loadEvidenceCounts } from '@/lib/evidence';
import { reportingYearRange } from '@/lib/utils';
import { summarisePipeline } from '@/lib/pipeline';
import { activeOrg } from '@/lib/active-org';
import { fetchAll } from '@/lib/fetch-all';
import { goalMeasurement, type GoalMeasurement } from '@/lib/goal-period-core';
import { scopeTotals, type ScopeTotals } from '@/lib/goal-metrics';
import { boundaryMap, shareForEntry, type ConsolidationApproach } from '@/lib/consolidation-core';
import { waterWithdrawal } from '@/lib/water-core';

export default async function GoalsPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userProfile } = await supabase
    .from('users')
    .select('organization_id, role, organizations!users_organization_id_fkey(reporting_year_start, base_year, consolidation_approach), active_organization:organizations!users_active_organization_id_fkey(reporting_year_start, base_year, consolidation_approach)')
    .eq('id', user.id)
    .single();

  const org = activeOrg(userProfile);
  const fyStart: number = org?.reporting_year_start ?? 1;
  const orgBaseYear: number = org?.base_year ?? new Date().getFullYear() - 1;
  const userRole: string = userProfile?.role ?? 'viewer';

  const now = new Date();
  const curYear = now.getMonth() + 1 >= fyStart ? now.getFullYear() : now.getFullYear() - 1;
  const { startDate: curStart, endDate: curEnd } = reportingYearRange(curYear, fyStart);
  // Goals are judged on the latest COMPLETE reporting year — see
  // lib/goal-period-core.ts. The year to date is only a fallback.
  const completeYear = curYear - 1;
  const { startDate: prevStart, endDate: prevEnd } = reportingYearRange(completeYear, fyStart);

  const [
    { data: goals }, { data: curEmissions }, { data: curEhs }, { data: projects },
    { data: prevEmissions }, { data: prevEhs }, { data: sites },
  ] = await Promise.all([
    supabase
      .from('goals')
      .select('*')
      .order('created_at', { ascending: false }),
    fetchAll((from, to) => supabase
      .from('emission_entries')
      .select('scope, co2e_kg, co2e_kg_location_based, site_id')
      .gte('entry_date', curStart)
      .lte('entry_date', curEnd)
      .is('deleted_at', null).order('id').range(from, to)),
    fetchAll((from, to) => supabase
      .from('ehs_entries')
      .select('metric_type, source_type, quantity_normalized')
      .gte('entry_date', curStart)
      .lte('entry_date', curEnd)
      .is('deleted_at', null).order('id').range(from, to)),
    supabase
      .from('projects')
      .select('id, name, status, pipeline_inclusion_status, estimated_co2e_reduction_kg_per_year, actual_co2e_reduction_kg_per_year, estimated_water_reduction_gal_per_year, actual_water_reduction_gal_per_year, estimated_waste_reduction_kg_per_year, actual_waste_reduction_kg_per_year, start_date, completion_date')
      .in('status', ['approved', 'in_progress', 'completed']),
    fetchAll((from, to) => supabase
      .from('emission_entries')
      .select('scope, co2e_kg, co2e_kg_location_based, site_id')
      .gte('entry_date', prevStart)
      .lte('entry_date', prevEnd)
      .is('deleted_at', null).order('id').range(from, to)),
    fetchAll((from, to) => supabase
      .from('ehs_entries')
      .select('metric_type, source_type, quantity_normalized')
      .gte('entry_date', prevStart)
      .lte('entry_date', prevEnd)
      .is('deleted_at', null).order('id').range(from, to)),
    supabase.from('sites').select('id, ownership_percent, is_controlled'),
  ]);

  // The organizational boundary, applied exactly as the report and dashboard
  // apply it (lib/consolidation-core.ts).
  const approach = (org?.consolidation_approach ?? 'operational_control') as ConsolidationApproach;
  const boundaries = boundaryMap((sites ?? []).map((x) => ({
    id: x.id as string,
    ownership_percent: Number(x.ownership_percent ?? 100),
    is_controlled: x.is_controlled ?? true,
  })));
  const share = (siteId: string | null) => shareForEntry(siteId, boundaries, approach);

  type EhsRow = { metric_type: string; source_type: string | null; quantity_normalized: number };
  // Water and waste in their canonical stored units (US gallons, kg) — the
  // same units goal baselines and targets are held in. Water is withdrawal:
  // discharges are flows out, not use (lib/water-core.ts).
  const ehsTotal = (rows: EhsRow[] | null, metric: 'water' | 'waste'): number | null => {
    const m = (rows ?? []).filter((r) => r.metric_type === metric);
    if (m.length === 0) return null;
    return metric === 'water' ? waterWithdrawal(m) : m.reduce((sum, r) => sum + r.quantity_normalized, 0);
  };
  const measure = (complete: number | null, ytd: number | null): GoalMeasurement | null =>
    goalMeasurement(completeYear, complete, curYear, ytd);

  // Each GHG goal is measured on its own scope and Scope 2 method, so the
  // page passes the parts rather than one total. Which year they come from is
  // decided once, by whether the complete year has any Scope 1 or 2 data.
  const prevTotals = scopeTotals(prevEmissions, share);
  const curTotals = scopeTotals(curEmissions, share);
  const sum12 = (t: ScopeTotals | null) => (t ? t.scope1 + t.scope2Market : null);
  const ghg = measure(sum12(prevTotals), sum12(curTotals));
  const ghgTotals: ScopeTotals | null = ghg == null ? null : ghg.year === completeYear ? prevTotals : curTotals;
  const water = measure(ehsTotal(prevEhs, 'water'), ehsTotal(curEhs, 'water'));
  const waste = measure(ehsTotal(prevEhs, 'waste'), ehsTotal(curEhs, 'waste'));

  // Goal attainment is a question about run-rate at the target date, so the
  // annualised pipeline is what counts here — not the pro-rated current-year
  // figure the dashboard shows. One summary per metric: a water goal must be
  // compared against water savings, never against the carbon pipeline.
  const ghgPipeline   = summarisePipeline(projects ?? [], curYear, fyStart, { metric: 'ghg', completedAfter: prevEnd });
  const waterPipeline = summarisePipeline(projects ?? [], curYear, fyStart, { metric: 'water', completedAfter: prevEnd });
  const wastePipeline = summarisePipeline(projects ?? [], curYear, fyStart, { metric: 'waste', completedAfter: prevEnd });

  const evidenceCounts = await loadEvidenceCounts('goal', (goals ?? []).map((g) => g.id));

  return (
    <GoalsClient
      goals={goals ?? []}
      currentGhg={ghgTotals ?? { scope1: 0, scope2Market: 0, scope2Location: 0 }}
      currentWaterGal={water?.value ?? 0}
      currentWasteKg={waste?.value ?? 0}
      measuredIn={{ ghg, water, waste }}
      pipelineKg={ghgPipeline.annualisedValue}
      pipelineCurrentYearKg={ghgPipeline.currentYearValue}
      pipelineWaterGal={waterPipeline.annualisedValue}
      pipelineWasteKg={wastePipeline.annualisedValue}
      currentYear={curYear}
      orgBaseYear={orgBaseYear}
      userRole={userRole}
      evidenceCounts={evidenceCounts}
    />
  );
}
