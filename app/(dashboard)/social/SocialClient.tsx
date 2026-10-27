'use client';

import { useMemo, useState } from 'react';
import { sourceLabel } from '@/lib/source-labels';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { Plus, Building2, Info } from 'lucide-react';
import type { DerivedRate, MetricDefinition } from '@/lib/social-metrics-core';
import { EvidenceCell } from '@/components/evidence/EvidencePanel';
import { evidenceCountKey } from '@/lib/evidence-core';

interface CatalogRow {
  metric_type: string;
  source_type: string;
  label: string;
  description: string | null;
  canonical_unit: string;
  aggregation: string;
  pillar: string;
  framework_reference: string | null;
  display_order: number;
}

interface EntryRow {
  id: string;
  site_id: string | null;
  entry_date: string;
  metric_type: string;
  source_type: string;
  quantity: number;
  unit: string;
  quantity_normalized: number;
  unit_normalized: string;
  notes: string | null;
  sites: { name: string } | null;
}

interface Props {
  sites: { id: string; name: string }[];
  entries: EntryRow[];
  catalog: CatalogRow[];
  fallbackCatalog: MetricDefinition[];
  rates: DerivedRate[];
  aggregates: [string, number][];
  year: number;
  periodLabel: string;
  userRole: string;
  /** Active organization; null only if the profile lookup failed. */
  organizationId: string | null;
  evidenceCounts: Record<string, number>;
  scopeIsFiltered: boolean;
}

const FAMILY_LABELS: Record<string, string> = {
  safety: 'Safety', workforce: 'Workforce', training: 'Training', governance: 'Governance',
};
const FAMILY_ORDER = ['safety', 'workforce', 'training', 'governance'];

const ORG_LEVEL = '__org__';

export function SocialClient({
  sites, entries, catalog, fallbackCatalog, rates, aggregates,
  year, periodLabel, userRole, organizationId, evidenceCounts, scopeIsFiltered,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const canEdit = userRole === 'admin' || userRole === 'editor';

  // The database catalog is authoritative; the compiled-in list is the fallback
  // for a database where migration 023's seed has not been applied yet. They
  // are kept in sync deliberately — see social-metrics-core.ts.
  const metrics: CatalogRow[] = useMemo(() => {
    if (catalog.length > 0) return catalog;
    return fallbackCatalog.map((m, idx) => ({
      metric_type: m.metricType, source_type: m.sourceType, label: m.label,
      description: null, canonical_unit: m.canonicalUnit, aggregation: m.aggregation,
      pillar: m.pillar, framework_reference: null, display_order: idx,
    }));
  }, [catalog, fallbackCatalog]);

  const orgLevelKeys = useMemo(
    () => new Set(fallbackCatalog.filter((m) => m.orgLevel).map((m) => `${m.metricType}:${m.sourceType}`)),
    [fallbackCatalog],
  );

  const aggregateMap = useMemo(() => new Map(aggregates), [aggregates]);

  const [family, setFamily] = useState('safety');
  const [sourceType, setSourceType] = useState('');
  const [siteId, setSiteId] = useState('');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const familyMetrics = metrics.filter((m) => m.metric_type === family);
  const selected = familyMetrics.find((m) => m.source_type === sourceType) ?? null;
  const isOrgLevel = selected ? orgLevelKeys.has(`${selected.metric_type}:${selected.source_type}`) : false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) { toast('Choose a metric first.', 'error'); return; }
    if (!isOrgLevel && !siteId) { toast('This metric needs a site.', 'error'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/entries/ehs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: isOrgLevel ? undefined : siteId,
          metricType: selected.metric_type,
          sourceType: selected.source_type,
          quantity: Number(quantity),
          unit: selected.canonical_unit,
          entryDate,
          notes: notes || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) { toast(body.error ?? 'Could not save that entry.', 'error'); return; }
      toast(`${selected.label} recorded.`, 'success');
      setQuantity(''); setNotes('');
      router.refresh();
    } catch {
      toast('Could not reach the server.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Social &amp; governance</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            Workforce, safety, training and governance data · FY {year}
            <span className="text-gray-400"> ({periodLabel})</span>
          </p>
        </div>
      </div>

      {/* ── Derived rates ───────────────────────────────────────────────
          Presented first because they are what a disclosure asks for — but
          computed here from the raw counts below, never stored. ─────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Derived rates</h2>
          <p className="text-xs text-gray-400">
            Calculated from the raw counts, not entered. Never stored.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rates.map((rate) => <RateCard key={rate.key} rate={rate} />)}
        </div>
        <p className="text-xs text-gray-500">
          Injury rates use the US OSHA basis of 200,000 hours worked. GRI 403-9 also
          permits 1,000,000 and requires the reporter to state which was used, so the
          basis is shown on every rate and carried into the report.
        </p>
      </section>

      {/* ── Entry ──────────────────────────────────────────────────────── */}
      {canEdit && (
        <Card>
          <CardContent className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Record a value</h2>

            <div className="flex flex-wrap gap-2">
              {FAMILY_ORDER.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => { setFamily(f); setSourceType(''); }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-sm border transition-colors',
                    family === f
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700 font-medium'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {FAMILY_LABELS[f]}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="lg:col-span-2">
                <Label htmlFor="metric">Metric</Label>
                <select
                  id="metric"
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value)}
                  className="mt-1 flex h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900"
                >
                  <option value="">Select a metric…</option>
                  {familyMetrics.map((m) => (
                    <option key={m.source_type} value={m.source_type}>{m.label}</option>
                  ))}
                </select>
                {selected?.description && (
                  <p className="text-xs text-gray-500 mt-1.5">{selected.description}</p>
                )}
              </div>

              <div>
                <Label htmlFor="site">Site</Label>
                {isOrgLevel ? (
                  <div className="mt-1 flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600">
                    <Building2 size={14} className="text-gray-400" />
                    Organization-wide
                  </div>
                ) : (
                  <select
                    id="site"
                    value={siteId}
                    onChange={(e) => setSiteId(e.target.value)}
                    className="mt-1 flex h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900"
                  >
                    <option value="">Select a site…</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                {isOrgLevel && (
                  <p className="text-xs text-gray-500 mt-1.5">
                    This metric belongs to the entity, not a plant.
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="date">Date</Label>
                <Input id="date" type="date" value={entryDate} className="mt-1"
                       onChange={(e) => setEntryDate(e.target.value)} />
              </div>

              <div>
                <Label htmlFor="quantity">
                  Value {selected && <span className="text-gray-400">({selected.canonical_unit})</span>}
                </Label>
                <Input
                  id="quantity" type="number" step="any" min="0" value={quantity} className="mt-1"
                  placeholder={selected ? selected.canonical_unit : ''}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                {selected?.aggregation === 'point_in_time' && (
                  <p className="text-xs text-amber-700 mt-1.5">
                    A point-in-time reading. Periods take the latest value, never a sum.
                  </p>
                )}
              </div>

              <div className="lg:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" value={notes} className="mt-1"
                       placeholder="Optional — basis, caveats, source document"
                       onChange={(e) => setNotes(e.target.value)} />
              </div>

              <div className="flex items-end">
                <Button type="submit" disabled={saving || !selected}>
                  <Plus size={14} /> {saving ? 'Saving…' : 'Add entry'}
                </Button>
              </div>
            </form>

            {selected?.framework_reference && (
              <p className="text-xs text-gray-500 flex items-start gap-1.5 border-t border-gray-100 pt-3">
                <Info size={12} className="flex-shrink-0 mt-0.5 text-gray-400" />
                <span>
                  Typically serves <span className="text-gray-700">{selected.framework_reference}</span>.
                  Indicative only — disclosures are answered through the requirement mapping,
                  not this note.
                </span>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Totals by metric ───────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Totals for the period</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FAMILY_ORDER.map((f) => {
            const rows = metrics.filter((m) => m.metric_type === f);
            if (rows.length === 0) return null;
            return (
              <Card key={f}>
                <CardContent className="space-y-2">
                  <p className="text-sm font-medium text-gray-900">{FAMILY_LABELS[f]}</p>
                  <dl className="space-y-1.5">
                    {rows.map((m) => {
                      const value = aggregateMap.get(`${m.metric_type}:${m.source_type}`);
                      return (
                        <div key={m.source_type} className="flex items-baseline justify-between gap-3 text-sm">
                          <dt className="text-gray-600">{m.label}</dt>
                          <dd className={cn('font-mono text-right flex-shrink-0',
                            value === undefined ? 'text-gray-300' : 'text-gray-900')}>
                            {value === undefined
                              ? 'not measured'
                              : `${value.toLocaleString('en-US')} ${m.canonical_unit}`}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <p className="text-xs text-gray-500">
          &ldquo;Not measured&rdquo; is shown rather than zero. An unmeasured metric and a
          measured zero are different disclosures, and a report that confuses them is
          a misstatement.
          {scopeIsFiltered && ' Organization-wide governance metrics ignore the sidebar site scope, since they belong to no site.'}
        </p>
      </section>

      {/* ── Recent entries ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Recent entries <span className="text-gray-400 font-normal">({entries.length})</span>
        </h2>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <Th>Date</Th><Th>Metric</Th><Th>Where</Th>
                  <Th className="text-right">Value</Th><Th>Notes</Th>
                  <Th className="w-12"><span className="sr-only">Evidence</span></Th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                      Nothing recorded for {year} yet.
                    </td>
                  </tr>
                ) : entries.map((e) => {
                  const m = metrics.find(
                    (x) => x.metric_type === e.metric_type && x.source_type === e.source_type,
                  );
                  return (
                    <tr key={e.id} className="border-b border-gray-100 last:border-0">
                      <Td className="font-mono text-xs text-gray-500">{e.entry_date}</Td>
                      <Td>
                        <span className="text-gray-900">{m?.label ?? e.source_type}</span>
                        <Badge variant="secondary" className="ml-2">
                          {FAMILY_LABELS[e.metric_type] ?? e.metric_type}
                        </Badge>
                      </Td>
                      <Td className="text-gray-600">
                        {e.site_id === null
                          ? <span className="inline-flex items-center gap-1.5 text-gray-500">
                              <Building2 size={12} /> Organization-wide
                            </span>
                          : (e.sites?.name ?? '—')}
                      </Td>
                      <Td className="text-right font-mono text-gray-900">
                        {e.quantity_normalized.toLocaleString('en-US')}{' '}
                        <span className="text-gray-400">{e.unit_normalized}</span>
                      </Td>
                      <Td className="text-gray-500">{e.notes ?? ''}</Td>
                      <Td>
                        <EvidenceCell
                          recordType="ehs_entry"
                          recordId={e.id}
                          title={`${m?.label ?? e.source_type} · ${e.entry_date}`}
                          organizationId={organizationId}
                          canEdit={canEdit}
                          initialCount={evidenceCounts[evidenceCountKey('ehs_entry', e.id)] ?? 0}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/**
 * "recordable work-related injuries and hours worked" from the rate's input
 * keys, using the same labels as the entry form — not the raw keys, which
 * read as "separations voluntary and separations involuntary and headcount".
 */
function neededInputs(inputs: string[]): string {
  const names = inputs.map((i) => sourceLabel(i.split(':')[1] ?? i).toLowerCase());
  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names);
}

function RateCard({ rate }: { rate: DerivedRate }) {
  return (
    <Card>
      <CardContent className="py-4 space-y-1">
        <p className="text-xs font-medium text-gray-500">{rate.label}</p>
        {rate.missing ? (
          <>
            <p className="text-2xl font-semibold text-gray-300">not measured</p>
            <p className="text-xs text-gray-400">
              Needs {neededInputs(rate.inputs)}.
            </p>
          </>
        ) : (
          <>
            <p className="text-2xl font-semibold text-gray-900">
              {rate.value!.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              {rate.unit === '%' && <span className="text-lg text-gray-500">%</span>}
            </p>
            <p className="text-xs text-gray-400">
              {rate.unit === '%' ? rate.formula : rate.unit}
            </p>
          </>
        )}
        {rate.hoursBasis && (
          <Badge variant="outline">
            {rate.hoursBasis.toLocaleString('en-US')}-hour basis
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide', className)}>
      {children}
    </th>
  );
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-4 py-2.5 align-top', className)}>{children}</td>;
}
