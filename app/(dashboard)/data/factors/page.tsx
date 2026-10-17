import { createServerClient } from '@/lib/supabase/server';
import { evidenceOrganizationId, loadEvidenceCounts } from '@/lib/evidence';
import { FactorsClient } from './FactorsClient';

export default async function FactorsPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userProfile } = await supabase
    .from('users')
    .select('role, organization_id, active_organization_id')
    .eq('id', user.id)
    .single();

  const userRole: string = userProfile?.role ?? 'viewer';

  const [{ data: customFactors }, { data: sites }, { data: scope1Fuels }, { data: refrigerants }] =
    await Promise.all([
      supabase
        .from('custom_emission_factors')
        .select('*')
        .order('factor_category')
        .order('effective_from', { ascending: false }),
      supabase.from('sites').select('id, name').eq('is_active', true).order('name'),
      supabase.from('scope1_emission_factors').select('fuel_type, co2e_factor').order('fuel_type'),
      supabase
        .from('refrigerant_factors')
        .select('refrigerant_code, refrigerant_name, gwp_100_year')
        .order('refrigerant_code'),
    ]);

  const evidenceCounts = await loadEvidenceCounts(
    'custom_emission_factor', (customFactors ?? []).map((f) => f.id));

  return (
    <FactorsClient
      userRole={userRole}
      initialFactors={customFactors ?? []}
      sites={sites ?? []}
      scope1Fuels={scope1Fuels ?? []}
      refrigerants={refrigerants ?? []}
      organizationId={evidenceOrganizationId(userProfile)}
      evidenceCounts={evidenceCounts}
    />
  );
}
