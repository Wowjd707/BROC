'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtFigure } from '@/lib/utils';
import {
  resolveMetric, requirementState, coveragePercent,
  type InventoryInput, type RequirementState,
} from '@/lib/disclosure-metrics-core';
import {
  concludeTopics, statusByTopic, requirementApplicability, linksByRequirement, summariseScope,
  type ApplicabilityResult,
} from '@/lib/materiality-linkage-core';
import type { TopicAssessmentInput, Score } from '@/lib/materiality-core';
import { DEFAULT_THRESHOLD } from '@/lib/materiality-core';
import type {
  DisclosureFramework, DisclosureRequirement, DisclosureResponse,
  MaterialTopic, MaterialityAssessment, RequirementTopic, TopicAssessment,
} from '@/lib/supabase/types';
import {
  buildReportModel, renderReportHtml,
  type ProvenanceInput, type MaterialityScope,
} from '@/lib/report-builder';
import { EvidencePanel } from '@/components/evidence/EvidencePanel';
import { RequirementImportDialog } from './RequirementImportDialog';
import {
  ChevronDown, ChevronRight, Database, FileText, Download, Upload, Scale, AlertTriangle, Sparkles,
} from 'lucide-react';
import { ReportingYearSelect } from '@/components/layout/ReportingYearSelect';

interface Props {
  userRole: string;
  orgName: string;
  currentYear: number;
  /** Selectable reporting years, newest first. */
  availableYears: number[];
  frameworks: DisclosureFramework[];
  requirements: DisclosureRequirement[];
  initialResponses: DisclosureResponse[];
  inventory: InventoryInput;
  provenance: ProvenanceInput;
  topics: MaterialTopic[];
  requirementTopics: Pick<RequirementTopic, 'requirement_id' | 'topic_code'>[];
  /** The assessment scoping this reporting year, or null if there is none. */
  gatingAssessment: MaterialityAssessment | null;
  topicScores: TopicAssessment[];
  organizationId: string | null;
  /** Null when no AI provider is configured — every affordance then hides. */
  aiStatus: { enabled: boolean; providerId: string | null; model: string | null } | null;
  loadError: string | null;
}

const STATE_META: Record<RequirementState, { label: string; badge: 'default' | 'blue' | 'warning' | 'secondary' }> = {
  satisfied_by_data:   { label: 'From platform data', badge: 'default' },
  answered:            { label: 'Complete',           badge: 'default' },
  in_progress:         { label: 'In progress',        badge: 'warning' },
  not_material:        { label: 'Not material',       badge: 'secondary' },
  excluded_immaterial: { label: 'Outside material scope', badge: 'secondary' },
  outstanding:         { label: 'Outstanding',        badge: 'blue' },
};

/** Group requirement rows under their section heading, preserving order. */
function groupSections<T extends { req: { section: string | null } }>(rows: T[]): [string, T[]][] {
  const bySection = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.req.section ?? 'Other';
    bySection.set(key, [...(bySection.get(key) ?? []), row]);
  }
  return Array.from(bySection.entries());
}

export function DisclosuresClient({
  userRole, orgName, currentYear, availableYears, frameworks, requirements, initialResponses, inventory, provenance,
  topics, requirementTopics, gatingAssessment, topicScores, organizationId, aiStatus, loadError,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const canEdit = userRole === 'admin' || userRole === 'editor';

  const [activeFramework, setActiveFramework] = useState(frameworks[0]?.code ?? '');
  const [responses, setResponses] = useState<DisclosureResponse[]>(initialResponses);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reqImportOpen, setReqImportOpen] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // AI drafting. `aiWarning` holds the grounding check's findings for the
  // current draft and is cleared the moment the user edits, since the check
  // described the model's text and not theirs.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiWarning, setAiWarning] = useState<string | null>(null);
  const [aiAttribution, setAiAttribution] = useState<string | null>(null);

  async function draftWithAi(requirementId: string) {
    setAiBusy(true);
    setAiError('');
    setAiWarning(null);

    try {
      const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requirementId,
          reportingYear: currentYear,
          existingNarrative: draft,
        }),
      });
      const payload = await res.json();

      if (!res.ok) {
        setAiError(payload.error ?? 'Could not generate a draft.');
        return;
      }

      // Replaces the editor contents, never the saved record — the user still
      // has to review and save through the normal path.
      setDraft(payload.draft);
      setAiWarning(payload.warning ?? null);
      setAiAttribution(`${payload.provider} · ${payload.model}`);
      if (payload.factCount === 0) {
        setAiWarning(
          'The platform holds no data for this requirement, so every figure in this draft is unsupported. ' +
          (payload.warning ?? ''),
        );
      }
    } catch {
      setAiError('Could not reach the drafting service.');
    } finally {
      setAiBusy(false);
    }
  }

  const responseByReq = useMemo(
    () => new Map(responses.map(r => [r.requirement_id, r])),
    [responses],
  );

  // ─── Materiality scoping ───────────────────────────────────────────────────
  const threshold = gatingAssessment?.threshold ?? DEFAULT_THRESHOLD;

  const topicConclusions = useMemo(() => {
    const inputs: TopicAssessmentInput[] = topicScores.map(s => ({
      topicCode: s.topic_code,
      impact: {
        scale: s.impact_scale as Score,
        scope: s.impact_scope as Score,
        irremediability: s.impact_irremediability as Score,
        likelihood: s.impact_likelihood as Score,
        isActual: s.impact_is_actual,
        isNegative: s.impact_is_negative,
      },
      financial: {
        magnitude: s.financial_magnitude as Score,
        likelihood: s.financial_likelihood as Score,
      },
    }));
    return concludeTopics(topics.map(t => t.code), inputs, threshold);
  }, [topics, topicScores, threshold]);

  const topicStatuses = useMemo(() => statusByTopic(topicConclusions), [topicConclusions]);
  const topicLinks = useMemo(() => linksByRequirement(requirementTopics), [requirementTopics]);

  const applicabilityByReq = useMemo(() => {
    const map = new Map<string, ApplicabilityResult>();
    for (const req of requirements) {
      map.set(
        req.id,
        requirementApplicability(topicLinks.get(req.id) ?? [], topicStatuses, gatingAssessment != null),
      );
    }
    return map;
  }, [requirements, topicLinks, topicStatuses, gatingAssessment]);

  const frameworkReqs = useMemo(
    () => requirements.filter(r => r.framework_code === activeFramework),
    [requirements, activeFramework],
  );

  /** State + resolved metric + materiality scope for every requirement shown. */
  const rows = useMemo(() => frameworkReqs.map(req => {
    const metric = req.metric_key ? resolveMetric(req.metric_key, inventory) : null;
    const response = responseByReq.get(req.id);
    const applicability = applicabilityByReq.get(req.id);
    const excluded = applicability?.applicability === 'excluded_immaterial';
    return {
      req, metric, response, applicability,
      state: requirementState(req, response, metric, !excluded),
    };
  }), [frameworkReqs, inventory, responseByReq, applicabilityByReq]);

  // Coverage per framework, for the selector
  const coverageByFramework = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of frameworks) {
      const states = requirements
        .filter(r => r.framework_code === f.code)
        .map(req => {
          const metric = req.metric_key ? resolveMetric(req.metric_key, inventory) : null;
          const excluded = applicabilityByReq.get(req.id)?.applicability === 'excluded_immaterial';
          return requirementState(req, responseByReq.get(req.id), metric, !excluded);
        });
      map.set(f.code, coveragePercent(states));
    }
    return map;
  }, [frameworks, requirements, inventory, responseByReq, applicabilityByReq]);

  /**
   * Scope of the ACTIVE framework. `isGated` is a property of the framework,
   * not of the organization: TCFD and the California statutes carry no topic
   * links and are never scoped by an ESRS assessment, so they must not show a
   * materiality banner at all.
   */
  const scope = useMemo(() => {
    const isGated = frameworkReqs.some(r => (topicLinks.get(r.id) ?? []).length > 0);
    return summariseScope(
      rows.map(r => r.applicability).filter((a): a is ApplicabilityResult => a != null),
      isGated,
    );
  }, [frameworkReqs, topicLinks, rows]);

  const excludedRows = useMemo(
    () => rows.filter(r => r.state === 'excluded_immaterial'),
    [rows],
  );

  // Excluded requirements are hidden by default but never dropped from the
  // data — they are listed on request, and always named in the report.
  const sections = useMemo(
    () => groupSections(showExcluded ? rows : rows.filter(r => r.state !== 'excluded_immaterial')),
    [rows, showExcluded],
  );

  const framework = frameworks.find(f => f.code === activeFramework);
  const coverage = coverageByFramework.get(activeFramework) ?? 0;
  const topicName = (code: string) => topics.find(t => t.code === code)?.name ?? code;
  const materialTopicCount = topicConclusions.filter(c => c.status === 'material').length;

  /** Assemble and download the report for the active framework. */
  function exportReport() {
    if (!framework) return;

    // Only a framework that is actually topic-linked, in a year that has an
    // assessment, gets a scope statement. Attaching one to TCFD would assert a
    // scoping the standard does not apply.
    const materialityScope: MaterialityScope | null =
      scope.isGated && gatingAssessment
        ? {
            assessmentName: gatingAssessment.name,
            assessmentYear: gatingAssessment.reporting_year,
            threshold,
            status: gatingAssessment.status,
            methodology: gatingAssessment.methodology,
            topics: topicConclusions.map(c => ({
              code: c.topicCode,
              name: topicName(c.topicCode),
              status: c.status,
              impactScore: c.impactScore,
              financialScore: c.financialScore,
            })),
            omitted: excludedRows.map(({ req, applicability }) => ({
              code: req.requirement_code,
              title: req.title,
              topics: applicability?.immaterialTopics ?? [],
            })),
            undeterminedTopics: scope.unassessedTopics,
          }
        : null;

    const model = buildReportModel({
      orgName,
      reportingYear: currentYear,
      generatedAt: new Date().toISOString().slice(0, 10),
      framework: {
        code: framework.code,
        name: framework.name,
        issuer: framework.issuer,
        version: framework.version,
        sourceRef: framework.source_ref,
      },
      coverage,
      inventorySummary: [
        { label: 'Scope 1 (direct)', value: inventory.scope1Kg / 1000, unit: 'tCO₂e' },
        { label: 'Scope 2 (location-based)', value: inventory.scope2LocationKg / 1000, unit: 'tCO₂e' },
        { label: 'Scope 2 (market-based)', value: inventory.scope2MarketKg / 1000, unit: 'tCO₂e' },
        {
          label: 'Scope 3 (value chain)',
          value: inventory.scope3Kg / 1000,
          unit: 'tCO₂e',
          note: `across ${provenance.scope3CategoriesWithData} of 15 categories`,
        },
        {
          label: 'Total (Scope 1 + 2 location-based + 3)',
          value: (inventory.scope1Kg + inventory.scope2LocationKg + inventory.scope3Kg) / 1000,
          unit: 'tCO₂e',
        },
        { label: 'Energy consumption', value: inventory.energyKwh, unit: 'kWh' },
        { label: 'Water consumption', value: inventory.waterGallons, unit: 'gallons' },
        { label: 'Waste generated', value: inventory.wasteKg, unit: 'kg' },
      ],
      // Built from `rows`, not from the on-screen `sections`: what the report
      // contains must not depend on whether a UI toggle happened to be open.
      // Excluded requirements are named in the scope statement instead.
      sections: groupSections(rows.filter(r => r.state !== 'excluded_immaterial'))
        .map(([heading, sectionRows]) => ({
          heading,
          requirements: sectionRows.map(({ req, metric, response, state }) => ({
            code: req.requirement_code,
            title: req.title,
            description: req.description,
            narrative: response?.narrative ?? null,
            metric,
            state,
          })),
        })),
      provenance,
      materialityScope,
    });

    const html = renderReportHtml(model);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${orgName.replace(/[^\w-]+/g, '_')}_${framework.code}_${currentYear}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openRow(reqId: string, existing: string | null) {
    setExpanded(expanded === reqId ? null : reqId);
    setDraft(existing ?? '');
    setAiError('');
    setAiWarning(null);
    setAiAttribution(null);
  }

  async function save(reqId: string, status: string) {
    if (!canEdit) return;
    setSaving(true);

    const payload = {
      requirement_id: reqId,
      reporting_year: currentYear,
      narrative: draft.trim() || null,
      status,
    };

    const { data, error } = await supabase
      .from('disclosure_responses')
      .upsert(payload, { onConflict: 'organization_id,requirement_id,reporting_year' })
      .select()
      .single();

    setSaving(false);
    if (error) return;

    setResponses(prev => {
      const others = prev.filter(r => r.requirement_id !== reqId);
      return [...others, data as DisclosureResponse];
    });
    setExpanded(null);
    router.refresh();
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Disclosures</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            The same inventory, mapped to each framework&apos;s requirements. Metrics are answered
            automatically from platform data; narrative disclosures are authored here. FY {currentYear} · {orgName}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ReportingYearSelect value={currentYear} years={availableYears} />
          {userRole === 'admin' && (
            <Button onClick={() => setReqImportOpen(true)} variant="outline">
              <Upload size={14} className="mr-1.5" />
              Import requirements
            </Button>
          )}
          {framework && (
            <Button onClick={exportReport} variant="outline">
              <Download size={14} className="mr-1.5" />
              Export {framework.code.replace(/_/g, ' ')} report
            </Button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4">
          <p className="text-sm font-medium text-red-800 mb-1">Could not load the framework catalog</p>
          <p className="text-sm text-red-700 font-mono">{loadError}</p>
        </div>
      )}

      {!loadError && frameworks.length === 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
          <p className="font-medium mb-1">No frameworks available</p>
          <p>
            The query succeeded but returned no rows. If <code>disclosure_frameworks</code> has rows
            when queried in the SQL editor, the table almost certainly has row-level security enabled
            with no read policy — RLS with no policy returns zero rows without raising an error.
            Applying migration <code>013_reference_table_rls.sql</code> fixes it.
          </p>
        </div>
      )}

      {/* Framework selector */}
      <div className="flex gap-2 flex-wrap">
        {frameworks.map(f => {
          const cov = coverageByFramework.get(f.code) ?? 0;
          const active = f.code === activeFramework;
          return (
            <button
              key={f.code}
              onClick={() => { setActiveFramework(f.code); setExpanded(null); }}
              className={`px-4 py-2.5 rounded-lg border text-left transition-colors ${
                active ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className={`text-sm font-medium ${active ? 'text-emerald-800' : 'text-gray-900'}`}>
                {f.code.replace(/_/g, ' ')}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{cov.toFixed(0)}% covered</div>
            </button>
          );
        })}
      </div>

      {framework && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{framework.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {framework.issuer}{framework.version ? ` · ${framework.version}` : ''}
                </p>
                {framework.description && (
                  <p className="text-sm text-gray-600 mt-2 max-w-3xl">{framework.description}</p>
                )}
                <p className="text-[11px] text-gray-400 mt-2">Source: {framework.source_ref}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-3xl font-semibold text-gray-900">{coverage.toFixed(0)}%</p>
                <p className="text-xs text-gray-500">coverage</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${coverage}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Materiality scoping — only for frameworks whose requirements are
          topic-linked. TCFD, IFRS S2, GRI and the California statutes are not
          scoped by an ESRS assessment and show nothing here. */}
      {scope.isGated && (
        gatingAssessment ? (
          <Card>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                    <Scale size={14} className="text-emerald-600" />
                    Scoped by your double materiality assessment
                  </p>
                  <p className="text-xs text-gray-500 mt-1 max-w-2xl">
                    <Link href="/materiality" className="text-emerald-700 hover:underline">
                      {gatingAssessment.name}
                    </Link>{' '}
                    · threshold {threshold} / 5 · {gatingAssessment.status.replace('_', ' ')} ·{' '}
                    {materialTopicCount} of {topics.length} ESRS topics material.
                    Requirements mapped only to topics you assessed as not material are excluded
                    here and listed as explicit omissions in the exported report.
                  </p>
                </div>
                <div className="flex items-center gap-4 shrink-0 text-right">
                  <div>
                    <p className="text-xl font-semibold text-gray-900">{scope.required + scope.undetermined}</p>
                    <p className="text-[11px] text-gray-500">required</p>
                  </div>
                  <div>
                    <p className="text-xl font-semibold text-gray-400">{scope.excluded}</p>
                    <p className="text-[11px] text-gray-500">excluded</p>
                  </div>
                </div>
              </div>

              {scope.undetermined > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-900 flex items-start gap-1.5">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    {scope.undetermined} requirement{scope.undetermined === 1 ? '' : 's'} map to topics
                    you have not assessed yet ({scope.unassessedTopics.map(topicName).join(', ')}), so
                    they are still required. Not assessing a topic is not the same as concluding it is
                    immaterial — finish the assessment to scope them out.
                  </span>
                </div>
              )}

              {scope.excluded > 0 && (
                <button
                  onClick={() => setShowExcluded(v => !v)}
                  className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2"
                >
                  {showExcluded ? 'Hide' : 'Show'} {scope.excluded} excluded requirement
                  {scope.excluded === 1 ? '' : 's'}
                </button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
            <p className="font-medium mb-1">No FY {currentYear} double materiality assessment</p>
            <p className="text-xs">
              Every topic of this framework is shown as required. Under CSRD the assessment decides
              which topical standards you must report at all, so nothing is scoped out until it
              exists — an unfinished assessment must never shrink an obligation.{' '}
              <Link href="/materiality" className="font-medium underline underline-offset-2">
                Start the {currentYear} assessment
              </Link>.
            </p>
          </div>
        )
      )}

      {/* Requirements grouped by section */}
      <div className="space-y-6">
        {sections.map(([section, sectionRows]) => (
          <div key={section}>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">{section}</h2>
            <Card>
              <CardContent className="p-0 divide-y divide-gray-50">
                {sectionRows.map(({ req, metric, response, state, applicability }) => {
                  const meta = STATE_META[state];
                  const isOpen = expanded === req.id;
                  const excluded = state === 'excluded_immaterial';
                  return (
                    <div key={req.id} className={excluded ? 'bg-gray-50/60' : undefined}>
                      <button
                        onClick={() => openRow(req.id, response?.narrative ?? null)}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50/50 flex items-start gap-3"
                      >
                        <span className="mt-0.5 text-gray-400 shrink-0">
                          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-gray-400">{req.requirement_code}</span>
                            <Badge variant={meta.badge}>{meta.label}</Badge>
                            {req.metric_key && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                                {/* The metric's name, not its database key ("ghg_all_scopes"). */}
                                <Database size={11} />{metric?.label ?? 'Platform metric'}
                              </span>
                            )}
                          </span>
                          <span className={`block text-sm mt-1 ${excluded ? 'text-gray-500' : 'text-gray-900'}`}>
                            {req.title}
                          </span>

                          {/* Why the materiality assessment scoped this in or out */}
                          {excluded && (
                            <span className="block mt-1 text-xs text-gray-500">
                              Assessed not material: {applicability?.immaterialTopics.map(topicName).join(', ')}.
                              Retained in the catalog and listed as an omission in the report.
                            </span>
                          )}
                          {applicability?.applicability === 'undetermined' && (
                            <span className="block mt-1 text-xs text-amber-700">
                              Required until {applicability.unassessedTopics.map(topicName).join(', ')} is assessed.
                            </span>
                          )}

                          {/* Auto-answered metric value */}
                          {metric && !metric.missing && metric.value != null && (
                            <span className="block mt-1.5 text-sm">
                              <span className="font-semibold text-emerald-700">
                                {fmtFigure(metric.value, metric.unit)}
                              </span>
                              {metric.breakdown && metric.breakdown.length > 0 && (
                                <span className="block text-xs text-gray-500 mt-0.5">
                                  {metric.breakdown.map(b => `${b.label}: ${fmtFigure(b.value, b.unit)}`).join(' · ')}
                                </span>
                              )}
                            </span>
                          )}
                          {metric?.missing && (
                            <span className="block mt-1 text-xs text-amber-700">
                              No platform data for this metric yet.
                            </span>
                          )}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="px-4 pb-4 pl-12 space-y-3">
                          {req.description && <p className="text-xs text-gray-500">{req.description}</p>}

                          {/* Evidence hangs off the response row, which does not
                              exist until something is saved — so this appears
                              once there is a response to attach it to. */}
                          {response && organizationId ? (
                            <div className="rounded-lg border border-gray-100 p-3">
                              <p className="text-xs font-medium text-gray-700 mb-2">Supporting evidence</p>
                              <EvidencePanel
                                recordType="disclosure_response"
                                recordId={response.id}
                                organizationId={organizationId}
                                canEdit={canEdit}
                              />
                            </div>
                          ) : (
                            canEdit && (
                              <p className="text-xs text-gray-400">
                                Save a draft to attach supporting evidence to this disclosure.
                              </p>
                            )
                          )}
                          <Textarea
                            value={draft}
                            onChange={(e) => {
                              setDraft(e.target.value);
                              // The check described the model's text; once the
                              // user edits, it no longer describes what is here.
                              setAiWarning(null);
                            }}
                            rows={6}
                            placeholder={
                              req.response_type === 'metric'
                                ? 'Optional commentary on the reported figure…'
                                : 'Write the disclosure narrative for this requirement…'
                            }
                            disabled={!canEdit}
                          />

                          {canEdit && aiStatus?.enabled && (
                            <div className="space-y-2">
                              <div className="flex items-center gap-3 flex-wrap">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={aiBusy}
                                  onClick={() => draftWithAi(req.id)}
                                >
                                  <Sparkles size={14} className="mr-1.5" />
                                  {aiBusy ? 'Drafting…' : draft.trim() ? 'Redraft with AI' : 'Draft with AI'}
                                </Button>
                                <span className="text-[11px] text-gray-400">
                                  {aiAttribution ?? `${aiStatus.providerId} · ${aiStatus.model}`}
                                  {' · drafts only, nothing is saved until you save it'}
                                </span>
                              </div>

                              {/* The grounding check. Worded as a prompt to
                                  verify: it cannot tell a fabricated figure
                                  from a correctly derived one, and claiming
                                  otherwise would be false assurance. */}
                              {aiWarning && (
                                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2">
                                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
                                  <p className="text-xs text-amber-900">{aiWarning}</p>
                                </div>
                              )}

                              {aiError && <p className="text-xs text-red-600">{aiError}</p>}
                            </div>
                          )}
                          {canEdit && (
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button size="sm" onClick={() => save(req.id, 'complete')} disabled={saving}>
                                {saving ? 'Saving…' : 'Mark complete'}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => save(req.id, 'in_progress')} disabled={saving}>
                                Save draft
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => save(req.id, 'not_material')} disabled={saving}>
                                Not material
                              </Button>
                              {response?.updated_at && (
                                <span className="text-[11px] text-gray-400 ml-auto">
                                  Last updated {new Date(response.updated_at).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      <RequirementImportDialog open={reqImportOpen} onClose={() => setReqImportOpen(false)} />

      {frameworkReqs.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center text-sm text-gray-500">
            <FileText size={22} className="mx-auto mb-2 text-gray-300" />
            No requirements loaded for this framework.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
