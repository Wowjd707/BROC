import { createServerClient } from '@/lib/supabase/server';
import { SettingsClient } from './SettingsClient';
import { SandboxEntryCard } from '@/components/layout/SandboxEntryCard';
import { getSandboxStatus } from '@/lib/sandbox';
import { activeOrg } from '@/lib/active-org';
import { evidenceOrganizationId, loadEvidenceCounts } from '@/lib/evidence';

export default async function SettingsPage() {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [
    { data: userProfile },
    { data: sites },
    { data: teamMembers },
    { data: businessUnits },
    { data: siteGroups },
    { data: groupMembers },
    { data: refrigerants },
    { data: denominators },
  ] = await Promise.all([
    supabase
      .from('users')
      .select('*, organizations!users_organization_id_fkey(*), active_organization:organizations!users_active_organization_id_fkey(*)')
      .eq('id', user.id)
      .single(),
    supabase
      .from('sites')
      .select('*')
      .order('name'),
    supabase
      .from('users')
      .select('*')
      .order('first_name'),
    supabase
      .from('business_units')
      .select('*')
      .order('sort_order')
      .order('name'),
    supabase
      .from('site_groups')
      .select('*')
      .order('name'),
    supabase
      .from('site_group_members')
      .select('group_id, site_id'),
    supabase
      .from('refrigerant_factors')
      .select('refrigerant_code, refrigerant_name')
      .order('refrigerant_code'),
    supabase
      .from('business_metrics')
      .select('metric_key, label, description, unit, category, aggregation, is_denominator, display_order, organization_id')
      .eq('is_active', true)
      .order('display_order'),
  ]);

  const sandbox = await getSandboxStatus();
  const siteEvidenceCounts = await loadEvidenceCounts('site', (sites ?? []).map((s) => s.id));

  return (
    <>
    <SettingsClient
      userProfile={userProfile}
      organization={activeOrg(userProfile)}
      sites={sites ?? []}
      teamMembers={teamMembers ?? []}
      currentUserId={user.id}
      businessUnits={businessUnits ?? []}
      siteGroups={siteGroups ?? []}
      groupMembers={groupMembers ?? []}
      refrigerants={refrigerants ?? []}
      denominators={(denominators ?? []) as never}
      evidenceOrganizationId={evidenceOrganizationId(userProfile)}
      siteEvidenceCounts={siteEvidenceCounts}
    />
    {/* Entering practice mode is a deliberate act, so the way in lives here
        rather than in the main nav — one mis-click from the sidebar and
        someone enters month-end figures into a sandbox. Hidden while already
        inside it; the banner is the way out. */}
    {!sandbox.inSandbox && (
      <div className="px-6 lg:px-8 pb-8">
        <SandboxEntryCard seeded={sandbox.seededAt !== null} />
      </div>
    )}
    </>
  );
}
