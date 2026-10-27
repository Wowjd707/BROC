import { createServerClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { MaterialityClient } from './MaterialityClient';
import { activeOrg } from '@/lib/active-org';
import { evidenceOrganizationId, loadEvidenceCounts } from '@/lib/evidence';

export default async function MaterialityPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userProfile } = await supabase
    .from('users')
    .select('role, organization_id, active_organization_id, organizations!users_organization_id_fkey(reporting_year_start, name), active_organization:organizations!users_active_organization_id_fkey(reporting_year_start, name)')
    .eq('id', user.id)
    .single();

  const org = activeOrg(userProfile);
  const fyStart: number = org?.reporting_year_start ?? 1;
  const userRole: string = userProfile?.role ?? 'viewer';

  const now = new Date();
  const curYear = now.getMonth() + 1 >= fyStart ? now.getFullYear() : now.getFullYear() - 1;

  const [
    { data: topics },
    { data: assessments, error: assessmentsError },
    { data: requirementTopics },
  ] = await Promise.all([
    supabase.from('material_topics').select('*').order('sort_order'),
    supabase.from('materiality_assessments').select('*').order('reporting_year', { ascending: false }),
    // What each topic actually gates, so the assessment shows its consequences
    // rather than being a scoring exercise disconnected from the reports.
    // Paged — the full ESRS mapping passes 1,000 rows. See lib/fetch-all.ts.
    fetchAll((from, to) => supabase.from('requirement_topics').select('topic_code')
      .order('requirement_id').order('topic_code').range(from, to)),
  ]);

  const gatedByTopic: Record<string, number> = {};
  for (const row of requirementTopics ?? []) {
    gatedByTopic[row.topic_code] = (gatedByTopic[row.topic_code] ?? 0) + 1;
  }

  // Load the most recent assessment's detail, if one exists.
  const active = assessments?.[0] ?? null;
  const [{ data: topicScores }, { data: ratings }] = active
    ? await Promise.all([
        supabase.from('topic_assessments').select('*').eq('assessment_id', active.id),
        supabase.from('stakeholder_ratings').select('*').eq('assessment_id', active.id),
      ])
    : [{ data: [] }, { data: [] }];

  const evidenceCounts = active ? await loadEvidenceCounts('materiality_assessment', [active.id]) : {};

  return (
    <MaterialityClient
      userRole={userRole}
      orgName={org?.name ?? 'Organization'}
      currentYear={curYear}
      topics={topics ?? []}
      assessments={assessments ?? []}
      activeAssessment={active}
      topicScores={topicScores ?? []}
      stakeholderRatings={ratings ?? []}
      gatedByTopic={gatedByTopic}
      loadError={assessmentsError?.message ?? null}
      organizationId={evidenceOrganizationId(userProfile)}
      evidenceCount={active ? evidenceCounts[`materiality_assessment:${active.id}`] ?? 0 : 0}
    />
  );
}
