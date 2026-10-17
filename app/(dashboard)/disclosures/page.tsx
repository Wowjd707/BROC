import { createServerClient } from '@/lib/supabase/server';
import { getInventoryForYear, getProvenanceForYear } from '@/lib/disclosure-metrics';
import { pickGatingAssessment } from '@/lib/materiality-linkage-core';
import { getAiStatus } from '@/lib/ai';
import { reportingYearOptions, resolveReportingYear } from '@/lib/reporting-year-core';
import { DisclosuresClient } from './DisclosuresClient';
import { activeOrg } from '@/lib/active-org';
import { evidenceOrganizationId } from '@/lib/evidence';

export default async function DisclosuresPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const supabase = await createServerClient();
  const { year: rawYear } = await searchParams;
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
  const thisReportingYear = now.getMonth() + 1 >= fyStart ? now.getFullYear() : now.getFullYear() - 1;

  // Which years are worth offering: from the earliest entered data to now. One
  // cheap query rather than a hard-coded range, so a new organization is not
  // invited to file against a decade of empty years.
  const { data: earliest } = await supabase
    .from('emission_entries')
    .select('entry_date')
    .is('deleted_at', null)
    .order('entry_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  const availableYears = reportingYearOptions(
    thisReportingYear,
    (earliest?.entry_date as string | undefined) ?? null,
  );

  // A year in the URL is honoured only if it is one we offer. An arbitrary
  // ?year=1970 would otherwise render an empty inventory that looks like a bug.
  const curYear = resolveReportingYear(rawYear, availableYears, thisReportingYear);

  const [
    { data: frameworks, error: frameworksError },
    { data: requirements, error: requirementsError },
    { data: responses },
    { data: requirementTopics },
    { data: topics },
    { data: assessments },
  ] = await Promise.all([
    supabase.from('disclosure_frameworks').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('disclosure_requirements').select('*').order('framework_code').order('sort_order'),
    supabase.from('disclosure_responses').select('*').eq('reporting_year', curYear),
    supabase.from('requirement_topics').select('requirement_id, topic_code'),
    supabase.from('material_topics').select('*').order('sort_order'),
    supabase.from('materiality_assessments').select('*').eq('reporting_year', curYear),
  ]);

  // Surface read failures rather than rendering them as an empty page. An
  // empty framework list and a failed query look identical to the user
  // otherwise, which is exactly the confusion this avoids.
  const loadError = frameworksError?.message ?? requirementsError?.message ?? null;

  // The assessment that scopes THIS reporting year — never simply the latest
  // one, so a newer assessment cannot retroactively re-scope a filed year.
  const gatingAssessment = pickGatingAssessment(assessments ?? [], curYear);
  const aiStatus = getAiStatus();

  const { data: topicScores } = gatingAssessment
    ? await supabase.from('topic_assessments').select('*').eq('assessment_id', gatingAssessment.id)
    : { data: [] };

  const [inventory, provenance] = await Promise.all([
    getInventoryForYear(curYear, fyStart),
    getProvenanceForYear(curYear, fyStart),
  ]);

  return (
    <DisclosuresClient
      userRole={userRole}
      orgName={org?.name ?? 'Organization'}
      currentYear={curYear}
      availableYears={availableYears}
      frameworks={frameworks ?? []}
      requirements={requirements ?? []}
      initialResponses={responses ?? []}
      inventory={inventory}
      provenance={provenance}
      topics={topics ?? []}
      requirementTopics={requirementTopics ?? []}
      gatingAssessment={gatingAssessment}
      topicScores={topicScores ?? []}
      organizationId={evidenceOrganizationId(userProfile)}
      // Status only — the key never leaves the server.
      aiStatus={aiStatus.enabled ? aiStatus : null}
      loadError={loadError}
    />
  );
}
