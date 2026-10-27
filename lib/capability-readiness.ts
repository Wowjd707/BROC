import 'server-only';
import { createServerClient } from './supabase/server';
import { fetchAll } from './fetch-all';
import { reportingYearRange } from './utils';
import { getInventoryForYear } from './disclosure-metrics';
import { resolveMetric } from './disclosure-metrics-core';
import { isSocialGovernanceFamily } from './social-metrics-core';
import type { ReadinessFacts } from './capability-readiness-core';

/**
 * Gather every fact the capability probes need, in one pass.
 *
 * One bag of counts rather than a query per capability: there are 39 capability
 * rows across 21 regimes and several ask the same questions, so evaluating them
 * individually would be dozens of round trips to answer "how many sites have
 * data" over and over.
 *
 * Everything read here is already visible to the caller under RLS — this adds
 * no new access, it just counts what is there.
 */
export async function getReadinessFacts(
  year: number,
  fyStart: number,
): Promise<ReadinessFacts> {
  const supabase = await createServerClient();
  const { startDate, endDate } = reportingYearRange(year, fyStart);

  const [
    { data: sites },
    { data: emissionSites },
    { data: scope3Rows },
    { count: cbamCount },
    { data: surveys },
    { data: invitations },
    { count: supplierCount },
    { data: requirements },
    { data: responses },
    { data: assessments },
    { data: ehsRows },
    { data: evidenceRows },
    { count: entryCount },
    { data: goals },
  ] = await Promise.all([
    supabase.from('sites').select('id').eq('is_active', true),
    // List queries are paged (lib/fetch-all.ts): coverage measured on the first
    // 1,000 rows against an exact count reads as a gap that is not there.
    fetchAll((from, to) => supabase.from('emission_entries').select('site_id')
      .gte('entry_date', startDate).lte('entry_date', endDate).is('deleted_at', null)
      .order('id').range(from, to)),
    fetchAll((from, to) => supabase.from('scope3_entries').select('category_number')
      .gte('entry_date', startDate).lte('entry_date', endDate).is('deleted_at', null)
      .order('id').range(from, to)),
    supabase.from('cbam_calculations').select('id', { count: 'exact', head: true }),
    supabase.from('supplier_surveys').select('id, regulation_type'),
    fetchAll((from, to) => supabase.from('supplier_survey_invitations').select('survey_id, status')
      .order('id').range(from, to)),
    supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('is_active', true),
    fetchAll((from, to) => supabase.from('disclosure_requirements')
      .select('id, metric_key, disclosure_frameworks(code)')
      .order('id').range(from, to)),
    fetchAll((from, to) => supabase.from('disclosure_responses').select('requirement_id, status')
      .eq('reporting_year', year)
      .order('id').range(from, to)),
    supabase.from('materiality_assessments').select('id, status'),
    fetchAll((from, to) => supabase.from('ehs_entries').select('metric_type, source_type')
      .gte('entry_date', startDate).lte('entry_date', endDate).is('deleted_at', null)
      .order('id').range(from, to)),
    fetchAll((from, to) => supabase.from('evidence_attachments').select('record_id')
      .in('record_type', ['emission_entry', 'ehs_entry', 'scope3_entry'])
      .order('id').range(from, to)),
    supabase.from('emission_entries').select('id', { count: 'exact', head: true })
      .gte('entry_date', startDate).lte('entry_date', endDate).is('deleted_at', null),
    supabase.from('goals').select('metric, status').eq('status', 'active'),
  ]);

  // ── Site coverage ──────────────────────────────────────────────────────────
  const sitesWithData = new Set((emissionSites ?? []).map((e) => e.site_id));

  // ── Supplier questionnaires, by type ───────────────────────────────────────
  // The column is `regulation_type`, not `survey_type`. Lower-cased because the
  // seed data carries both 'CBAM' and 'cbam'.
  const surveyType = new Map<string, string>(
    (surveys ?? []).map((s) => [s.id as string, String(s.regulation_type ?? '').toLowerCase()]),
  );
  const surveysByType: Record<string, { sent: number; responded: number }> = {};
  for (const inv of invitations ?? []) {
    const type = surveyType.get(inv.survey_id as string);
    if (!type) continue;
    const bucket = (surveysByType[type] ??= { sent: 0, responded: 0 });
    // An invitation is only counted as sent once the mailer confirmed it — the
    // same honesty the suppliers page enforces. A 'pending' row is not a chase
    // the user has actually made.
    if (inv.status !== 'pending') bucket.sent += 1;
    if (inv.status === 'submitted') bucket.responded += 1;
  }

  // ── Framework coverage ─────────────────────────────────────────────────────
  // A requirement counts as covered when someone completed it, or when a linked
  // metric actually has data — the same two conditions the disclosures page
  // uses, so the two screens cannot disagree.
  const inventory = await getInventoryForYear(year, fyStart);
  const completed = new Set(
    (responses ?? []).filter((r) => r.status === 'complete').map((r) => r.requirement_id),
  );
  const frameworkCoverage: Record<string, { covered: number; total: number }> = {};
  for (const req of requirements ?? []) {
    const fw = (req as { disclosure_frameworks?: { code: string } | null }).disclosure_frameworks;
    const code = fw?.code;
    if (!code) continue;
    const bucket = (frameworkCoverage[code] ??= { covered: 0, total: 0 });
    bucket.total += 1;
    if (completed.has(req.id)) { bucket.covered += 1; continue; }
    if (req.metric_key) {
      const metric = resolveMetric(req.metric_key, inventory);
      if (metric && !metric.missing && metric.value != null) bucket.covered += 1;
    }
  }

  // ── EHS and social data presence ───────────────────────────────────────────
  const socialMetricsWithData = Array.from(new Set(
    (ehsRows ?? [])
      .filter((e) => isSocialGovernanceFamily(e.metric_type))
      .map((e) => `${e.metric_type}:${e.source_type}`),
  ));
  const ehsFamiliesWithData = Array.from(new Set(
    (ehsRows ?? [])
      .filter((e) => e.metric_type === 'water' || e.metric_type === 'waste')
      .map((e) => e.metric_type),
  ));

  // ── Goals ──────────────────────────────────────────────────────────────────
  const goalsByMetric: Record<string, number> = {};
  for (const g of goals ?? []) {
    const key = String(g.metric ?? 'ghg');
    goalsByMetric[key] = (goalsByMetric[key] ?? 0) + 1;
  }

  return {
    sitesTotal: (sites ?? []).length,
    sitesWithCurrentYearEmissions: sitesWithData.size,
    scope3CategoriesWithData: new Set((scope3Rows ?? []).map((r) => r.category_number)).size,
    cbamCalculations: cbamCount ?? 0,
    surveysByType,
    suppliersCount: supplierCount ?? 0,
    frameworkCoverage,
    materialityExists: (assessments ?? []).length > 0,
    materialityComplete: (assessments ?? []).some((a) => a.status === 'complete'),
    socialMetricsWithData,
    ehsFamiliesWithData,
    evidence: {
      withEvidence: new Set((evidenceRows ?? []).map((e) => e.record_id)).size,
      total: entryCount ?? 0,
    },
    goalsByMetric,
  };
}
