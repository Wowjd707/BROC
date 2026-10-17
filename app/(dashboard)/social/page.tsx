import { createServerClient } from '@/lib/supabase/server';
import { SocialClient } from './SocialClient';
import { resolveScope, applyScope } from '@/lib/scope-filter';
import { reportingYearRange } from '@/lib/utils';
import { activeOrg } from '@/lib/active-org';
import { evidenceOrganizationId, loadEvidenceCounts } from '@/lib/evidence';
import {
  SOCIAL_GOVERNANCE_METRICS, aggregateAll, inputsFromAggregates, deriveRates,
} from '@/lib/social-metrics-core';

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; year?: string }>;
}) {
  const supabase = await createServerClient();
  const { scope: rawScope, year: rawYear } = await searchParams;
  const scope = await resolveScope(rawScope);

  const { data: { user } } = await supabase.auth.getUser();
  const { data: userProfile } = user
    ? await supabase
        .from('users')
        .select('role, organization_id, active_organization_id, organizations!users_organization_id_fkey(reporting_year_start), active_organization:organizations!users_active_organization_id_fkey(reporting_year_start)')
        .eq('id', user.id)
        .single()
    : { data: null };

  const fyStart = activeOrg(userProfile)?.reporting_year_start ?? 1;
  const year = Number(rawYear) || new Date().getFullYear();
  const { startDate, endDate } = reportingYearRange(year, fyStart);

  const families = ['safety', 'workforce', 'training', 'governance'];

  const [{ data: sites }, { data: entries }, { data: catalog }] = await Promise.all([
    applyScope(
      supabase.from('sites').select('id, name').eq('is_active', true).order('name'),
      scope.siteIds, 'id',
    ),
    // Entity-level rows have a null site_id, so they can never satisfy a site
    // filter. They are fetched unscoped and merged below, because a governance
    // figure belongs to the organization rather than to any site in the scope.
    supabase
      .from('ehs_entries')
      .select('id, site_id, entry_date, metric_type, source_type, quantity, unit, quantity_normalized, unit_normalized, notes, sites(name)')
      .in('metric_type', families)
      .gte('entry_date', startDate).lte('entry_date', endDate)
      .is('deleted_at', null)
      .order('entry_date', { ascending: false })
      .limit(300),
    supabase
      .from('sustainability_metrics')
      .select('metric_type, source_type, label, description, canonical_unit, aggregation, pillar, framework_reference, display_order')
      .in('pillar', ['social', 'governance'])
      .eq('is_active', true)
      .order('display_order'),
  ]);

  const allEntries = entries ?? [];

  // Site-scoped rows respect the sidebar scope; entity-level rows never do.
  const inScopeSiteIds = scope.siteIds;
  const visible = allEntries.filter((e) =>
    e.site_id === null || inScopeSiteIds === null || inScopeSiteIds.includes(e.site_id),
  );

  const aggregates = aggregateAll(
    visible.map((e) => ({
      metricType: e.metric_type,
      sourceType: e.source_type,
      entryDate: e.entry_date,
      quantityNormalized: e.quantity_normalized,
      siteId: e.site_id,
    })),
  );
  const rates = deriveRates(inputsFromAggregates(aggregates), 200_000);

  // Social and governance figures live in ehs_entries, which has always been
  // attachable — this page simply never offered it. A headcount or a recordable
  // count is as much a reported figure as a fuel invoice.
  const evidenceCounts = await loadEvidenceCounts('ehs_entry', visible.map((e) => e.id));

  return (
    <SocialClient
      sites={sites ?? []}
      entries={visible}
      catalog={catalog ?? []}
      fallbackCatalog={SOCIAL_GOVERNANCE_METRICS}
      rates={rates}
      aggregates={Array.from(aggregates.entries())}
      year={year}
      periodLabel={`${startDate} to ${endDate}`}
      userRole={userProfile?.role ?? 'viewer'}
      organizationId={evidenceOrganizationId(userProfile)}
      evidenceCounts={evidenceCounts}
      scopeIsFiltered={inScopeSiteIds !== null}
    />
  );
}
