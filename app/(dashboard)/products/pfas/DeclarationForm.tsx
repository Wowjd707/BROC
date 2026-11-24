'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DrawerShell } from '@/components/ui/drawer-shell';
import { Plus, X } from 'lucide-react';
import {
  STATUS_LABEL, BASIS_LABEL, validCas, type DeclarationRow, type SubstanceRow, type PfasStatus, type PfasBasis,
} from '@/lib/pfas-core';
import { today, type Named } from '../eudr/types';

type Sub = { id: string | null; name: string; cas: string; fn: string; component: string; low: string; high: string; unit: '' | 'ppm' | 'percent' | 'mg_per_unit' };
const blankSub = (): Sub => ({ id: null, name: '', cas: '', fn: '', component: '', low: '', high: '', unit: '' });
const num = (v: string) => (v.trim() ? Number(v.replace(/,/g, '')) : null);

/** Markets the form offers as one-tap chips; any other code can be typed. */
const COMMON_MARKETS = ['US-MN', 'US-ME', 'US', 'CA', 'EU'];

/**
 * A part's PFAS declaration and, when it contains intentionally added PFAS,
 * each substance. Saved together: the declaration first, then the substances
 * that were added, changed or removed.
 */
export function DeclarationForm({
  declaration, substances, productId, supplierId, suppliers, canEdit, onCancel, onSaved,
}: {
  declaration: DeclarationRow | null;
  substances: SubstanceRow[];
  productId: string;
  supplierId: string | null;
  suppliers: Named[];
  canEdit: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const existing = declaration ? substances.filter((s) => s.declaration_id === declaration.id) : [];
  const [status, setStatus] = useState<PfasStatus>(declaration?.status ?? 'unknown');
  const [basis, setBasis] = useState<PfasBasis | ''>(declaration?.basis ?? '');
  const [evidence, setEvidence] = useState(declaration?.evidence ?? '');
  const [declaredOn, setDeclaredOn] = useState(declaration?.declared_on ?? today());
  const [supplier, setSupplier] = useState(declaration?.supplier_id ?? supplierId ?? '');
  const [markets, setMarkets] = useState<string[]>(declaration?.markets ?? []);
  const [marketInput, setMarketInput] = useState('');
  const [category, setCategory] = useState(declaration?.product_category ?? '');
  const [notes, setNotes] = useState(declaration?.notes ?? '');
  const [subs, setSubs] = useState<Sub[]>(existing.length ? existing.map((s) => ({
    id: s.id, name: s.name, cas: s.cas_number ?? '', fn: s.function ?? '', component: s.component ?? '',
    low: s.amount_low?.toString() ?? '', high: s.amount_high?.toString() ?? '', unit: s.amount_unit ?? '',
  })) : status === 'intentionally_added' ? [blankSub()] : []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const readOnly = !canEdit;
  const setSub = (i: number, patch: Partial<Sub>) => setSubs((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  function addMarket(raw: string) {
    // "EU" is shorthand people use; the rules work per Member State, so it is kept as typed and only informs.
    const code = raw.trim().toUpperCase();
    if (!code) return;
    if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(code)) { setError('Markets are two-letter country codes (DE), or US states as US-MN.'); return; }
    setError('');
    if (!markets.includes(code)) setMarkets([...markets, code]);
    setMarketInput('');
  }

  async function save() {
    if (status !== 'unknown') {
      if (!basis) { setError('Say what the answer is based on.'); return; }
      if (!evidence.trim()) { setError('Reference the evidence: the declaration, test report or assessment.'); return; }
      if (!declaredOn) { setError('Enter the date of the declaration or report.'); return; }
    }
    const keep = status === 'intentionally_added' ? subs.filter((s) => s.name.trim() || s.cas.trim()) : [];
    for (const s of keep) {
      if (!s.name.trim()) { setError('Every substance needs a name.'); return; }
      if (s.cas.trim() && !validCas(s.cas)) { setError(`${s.cas} is not a valid CAS number.`); return; }
      const lo = num(s.low), hi = num(s.high);
      if ((lo != null || hi != null) && !s.unit) { setError(`${s.name}: choose the unit of the amount.`); return; }
      if (lo != null && hi != null && lo > hi) { setError(`${s.name}: the low end of the range is above the high end.`); return; }
    }
    setSaving(true);
    const payload = {
      product_id: productId, status, basis: status === 'unknown' ? null : basis || null,
      evidence: status === 'unknown' ? null : evidence.trim(), declared_on: status === 'unknown' ? null : declaredOn,
      supplier_id: supplier || null, markets, product_category: category.trim() || null, notes: notes.trim() || null,
    };
    const res = declaration
      ? await supabase.from('pfas_declarations').update(payload).eq('id', declaration.id).select('id').single()
      : await supabase.from('pfas_declarations').insert(payload).select('id').single();
    if (res.error || !res.data) { setSaving(false); setError(res.error?.message ?? 'Could not be saved.'); return; }
    const declId = res.data.id as string;

    const rows = keep.map((s) => ({
      declaration_id: declId, name: s.name.trim(), cas_number: s.cas.trim() || null, function: s.fn.trim() || null,
      component: s.component.trim() || null, amount_low: num(s.low), amount_high: num(s.high) ?? num(s.low), amount_unit: s.unit || null,
    }));
    const removed = existing.filter((e) => !keep.some((k) => k.id === e.id)).map((e) => e.id);
    if (removed.length) {
      const { error: e } = await supabase.from('pfas_substances').delete().in('id', removed);
      if (e) { setSaving(false); setError(`Saved, but substances could not be removed: ${e.message}`); return; }
    }
    for (const [i, s] of keep.entries()) {
      const r = s.id
        ? await supabase.from('pfas_substances').update(rows[i]).eq('id', s.id)
        : await supabase.from('pfas_substances').insert(rows[i]);
      if (r.error) { setSaving(false); setError(`Saved, but ${s.name} could not be: ${r.error.message}`); return; }
    }
    setSaving(false);
    onSaved();
  }

  return (
    <DrawerShell
      title="PFAS declaration"
      subtitle="Whether the part contains intentionally added PFAS, on what evidence, and where it is sold."
      footer={<>
        <Button variant="outline" onClick={onCancel}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly && <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>}
      </>}
    >
      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Label required>Answer</Label>
            <Select value={status} onValueChange={(v) => { setStatus(v as PfasStatus); if (v === 'intentionally_added' && subs.length === 0) setSubs([blankSub()]); }} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(STATUS_LABEL) as PfasStatus[]).map((k) => <SelectItem key={k} value={k}>{STATUS_LABEL[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {status !== 'unknown' && <>
            <div>
              <Label required>Based on</Label>
              <Select value={basis || undefined} onValueChange={(v) => setBasis(v as PfasBasis)} disabled={readOnly}>
                <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>{(Object.keys(BASIS_LABEL) as PfasBasis[]).map((k) => <SelectItem key={k} value={k}>{BASIS_LABEL[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label required>Dated</Label><Input type="date" value={declaredOn} onChange={(e) => setDeclaredOn(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label required>Evidence</Label><Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Supplier PFAS statement ref., lab report no." /></div>
          </>}
          <div>
            <Label>Supplier</Label>
            <Select value={supplier || 'none'} onValueChange={(v) => setSupplier(v === 'none' ? '' : v)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Product category</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="As reporting forms describe it" /></div>
        </div>

        <div>
          <Label>Markets</Label>
          <p className="text-xs text-gray-500 mb-2">Where the part is sold, offered or distributed. US states as US-MN; they decide which PFAS rules apply.</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {markets.map((m) => (
              <span key={m} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-800 text-xs px-2 py-0.5">
                {m}<button type="button" onClick={() => setMarkets(markets.filter((x) => x !== m))} aria-label={`Remove ${m}`}><X size={12} /></button>
              </span>
            ))}
            {COMMON_MARKETS.filter((m) => !markets.includes(m)).map((m) => (
              <button key={m} type="button" onClick={() => addMarket(m)} className="rounded-full border border-dashed border-gray-300 text-xs text-gray-600 px-2 py-0.5 hover:border-gray-500">+ {m}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={marketInput} onChange={(e) => setMarketInput(e.target.value.toUpperCase())} placeholder="Other code, e.g. DE or US-NY"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMarket(marketInput); } }} />
            <Button type="button" variant="outline" onClick={() => addMarket(marketInput)}>Add</Button>
          </div>
        </div>

        {status === 'intentionally_added' && (
          <div>
            <p className="text-sm font-medium text-gray-900">Substances</p>
            <p className="text-xs text-gray-500 mb-3">Each intentionally added PFAS: its CAS number, what it does, where it is, and how much (exact, or a range).</p>
            <div className="space-y-3">
              {subs.map((s, i) => (
                <div key={i} className="rounded-md border border-gray-100 p-3 space-y-3">
                  <div className="flex gap-2">
                    <div className="flex-1"><Label>Substance</Label><Input value={s.name} onChange={(e) => setSub(i, { name: e.target.value })} placeholder="PTFE" /></div>
                    <div className="w-36">
                      <Label>CAS number</Label>
                      <Input value={s.cas} onChange={(e) => setSub(i, { cas: e.target.value })} className={`font-mono ${s.cas && !validCas(s.cas) ? 'border-red-300' : ''}`} placeholder="9002-84-0" />
                    </div>
                    {!readOnly && <button type="button" className="self-end mb-2 text-gray-400 hover:text-red-600" onClick={() => setSubs(subs.filter((_, j) => j !== i))} aria-label="Remove substance"><X size={15} /></button>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><Label>What it does</Label><Input value={s.fn} onChange={(e) => setSub(i, { fn: e.target.value })} placeholder="Low-friction seal face" /></div>
                    <div><Label>Where in the part</Label><Input value={s.component} onChange={(e) => setSub(i, { component: e.target.value })} placeholder="Shaft seal" /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Amount from</Label><Input value={s.low} onChange={(e) => setSub(i, { low: e.target.value })} inputMode="decimal" /></div>
                    <div><Label>to</Label><Input value={s.high} onChange={(e) => setSub(i, { high: e.target.value })} inputMode="decimal" placeholder="same" /></div>
                    <div>
                      <Label>Unit</Label>
                      <Select value={s.unit || undefined} onValueChange={(v) => setSub(i, { unit: v as Sub['unit'] })} disabled={readOnly}>
                        <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
                        <SelectContent><SelectItem value="ppm">ppm</SelectItem><SelectItem value="percent">%</SelectItem><SelectItem value="mg_per_unit">mg per unit</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
              {!readOnly && <Button type="button" size="sm" variant="outline" onClick={() => setSubs([...subs, blankSub()])}><Plus size={13} className="mr-1" />Add substance</Button>}
            </div>
          </div>
        )}

        <div><Label>Notes</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </fieldset>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </DrawerShell>
  );
}
