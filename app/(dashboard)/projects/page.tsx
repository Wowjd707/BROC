import { createServerClient } from '@/lib/supabase/server';
import { ProjectsClient } from './ProjectsClient';
import { resolveScope } from '@/lib/scope-filter';
import { activeOrg } from '@/lib/active-org';
import { evidenceOrganizationId, loadEvidenceCounts } from '@/lib/evidence';

export default async function ProjectsPage({
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
    .select('organization_id, active_organization_id, role, organizations!users_organization_id_fkey(reporting_year_start), active_organization:organizations!users_active_organization_id_fkey(reporting_year_start)')
    .eq('id', user.id)
    .single();

  const userRole: string = userProfile?.role ?? 'viewer';
  const fyStart: number = activeOrg(userProfile)?.reporting_year_start ?? 1;
  const now = new Date();
  const curYear = now.getMonth() + 1 >= fyStart ? now.getFullYear() : now.getFullYear() - 1;

  // Projects are fetched unfiltered and scoped in the client, because a project
  // with no site is organization-wide: it belongs to every view, but must not
  // be counted into a single unit's pipeline. The client separates the two
  // rather than the query silently dropping or duplicating them.
  const [{ data: projects }, { data: sites }] = await Promise.all([
    supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false }),
    supabase
      .from('sites')
      .select('id, name')
      .eq('is_active', true),
  ]);

  // A claimed saving is a reported figure: the M&V report or engineering
  // estimate behind it belongs with it.
  const evidenceCounts = await loadEvidenceCounts('project', (projects ?? []).map((p) => p.id));

  return (
    <ProjectsClient
      initialProjects={projects ?? []}
      sites={sites ?? []}
      userRole={userRole}
      scopeSiteIds={scope.siteIds}
      scopeLabel={scope.label}
      currentYear={curYear}
      fyStart={fyStart}
      organizationId={evidenceOrganizationId(userProfile)}
      evidenceCounts={evidenceCounts}
    />
  );
}
