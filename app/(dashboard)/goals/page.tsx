import { createServerClient } from '@/lib/supabase/server';
import { GoalsClient } from './GoalsClient';
import { loadEvidenceCounts } from '@/lib/evidence';
import { reportingYearRange } from '@/lib/utils';
import { summarisePipeline } from '@/lib/pipeline';
import { activeOrg } from '@/lib/active-org';

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

  const [{ data: goals }, { data: curEmissions }, { data: curEhs }, { data: projects }] = await Promise.all([
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
  ]);

  // Compute current year market-based and location-based totals
  const currentMarketKg = (curEmissions ?? []).reduce((sum, r) => {
    if (r.scope === 'scope1') return sum + r.co2e_kg;
    if (r.scope === 'scope2') return sum + r.co2e_kg;
    return sum;
  }, 0);
  const currentLocationKg = (curEmissions ?? []).reduce((sum, r) => {
    if (r.scope === 'scope1') return sum + r.co2e_kg;
    if (r.scope === 'scope2') return sum + (r.co2e_kg_location_based ?? r.co2e_kg);
    return sum;
  }, 0);

  // Water and waste totals in their canonical stored units (US gallons, kg) —
  // the same units goal baselines and targets are held in, so a goal and a
  // measured total are compared without a conversion step between them.
  const currentWaterGal = (curEhs ?? [])
    .filter((r) => r.metric_type === 'water')
    .reduce((sum, r) => sum + r.quantity_normalized, 0);
  const currentWasteKg = (curEhs ?? [])
    .filter((r) => r.metric_type === 'waste')
    .reduce((sum, r) => sum + r.quantity_normalized, 0);

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
      currentMarketKg={currentMarketKg}
      currentLocationKg={currentLocationKg}
      currentWaterGal={currentWaterGal}
      currentWasteKg={currentWasteKg}
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
