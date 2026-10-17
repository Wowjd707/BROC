import { createServerClient } from '@/lib/supabase/server';
import { resolveScope } from '@/lib/scope-filter';
import { buildAnomalyReport } from '@/lib/anomaly';
import { DataReviewClient } from './DataReviewClient';
import { activeOrg } from '@/lib/active-org';

export default async function DataReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; asOf?: string }>;
}) {
  const supabase = await createServerClient();
  const { scope: rawScope, asOf } = await searchParams;
  const scope = await resolveScope(rawScope);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userProfile } = await supabase
    .from('users')
    .select('organizations!users_organization_id_fkey(reporting_year_start), active_organization:organizations!users_active_organization_id_fkey(reporting_year_start)')
    .eq('id', user.id)
    .single();

  const org = activeOrg(userProfile);
  const fyStart: number = org?.reporting_year_start ?? 1;

  // Default to the last COMPLETE month. Reviewing the current month would
  // report every site as behind simply because the month is still running.
  const now = new Date();
  const lastComplete = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultMonth = `${lastComplete.getFullYear()}-${String(lastComplete.getMonth() + 1).padStart(2, '0')}`;
  const asOfMonth = /^\d{4}-\d{2}$/.test(asOf ?? '') ? asOf! : defaultMonth;

  const report = await buildAnomalyReport(scope.siteIds, asOfMonth);

  return (
    <DataReviewClient
      report={report}
      scopeLabel={scope.label}
      asOfMonth={asOfMonth}
      fyStart={fyStart}
    />
  );
}
