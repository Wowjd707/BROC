'use client';

import { useState, useMemo, useTransition } from 'react';
import { isSiteKeyed } from '@/lib/custom-factors-core';
import { releaseEvidence } from '@/components/evidence/release-evidence';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { formatDate, toTitleCase, fmtFactor, perUnit, todayLocal } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CustomFactorImportDialog } from './CustomFactorImportDialog';
import { EvidenceCell } from '@/components/evidence/EvidencePanel';
import { evidenceCountKey } from '@/lib/evidence-core';
import Link from 'next/link';
import { Upload, ChevronLeft } from 'lucide-react';
import type { CustomEmissionFactor } from '@/lib/supabase/types';

interface Site { id: string; name: string; }
interface Scope1Fuel { fuel_type: string; co2e_factor: number; }
interface Refrigerant { refrigerant_code: string; refrigerant_name: string; gwp_100_year: number; }

interface Props {
  userRole: string;
  initialFactors: CustomEmissionFactor[];
  sites: Site[];
  scope1Fuels: Scope1Fuel[];
  refrigerants: Refrigerant[];
  organizationId: string | null;
  evidenceCounts: Record<string, number>;
}

const CATEGORY_META: Record<string, { label: string; unit: string; keyLabel: string; badge: 'default' | 'secondary' | 'blue' }> = {
  scope1:          { label: 'Scope 1 fuel',        unit: 'MMBtu', keyLabel: 'Fuel type',    badge: 'default' },
  scope2_location: { label: 'Scope 2 grid (site)', unit: 'kWh',   keyLabel: 'Site',         badge: 'blue' },
  // Market-based Scope 2 for a site with no contract, e.g. the Green-e
  // residual mix for its eGRID subregion. Without one, market-based uses the
  // grid average and the report discloses it.
  scope2_residual: { label: 'Scope 2 residual mix (site)', unit: 'kWh', keyLabel: 'Site',    badge: 'blue' },
  // Purchased heat or steam, from the supplier. Required for district heating.
  scope2_heat:     { label: 'Scope 2 heat/steam (site)', unit: 'kWh', keyLabel: 'Site', badge: 'blue' },
  refrigerant:     { label: 'Refrigerant GWP',     unit: 'kg',    keyLabel: 'Refrigerant',  badge: 'secondary' },
};

type Category = keyof typeof CATEGORY_META;

interface FormState {
  factor_category: Category;
  factor_key: string;
  label: string;
  co2e_factor: string;
  factor_source: string;
  data_year: string;
  effective_from: string;
  effective_to: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  factor_category: 'scope1',
  factor_key: '',
  label: '',
  co2e_factor: '',
  factor_source: '',
  data_year: String(new Date().getFullYear()),
  effective_from: `${new Date().getFullYear()}-01-01`,
  effective_to: '',
  notes: '',
};

export function FactorsClient({
  userRole, initialFactors, sites, scope1Fuels, refrigerants,
  organizationId, evidenceCounts,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const canEdit = userRole === 'admin' || userRole === 'editor';
  const canDelete = userRole === 'admin';

  const [factors, setFactors] = useState<CustomEmissionFactor[]>(initialFactors);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CustomEmissionFactor | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const siteName = useMemo(() => new Map(sites.map(s => [s.id, s.name])), [sites]);

  function keyLabelFor(f: { factor_category: string; factor_key: string; label: string | null }): string {
    if (f.label) return f.label;
    if (isSiteKeyed(f.factor_category)) return siteName.get(f.factor_key) ?? f.factor_key;
    return toTitleCase(f.factor_key);
  }

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setError('');
    setShowForm(true);
  }

  function openEdit(f: CustomEmissionFactor) {
    setForm({
      factor_category: f.factor_category as Category,
      factor_key: f.factor_key,
      label: f.label ?? '',
      co2e_factor: String(f.co2e_factor),
      factor_source: f.factor_source,
      data_year: String(f.data_year),
      effective_from: f.effective_from,
      effective_to: f.effective_to ?? '',
      notes: f.notes ?? '',
    });
    setEditing(f);
    setError('');
    setShowForm(true);
  }

  // Options for the key dropdown, driven by the selected category
  const keyOptions = useMemo(() => {
    if (form.factor_category === 'scope1') {
      return scope1Fuels.map(f => ({ value: f.fuel_type, label: `${toTitleCase(f.fuel_type)} (default ${f.co2e_factor} kg/MMBtu)` }));
    }
    if (form.factor_category === 'refrigerant') {
      return refrigerants.map(r => ({ value: r.refrigerant_code, label: `${r.refrigerant_name} (default GWP ${r.gwp_100_year})` }));
    }
    return sites.map(s => ({ value: s.id, label: s.name }));
  }, [form.factor_category, scope1Fuels, refrigerants, sites]);

  async function handleSave() {
    if (!form.factor_key) { setError('Select what this factor applies to.'); return; }
    const value = parseFloat(form.co2e_factor);
    if (!Number.isFinite(value) || value < 0) { setError('Enter a valid non-negative factor value.'); return; }
    if (!form.factor_source.trim()) { setError('A factor source is required (provenance is mandatory for auditability).'); return; }
    if (!form.data_year) { setError('A data year is required.'); return; }
    setError('');

    const meta = CATEGORY_META[form.factor_category];
    const payload = {
      factor_category: form.factor_category,
      factor_key: form.factor_key,
      label: form.label.trim() || null,
      co2e_factor: value,
      unit: meta.unit,
      factor_source: form.factor_source.trim(),
      data_year: parseInt(form.data_year),
      effective_from: form.effective_from,
      effective_to: form.effective_to || null,
      notes: form.notes.trim() || null,
    };

    startTransition(async () => {
      if (editing) {
        const { data, error: err } = await supabase
          .from('custom_emission_factors')
          .update(payload)
          .eq('id', editing.id)
          .select()
          .single();
        if (err) { setError(err.message); return; }
        setFactors(fs => fs.map(f => (f.id === editing.id ? (data as CustomEmissionFactor) : f)));
      } else {
        const { data, error: err } = await supabase
          .from('custom_emission_factors')
          .insert(payload)
          .select()
          .single();
        if (err) { setError(err.message); return; }
        setFactors(fs => [data as CustomEmissionFactor, ...fs]);
      }
      setShowForm(false);
      router.refresh();
    });
  }

  async function handleDelete() {
    if (!deleteId) return;
    // A factor already used by an entry, or a delete RLS refuses (only an
    // admin may delete), used to vanish from the list and come back on reload.
    const { data, error: err } = await supabase
      .from('custom_emission_factors').delete().eq('id', deleteId).select('id');
    setDeleteId(null);
    if (err || !data?.length) {
      toast(err?.message ?? 'That factor could not be deleted.', 'error');
      return;
    }
    setFactors(fs => fs.filter(f => f.id !== deleteId));
    const evidenceError = await releaseEvidence('custom_emission_factor', deleteId);
    if (evidenceError) toast(evidenceError, 'error');
    router.refresh();
  }

  function isCurrent(f: CustomEmissionFactor): boolean {
    const today = todayLocal();
    return f.is_active && f.effective_from <= today && (f.effective_to == null || f.effective_to > today);
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/data"
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition-colors mb-1"
          >
            <ChevronLeft size={13} />Environmental Data Entry
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">Emission Factors</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            Override the built-in reference factors (EPA, eGRID, IPCC) with your organization&apos;s own
            measured or supplier-specific values. Factors are versioned by effective date, so historical
            entries keep the factor that was in force when the activity occurred.
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload size={14} className="mr-1.5" />
              Import factors
            </Button>
            <Button onClick={openCreate}>Add custom factor</Button>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800">
        Custom factors take precedence over the global reference tables when an entry is saved.
        Where no custom factor applies for the activity date, the platform falls back to the built-in factor.
      </div>

      {factors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500 text-sm">
            <p>No custom factors yet. The platform is using its built-in reference factors for all calculations.</p>
            {canEdit && (
              <p className="text-xs text-gray-400 mt-2">
                Loading a whole vintage? Use{' '}
                <button onClick={() => setImportOpen(true)} className="text-emerald-700 hover:underline">
                  Import factors
                </button>{' '}
                instead of adding them one at a time.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Applies to</th>
                  <th className="px-4 py-3 font-medium text-right">Factor</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Effective</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Evidence</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {factors.map(f => {
                  const meta = CATEGORY_META[f.factor_category] ?? CATEGORY_META.scope1;
                  return (
                    <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <Badge variant={meta.badge}>{meta.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-900">{keyLabelFor(f)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                        {fmtFactor(f.co2e_factor)} <span className="text-gray-400 font-normal">kg/{perUnit(f.unit)}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {f.factor_source}
                        <span className="text-gray-400"> · {f.data_year}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {formatDate(f.effective_from)}
                        {' → '}
                        {f.effective_to ? formatDate(f.effective_to) : 'present'}
                      </td>
                      <td className="px-4 py-3">
                        {isCurrent(f)
                          ? <Badge variant="default">Current</Badge>
                          : <Badge variant="secondary">Historical</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        {/* The certificate or supplier declaration behind an
                            org-specific factor — the provenance `factor_source`
                            names in prose. */}
                        <EvidenceCell
                          recordType="custom_emission_factor"
                          recordId={f.id}
                          title={`${meta.label} · ${keyLabelFor(f)} · ${fmtFactor(f.co2e_factor)} kg/${perUnit(f.unit)}`}
                          organizationId={organizationId}
                          canEdit={canEdit}
                          initialCount={evidenceCounts[evidenceCountKey('custom_emission_factor', f.id)] ?? 0}
                        />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {canEdit && (
                          <button onClick={() => openEdit(f)} className="text-sm text-emerald-700 hover:underline mr-3">
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => setDeleteId(f.id)} className="text-sm text-red-600 hover:underline">
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Create / edit dialog */}
      <Dialog open={showForm} onOpenChange={(o) => { if (!o) setShowForm(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit custom factor' : 'Add custom factor'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label required>Category</Label>
              <Select
                value={form.factor_category}
                onValueChange={(v) => { setField('factor_category', v as Category); setField('factor_key', ''); }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_META).map(([value, m]) => (
                    <SelectItem key={value} value={value}>{m.label} (kg CO₂e/{m.unit})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label required>{CATEGORY_META[form.factor_category].keyLabel}</Label>
              <Select value={form.factor_key} onValueChange={(v) => setField('factor_key', v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {keyOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label required>Factor value (kg CO₂e/{CATEGORY_META[form.factor_category].unit})</Label>
                <Input type="number" step="any" min="0" value={form.co2e_factor}
                  onChange={(e) => setField('co2e_factor', e.target.value)} />
              </div>
              <div>
                <Label required>Data year</Label>
                <Input type="number" value={form.data_year}
                  onChange={(e) => setField('data_year', e.target.value)} />
              </div>
            </div>

            <div>
              <Label required>Source / provenance</Label>
              <Input value={form.factor_source} placeholder="e.g. Supplier declaration 2025-03, third-party verification cert."
                onChange={(e) => setField('factor_source', e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label required>Effective from</Label>
                <Input type="date" value={form.effective_from}
                  onChange={(e) => setField('effective_from', e.target.value)} />
              </div>
              <div>
                <Label>Effective to (optional)</Label>
                <Input type="date" value={form.effective_to}
                  onChange={(e) => setField('effective_to', e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Label (optional)</Label>
              <Input value={form.label} placeholder="Human-friendly name shown in the table"
                onChange={(e) => setField('label', e.target.value)} />
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={form.notes} rows={2} onChange={(e) => setField('notes', e.target.value)} />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? 'Saving…' : editing ? 'Save changes' : 'Add factor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CustomFactorImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        open={!!deleteId}
        title="Delete custom factor?"
        description="Entries already saved with this factor keep their stored values. New entries will fall back to the reference factor."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
