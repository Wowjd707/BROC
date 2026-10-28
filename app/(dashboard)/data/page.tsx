import { createServerClient } from '@/lib/supabase/server';
import { DataEntryClient } from './DataEntryClient';
import { resolveScope, applyScope } from '@/lib/scope-filter';
import { evidenceOrganizationId, loadEvidenceCountsFor } from '@/lib/evidence';

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; from?: string; to?: string }>;
}) {
  const supabase = await createServerClient();
  const { scope: rawScope, from: rawFrom, to: rawTo } = await searchParams;
  const scope = await resolveScope(rawScope);

  // The date range is applied in the query, not in the browser. Filtering in
  // the browser searched only the latest 200 rows, so a range in last year
  // came back empty while the entries existed.
  const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const dateFrom = isDate(rawFrom) ? rawFrom : null;
  const dateTo = isDate(rawTo) ? rawTo : null;
  const rowLimit = dateFrom || dateTo ? 1000 : 200;
  const inRange = <Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q): Q => {
    let out = q;
    if (dateFrom) out = out.gte('entry_date', dateFrom);
    if (dateTo) out = out.lte('entry_date', dateTo);
    return out;
  };

  const { data: { user } } = await supabase.auth.getUser();
  const { data: userProfile } = user
    ? await supabase.from('users').select('role, organization_id, active_organization_id').eq('id', user.id).single()
    : { data: null };

  const [{ data: sites }, { data: emissions }, { data: ehsEntries }, { data: refrigerants }] = await Promise.all([
    applyScope(supabase.from('sites').select('id, name, city, state, zip_code, country').eq('is_active', true).order('name'), scope.siteIds, 'id'),
    applyScope(inRange(supabase.from('emission_entries')
      .select('*, sites(name)')
      .is('deleted_at', null))
      .order('entry_date', { ascending: false })
      .limit(rowLimit), scope.siteIds),
    // Water and waste only: this page lists those two. Social and governance
    // rows share the table and were using up the 200-row window.
    applyScope(inRange(supabase.from('ehs_entries')
      .select('*, sites(name)')
      .in('metric_type', ['water', 'waste'])
      .is('deleted_at', null))
      .order('entry_date', { ascending: false })
      .limit(rowLimit), scope.siteIds),
    supabase.from('refrigerant_factors')
      .select('refrigerant_code, refrigerant_name, gwp_100_year, is_montreal_protocol')
      .order('refrigerant_code'),
  ]);

  // Attachment counts for exactly the rows on screen. RLS scopes this to the
  // caller's organization.
  const evidenceCounts = await loadEvidenceCountsFor([
    { recordType: 'emission_entry', ids: (emissions ?? []).map((e) => e.id) },
    { recordType: 'ehs_entry', ids: (ehsEntries ?? []).map((e) => e.id) },
  ]);

  return (
    <DataEntryClient
      // Remount on a new range so the lists start from the new rows.
      key={`${dateFrom ?? ''}|${dateTo ?? ''}`}
      dateFrom={dateFrom}
      dateTo={dateTo}
      rowLimit={rowLimit}
      sites={sites ?? []}
      initialEmissions={emissions ?? []}
      initialEhsEntries={ehsEntries ?? []}
      refrigerantFactors={refrigerants ?? []}
      organizationId={evidenceOrganizationId(userProfile)}
      userRole={userProfile?.role ?? 'viewer'}
      initialEvidenceCounts={evidenceCounts}
    />
  );
}
