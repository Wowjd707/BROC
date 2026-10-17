import { createServerClient } from '@/lib/supabase/server';
import { DataEntryClient } from './DataEntryClient';
import { resolveScope, applyScope } from '@/lib/scope-filter';
import { evidenceOrganizationId, loadEvidenceCountsFor } from '@/lib/evidence';

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const supabase = await createServerClient();
  const { scope: rawScope } = await searchParams;
  const scope = await resolveScope(rawScope);

  const { data: { user } } = await supabase.auth.getUser();
  const { data: userProfile } = user
    ? await supabase.from('users').select('role, organization_id, active_organization_id').eq('id', user.id).single()
    : { data: null };

  const [{ data: sites }, { data: emissions }, { data: ehsEntries }, { data: refrigerants }] = await Promise.all([
    applyScope(supabase.from('sites').select('id, name, city, state, zip_code').eq('is_active', true).order('name'), scope.siteIds, 'id'),
    applyScope(supabase.from('emission_entries')
      .select('*, sites(name)')
      .is('deleted_at', null)
      .order('entry_date', { ascending: false })
      .limit(200), scope.siteIds),
    applyScope(supabase.from('ehs_entries')
      .select('*, sites(name)')
      .is('deleted_at', null)
      .order('entry_date', { ascending: false })
      .limit(200), scope.siteIds),
    supabase.from('refrigerant_factors')
      .select('refrigerant_code, refrigerant_name, gwp_100_year')
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
