'use client';

import { useState } from 'react';
import { fetchAll } from '@/lib/fetch-all';
import { rowsToCsv } from '@/lib/csv-export';
import { regulationLabel } from '@/lib/regulations';
import { createClient } from '@/lib/supabase/client';
import { reportingYearRange } from '@/lib/utils';
import { SCOPE3_CATEGORIES } from '@/lib/scope3';
import { lastContactedAt } from '@/lib/survey-questions-core';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

interface Props {
  availableYears: number[];
  currentYear: number;
  fyStart: number;
  orgName: string;
  sites: { id: string; name: string }[];
  /** null = all sites. [] = the current scope matches nothing. */
  scopeSiteIds: string[] | null;
  scopeLabel: string;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────
// Escaping lives in lib/csv-export.ts, which also neutralises spreadsheet
// formulas: supplier names and survey answers are written by people outside
// the organization, and these files are opened in Excel.

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ReportsClient({
  availableYears, currentYear, fyStart, orgName, sites, scopeSiteIds, scopeLabel,
}: Props) {
  /**
   * Apply the sidebar's reporting scope to an export query. Exports must honour
   * the same filter as the screen — a CSV that quietly contains every site
   * while the UI says "EMEA" is a reporting error, not a convenience.
   */
  const scoped = <T extends { in: (c: string, v: readonly string[]) => T }>(q: T, col = 'site_id'): T =>
    scopeSiteIds === null ? q : q.in(col, scopeSiteIds);

  const supabase = createClient();
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [loadingReport, setLoadingReport] = useState<string | null>(null);

  const siteMap = new Map(sites.map(s => [s.id, s.name]));

  async function downloadGhgInventory() {
    setLoadingReport('ghg');
    const year = parseInt(selectedYear);
    const { startDate, endDate } = reportingYearRange(year, fyStart);

    // Paged: an export cut at Supabase's 1,000-row default would be an
    // incomplete inventory with nothing to say so. See lib/fetch-all.ts.
    const { data } = await fetchAll((from, to) => scoped(supabase
      .from('emission_entries')
      .select('*')
      .gte('entry_date', startDate)
      .lte('entry_date', endDate)
      .is('deleted_at', null))
      .order('entry_date').order('id')
      .range(from, to));

    if (!data) { setLoadingReport(null); return; }

    const headers = [
      'Date',
      'Site',
      'Scope',
      'Scope 1 Category',
      'Source Type',
      'Source Detail',
      'Quantity',
      'Unit (normalized)',
      'Accounting Method',
      'Instrument Type',
      'Emission Factor (kg CO₂e/unit)',
      'Emission Factor Source',
      'Supplier Emission Factor',
      'CO₂e kg (market-based)',
      'CO₂e kg (location-based)',
      'Notes',
    ];

    const rows = data.map(r => [
      r.entry_date,
      siteMap.get(r.site_id) ?? r.site_id,
      r.scope,
      r.scope1_category ?? '',
      r.source_type,
      r.source_detail ?? '',
      r.quantity_normalized,
      r.unit_normalized,
      r.accounting_method ?? 'location_based',
      r.instrument_type ?? '',
      r.emission_factor_used ?? '',
      r.emission_factor_source ?? '',
      r.supplier_emission_factor ?? '',
      r.co2e_kg,
      r.co2e_kg_location_based ?? r.co2e_kg,
      r.notes ?? '',
    ]);

    downloadCsv(rowsToCsv(headers, rows), `${orgName}_GHG_Inventory_${year}.csv`);
    setLoadingReport(null);
  }

  async function downloadEhsReport() {
    setLoadingReport('ehs');
    const year = parseInt(selectedYear);
    const { startDate, endDate } = reportingYearRange(year, fyStart);

    const { data } = await fetchAll((from, to) => scoped(supabase
      .from('ehs_entries')
      .select('*')
      .gte('entry_date', startDate)
      .lte('entry_date', endDate)
      .is('deleted_at', null))
      .order('entry_date').order('id')
      .range(from, to));

    if (!data) { setLoadingReport(null); return; }

    const headers = [
      'Date',
      'Site',
      'Metric Type',
      'Source Type',
      'Hazard Class',
      'Disposal Method',
      'Quantity',
      'Unit (normalized)',
      'Notes',
    ];

    // Waste entries encode hazard class + disposal method in source_type
    // (e.g. "hazardous_incinerated", "non_hazardous_recycled")
    const wasteBreakdown = (r: { metric_type: string; source_type: string }) => {
      if (r.metric_type !== 'waste') return { hazard: '', disposal: '' };
      const isHazardous = r.source_type.startsWith('hazardous');
      const prefix = isHazardous ? 'hazardous_' : 'non_hazardous_';
      return {
        hazard: isHazardous ? 'hazardous' : 'non_hazardous',
        disposal: r.source_type.startsWith(prefix) ? r.source_type.slice(prefix.length) : r.source_type,
      };
    };

    const rows = data.map(r => {
      const { hazard, disposal } = wasteBreakdown(r);
      return [
        r.entry_date,
        // Entity-level metrics have no site; labelled rather than left blank so
        // a reader of the CSV can tell "organization-wide" from "missing".
        r.site_id ? (siteMap.get(r.site_id) ?? r.site_id) : 'Organization-wide',
        r.metric_type,
        r.source_type ?? '',
        hazard,
        disposal,
        r.quantity_normalized,
        r.unit_normalized,
        r.notes ?? '',
      ];
    });

    downloadCsv(rowsToCsv(headers, rows), `${orgName}_EHS_Performance_${year}.csv`);
    setLoadingReport(null);
  }

  async function downloadScope3Inventory() {
    setLoadingReport('scope3');
    const year = parseInt(selectedYear);
    const { startDate, endDate } = reportingYearRange(year, fyStart);

    const { data } = await fetchAll((from, to) => scoped(supabase
      .from('scope3_entries')
      .select('*, suppliers(name), sites(name)')
      .gte('entry_date', startDate)
      .lte('entry_date', endDate)
      .is('deleted_at', null))
      .order('category_number')
      .order('entry_date').order('id')
      .range(from, to));

    if (!data) { setLoadingReport(null); return; }

    const headers = [
      'Date',
      'Category',
      'Category Name',
      'Description',
      'Supplier',
      'Site',
      'Method',
      'Activity Value',
      'Activity Unit',
      'Emission Factor',
      'Factor Unit',
      'Factor Source',
      'Factor Data Year',
      'CO₂e kg',
      'Data Quality',
      'Notes',
    ];

    const rows = data.map(r => {
      const rec = r as typeof r & { suppliers: { name: string } | null; sites: { name: string } | null };
      return [
        rec.entry_date,
        rec.category_number,
        SCOPE3_CATEGORIES.find(c => c.number === rec.category_number)?.name ?? '',
        rec.description ?? '',
        rec.suppliers?.name ?? '',
        rec.sites?.name ?? '',
        rec.calculation_method,
        rec.activity_value,
        rec.activity_unit,
        rec.factor_value,
        rec.factor_unit,
        rec.factor_source,
        rec.factor_data_year ?? '',
        rec.co2e_kg,
        rec.data_quality,
        rec.notes ?? '',
      ];
    });

    downloadCsv(rowsToCsv(headers, rows), `${orgName}_Scope3_Inventory_${year}.csv`);
    setLoadingReport(null);
  }

  async function downloadSupplierResponses() {
    setLoadingReport('supplier');

    const { data: invitations } = await fetchAll((from, to) => supabase
      .from('supplier_survey_invitations')
      .select('*, supplier_surveys(title, regulation_type, custom_regulation_name)')
      .order('submitted_at', { ascending: false }).order('id')
      .range(from, to));

    // One row per answered question, so this passes 1,000 rows long before
    // the invitations do.
    const { data: responses } = await fetchAll((from, to) => supabase
      .from('supplier_survey_question_responses')
      .select('*')
      .order('id')
      .range(from, to));

    if (!invitations) { setLoadingReport(null); return; }

    // Build a map of responses by invitation_id
    const responseMap = new Map<string, Array<{ question_id: string; answer: string | null }>>();
    for (const r of (responses ?? [])) {
      if (!responseMap.has(r.invitation_id)) responseMap.set(r.invitation_id, []);
      responseMap.get(r.invitation_id)!.push({ question_id: r.question_id, answer: r.answer });
    }

    // Flatten: one row per invitation with answers as JSON.
    // Contact history travels with the responses so a chase record can be shown
    // to an auditor asking why a supplier line is empty — "never contacted" and
    // "asked four times, no reply" are different findings.
    const headers = [
      'Survey',
      'Regulation Type',
      'Supplier Name',
      'Email',
      'Status',
      'Sent At',
      'Last Reminded At',
      'Reminders Sent',
      'Last Contacted At',
      'Submitted At',
      'Responses (JSON)',
    ];

    const rows = invitations.map(inv => {
      const survey = (inv as { supplier_surveys?: { title: string; regulation_type: string; custom_regulation_name: string | null } | null }).supplier_surveys;
      const inv_responses = responseMap.get(inv.id) ?? [];
      const responseJson = JSON.stringify(
        Object.fromEntries(inv_responses.map(r => [r.question_id, r.answer])),
      );
      // Blank rather than a date when nothing was ever sent — an invitation row
      // is not evidence the supplier was actually asked.
      const contact = lastContactedAt(inv);
      return [
        survey?.title ?? '',
        // The label, not the raw type: a custom survey exports as 'custom'
        // otherwise, and this file is what an assurance provider reads.
        survey ? regulationLabel(survey.regulation_type, survey.custom_regulation_name) : '',
        inv.supplier_name ?? '',
        inv.email,
        inv.status,
        inv.sent_at ?? '',
        inv.last_reminded_at ?? '',
        inv.reminder_count ?? 0,
        contact?.at ?? '',
        inv.submitted_at ?? '',
        responseJson,
      ];
    });

    downloadCsv(rowsToCsv(headers, rows), `${orgName}_Supplier_Responses.csv`);
    setLoadingReport(null);
  }

  async function downloadAuditTrail() {
    setLoadingReport('audit');

    // `.limit(10000)` was capped to 1,000 by the server, so the assurance
    // export silently held only the latest 1,000 changes.
    const { data } = await fetchAll((from, to) => supabase
      .from('audit_log')
      .select('created_at, user_id, table_name, record_id, action, changes')
      .order('created_at', { ascending: false }).order('id')
      .range(from, to));

    if (!data) { setLoadingReport(null); return; }

    const headers = [
      'Timestamp',
      'User ID',
      'Table',
      'Record ID',
      'Action',
      'Change (JSON)',
    ];

    const rows = data.map(r => [
      r.created_at,
      r.user_id ?? '',
      r.table_name,
      r.record_id,
      r.action,
      JSON.stringify(r.changes),
    ]);

    downloadCsv(rowsToCsv(headers, rows), `${orgName}_Audit_Trail.csv`);
    setLoadingReport(null);
  }

  // ── Report definitions ────────────────────────────────────────────────────
  const reports = [
    {
      id: 'ghg',
      title: 'GHG Inventory Summary',
      description: 'Complete Scope 1 and Scope 2 emission entries with market-based and location-based CO₂e, emission factors, and accounting methods. GHG Protocol compliant.',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
        </svg>
      ),
      badge: 'Year-specific',
      yearSelector: true,
      onDownload: downloadGhgInventory,
    },
    {
      id: 'scope3',
      title: 'Scope 3 Inventory',
      description: 'Value-chain emissions by GHG Protocol category with full lineage — activity data, the factor applied and its cited source, calculation method, and data-quality tier for each entry.',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      ),
      badge: 'Year-specific',
      yearSelector: true,
      onDownload: downloadScope3Inventory,
    },
    {
      id: 'ehs',
      title: 'EHS Performance',
      description: 'Water consumption and waste generation data by site, including disposal method, hazard class, and unit-normalized quantities for all logged entries.',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
      badge: 'Year-specific',
      yearSelector: true,
      onDownload: downloadEhsReport,
    },
    {
      id: 'supplier',
      title: 'Supplier Survey Responses',
      description: 'All supplier survey responses across all surveys and regulations, with submission status, timestamps, and full response data exported as JSON.',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      badge: 'All time',
      yearSelector: false,
      onDownload: downloadSupplierResponses,
    },
    {
      id: 'audit',
      title: 'Audit Trail',
      description: 'Complete change history for emissions, EHS, goals, and projects — every insert, update, and delete with before/after values, user, and timestamp. Supports external assurance and data-lineage review.',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      badge: 'All time',
      yearSelector: false,
      onDownload: downloadAuditTrail,
    },
  ];

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Export data for GHG disclosures, audits, and supplier management · {scopeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Reporting year:</span>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {reports.map(report => (
          <Card key={report.id} className="flex flex-col">
            <CardContent className="pt-6 pb-6 flex flex-col h-full">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  {report.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 text-sm">{report.title}</h3>
                    <Badge variant="secondary" className="text-xs shrink-0">{report.badge}</Badge>
                  </div>
                </div>
              </div>
              <p className="text-sm text-gray-500 mb-6 flex-1">{report.description}</p>
              <Button
                onClick={report.onDownload}
                disabled={loadingReport === report.id}
                className="w-full"
                variant="outline"
              >
                {loadingReport === report.id ? (
                  <>
                    <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download CSV
                    {report.yearSelector && ` (${selectedYear})`}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Info callout */}
      <div className="rounded-xl bg-blue-50 border border-blue-100 p-5">
        <div className="flex gap-3">
          <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">About these exports</p>
            <p>
              GHG Inventory exports include both <strong>market-based</strong> and <strong>location-based</strong> Scope 2 figures
              in separate columns, supporting dual reporting per GHG Protocol Scope 2 Guidance.
              All quantities are in normalized units (kWh, MMBtu, kg) as stored at entry time.
              Soft-deleted entries are excluded.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
