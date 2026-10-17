import { createServerClient } from '@/lib/supabase/server';
import { DashboardClient } from './DashboardClient';
import { reportingYearRange } from '@/lib/utils';
import { resolveScope, applyScope } from '@/lib/scope-filter';
import { activeOrg } from '@/lib/active-org';
import type { ConsolidationApproach } from '@/lib/consolidation-core';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const supabase = await createServerClient();
  const { scope: rawScope } = await searchParams;
  const scope = await resolveScope(rawScope);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userProfile } = await supabase
    .from('users')
    .select('organization_id, organizations!users_organization_id_fkey(reporting_year_start, name, consolidation_approach), active_organization:organizations!users_active_organization_id_fkey(reporting_year_start, name, consolidation_approach)')
    .eq('id', user.id)
    .single();

  const org = activeOrg(userProfile);
  const fyStart: number = org?.reporting_year_start ?? 1;

  const now = new Date();
  const curYear = now.getMonth() + 1 >= fyStart ? now.getFullYear() : now.getFullYear() - 1;
  const priorYear = curYear - 1;

  const { startDate: curStart, endDate: curEnd } = reportingYearRange(curYear, fyStart);
  const { startDate: priorStart, endDate: priorEnd } = reportingYearRange(priorYear, fyStart);

  // Fetch all data in parallel
  const [
    { data: curEmissions },
    { data: priorEmissions },
    { data: curEhs },
    { data: priorEhs },
    { data: sites },
    { data: goals },
    { data: projects },
    { data: surveys },
    { data: regulatoryMilestones },
    { data: invitations },
    { data: curScope3 },
    { data: priorScope3 },
  ] = await Promise.all([
    applyScope(supabase.from('emission_entries').select('scope, scope1_category, co2e_kg, co2e_kg_location_based, accounting_method, source_type, site_id, entry_date, unit_normalized, quantity_normalized')
      .gte('entry_date', curStart).lte('entry_date', curEnd).is('deleted_at', null), scope.siteIds),
    applyScope(supabase.from('emission_entries').select('scope, co2e_kg, accounting_method, site_id, entry_date')
      .gte('entry_date', priorStart).lte('entry_date', priorEnd).is('deleted_at', null), scope.siteIds),
    applyScope(supabase.from('ehs_entries').select('metric_type, source_type, quantity_normalized, unit_normalized, site_id, entry_date')
      .gte('entry_date', curStart).lte('entry_date', curEnd).is('deleted_at', null), scope.siteIds),
    applyScope(supabase.from('ehs_entries').select('metric_type, quantity_normalized')
      .gte('entry_date', priorStart).lte('entry_date', priorEnd).is('deleted_at', null), scope.siteIds),
    applyScope(supabase.from('sites').select('id, name, floor_area_sqft, ownership_percent, is_controlled').eq('is_active', true), scope.siteIds, 'id'),
    // Every active goal, not just the first: the dashboard now shows progress
    // across all of them, and a single-goal LIMIT silently hid the rest.
    supabase.from('goals').select('*').eq('status', 'active').order('target_year'),
    supabase.from('projects')
      .select('id, name, status, pipeline_inclusion_status, estimated_co2e_reduction_kg_per_year, actual_co2e_reduction_kg_per_year, estimated_water_reduction_gal_per_year, actual_water_reduction_gal_per_year, estimated_waste_reduction_kg_per_year, actual_waste_reduction_kg_per_year, start_date, completion_date')
      .neq('status', 'cancelled'),
    supabase.from('supplier_surveys').select('id').eq('status', 'active'),
    // Reference data, so deliberately unscoped: a CBAM deadline is not a
    // property of any business unit the sidebar can filter to.
    supabase.from('regulatory_items')
      .select('code, name, next_milestone, next_milestone_date, stage')
      .eq('is_active', true)
      .not('next_milestone_date', 'is', null)
      .gte('next_milestone_date', new Date().toISOString().slice(0, 10))
      .order('next_milestone_date')
      .limit(4),
    supabase.from('supplier_survey_invitations').select('id, status, survey_id'),
    applyScope(supabase.from('scope3_entries').select('category_number, co2e_kg, data_quality')
      .gte('entry_date', curStart).lte('entry_date', curEnd).is('deleted_at', null), scope.siteIds),
    applyScope(supabase.from('scope3_entries').select('category_number, co2e_kg, data_quality')
      .gte('entry_date', priorStart).lte('entry_date', priorEnd).is('deleted_at', null), scope.siteIds),
  ]);

  return (
    <DashboardClient
      // Not a made-up name: organizations.name is NOT NULL, so a missing value
      // here means the embed or the profile did not resolve. See SidebarLayout.
      orgName={org?.name ?? 'Organization unavailable'}
      scopeLabel={scope.label}
      // Goals and projects are organization-wide records — `goals` has no
      // site column at all — so they cannot be scope-filtered. The client
      // needs to know a filter is active so it does not compare an
      // org-wide baseline against one business unit's current emissions.
      scopeIsFiltered={scope.siteIds !== null}
      // The same organizational boundary the report applies. Passed rather
      // than recomputed so the dashboard and the filed figures cannot drift.
      consolidationApproach={(org?.consolidation_approach ?? 'operational_control') as ConsolidationApproach}
      currentYear={curYear}
      priorYear={priorYear}
      fyStart={fyStart}
      curEmissions={curEmissions ?? []}
      priorEmissions={priorEmissions ?? []}
      curEhs={curEhs ?? []}
      priorEhs={priorEhs ?? []}
      sites={sites ?? []}
      goals={goals ?? []}
      projects={projects ?? []}
      activeSurveys={surveys ?? []}
      regulatoryMilestones={regulatoryMilestones ?? []}
      invitations={invitations ?? []}
      curScope3={curScope3 ?? []}
      priorScope3={priorScope3 ?? []}
    />
  );
}
