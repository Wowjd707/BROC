import { createServerClient } from '@/lib/supabase/server';
import { GoalsClient } from './GoalsClient';
import { loadEvidenceCounts } from '@/lib/evidence';
import { reportingYearRange } from '@/lib/utils';
import { summarisePipeline } from '@/lib/pipeline';
import { activeOrg } from '@/lib/active-org';
import { goalMeasurement, type GoalMeasurement } from '@/lib/goal-period-core';

export default async function GoalsPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userProfile } = await supabase
    .from('users')
    .select('organization_id, role, organizations!users_organization_id_fkey(reporting_year_start, base_year), active_organization:organizations!users_active_organization_id_fkey(reporting_year_start, base_year)')
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
    { data: prevEmissions }, { data: prevEhs },
  ] = await Promise.all([
    supabase
      .from('goals')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('emission_entries')
      .select('scope, co2e_kg, co2e_kg_location_based, accounting_method')
      .gte('entry_date', curStart)
      .lte('entry_date', curEnd)
      .is('deleted_at', null),
    supabase
      .from('ehs_entries')
      .select('metric_type, quantity_normalized')
      .gte('entry_date', curStart)
      .lte('entry_date', curEnd)
      .is('deleted_at', null),
    supabase
      .from('projects')
      .select('id, name, status, pipeline_inclusion_status, estimated_co2e_reduction_kg_per_year, actual_co2e_reduction_kg_per_year, estimated_water_reduction_gal_per_year, actual_water_reduction_gal_per_year, estimated_waste_reduction_kg_per_year, actual_waste_reduction_kg_per_year, start_date, completion_date')
      .in('status', ['approved', 'in_progress', 'completed']),
    supabase
      .from('emission_entries')
      .select('scope, co2e_kg, co2e_kg_location_based, accounting_method')
      .gte('entry_date', prevStart)
      .lte('entry_date', prevEnd)
      .is('deleted_at', null),
    supabase
      .from('ehs_entries')
      .select('metric_type, quantity_normalized')
      .gte('entry_date', prevStart)
      .lte('entry_date', prevEnd)
      .is('deleted_at', null),
  ]);

  type EmRow = { scope: string; co2e_kg: number; co2e_kg_location_based: number | null };
  type EhsRow = { metric_type: string; quantity_normalized: number };
  /** Scope 1 + 2 total, or null when the year has no Scope 1/2 entries. */
  const ghgTotal = (rows: EmRow[] | null, method: 'market' | 'location'): number | null => {
    const s12 = (rows ?? []).filter((r) => r.scope === 'scope1' || r.scope === 'scope2');
    if (s12.length === 0) return null;
    return s12.reduce((sum, r) => sum + (r.scope === 'scope2' && method === 'location'
      ? (r.co2e_kg_location_based ?? r.co2e_kg)
      : r.co2e_kg), 0);
  };
  // Water and waste in their canonical stored units (US gallons, kg) — the
  // same units goal baselines and targets are held in.
  const ehsTotal = (rows: EhsRow[] | null, metric: string): number | null => {
    const m = (rows ?? []).filter((r) => r.metric_type === metric);
    return m.length === 0 ? null : m.reduce((sum, r) => sum + r.quantity_normalized, 0);
  };
  const measure = (complete: number | null, ytd: number | null): GoalMeasurement | null =>
    goalMeasurement(completeYear, complete, curYear, ytd);

  const ghgMarket   = measure(ghgTotal(prevEmissions, 'market'), ghgTotal(curEmissions, 'market'));
  const ghgLocation = measure(ghgTotal(prevEmissions, 'location'), ghgTotal(curEmissions, 'location'));
  const water       = measure(ehsTotal(prevEhs, 'water'), ehsTotal(curEhs, 'water'));
  const waste       = measure(ehsTotal(prevEhs, 'waste'), ehsTotal(curEhs, 'waste'));

  // Goal attainment is a question about run-rate at the target date, so the
  // annualised pipeline is what counts here — not the pro-rated current-year
  // figure the dashboard shows. One summary per metric: a water goal must be
  // compared against water savings, never against the carbon pipeline.
  const ghgPipeline   = summarisePipeline(projects ?? [], curYear, fyStart, { metric: 'ghg' });
  const waterPipeline = summarisePipeline(projects ?? [], curYear, fyStart, { metric: 'water' });
  const wastePipeline = summarisePipeline(projects ?? [], curYear, fyStart, { metric: 'waste' });

  const evidenceCounts = await loadEvidenceCounts('goal', (goals ?? []).map((g) => g.id));

  return (
    <GoalsClient
      goals={goals ?? []}
      currentMarketKg={ghgMarket?.value ?? 0}
      currentLocationKg={ghgLocation?.value ?? 0}
      currentWaterGal={water?.value ?? 0}
      currentWasteKg={waste?.value ?? 0}
      measuredIn={{ ghg: ghgMarket, water, waste }}
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
