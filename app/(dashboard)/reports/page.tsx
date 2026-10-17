import { createServerClient } from '@/lib/supabase/server';
import { ReportsClient } from './ReportsClient';
import { resolveScope } from '@/lib/scope-filter';
import { activeOrg } from '@/lib/active-org';

export default async function ReportsPage({
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
    .select('organization_id, role, organizations!users_organization_id_fkey(reporting_year_start, name), active_organization:organizations!users_active_organization_id_fkey(reporting_year_start, name)')
    .eq('id', user.id)
    .single();

  const org = activeOrg(userProfile);
  const fyStart: number = org?.reporting_year_start ?? 1;

  const now = new Date();
  const curYear = now.getMonth() + 1 >= fyStart ? now.getFullYear() : now.getFullYear() - 1;

  // Provide years dropdown for the past 5 years
  const availableYears = Array.from({ length: 5 }, (_, i) => curYear - i);



  return (
    <ReportsClient
      availableYears={availableYears}
      currentYear={curYear}
      fyStart={fyStart}
      orgName={org?.name ?? 'Organization'}
      sites={scope.sites}
      scopeSiteIds={scope.siteIds}
      scopeLabel={scope.label}
    />
  );
}
