import { createServerClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { reportingYearRange } from '@/lib/utils';
import { getSupplierDataOverview } from '@/lib/supplier-data';
import { resolveScope, applyScope } from '@/lib/scope-filter';
import { evidenceOrganizationId, loadEvidenceCounts } from '@/lib/evidence';
import { Scope3Client } from './Scope3Client';
import { activeOrg } from '@/lib/active-org';

export default async function Scope3Page({
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
    .select('role, organization_id, active_organization_id, organizations!users_organization_id_fkey(reporting_year_start), active_organization:organizations!users_active_organization_id_fkey(reporting_year_start)')
    .eq('id', user.id)
    .single();

  const org = activeOrg(userProfile);
  const fyStart: number = org?.reporting_year_start ?? 1;
  const userRole: string = userProfile?.role ?? 'viewer';

  const now = new Date();
  const curYear = now.getMonth() + 1 >= fyStart ? now.getFullYear() : now.getFullYear() - 1;
  const { startDate, endDate } = reportingYearRange(curYear, fyStart);

  const [{ data: entries }, { data: categories }, { data: factors }, { data: suppliers }, { data: sites }] =
    await Promise.all([
      // Paged: the category totals are built from these rows. See lib/fetch-all.ts.
      fetchAll((from, to) => applyScope(supabase
        .from('scope3_entries')
        .select('*, suppliers(name), sites(name)')
        .gte('entry_date', startDate)
        .lte('entry_date', endDate)
        .is('deleted_at', null), scope.siteIds)
        .order('entry_date', { ascending: false }).order('id')
        .range(from, to)),
      supabase.from('scope3_categories').select('*').order('category_number'),
      supabase
        .from('scope3_factors')
        .select('*')
        .eq('is_active', true)
        .order('category_number')
        .order('activity_key'),
      supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
      supabase.from('sites').select('id, name').eq('is_active', true).order('name'),
    ]);

  const supplierData = await getSupplierDataOverview(curYear);

  const evidenceCounts = await loadEvidenceCounts('scope3_entry', (entries ?? []).map((e) => e.id));

  return (
    <Scope3Client
      organizationId={evidenceOrganizationId(userProfile)}
      evidenceCounts={evidenceCounts}
      userRole={userRole}
      scopeLabel={scope.label}
      currentYear={curYear}
      initialEntries={entries ?? []}
      categories={categories ?? []}
      factors={factors ?? []}
      suppliers={suppliers ?? []}
      sites={sites ?? []}
      declarations={supplierData.declarations}
      supplierScores={supplierData.scores}
    />
  );
}
