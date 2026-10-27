import { createServerClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { MetricsClient } from './MetricsClient';
import { resolveScope, applyScope } from '@/lib/scope-filter';
import { activeOrg } from '@/lib/active-org';
import { evidenceOrganizationId, loadEvidenceCounts } from '@/lib/evidence';

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; year?: string }>;
}) {
  const supabase = await createServerClient();
  const { scope: rawScope, year: rawYear } = await searchParams;
  const scope = await resolveScope(rawScope);

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from('users')
        .select('role, organization_id, active_organization_id, organizations!users_organization_id_fkey(reporting_year_start, intensity_metric_key), active_organization:organizations!users_active_organization_id_fkey(reporting_year_start, intensity_metric_key)')
        .eq('id', user.id)
        .single()
    : { data: null };

  const org = activeOrg(profile);
  const fyStart = org?.reporting_year_start ?? 1;

  const now = new Date();
  const defaultYear = now.getMonth() + 1 >= fyStart ? now.getFullYear() : now.getFullYear() - 1;
  const year = Number(rawYear) || defaultYear;

  const [{ data: definitions }, { data: values }, { data: sites }] = await Promise.all([
    supabase
      .from('business_metrics')
      .select('metric_key, label, description, unit, category, aggregation, is_denominator, display_order, organization_id')
      .eq('is_active', true)
      .order('display_order'),
    fetchAll((from, to) => supabase
      .from('business_metric_values')
      .select('id, metric_key, reporting_year, site_id, as_of_date, value, notes')
      .eq('reporting_year', year)
      .is('deleted_at', null)
      .order('as_of_date', { ascending: false }).order('id')
      .range(from, to)),
    applyScope(
      supabase.from('sites').select('id, name').eq('is_active', true).order('name'),
      scope.siteIds, 'id',
    ),
  ]);

  const evidenceCounts = await loadEvidenceCounts(
    'business_metric_value', (values ?? []).map((v) => v.id));

  return (
    <MetricsClient
      definitions={(definitions ?? []) as never}
      values={values ?? []}
      sites={sites ?? []}
      year={year}
      intensityMetricKey={org?.intensity_metric_key ?? null}
      // The ACTIVE organization: it scopes both new metric definitions and
      // evidence uploads, and RLS refuses the home id while in practice mode.
      organizationId={evidenceOrganizationId(profile)}
      evidenceCounts={evidenceCounts}
      userRole={profile?.role ?? 'viewer'}
    />
  );
}
