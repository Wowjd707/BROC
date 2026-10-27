import { createServerClient } from '@/lib/supabase/server';
import { KpisClient } from './KpisClient';
import { reportingYearRange } from '@/lib/utils';
import { resolveScope, applyScope } from '@/lib/scope-filter';
import { activeOrg } from '@/lib/active-org';
import { fetchAll } from '@/lib/fetch-all';
import type { ConsolidationApproach } from '@/lib/consolidation-core';

export default async function KpisPage({
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

  const [
    { data: curEmissions },
    { data: priorEmissions },
    { data: curEhs },
    { data: priorEhs },
    { data: sites },
  ] = await Promise.all([
    fetchAll((from, to) => applyScope(supabase
      .from('emission_entries')
      .select('scope, co2e_kg, co2e_kg_location_based, accounting_method, source_type, site_id, entry_date, unit_normalized, quantity_normalized')
      .gte('entry_date', curStart)
      .lte('entry_date', curEnd)
      .is('deleted_at', null), scope.siteIds).order('id').range(from, to)),
    fetchAll((from, to) => applyScope(supabase
      .from('emission_entries')
      .select('scope, co2e_kg, co2e_kg_location_based, accounting_method, source_type, site_id, entry_date, unit_normalized, quantity_normalized')
      .gte('entry_date', priorStart)
      .lte('entry_date', priorEnd)
      .is('deleted_at', null), scope.siteIds).order('id').range(from, to)),
    fetchAll((from, to) => applyScope(supabase
      .from('ehs_entries')
      .select('metric_type, source_type, quantity_normalized, unit_normalized, site_id, entry_date')
      .gte('entry_date', curStart)
      .lte('entry_date', curEnd)
      .is('deleted_at', null), scope.siteIds).order('id').range(from, to)),
    fetchAll((from, to) => applyScope(supabase
      .from('ehs_entries')
      .select('metric_type, source_type, quantity_normalized, unit_normalized, site_id, entry_date')
      .gte('entry_date', priorStart)
      .lte('entry_date', priorEnd)
      .is('deleted_at', null), scope.siteIds).order('id').range(from, to)),
    applyScope(supabase
      .from('sites')
      .select('id, name, floor_area_sqft, ownership_percent, is_controlled')
      .eq('is_active', true), scope.siteIds, 'id'),
  ]);

  return (
    <KpisClient
      scopeLabel={scope.label}
      currentYear={curYear}
      priorYear={priorYear}
      fyStart={fyStart}
      curEmissions={curEmissions ?? []}
      priorEmissions={priorEmissions ?? []}
      curEhs={curEhs ?? []}
      priorEhs={priorEhs ?? []}
      sites={sites ?? []}
      consolidationApproach={(org?.consolidation_approach ?? 'operational_control') as ConsolidationApproach}
    />
  );
}
