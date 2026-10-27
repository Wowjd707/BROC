/**
 * Assembles a submission-ready sustainability report from platform data.
 *
 * Output is a single self-contained HTML file: no external stylesheets, fonts,
 * or scripts. That is a deliberate no-lock-in choice — it opens in any browser,
 * prints to PDF natively, and can be archived as a single artifact with no
 * dependency on this application still existing. Word/PDF binaries would mean a
 * heavyweight dependency and a format the deploying organization cannot diff or grep.
 *
 * The report always carries a **basis of preparation** appendix listing every
 * emission factor source that fed the numbers, plus the data-quality mix. A
 * sustainability report whose figures cannot be traced to their factors is not
 * assurable, so this is generated, never optional.
 *
 * Pure and dependency-free so it is unit-testable.
 */

import type { MetricValue, RequirementState } from './disclosure-metrics-core';
import type { TopicStatus } from './materiality-linkage-core';

// ─── Model ───────────────────────────────────────────────────────────────────

export interface ReportRequirement {
  code: string;
  title: string;
  description: string | null;
  narrative: string | null;
  metric: MetricValue | null;
  state: RequirementState;
}

export interface ReportSection {
  heading: string;
  requirements: ReportRequirement[];
}

export interface InventorySummaryRow {
  label: string;
  value: number | null;
  unit: string;
  note?: string;
}

export interface ProvenanceInput {
  /** Distinct cited factor sources that fed the reported figures. */
  factorSources: string[];
  /** Scope 3 emissions by data-quality tier, in kg. */
  dataQualityMix: { primary: number; secondary: number; estimated: number };
  scope3CategoriesWithData: number;
}

/**
 * The materiality assessment that scoped this statement.
 *
 * Present only for frameworks whose requirements carry topic links and only
 * when the reporting year has an assessment. ESRS 2 IRO-2 requires the
 * undertaking to state which topics it assessed and which it concluded are not
 * material, so a scoped report must SAY it is scoped and list what it left out
 * — an omission the reader cannot see is indistinguishable from a gap.
 */
export interface MaterialityScope {
  assessmentName: string;
  assessmentYear: number;
  threshold: number;
  status: string;
  methodology: string | null;
  topics: {
    code: string;
    name: string;
    status: TopicStatus;
    impactScore: number;
    financialScore: number;
  }[];
  /** Requirements omitted because every topic they map to was immaterial. */
  omitted: { code: string; title: string; topics: string[] }[];
  /** Requirements retained because a topic they map to is still unassessed. */
  undeterminedTopics: string[];
}

export interface BuildReportInput {
  orgName: string;
  reportingYear: number;
  generatedAt: string;
  framework: {
    code: string;
    name: string;
    issuer: string;
    version: string | null;
    sourceRef: string;
  };
  coverage: number;
  inventorySummary: InventorySummaryRow[];
  sections: ReportSection[];
  provenance: ProvenanceInput;
  materialityScope?: MaterialityScope | null;
}

export type ReportModel = BuildReportInput;

export function buildReportModel(input: BuildReportInput): ReportModel {
  return input;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

/** Escape text for safe interpolation into HTML. Narratives are user-authored. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render a narrative: escaped, with blank lines becoming paragraphs. */
function renderNarrative(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br />')}</p>`);
  return paragraphs.join('\n');
}

function formatNumber(n: number): string {
  // Whole numbers stay whole ("2 targets", not "2.00 targets"); small
  // fractional values keep up to two decimals.
  const decimals = Math.abs(n) > 0 && Math.abs(n) < 100 && !Number.isInteger(n) ? 2 : 0;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

const STATE_LABEL: Record<RequirementState, string> = {
  satisfied_by_data: 'Reported from platform data',
  answered: 'Complete',
  in_progress: 'In progress',
  not_material: 'Not material',
  excluded_immaterial: 'Outside the material scope of this statement',
  outstanding: 'Not yet disclosed',
};

/**
 * Materiality scores are judgements on a 1–5 scale, not measurements. One
 * decimal, and no trailing zero on a whole number, so a threshold of 3 reads as
 * "3" the way the assessment states it rather than as "3.00".
 */
function formatScore(n: number): string {
  return Number(n.toFixed(1)).toString();
}

const TOPIC_STATUS_LABEL: Record<TopicStatus, string> = {
  material: 'Material',
  not_material: 'Not material',
  unassessed: 'Not assessed',
};

function renderMetric(metric: MetricValue): string {
  if (metric.missing || metric.value == null) {
    return `<p class="missing">No data recorded for this metric in the reporting period.</p>`;
  }
  const breakdown = metric.breakdown?.length
    ? `<table class="breakdown">
        ${metric.breakdown
          .map(
            (b) =>
              `<tr><td>${escapeHtml(b.label)}</td><td class="num">${formatNumber(b.value)} ${escapeHtml(b.unit)}</td></tr>`,
          )
          .join('\n')}
       </table>`
    : '';
  return `<div class="metric">
      <div class="metric-value">${formatNumber(metric.value)} <span class="unit">${escapeHtml(metric.unit)}</span></div>
      <div class="metric-label">${escapeHtml(metric.label)}</div>
      ${breakdown}
    </div>`;
}

function renderRequirement(req: ReportRequirement): string {
  const body = req.narrative && req.narrative.trim()
    ? renderNarrative(req.narrative)
    : req.metric && !req.metric.missing
      ? ''
      : `<p class="missing">Not yet disclosed.</p>`;

  return `<section class="requirement">
    <h3><span class="code">${escapeHtml(req.code)}</span> ${escapeHtml(req.title)}</h3>
    ${req.description ? `<p class="description">${escapeHtml(req.description)}</p>` : ''}
    ${req.metric ? renderMetric(req.metric) : ''}
    ${body}
    <p class="state">${escapeHtml(STATE_LABEL[req.state])}</p>
  </section>`;
}

function renderInventoryTable(rows: InventorySummaryRow[]): string {
  return `<table class="inventory">
    <thead><tr><th>Metric</th><th class="num">Value</th><th>Unit</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
            <td>${escapeHtml(r.label)}${r.note ? `<span class="note">${escapeHtml(r.note)}</span>` : ''}</td>
            <td class="num">${r.value == null ? '—' : formatNumber(r.value)}</td>
            <td>${escapeHtml(r.unit)}</td>
          </tr>`,
        )
        .join('\n')}
    </tbody>
  </table>`;
}

/**
 * The scope statement: which topics were assessed, what was concluded, and
 * which disclosure requirements were consequently omitted.
 *
 * Omissions are listed by code and title rather than dropped silently. A reader
 * — and an assurance provider — must be able to tell "we concluded this is not
 * material" apart from "we did not answer this", and the two look identical if
 * the excluded requirements simply vanish from the document.
 */
function renderMaterialityScope(scope: MaterialityScope): string {
  const materialCount = scope.topics.filter((t) => t.status === 'material').length;

  const topicRows = scope.topics
    .map(
      (t) => `<tr>
        <td><strong>${escapeHtml(t.code)}</strong> ${escapeHtml(t.name)}</td>
        <td>${escapeHtml(TOPIC_STATUS_LABEL[t.status])}</td>
        <td class="num">${t.status === 'unassessed' ? '—' : formatScore(t.impactScore)}</td>
        <td class="num">${t.status === 'unassessed' ? '—' : formatScore(t.financialScore)}</td>
      </tr>`,
    )
    .join('\n');

  const omissions = scope.omitted.length
    ? `<table class="inventory">
        <thead><tr><th>Requirement</th><th>Topic assessed not material</th></tr></thead>
        <tbody>
          ${scope.omitted
            .map(
              (o) => `<tr>
                <td><strong>${escapeHtml(o.code)}</strong> ${escapeHtml(o.title)}</td>
                <td>${escapeHtml(o.topics.join(', '))}</td>
              </tr>`,
            )
            .join('\n')}
        </tbody>
      </table>`
    : `<p>No disclosure requirements were omitted: every topic in scope for this framework was
       assessed as material or remains under assessment.</p>`;

  const undetermined = scope.undeterminedTopics.length
    ? `<p class="missing">
        The following topics have not yet been assessed, so the disclosure requirements mapped to
        them are retained in this statement rather than omitted:
        ${escapeHtml(scope.undeterminedTopics.join(', '))}.
       </p>`
    : '';

  const methodology = scope.methodology
    ? `<h3>Methodology</h3>${renderNarrative(scope.methodology)}`
    : `<p class="missing">No methodology narrative was recorded for this assessment. ESRS 2 IRO-1
       requires the process for identifying and assessing material impacts, risks and opportunities
       to be described.</p>`;

  return `<h2>Material topics and the scope of this statement</h2>
    <p>
      The topics disclosed below were determined by the double materiality assessment
      &ldquo;${escapeHtml(scope.assessmentName)}&rdquo; for reporting year
      ${escapeHtml(String(scope.assessmentYear))} (status: ${escapeHtml(scope.status)}). Each topic
      was assessed both for the undertaking&rsquo;s impacts on people and the environment and for the
      financial effects of sustainability matters on the undertaking. A topic is material where
      <strong>either</strong> dimension reaches the assessment threshold of ${escapeHtml(formatScore(scope.threshold))} on a 1–5 scale.
      ${escapeHtml(String(materialCount))} of ${escapeHtml(String(scope.topics.length))} topics were
      assessed as material.
    </p>
    ${methodology}
    <h3>Assessment outcome by topic</h3>
    <table class="inventory">
      <thead><tr><th>Topic</th><th>Conclusion</th><th class="num">Impact</th><th class="num">Financial</th></tr></thead>
      <tbody>${topicRows}</tbody>
    </table>
    <h3>Disclosure requirements omitted as not material</h3>
    ${omissions}
    ${undetermined}`;
}

function renderBasisOfPreparation(model: ReportModel): string {
  const { provenance } = model;
  const mix = provenance.dataQualityMix;
  const mixTotal = mix.primary + mix.secondary + mix.estimated;
  const pct = (v: number) => (mixTotal > 0 ? ((v / mixTotal) * 100).toFixed(1) : '0.0');

  const sources = provenance.factorSources.length
    ? `<ul>${provenance.factorSources.map((s) => `<li>${escapeHtml(s)}</li>`).join('\n')}</ul>`
    : `<p class="missing">No emission factor sources recorded — no emissions data in this reporting period.</p>`;

  return `<section class="appendix">
    <h2>Basis of preparation</h2>

    <h3>Reporting boundary and period</h3>
    <p>
      This report covers the ${escapeHtml(String(model.reportingYear))} reporting year for
      ${escapeHtml(model.orgName)}. Greenhouse gas emissions are accounted for in accordance with the
      GHG Protocol Corporate Accounting and Reporting Standard. Scope 2 emissions are reported on both
      a location-based and a market-based basis in accordance with the GHG Protocol Scope 2 Guidance.
      Scope 3 emissions are categorised in accordance with the GHG Protocol Corporate Value Chain
      (Scope 3) Standard.
    </p>

    <h3>Emission factor sources</h3>
    <p>The following emission factor sources were applied to the activity data in this report:</p>
    ${sources}

    <h3>Scope 3 data quality</h3>
    <p>
      Scope 3 emissions are reported across ${escapeHtml(String(provenance.scope3CategoriesWithData))}
      of the 15 categories defined by the GHG Protocol. By emissions:
    </p>
    <table class="breakdown">
      <tr><td>Primary data (supplier- or activity-specific)</td><td class="num">${pct(mix.primary)}%</td></tr>
      <tr><td>Secondary data (industry average)</td><td class="num">${pct(mix.secondary)}%</td></tr>
      <tr><td>Estimated (spend-based)</td><td class="num">${pct(mix.estimated)}%</td></tr>
    </table>

    <h3>Traceability</h3>
    <p>
      Every figure in this report derives from individual activity-data entries, each of which records
      the raw quantity as entered, the normalised quantity, the emission factor applied, and that
      factor's cited source. A complete change history for all reported data is retained and is
      available for inspection.
    </p>

    <h3>Framework</h3>
    <p>
      Disclosures are structured against ${escapeHtml(model.framework.name)}
      (${escapeHtml(model.framework.issuer)}${model.framework.version ? `, ${escapeHtml(model.framework.version)}` : ''}).
      Requirement structure sourced from: ${escapeHtml(model.framework.sourceRef)}.
      ${model.materialityScope
        ? `The disclosure requirements presented were scoped by the double materiality assessment
           described under &ldquo;Material topics and the scope of this statement&rdquo;; requirements
           omitted on materiality grounds are listed there in full.`
        : `All disclosure requirements of the framework are presented; none has been omitted on
           materiality grounds.`}
    </p>
  </section>`;
}

const STYLES = `
  :root { --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --accent:#047857; --accent-bg:#ecfdf5; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink); line-height: 1.6; margin: 0; padding: 0; background: #fff;
  }
  .page { max-width: 800px; margin: 0 auto; padding: 48px 40px; }
  .cover { border-bottom: 3px solid var(--accent); padding-bottom: 28px; margin-bottom: 36px; }
  .cover .eyebrow { color: var(--accent); font-size: 13px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
  .cover h1 { font-size: 32px; margin: 10px 0 6px; line-height: 1.2; }
  .cover .sub { color: var(--muted); font-size: 15px; }
  .cover .meta { margin-top: 18px; font-size: 13px; color: var(--muted); }
  h2 { font-size: 20px; margin: 36px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  h3 { font-size: 15px; margin: 22px 0 6px; }
  h3 .code { color: var(--accent); font-weight: 700; margin-right: 8px; }
  p { margin: 8px 0; }
  .description { color: var(--muted); font-size: 13px; font-style: italic; }
  .missing { color: #b45309; font-size: 13px; }
  .state { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-top: 8px; }
  .requirement { margin-bottom: 26px; page-break-inside: avoid; }
  .metric { background: var(--accent-bg); border-left: 3px solid var(--accent); padding: 12px 16px; margin: 10px 0; }
  .metric-value { font-size: 24px; font-weight: 700; color: #065f46; }
  .metric-value .unit { font-size: 14px; font-weight: 500; }
  .metric-label { font-size: 12px; color: #047857; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
  .inventory th { text-align: left; border-bottom: 2px solid var(--line); padding: 8px 6px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .inventory td { border-bottom: 1px solid var(--line); padding: 8px 6px; }
  .breakdown td { padding: 4px 6px; border-bottom: 1px solid var(--line); font-size: 13px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .note { display: block; font-size: 11px; color: var(--muted); }
  .coverage { display: inline-block; background: var(--accent-bg); color: #065f46; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .appendix { margin-top: 44px; padding-top: 20px; border-top: 3px solid var(--accent); page-break-before: always; }
  .appendix ul { margin: 8px 0; padding-left: 20px; font-size: 14px; }
  .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }
  @media print {
    .page { padding: 0; max-width: none; }
    h2 { page-break-after: avoid; }
  }
`;

/** Render the report model as a single self-contained HTML document. */
export function renderReportHtml(model: ReportModel): string {
  const title = `${model.orgName} — ${model.framework.code.replace(/_/g, ' ')} Disclosure ${model.reportingYear}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="page">

  <header class="cover">
    <div class="eyebrow">Sustainability Disclosure</div>
    <h1>${escapeHtml(model.orgName)}</h1>
    <div class="sub">${escapeHtml(model.framework.name)} · Reporting year ${escapeHtml(String(model.reportingYear))}</div>
    <div class="meta">
      <span class="coverage">${model.coverage.toFixed(0)}% of requirements addressed</span>
      &nbsp;·&nbsp; Generated ${escapeHtml(model.generatedAt)}
    </div>
  </header>

  ${model.materialityScope ? renderMaterialityScope(model.materialityScope) : ''}

  <h2>Emissions inventory summary</h2>
  ${renderInventoryTable(model.inventorySummary)}

  ${model.sections
    .map(
      (s) => `<h2>${escapeHtml(s.heading)}</h2>
      ${s.requirements.map(renderRequirement).join('\n')}`,
    )
    .join('\n')}

  ${renderBasisOfPreparation(model)}

  <div class="footer">
    ${escapeHtml(model.orgName)} · ${escapeHtml(model.framework.name)} · Reporting year
    ${escapeHtml(String(model.reportingYear))} · Generated ${escapeHtml(model.generatedAt)}.
    Figures are traceable to source activity data, emission factors, and their cited sources.
  </div>

</div>
</body>
</html>`;
}
