import { describe, it, expect } from 'vitest';
import {
  escapeHtml, renderReportHtml, buildReportModel, renderMethodology,
  type BuildReportInput, type MaterialityScope,
} from './report-builder';

function model(overrides: Partial<BuildReportInput> = {}): BuildReportInput {
  return buildReportModel({
    orgName: 'Demo Manufacturing Co',
    reportingYear: 2025,
    generatedAt: '2026-07-24',
    framework: {
      code: 'GRI_305',
      name: 'GRI 305: Emissions',
      issuer: 'Global Reporting Initiative',
      version: '2016',
      sourceRef: 'GRI 305: Emissions 2016',
    },
    coverage: 71.4,
    inventorySummary: [
      { label: 'Scope 1', value: 500, unit: 'tCO₂e' },
      { label: 'Scope 2 (location-based)', value: 300, unit: 'tCO₂e' },
      { label: 'Scope 3', value: 2000, unit: 'tCO₂e', note: 'across 2 categories' },
      { label: 'Energy', value: null, unit: 'kWh' },
    ],
    sections: [
      {
        heading: 'Emissions',
        requirements: [
          {
            code: '305-1',
            title: 'Direct (Scope 1) GHG emissions.',
            description: null,
            narrative: 'First paragraph.\n\nSecond paragraph.',
            metric: { label: 'Scope 1', value: 500, unit: 'tCO₂e' },
            state: 'satisfied_by_data',
          },
          {
            code: '305-6',
            title: 'Emissions of ozone-depleting substances (ODS).',
            description: 'Report ODS in CFC-11 equivalent.',
            narrative: null,
            metric: null,
            state: 'outstanding',
          },
        ],
      },
    ],
    provenance: {
      factorSources: ['EPA_2024', 'eGRID2023', 'IPCC_AR6'],
      dataQualityMix: { primary: 1000, secondary: 500, estimated: 500 },
      scope3CategoriesWithData: 2,
    },
    ...overrides,
  });
}

describe('escapeHtml', () => {
  it('escapes the characters that break or inject HTML', () => {
    expect(escapeHtml('<script>alert("x")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
  });
});

describe('renderReportHtml', () => {
  it('produces a self-contained document with no external references', () => {
    const html = renderReportHtml(model());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<style>');
    // No external resources — the file must stand alone as an archive artifact
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('includes org, framework, year and coverage on the cover', () => {
    const html = renderReportHtml(model());
    expect(html).toContain('Demo Manufacturing Co');
    expect(html).toContain('GRI 305: Emissions');
    expect(html).toContain('2025');
    expect(html).toContain('71% of requirements addressed');
  });

  it('renders the inventory summary including an em dash for missing values', () => {
    const html = renderReportHtml(model());
    expect(html).toContain('Scope 2 (location-based)');
    expect(html).toContain('across 2 categories');
    expect(html).toContain('—'); // the null energy row
  });

  it('renders narrative paragraphs separately', () => {
    const html = renderReportHtml(model());
    expect(html).toContain('<p>First paragraph.</p>');
    expect(html).toContain('<p>Second paragraph.</p>');
  });

  it('escapes user-authored narrative rather than emitting raw HTML', () => {
    const html = renderReportHtml(model({
      sections: [{
        heading: 'Emissions',
        requirements: [{
          code: '305-1', title: 'Direct emissions.', description: null,
          narrative: '<img src=x onerror=alert(1)>', metric: null, state: 'answered',
        }],
      }],
    }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('flags requirements with no disclosure', () => {
    const html = renderReportHtml(model());
    expect(html).toContain('Not yet disclosed.');
  });

  it('always includes the basis of preparation with every cited factor source', () => {
    const html = renderReportHtml(model());
    expect(html).toContain('Basis of preparation');
    expect(html).toContain('EPA_2024');
    expect(html).toContain('eGRID2023');
    expect(html).toContain('IPCC_AR6');
    expect(html).toContain('GHG Protocol Corporate Value Chain');
  });

  it('reports the data-quality mix as percentages of emissions', () => {
    const html = renderReportHtml(model());
    // 1000 / 2000 primary
    expect(html).toContain('50.0%');
    // 500 / 2000 each for secondary and estimated
    expect(html).toContain('25.0%');
  });

  it('handles an empty inventory without dividing by zero', () => {
    const html = renderReportHtml(model({
      provenance: {
        factorSources: [],
        dataQualityMix: { primary: 0, secondary: 0, estimated: 0 },
        scope3CategoriesWithData: 0,
      },
    }));
    expect(html).toContain('0.0%');
    expect(html).toContain('No emission factor sources recorded');
  });

  it('escapes an organization name containing markup', () => {
    const html = renderReportHtml(model({ orgName: 'Acme <b>Corp</b> & Co' }));
    expect(html).toContain('Acme &lt;b&gt;Corp&lt;/b&gt; &amp; Co');
    expect(html).not.toContain('<b>Corp</b>');
  });
});

describe('renderReportHtml — materiality scope', () => {
  const scope: MaterialityScope = {
    assessmentName: '2025 double materiality assessment',
    assessmentYear: 2025,
    threshold: 3,
    status: 'final',
    methodology: 'Topics screened against ESRS 1 AR 16.\n\nStakeholders consulted in Q2.',
    topics: [
      { code: 'E1', name: 'Climate change', status: 'material', impactScore: 4.5, financialScore: 3.2 },
      { code: 'E4', name: 'Biodiversity and ecosystems', status: 'not_material', impactScore: 1.5, financialScore: 0.8 },
      { code: 'S3', name: 'Affected communities', status: 'unassessed', impactScore: 0, financialScore: 0 },
    ],
    omitted: [
      { code: 'ESRS E4', title: 'Biodiversity and ecosystems', topics: ['E4'] },
    ],
    undeterminedTopics: ['S3'],
  };

  it('omits the whole section when the framework is not materiality-scoped', () => {
    const html = renderReportHtml(model());
    expect(html).not.toContain('Material topics and the scope of this statement');
    // …and says so explicitly, so silence is not mistaken for an omission.
    expect(html).toContain('none has been omitted on');
  });

  it('states the assessment, threshold and the material count', () => {
    const html = renderReportHtml(model({ materialityScope: scope }));
    expect(html).toContain('Material topics and the scope of this statement');
    expect(html).toContain('2025 double materiality assessment');
    expect(html).toContain('threshold of 3 on a 1–5 scale');
    expect(html).toContain('1 of 3 topics were');
  });

  it('lists every topic with its conclusion, including unassessed ones', () => {
    const html = renderReportHtml(model({ materialityScope: scope }));
    expect(html).toContain('Climate change');
    expect(html).toContain('Biodiversity and ecosystems');
    expect(html).toContain('Affected communities');
    expect(html).toContain('Not assessed');
  });

  it('names every omitted requirement rather than dropping it silently', () => {
    // An assurance provider must be able to tell "concluded not material" from
    // "never answered", which is impossible if omissions simply vanish.
    const html = renderReportHtml(model({ materialityScope: scope }));
    expect(html).toContain('Disclosure requirements omitted as not material');
    expect(html).toContain('ESRS E4');
  });

  it('flags topics still under assessment as retained, not omitted', () => {
    const html = renderReportHtml(model({ materialityScope: scope }));
    expect(html).toContain('have not yet been assessed');
    expect(html).toContain('S3');
  });

  it('says so when nothing was omitted', () => {
    const html = renderReportHtml(model({
      materialityScope: { ...scope, omitted: [], undeterminedTopics: [] },
    }));
    expect(html).toContain('No disclosure requirements were omitted');
    expect(html).not.toContain('have not yet been assessed');
  });

  it('flags a missing methodology narrative against ESRS 2 IRO-1', () => {
    const html = renderReportHtml(model({ materialityScope: { ...scope, methodology: null } }));
    expect(html).toContain('No methodology narrative was recorded');
  });

  it('escapes the user-authored assessment name and methodology', () => {
    const html = renderReportHtml(model({
      materialityScope: {
        ...scope,
        assessmentName: '<b>2025</b>',
        methodology: '<img src=x onerror=alert(1)>',
      },
    }));
    expect(html).not.toContain('<b>2025</b>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('stays self-contained with the scope section present', () => {
    const html = renderReportHtml(model({ materialityScope: scope }));
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe('renderMethodology', () => {
  it('states the boundary, the Scope 2 market-based basis and what sits outside the scopes', () => {
    const html = renderMethodology({
      consolidationApproach: 'equity_share',
      partialSiteCount: 1,
      excludedSiteCount: 0,
      estimatedPercent: 4.2,
      scope2MarketBasisKwh: { residual_mix: 600, grid_average: 400, self_generated: 500 },
      biogenicCo2Kg: 93_800,
      montrealGasesKg: 0,
    });
    expect(html).toContain('equity share approach');
    expect(html).toContain('1 site is included at less than 100%');
    // Self-generated electricity is not priced, so it is left out of the shares.
    expect(html).toContain('60.0% residual mix');
    expect(html).toContain('40.0% grid average, where no residual mix exists');
    expect(html).toContain('4.2% of Scope 1 and 2 emissions rest on estimates');
    expect(html).toContain('93.8 tCO₂');
  });

  it('renders nothing without a basis', () => {
    expect(renderMethodology(null)).toBe('');
  });
});
