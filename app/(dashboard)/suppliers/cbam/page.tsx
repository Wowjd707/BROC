import { createServerClient } from '@/lib/supabase/server';
import { CBAMCalculatorClient } from './CBAMCalculatorClient';
import { evidenceOrganizationId } from '@/lib/evidence';

export default async function CBAMCalculatorPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userProfile } = await supabase
    .from('users')
    .select('organization_id, active_organization_id, role')
    .eq('id', user.id)
    .single();

  const userRole: string = userProfile?.role ?? 'viewer';
  // The ACTIVE organization: calculations and saved factors are inserted with
  // it, and RLS refuses the home id while the session is in practice mode.
  const orgId = evidenceOrganizationId(userProfile);
  if (!orgId) return null; // no readable profile; the layout explains why

  const [{ data: suppliers }, { data: savedFactors }, { data: calculations }] =
    await Promise.all([
      supabase
        .from('suppliers')
        .select('id, name, country')
        .order('name'),
      supabase
        .from('cbam_supplier_factors')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('cbam_calculations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

  return (
    <CBAMCalculatorClient
      userRole={userRole}
      organizationId={orgId}
      initialSuppliers={suppliers ?? []}
      initialSavedFactors={savedFactors ?? []}
      initialCalculations={calculations ?? []}
    />
  );
}
