import { createServerClient } from '@/lib/supabase/server';
import { SocialClient } from './SocialClient';
import { resolveScope, applyScope } from '@/lib/scope-filter';
import { reportingYearRange } from '@/lib/utils';
import { activeOrg } from '@/lib/active-org';
import { fetchAll } from '@/lib/fetch-all';
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
  // The current REPORTING year by default, as every other page uses. The
  // calendar year opened an empty, not-yet-started year for anyone whose
  // fiscal year starts after January.
  const now = new Date();
  const currentReportingYear = now.getMonth() + 1 >= fyStart ? now.getFullYear() : now.getFullYear() - 1;
  const year = Number(rawYear) || currentReportingYear;
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
    // Every row, paged: the rates are computed from these. A `.limit(300)`
    // here meant a large organization's TRIR and turnover came from its
    // latest 300 entries only. The on-screen list is capped below instead.
    fetchAll((from, to) => supabase
      .from('ehs_entries')
      .select('id, site_id, entry_date, metric_type, source_type, quantity, unit, quantity_normalized, unit_normalized, notes, sites(name)')
      .in('metric_type', families)
      .gte('entry_date', startDate).lte('entry_date', endDate)
      .is('deleted_at', null)
      .order('entry_date', { ascending: false }).order('id')
      .range(from, to)),
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
  // The list shows the most recent entries; the figures above use all of them.
  const listed = visible.slice(0, 300);
  const evidenceCounts = await loadEvidenceCounts('ehs_entry', listed.map((e) => e.id));

  return (
    <SocialClient
      sites={sites ?? []}
      entries={listed}
      totalEntries={visible.length}
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
