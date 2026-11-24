'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Json } from '@/lib/supabase/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DrawerContent } from '@/components/ui/dialog';
import { DrawerShell } from '@/components/ui/drawer-shell';
import { Plus, ShieldCheck } from 'lucide-react';
import { RISK_CRITERIA, assessmentGaps, countryName, type CriterionAnswer } from '@/lib/eudr-core';
import { CountryPicker } from './CountryPicker';
import { today, type Assessment, type Named } from './types';

const RISK_LABEL = { low: 'Low', standard: 'Standard', high: 'High' } as const;

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

type Draft = {
  supplier_id: string; country: string[]; commodity: string; country_risk: 'low' | 'standard' | 'high';
  country_risk_basis: string; criteria: Record<string, CriterionAnswer>; conclusion: 'negligible' | 'not_negligible';
  mitigation: string; assessed_at: string; review_by: string; notes: string;
};

export interface AssessmentPreset { supplier_id?: string | null; country?: string | null; commodity?: string | null }

function draftOf(a: Assessment | null, preset?: AssessmentPreset): Draft {
  const t = today();
  return a ? {
    supplier_id: a.supplier_id ?? '', country: [a.country_code], commodity: a.commodity, country_risk: a.country_risk,
    country_risk_basis: a.country_risk_basis, criteria: a.criteria ?? {}, conclusion: a.conclusion,
    mitigation: a.mitigation ?? '', assessed_at: a.assessed_at, review_by: a.review_by ?? '', notes: a.notes ?? '',
  } : {
    supplier_id: preset?.supplier_id ?? '', country: preset?.country ? [preset.country] : [], commodity: preset?.commodity ?? '',
    country_risk: 'standard',
    // Where the Commission's classification is published; the assessor confirms the country's entry.
    country_risk_basis: 'Commission Implementing Regulation (EU) 2025/1093, Annex',
    criteria: {}, conclusion: 'negligible', mitigation: '', assessed_at: t, review_by: addMonths(t, 12), notes: '',
  };
}

export function RiskTab({
  assessments, suppliers, canEdit, onChanged,
}: { assessments: Assessment[]; suppliers: Named[]; canEdit: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState<null | { a: Assessment | null }>(null);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const now = today();

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <p className="text-sm text-gray-600 max-w-3xl">
          One assessment per supplier, country and commodity, against the criteria of Art. 10(2), with any mitigation under
          Art. 11. Where the country is classified low risk, Art. 13 lets you skip the criteria unless something points to a
          risk — record the classification and its basis anyway, so the shipment shows why.
        </p>
        {canEdit && <Button size="sm" onClick={() => setOpen({ a: null })}><Plus size={14} className="mr-1.5" />New assessment</Button>}
      </div>

      {assessments.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-gray-500">
          <ShieldCheck className="mx-auto mb-2 text-gray-300" />No risk assessments yet.
        </CardContent></Card>
      ) : (
        <div className="border border-gray-100 rounded-lg bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 text-left">
              <tr><th className="px-3 py-2">Country</th><th className="hidden md:table-cell px-3 py-2">Supplier</th><th className="hidden md:table-cell px-3 py-2">Commodity</th>
                <th className="hidden md:table-cell px-3 py-2">Country risk</th><th className="px-3 py-2">Conclusion</th><th className="hidden md:table-cell px-3 py-2">Assessed</th><th className="hidden md:table-cell px-3 py-2">Review by</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {assessments.map((a) => {
                const gaps = assessmentGaps(a);
                const overdue = a.review_by != null && a.review_by < now;
                return (
                  <tr key={a.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpen({ a })}>
                    <td className="px-3 py-2">
                      <p className="text-gray-900">{countryName(a.country_code)}</p>
                      <p className="md:hidden text-xs text-gray-500">
                        {[a.commodity, a.supplier_id ? supplierName.get(a.supplier_id) : 'any supplier', `${RISK_LABEL[a.country_risk].toLowerCase()} risk`, a.review_by ? `review by ${a.review_by}` : null].filter(Boolean).join(' · ')}
                        {overdue ? <span className="text-red-600"> (overdue)</span> : null}
                      </p>
                    </td>
                    <td className="hidden md:table-cell px-3 py-2">{a.supplier_id ? supplierName.get(a.supplier_id) ?? '—' : <span className="text-gray-400">Any</span>}</td>
                    <td className="hidden md:table-cell px-3 py-2">{a.commodity}</td>
                    <td className="hidden md:table-cell px-3 py-2"><Badge variant={a.country_risk === 'high' ? 'destructive' : a.country_risk === 'standard' ? 'warning' : 'secondary'}>{RISK_LABEL[a.country_risk]}</Badge></td>
                    <td className="px-3 py-2">
                      {a.conclusion === 'negligible' ? <Badge variant="default">Negligible</Badge> : <Badge variant="destructive">Not negligible</Badge>}
                      {gaps.length > 0 && <span className="ml-2 text-xs text-amber-700">{gaps.length} gap{gaps.length === 1 ? '' : 's'}</span>}
                    </td>
                    <td className="hidden md:table-cell px-3 py-2 text-xs text-gray-600">{a.assessed_at}</td>
                    <td className={`hidden md:table-cell px-3 py-2 text-xs ${overdue ? 'text-red-600' : 'text-gray-600'}`}>{a.review_by ?? '—'}{overdue ? ' (overdue)' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        {open && (
          <DrawerContent className="max-w-3xl">
            <AssessmentForm assessment={open.a} suppliers={suppliers} canEdit={canEdit}
              onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onChanged(); }} />
          </DrawerContent>
        )}
      </Dialog>
    </div>
  );
}

export function AssessmentForm({
  assessment, preset, suppliers, canEdit, onClose, onSaved,
}: {
  assessment: Assessment | null; preset?: AssessmentPreset; suppliers: Named[]; canEdit: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const supabase = createClient();
  const [d, setD] = useState<Draft>(draftOf(assessment, preset));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setCriterion = (key: string, patch: Partial<CriterionAnswer>) =>
    setD((x) => ({ ...x, criteria: { ...x.criteria, [key]: { ...(x.criteria[key] ?? { finding: '', concern: false }), ...patch } } }));
  const gaps = assessmentGaps({ country_risk: d.country_risk, criteria: d.criteria, conclusion: d.conclusion, mitigation: d.mitigation });

  async function save() {
    if (d.country.length !== 1) { setError('Choose the country of production.'); return; }
    if (!d.commodity.trim()) { setError('Enter the commodity, for example Rubber or Wood.'); return; }
    if (!d.country_risk_basis.trim()) { setError('Say where the country classification comes from.'); return; }
    setSaving(true);
    const payload = {
      supplier_id: d.supplier_id || null, country_code: d.country[0], commodity: d.commodity.trim(),
      country_risk: d.country_risk, country_risk_basis: d.country_risk_basis.trim(), criteria: d.criteria as unknown as Json,
      conclusion: d.conclusion, mitigation: d.mitigation.trim() || null, assessed_at: d.assessed_at,
      review_by: d.review_by || null, notes: d.notes.trim() || null,
    };
    const { error: err } = assessment
      ? await supabase.from('eudr_risk_assessments').update(payload).eq('id', assessment.id)
      : await supabase.from('eudr_risk_assessments').insert(payload);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  const lowRisk = d.country_risk === 'low';

  return (
    <DrawerShell
      title={assessment ? `Risk assessment · ${countryName(assessment.country_code)}` : 'New risk assessment'}
      subtitle="Regulation (EU) 2023/1115, Articles 10, 11 and 13"
      footer={canEdit ? <>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </> : <Button variant="outline" onClick={onClose}>Close</Button>}
    >
      <fieldset disabled={!canEdit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label>Supplier</Label>
            <Select value={d.supplier_id || 'none'} onValueChange={(v) => set('supplier_id', v === 'none' ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any supplier</SelectItem>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label required>Country of production</Label>
            <CountryPicker value={d.country} onChange={(v) => set('country', v)} multiple={false} />
          </div>
          <div>
            <Label required>Commodity</Label>
            <Input value={d.commodity} onChange={(e) => set('commodity', e.target.value)} placeholder="Rubber" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label required>Country risk (Art. 29)</Label>
            <Select value={d.country_risk} onValueChange={(v) => set('country_risk', v as Draft['country_risk'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label required>Basis for the classification</Label>
            <Input value={d.country_risk_basis} onChange={(e) => set('country_risk_basis', e.target.value)} />
            <p className="text-xs text-gray-400 mt-1">Check the country against the classification in force on the assessment date.</p>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-900">Criteria, Art. 10(2)</p>
          <p className="text-xs text-gray-500 mb-2">
            {lowRisk
              ? 'Low-risk country: Art. 13 means these are optional, unless you have information pointing to a risk. Record anything you found.'
              : 'Record what you found for each, and tick where it raises a concern.'}
          </p>
          <div className="space-y-2">
            {RISK_CRITERIA.map((c) => {
              const v = d.criteria[c.key] ?? { finding: '', concern: false };
              return (
                <div key={c.key} className="grid grid-cols-[2rem_1fr_auto] gap-2 items-start">
                  <span className="text-xs font-mono text-gray-500 pt-2">({c.key})</span>
                  <div>
                    <p className="text-xs text-gray-600 mb-1">{c.label}</p>
                    <Textarea rows={1} value={v.finding} onChange={(e) => setCriterion(c.key, { finding: e.target.value })}
                      placeholder={lowRisk ? 'Optional' : 'What you checked and found'} className="min-h-[2.25rem]" />
                  </div>
                  <label className="text-xs text-gray-600 inline-flex items-center gap-1 pt-6">
                    <input type="checkbox" checked={v.concern} onChange={(e) => setCriterion(c.key, { concern: e.target.checked })} /> Concern
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label required>Conclusion</Label>
            <Select value={d.conclusion} onValueChange={(v) => set('conclusion', v as Draft['conclusion'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="negligible">No or negligible risk</SelectItem>
                <SelectItem value="not_negligible">Risk is not negligible</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label required>Assessed on</Label>
            <Input type="date" value={d.assessed_at} onChange={(e) => set('assessed_at', e.target.value)} />
          </div>
          <div>
            <Label>Review by</Label>
            <Input type="date" value={d.review_by} onChange={(e) => set('review_by', e.target.value)} />
          </div>
        </div>

        <div>
          <Label>Mitigation (Art. 11)</Label>
          <Textarea rows={3} value={d.mitigation} onChange={(e) => set('mitigation', e.target.value)}
            placeholder="Additional information requested, audits or surveys carried out, and why the risk is now negligible" />
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {gaps.length > 0 && (
          <div className="rounded-md bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800 space-y-1">
            {gaps.map((g) => <p key={g}>{g}</p>)}
            <p className="text-amber-700">You can save it now; a shipment relying on it will not be ready to file until these are resolved.</p>
          </div>
        )}
        {d.conclusion === 'not_negligible' && (
          <p className="text-xs text-red-700">While the risk is not negligible, products from this source cannot be placed on the market or exported (Art. 3).</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </fieldset>
    </DrawerShell>
  );
}
