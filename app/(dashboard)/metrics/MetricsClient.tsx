'use client';

import { useMemo, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { Plus, Ruler, Building2, Gauge, Sparkles, Upload } from 'lucide-react';
import {
  aggregateMetricValues,
  type BusinessMetricDefinition, type BusinessMetricValue, type MetricAggregation,
} from '@/lib/business-metrics-core';
import { MetricValueImportDialog } from './MetricValueImportDialog';
import { EvidenceCell } from '@/components/evidence/EvidencePanel';
import { evidenceCountKey } from '@/lib/evidence-core';

interface ValueRow extends BusinessMetricValue {
  id: string;
  notes: string | null;
}

interface Props {
  definitions: BusinessMetricDefinition[];
  values: ValueRow[];
  sites: { id: string; name: string }[];
  year: number;
  intensityMetricKey: string | null;
  organizationId: string | null;
  evidenceCounts: Record<string, number>;
  userRole: string;
}

const AGGREGATION_HINT: Record<MetricAggregation, string> = {
  sum: 'Added up across the year',
  point_in_time: 'Latest reading from each site',
  average: 'Averaged across sites',
};

const CATEGORY_META: Record<string, { label: string; variant: string }> = {
  financial: { label: 'Financial', variant: 'blue' },
  operational: { label: 'Operational', variant: 'secondary' },
  workforce: { label: 'Workforce', variant: 'purple' },
  other: { label: 'Other', variant: 'outline' },
};

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

export function MetricsClient({
  definitions, values, sites, year, intensityMetricKey, organizationId, evidenceCounts, userRole,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { toast } = useToast();

  const canEdit = userRole === 'admin' || userRole === 'editor';

  const [entryFor, setEntryFor] = useState<BusinessMetricDefinition | null>(null);
  const [defineOpen, setDefineOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // An organization's own definition shadows a starter of the same key.
  const visible = useMemo(() => {
    const byKey = new Map<string, BusinessMetricDefinition>();
    for (const d of definitions) {
      const held = byKey.get(d.metric_key);
      if (!held || (d.organization_id !== null && held.organization_id === null)) byKey.set(d.metric_key, d);
    }
    return Array.from(byKey.values()).sort((a, b) => a.display_order - b.display_order);
  }, [definitions]);

  const totals = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const d of visible) {
      m.set(d.metric_key, aggregateMetricValues(
        values.filter((v) => v.metric_key === d.metric_key), d.aggregation,
      ));
    }
    return m;
  }, [visible, values]);

  const siteName = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites]);

  function setYear(next: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('year', String(next));
    router.push(`${pathname}?${params.toString()}`);
  }

  const years = Array.from({ length: 5 }, (_, i) => year - 2 + i);

  return (
    <div className="p-6 lg:p-8 space-y-6">

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Business metrics</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            What your organization measures itself by — revenue, headcount, output. These are the
            denominators intensity is reported against, so a board can be answered in the units it
            actually asks about.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700"
          >
            {years.map((y) => <option key={y} value={y}>FY {y}</option>)}
          </select>
          {canEdit && (
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Import figures
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" onClick={() => setDefineOpen(true)}>
              <Sparkles size={14} /> Define a metric
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Gauge size={22} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              No business metrics defined yet. Apply migration 027, or define one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((d) => (
            <MetricCard
              key={d.metric_key}
              definition={d}
              total={totals.get(d.metric_key) ?? null}
              isDenominator={intensityMetricKey === d.metric_key}
              entryCount={values.filter((v) => v.metric_key === d.metric_key).length}
              canEdit={canEdit}
              onAdd={() => setEntryFor(d)}
            />
          ))}
        </div>
      )}

      {/* ── Recorded values ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Recorded for FY {year} <span className="text-gray-400 font-normal">({values.length})</span>
        </h2>
        <Card>
          {values.length === 0 ? (
            <CardContent className="py-10 text-center text-sm text-gray-500">
              Nothing recorded for FY {year} yet. Add a figure from any card above.
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left">
                    <Th>Metric</Th><Th>Where</Th><Th>As of</Th>
                    <Th className="text-right">Value</Th><Th>Notes</Th>
                    <Th className="w-12"><span className="sr-only">Evidence</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {values.map((v) => {
                    const d = visible.find((x) => x.metric_key === v.metric_key);
                    return (
                      <tr key={v.id} className="border-b border-gray-100 last:border-0">
                        <Td className="text-gray-900">{d?.label ?? v.metric_key}</Td>
                        <Td className="text-gray-600">
                          {v.site_id
                            ? (siteName.get(v.site_id) ?? '—')
                            : <span className="inline-flex items-center gap-1.5 text-gray-500">
                                <Building2 size={12} /> Organization-wide
                              </span>}
                        </Td>
                        <Td className="font-mono text-xs text-gray-500">{v.as_of_date ?? '—'}</Td>
                        <Td className="text-right font-mono text-gray-900">
                          {v.value.toLocaleString('en-US')}{' '}
                          <span className="text-gray-400">{d?.unit ?? ''}</span>
                        </Td>
                        <Td className="text-gray-500">{v.notes ?? ''}</Td>
                        <Td>
                          <EvidenceCell
                            recordType="business_metric_value"
                            recordId={v.id}
                            title={`${d?.label ?? v.metric_key} · FY ${year}`}
                            organizationId={organizationId}
                            canEdit={canEdit}
                            initialCount={evidenceCounts[evidenceCountKey('business_metric_value', v.id)] ?? 0}
                          />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {entryFor && (
        <ValueDialog
          definition={entryFor}
          sites={sites}
          year={year}
          onClose={() => setEntryFor(null)}
          onSaved={() => { setEntryFor(null); router.refresh(); }}
          supabase={supabase}
          toast={toast}
        />
      )}

      {defineOpen && (
        <DefineDialog
          organizationId={organizationId}
          onClose={() => setDefineOpen(false)}
          onSaved={() => { setDefineOpen(false); router.refresh(); }}
          supabase={supabase}
          toast={toast}
        />
      )}

      <MetricValueImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        metricKeys={visible.map((d) => d.metric_key)}
        sites={sites}
        existingValues={values}
        year={year}
        supabase={supabase}
        onImported={() => router.refresh()}
      />
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function MetricCard({ definition, total, isDenominator, entryCount, canEdit, onAdd }: {
  definition: BusinessMetricDefinition;
  total: number | null;
  isDenominator: boolean;
  entryCount: number;
  canEdit: boolean;
  onAdd: () => void;
}) {
  const cat = CATEGORY_META[definition.category] ?? CATEGORY_META.other;
  return (
    <Card className={cn(isDenominator && 'ring-2 ring-emerald-500/30 border-emerald-200')}>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">{definition.label}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <Badge variant={cat.variant as BadgeVariant}>{cat.label}</Badge>
              {isDenominator && (
                <Badge variant="default">
                  <Ruler size={10} className="mr-1" /> Intensity denominator
                </Badge>
              )}
              {definition.organization_id !== null && (
                <Badge variant="outline">Yours</Badge>
              )}
            </div>
          </div>
        </div>

        <div>
          {total === null ? (
            <p className="text-2xl font-semibold text-gray-300">not recorded</p>
          ) : (
            <p className="text-2xl font-semibold text-gray-900">
              {total.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              <span className="text-base font-normal text-gray-500 ml-1.5">{definition.unit}</span>
            </p>
          )}
          <p className="text-xs text-gray-400 mt-0.5">
            {AGGREGATION_HINT[definition.aggregation]}
            {entryCount > 0 && ` · ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`}
          </p>
        </div>

        {definition.description && (
          <p className="text-xs text-gray-500 leading-relaxed">{definition.description}</p>
        )}

        {canEdit && (
          <Button variant="outline" size="sm" onClick={onAdd} className="w-full">
            <Plus size={13} /> Add a figure
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function ValueDialog({ definition, sites, year, onClose, onSaved, supabase, toast }: {
  definition: BusinessMetricDefinition;
  sites: { id: string; name: string }[];
  year: number;
  onClose: () => void;
  onSaved: () => void;
  supabase: any;
  toast: (m: string, v?: 'default' | 'success' | 'error' | 'warning') => void;
}) {
  const [value, setValue] = useState('');
  const [siteId, setSiteId] = useState('');
  const [asOf, setAsOf] = useState(`${year}-12-31`);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const needsDate = definition.aggregation !== 'sum';

  async function save() {
    if (!value) { toast('Enter a value.', 'error'); return; }
    setSaving(true);
    const { error } = await supabase.from('business_metric_values').insert({
      metric_key: definition.metric_key,
      reporting_year: year,
      site_id: siteId || null,
      as_of_date: asOf || null,
      value: Number(value),
      notes: notes || null,
    });
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(`${definition.label} recorded.`, 'success');
    onSaved();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{definition.label} · FY {year}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label required>Value ({definition.unit})</Label>
              <Input type="number" step="any" value={value} className="mt-1"
                     placeholder={definition.unit} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div>
              <Label>As of</Label>
              <Input type="date" value={asOf} className="mt-1"
                     onChange={(e) => setAsOf(e.target.value)} />
              {needsDate && (
                <p className="text-xs text-amber-700 mt-1">
                  Required — only the latest reading per site is counted.
                </p>
              )}
            </div>
          </div>

          <div>
            <Label>Applies to</Label>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="mt-1 flex h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900"
            >
              <option value="">The whole organization</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Site-level figures let the reporting scope filter apply to the denominator as well
              as the emissions.
            </p>
          </div>

          <div>
            <Label>Notes</Label>
            <Input value={notes} className="mt-1" placeholder="Optional — source, basis, caveats"
                   onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save figure'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DefineDialog({ organizationId, onClose, onSaved, supabase, toast }: {
  organizationId: string | null;
  onClose: () => void;
  onSaved: () => void;
  supabase: any;
  toast: (m: string, v?: 'default' | 'success' | 'error' | 'warning') => void;
}) {
  const [label, setLabel] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('operational');
  const [aggregation, setAggregation] = useState<MetricAggregation>('sum');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const metricKey = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  async function save() {
    if (!label.trim() || !unit.trim()) { toast('A name and a unit are required.', 'error'); return; }
    if (!organizationId) { toast('No organization on your profile.', 'error'); return; }
    setSaving(true);
    const { error } = await supabase.from('business_metrics').insert({
      organization_id: organizationId,
      metric_key: metricKey,
      label: label.trim(),
      unit: unit.trim(),
      category,
      aggregation,
      description: description.trim() || null,
      is_denominator: true,
      display_order: 100,
    });
    setSaving(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(`${label.trim()} defined.`, 'success');
    onSaved();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Define a business metric</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label required>Name</Label>
              <Input value={label} className="mt-1" placeholder="e.g. Room-nights sold"
                     onChange={(e) => setLabel(e.target.value)} />
              {metricKey && <p className="text-xs text-gray-400 mt-1 font-mono">{metricKey}</p>}
            </div>
            <div>
              <Label required>Unit</Label>
              <Input value={unit} className="mt-1" placeholder="e.g. room-nights, EUR, tonnes"
                     onChange={(e) => setUnit(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Category</Label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                      className="mt-1 flex h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm">
                <option value="operational">Operational</option>
                <option value="financial">Financial</option>
                <option value="workforce">Workforce</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <Label>How it adds up</Label>
              <select value={aggregation}
                      onChange={(e) => setAggregation(e.target.value as MetricAggregation)}
                      className="mt-1 flex h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm">
                <option value="sum">A flow — add readings up</option>
                <option value="point_in_time">A stock — latest per site</option>
                <option value="average">An average across sites</option>
              </select>
            </div>
          </div>

          {/* The one choice here people get wrong, and it silently distorts every
              intensity figure the metric is used in. */}
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
            <span className="font-medium">Flow or stock?</span> Revenue and units shipped are flows —
            a year&apos;s worth is the readings added together. Headcount and floor area are stocks —
            adding twelve monthly readings would report twelve times the workforce, and any intensity
            using it would come out at a twelfth of the truth.
          </div>

          <div>
            <Label>Description</Label>
            <Input value={description} className="mt-1" placeholder="Optional — how it is defined"
                   onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !label.trim() || !unit.trim()}>
            {saving ? 'Saving…' : 'Define metric'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide', className)}>{children}</th>;
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-4 py-2.5 align-top', className)}>{children}</td>;
}
