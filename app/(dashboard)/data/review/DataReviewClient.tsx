'use client';

import { useState, useMemo } from 'react';
import { rowsToCsv } from '@/lib/csv-export';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ANOMALY_KIND_LABELS,
  type AnomalyReport, type Finding, type Severity, type AnomalyKind,
} from '@/lib/anomaly-core';
import {
  AlertTriangle, AlertCircle, Info, CheckCircle2, ChevronDown, ChevronRight,
  ArrowLeft, Download,
} from 'lucide-react';

interface Props {
  report: AnomalyReport;
  scopeLabel: string;
  asOfMonth: string;
  fyStart: number;
}

const SEVERITY_META: Record<Severity, {
  label: string;
  badge: 'destructive' | 'warning' | 'secondary';
  icon: typeof AlertTriangle;
  tone: string;
}> = {
  high:   { label: 'High',   badge: 'destructive', icon: AlertTriangle, tone: 'text-red-600' },
  medium: { label: 'Medium', badge: 'warning',     icon: AlertCircle,   tone: 'text-amber-600' },
  low:    { label: 'Low',    badge: 'secondary',   icon: Info,          tone: 'text-gray-400' },
};

/** What each severity means, so the ranking is not a mystery ordering. */
const SEVERITY_MEANING: Record<Severity, string> = {
  high: 'Overstates or omits a figure outright — a double count, or a site contributing nothing.',
  medium: 'Likely to move a reported number. Confirm before the period closes.',
  low: 'Worth an eye. Often a real operational change rather than an error.',
};

export function DataReviewClient({ report, scopeLabel, asOfMonth, fyStart }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [kindFilter, setKindFilter] = useState<AnomalyKind | 'all'>('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { findings, summary, intensityCoverage } = report;

  const sites = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of findings) if (f.siteId) seen.set(f.siteId, f.siteName);
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [findings]);

  const kindsPresent = useMemo(() => {
    const seen = new Set<AnomalyKind>();
    for (const f of findings) seen.add(f.kind);
    return Array.from(seen).sort();
  }, [findings]);

  const visible = useMemo(
    () => findings.filter((f) =>
      (severityFilter === 'all' || f.severity === severityFilter) &&
      (kindFilter === 'all' || f.kind === kindFilter) &&
      (siteFilter === 'all' || f.siteId === siteFilter),
    ),
    [findings, severityFilter, kindFilter, siteFilter],
  );

  /** Grouped by business unit, which is how a BU owner reads this. */
  const byBusinessUnit = useMemo(() => {
    const groups = new Map<string, { name: string; findings: Finding[] }>();
    for (const f of visible) {
      const key = f.businessUnitId ?? '__none__';
      const name = f.businessUnitName ?? 'No business unit';
      const group = groups.get(key) ?? { name, findings: [] };
      group.findings.push(f);
      groups.set(key, group);
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [visible]);

  function setMonth(month: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('asOf', month);
    router.push(`/data/review?${params.toString()}`);
  }

  /** CSV of what is on screen — the format a reviewer works a list in. */
  function exportCsv() {
    const header = [
      'severity', 'kind', 'business_unit', 'site', 'stream', 'period', 'headline', 'basis',
    ];
    const rows = visible.map((f) => [
      f.severity,
      ANOMALY_KIND_LABELS[f.kind],
      f.businessUnitName ?? '',
      f.siteName,
      f.streamLabel ?? '',
      f.period ?? '',
      f.headline,
      f.basis.map((b) => `${b.label}: ${b.value}`).join('; '),
    ]);
    const csv = rowsToCsv(header, rows);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `data_review_${asOfMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const monthOptions = useMemo(() => {
    const options: string[] = [];
    const [y, m] = asOfMonth.split('-').map(Number);
    for (let i = 0; i < 12; i++) {
      const d = new Date(y, m - 1 - i, 1);
      options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return options;
  }, [asOfMonth]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <Link href="/data" className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={12} /> Environmental Data Entry
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Data review</h1>
            <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
              Gaps, swings and outliers in the activity data, so they are found before the period
              closes rather than during assurance. Every finding is a prompt to look — not a verdict.
              {' '}{scopeLabel}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={asOfMonth}
              onChange={(e) => setMonth(e.target.value)}
              className="border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>Through {m}</option>
              ))}
            </select>
            {visible.length > 0 && (
              <Button variant="outline" onClick={exportCsv}>
                <Download size={14} className="mr-1.5" />Export
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Scope of the review — what was actually looked at. */}
      <Card>
        <CardContent className="py-4 flex flex-wrap items-center gap-x-8 gap-y-3">
          <Stat label="Sites in scope" value={summary.sitesInScope} />
          <Stat
            label="Reporting"
            value={`${summary.sitesReporting} of ${summary.sitesInScope}`}
            tone={summary.sitesReporting < summary.sitesInScope ? 'text-amber-700' : undefined}
          />
          <Stat label="Entries reviewed" value={summary.observations.toLocaleString()} />
          <div className="flex items-center gap-2 ml-auto">
            {(['high', 'medium', 'low'] as Severity[]).map((s) => {
              const meta = SEVERITY_META[s];
              const Icon = meta.icon;
              return (
                <button
                  key={s}
                  onClick={() => setSeverityFilter(severityFilter === s ? 'all' : s)}
                  title={SEVERITY_MEANING[s]}
                  className={`px-3 py-1.5 rounded-lg border text-sm inline-flex items-center gap-1.5 transition-colors ${
                    severityFilter === s ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Icon size={14} className={meta.tone} />
                  <span className="font-medium text-gray-900">{summary.bySeverity[s]}</span>
                  <span className="text-gray-500">{meta.label}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {findings.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircle2 size={24} className="mx-auto mb-2 text-emerald-500" />
            <p className="text-sm font-medium text-gray-700">Nothing to review</p>
            <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
              No gaps, duplicates or unusual values through {asOfMonth} for the sites in scope. This
              is a statement about the checks that ran, not a guarantee the data is right.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Filters */}
          <div className="flex items-end gap-3 flex-wrap">
            <FilterSelect
              label="Finding type"
              value={kindFilter}
              onChange={(v) => setKindFilter(v as AnomalyKind | 'all')}
              options={[
                { value: 'all', label: `All types (${findings.length})` },
                ...kindsPresent.map((k) => ({
                  value: k,
                  label: `${ANOMALY_KIND_LABELS[k]} (${findings.filter((f) => f.kind === k).length})`,
                })),
              ]}
            />
            <FilterSelect
              label="Site"
              value={siteFilter}
              onChange={setSiteFilter}
              options={[
                { value: 'all', label: 'All sites' },
                ...sites.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            {(severityFilter !== 'all' || kindFilter !== 'all' || siteFilter !== 'all') && (
              <button
                onClick={() => { setSeverityFilter('all'); setKindFilter('all'); setSiteFilter('all'); }}
                className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2 pb-2"
              >
                Clear filters
              </button>
            )}
            <span className="text-xs text-gray-400 pb-2 ml-auto">
              Showing {visible.length} of {findings.length}
            </span>
          </div>

          {/* Findings, grouped by business unit */}
          <div className="space-y-6">
            {byBusinessUnit.map((group) => (
              <div key={group.name}>
                <h2 className="text-sm font-semibold text-gray-700 mb-2">
                  {group.name}
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {group.findings.length} finding{group.findings.length === 1 ? '' : 's'}
                  </span>
                </h2>
                <Card>
                  <CardContent className="p-0 divide-y divide-gray-50">
                    {group.findings.map((f) => {
                      const meta = SEVERITY_META[f.severity];
                      const Icon = meta.icon;
                      const isOpen = expanded === f.id;
                      return (
                        <div key={f.id}>
                          <button
                            onClick={() => setExpanded(isOpen ? null : f.id)}
                            className="w-full text-left px-4 py-3 hover:bg-gray-50/50 flex items-start gap-3"
                          >
                            <Icon size={15} className={`mt-0.5 shrink-0 ${meta.tone}`} />
                            <span className="flex-1 min-w-0">
                              <span className="flex items-center gap-2 flex-wrap">
                                <Badge variant={meta.badge}>{ANOMALY_KIND_LABELS[f.kind]}</Badge>
                                <span className="text-xs text-gray-500">{f.siteName}</span>
                                {f.period && <span className="text-xs text-gray-400">· {f.period}</span>}
                              </span>
                              <span className="block text-sm text-gray-900 mt-1">{f.headline}</span>
                            </span>
                            <span className="mt-0.5 text-gray-400 shrink-0">
                              {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </span>
                          </button>

                          {isOpen && (
                            <div className="px-4 pb-4 pl-12 space-y-3">
                              <p className="text-sm text-gray-600">{f.detail}</p>
                              {/* The numbers behind the claim — a reviewer has to
                                  be able to judge it without trusting the label. */}
                              <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                                <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                                  Basis
                                </p>
                                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                                  {f.basis.map((b) => (
                                    <div key={b.label}>
                                      <dt className="text-gray-500">{b.label}</dt>
                                      <dd className="text-gray-900 font-medium tabular-nums">{b.value}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>
                              {f.entryIds.length > 0 && (
                                <p className="text-xs text-gray-400">
                                  {f.entryIds.length} entr{f.entryIds.length === 1 ? 'y' : 'ies'} involved.
                                </p>
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

          {visible.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-sm text-gray-500">
                No findings match these filters.
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* What could not be checked is itself worth reporting. */}
      {intensityCoverage.some((c) => !c.sufficient || c.excludedForNoFloorArea.length > 0) && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm font-semibold text-gray-900 mb-1">Comparisons that could not run</p>
            <p className="text-xs text-gray-500 mb-3 max-w-2xl">
              Cross-site intensity needs a denominator that scales with consumption. Sites without a
              floor area are excluded from that comparison — not flagged as clean.
            </p>
            <div className="space-y-1.5">
              {intensityCoverage
                .filter((c) => !c.sufficient || c.excludedForNoFloorArea.length > 0)
                .map((c) => (
                  <div key={c.stream} className="text-xs text-gray-600">
                    <span className="font-medium text-gray-900">{c.streamLabel}</span>
                    {!c.sufficient
                      ? ` — only ${c.comparedSites} comparable site${c.comparedSites === 1 ? '' : 's'}, too few to tell an outlier from a small sample.`
                      : ` — ${c.comparedSites} compared.`}
                    {c.excludedForNoFloorArea.length > 0 && (
                      <span className="text-amber-700">
                        {' '}Missing floor area: {c.excludedForNoFloorArea.join(', ')}.
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-gray-400 max-w-3xl">
        Comparisons use the median and median absolute deviation rather than the mean and standard
        deviation, so a single bad entry cannot inflate the threshold past its own value and hide.
        Streams with too little history are reported as such rather than scored on noise. Reporting
        year starts in month {fyStart}.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-medium ${tone ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
