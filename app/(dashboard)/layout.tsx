import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { SidebarLayout } from '@/components/layout/SidebarLayout';
import { ToastProvider } from '@/components/ui/toast';
import { UnitPreferencesProvider } from '@/components/layout/UnitPreferences';
import { SandboxBanner } from '@/components/layout/SandboxBanner';
import { getSandboxStatus } from '@/lib/sandbox';
import { activeOrg } from '@/lib/active-org';
import { NoProfileNotice } from '@/components/layout/NoProfileNotice';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch user profile + org
  const { data: userProfile } = await supabase
    .from('users')
    .select('*, organizations!users_organization_id_fkey(id, name, reporting_year_start), active_organization:organizations!users_active_organization_id_fkey(id, name, reporting_year_start)')
    .eq('id', user.id)
    .single();

  // No readable profile means a deactivated account (migration 037 resolves an
  // inactive profile to no organization, which also hides the row itself).
  // Say so, rather than render an application in which every query is empty.
  if (!userProfile) {
    return <NoProfileNotice email={user.email ?? null} />;
  }

  // Whether this session is pointed at the practice workspace. Read in the
  // layout so the banner cannot be missing from any page — a practice session
  // that looks like the live one on even one screen defeats the point.
  const sandbox = await getSandboxStatus();

  // Options for the reporting-scope picker
  const [{ data: sites }, { data: businessUnits }, { data: siteGroups }] = await Promise.all([
    supabase.from('sites')
      .select('id, name, site_type, city, state, business_unit_id')
      .eq('is_active', true).order('name'),
    supabase.from('business_units')
      .select('id, parent_id, name, sort_order')
      .eq('is_active', true).order('sort_order').order('name'),
    supabase.from('site_groups').select('id, name').order('name'),
  ]);

  return (
    <ToastProvider>
      <UnitPreferencesProvider>
        {sandbox.inSandbox && (
          <SandboxBanner
            homeOrgName={sandbox.homeOrgName}
            canReset={userProfile?.role === 'admin'}
          />
        )}
        <SidebarLayout
          userProfile={userProfile}
          sites={sites ?? []}
          businessUnits={businessUnits ?? []}
          siteGroups={siteGroups ?? []}
        >
          {children}
        </SidebarLayout>
      </UnitPreferencesProvider>
    </ToastProvider>
  );
}
