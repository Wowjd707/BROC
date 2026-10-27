import { createServerClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { GoalDetailClient } from './GoalDetailClient';
import { reportingYearRange } from '@/lib/utils';
import { summarisePipeline } from '@/lib/pipeline';
import { asGoalMetric, scopeTotals, goalGhgValue } from '@/lib/goal-metrics';
import { boundaryMap, shareForEntry, type ConsolidationApproach } from '@/lib/consolidation-core';
import { waterWithdrawal } from '@/lib/water-core';
import { activeOrg } from '@/lib/active-org';
import { fetchAll } from '@/lib/fetch-all';
import { goalMeasurement } from '@/lib/goal-period-core';
import { evidenceOrganizationId, loadEvidenceCounts } from '@/lib/evidence';

export default async function GoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // A Promise since Next 15; Next 16 removed the synchronous shim, so reading
  // `params.id` directly is undefined and every goal 404s.
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userProfile } = await supabase
    .from('users')
    .select('organization_id, active_organization_id, role, organizations!users_organization_id_fkey(reporting_year_start, consolidation_approach), active_organization:organizations!users_active_organization_id_fkey(reporting_year_start, consolidation_approach)')
    .eq('id', user.id)
    .single();

  const org = activeOrg(userProfile);
  const fyStart: number = org?.reporting_year_start ?? 1;
  const userRole: string = userProfile?.role ?? 'viewer';

  const { data: goal } = await supabase
    .from('goals')
    .select('*')
    .eq('id', id)
    .single();

  if (!goal) notFound();

  // Fetch yearly emission totals from base year to current
  const now = new Date();
  const curYear = now.getMonth() + 1 >= fyStart ? now.getFullYear() : now.getFullYear() - 1;

  // Which table the history comes from depends on the goal's metric. A water
  // goal charted against emission_entries would be a plausible-looking line
  // made of the wrong numbers, so the source is chosen once, here.
  const metric = asGoalMetric(goal.metric);

  // Same boundary as the report and the Goals page.
  const { data: sites } = await supabase.from('sites').select('id, ownership_percent, is_controlled');
  const approach = (org?.consolidation_approach ?? 'operational_control') as ConsolidationApproach;
  const boundaries = boundaryMap((sites ?? []).map((x) => ({
    id: x.id as string,
    ownership_percent: Number(x.ownership_percent ?? 100),
    is_controlled: x.is_controlled ?? true,
  })));
  const share = (siteId: string | null) => shareForEntry(siteId, boundaries, approach);

  const yearlyData: Array<{ year: number; actualValue: number | null }> = [];
  for (let y = goal.base_year; y <= curYear; y++) {
    const { startDate, endDate } = reportingYearRange(y, fyStart);

    if (metric === 'ghg') {
      const { data: emRows } = await fetchAll((from, to) => supabase
        .from('emission_entries')
        .select('scope, co2e_kg, co2e_kg_location_based, site_id')
        .gte('entry_date', startDate)
        .lte('entry_date', endDate)
        .is('deleted_at', null)
        .order('id')
        .range(from, to));

      // The goal's own scope, under its Scope 2 method, boundary-adjusted.
      const totals = scopeTotals(emRows, share);

      // null, not 0, for a year with no entries: a chart point at zero would
      // read as "we emitted nothing" rather than "we did not measure".
      yearlyData.push({
        year: y,
        actualValue: totals ? goalGhgValue(totals, goal.scope, goal.scope2_accounting_method ?? 'market_based') : null,
      });
    } else {
      const { data: ehsRows } = await fetchAll((from, to) => supabase
        .from('ehs_entries')
        .select('metric_type, source_type, quantity_normalized')
        .eq('metric_type', metric)
        .gte('entry_date', startDate)
        .lte('entry_date', endDate)
        .is('deleted_at', null)
        .order('id')
        .range(from, to));

      // Water is withdrawal; discharges are not use (lib/water-core.ts).
      const total = metric === 'water'
        ? waterWithdrawal(ehsRows ?? [])
        : (ehsRows ?? []).reduce((sum, r) => sum + r.quantity_normalized, 0);
      yearlyData.push({ year: y, actualValue: ehsRows && ehsRows.length > 0 ? total : null });
    }
  }

  // Pipeline from approved/in_progress projects, in the goal's own metric.
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, status, pipeline_inclusion_status, estimated_co2e_reduction_kg_per_year, actual_co2e_reduction_kg_per_year, estimated_water_reduction_gal_per_year, actual_water_reduction_gal_per_year, estimated_waste_reduction_kg_per_year, actual_waste_reduction_kg_per_year, start_date, completion_date')
    .in('status', ['approved', 'in_progress', 'completed']);

  // Projects completed after the latest complete year are not yet in any
  // measured figure, so they stay in the pipeline until one reflects them.
  const completedAfter = reportingYearRange(curYear - 1, fyStart).endDate;
  const pipelineValue = summarisePipeline(projects ?? [], curYear, fyStart, { metric, completedAfter }).annualisedValue;

  // Judged on the latest complete reporting year; the year in progress is a
  // fallback only when no complete year has data. See lib/goal-period-core.ts.
  const valueFor = (y: number) => yearlyData.find((d) => d.year === y)?.actualValue ?? null;
  const measurement = goalMeasurement(curYear - 1, valueFor(curYear - 1), curYear, valueFor(curYear));
  const currentValue = measurement?.value ?? 0;

  return (
    <GoalDetailClient
      goal={goal}
      yearlyData={yearlyData}
      currentYear={curYear}
      currentValue={currentValue}
      measurement={measurement}
      pipelineValue={pipelineValue}
      userRole={userRole}
      organizationId={evidenceOrganizationId(userProfile)}
      evidenceCount={(await loadEvidenceCounts('goal', [goal.id]))[`goal:${goal.id}`] ?? 0}
    />
  );
}
