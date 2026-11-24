'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DrawerShell } from '@/components/ui/drawer-shell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AlertTriangle, Lock, XCircle } from 'lucide-react';
import { toCountryCode } from '@/lib/eudr-core';
import { regulationsForProduct } from '@/lib/compliance-core';
import { importIssues, embeddedEmissions, sectorForCode, yearOf, type ImportRow, type DeclarationRow } from '@/lib/cbam-core';
import { CountryPicker } from '../eudr/CountryPicker';
import { today, type Named, type ProductRow, type RuleRow, type ValueRow } from '../eudr/types';

type Draft = {
  product_id: string; supplier_id: string; import_date: string; customs_reference: string; cn_code: string;
  quantity: string; unit: 'tonne' | 'MWh'; country: string[]; installation_name: string; installation_id: string;
  direct: string; indirect: string; basis: '' | 'actual' | 'default'; source: string; verification: string;
  carbon_price: string; carbon_evidence: string; notes: string;
};

const num = (v: string) => (v.trim() ? Number(v.replace(/,/g, '')) : null);

/** The good's CN code to declare: the product's CN code, else its HS code. */
export function cnFor(p: Pick<ProductRow, 'cn_code' | 'hs_code'> | undefined): string {
  return (p?.cn_code ?? p?.hs_code ?? '').replace(/[\s.]/g, '');
}

/**
 * One import of a CBAM good. A new one starts from the part and from the
 * supplier's latest CBAM answers; the user confirms each figure and its source.
 */
export function ImportForm({
  imp, productId, products, rules, suppliers, values, declarations, canEdit, isAdmin, onCancel, onSaved,
}: {
  imp: ImportRow | null;
  productId?: string;
  products: (ProductRow & { country_of_origin?: string | null })[];
  rules: RuleRow[];
  suppliers: Named[];
  values: ValueRow[];
  declarations: DeclarationRow[];
  canEdit: boolean;
  isAdmin: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const cbamProducts = useMemo(
    () => products.filter((p) => p.id === (imp?.product_id ?? productId) || (p.is_active && regulationsForProduct(p, rules).includes('cbam'))),
    [products, rules, imp, productId],
  );

  function fromProduct(x: Draft, id: string): Draft {
    const p = products.find((y) => y.id === id);
    const latest = (key: string) => values
      .filter((v) => v.product_id === id && v.field_key === key)
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
    const direct = latest('cbam.direct_emissions');
    const indirect = latest('cbam.indirect_emissions');
    const basis = latest('cbam.emissions_basis')?.value;
    const country = toCountryCode(latest('cbam.installation_country')?.value) ?? toCountryCode(p?.country_of_origin ?? undefined);
    const answered = direct ?? indirect;
    return {
      ...x,
      product_id: id,
      supplier_id: x.supplier_id || p?.supplier_id || '',
      cn_code: x.cn_code || cnFor(p),
      country: x.country.length ? x.country : country ? [country] : [],
      installation_name: x.installation_name || latest('cbam.installation_name')?.value || '',
      direct: x.direct || direct?.value || '',
      indirect: x.indirect || indirect?.value || '',
      basis: x.basis || (basis === 'default' ? 'default' : basis ? 'actual' : ''),
      source: x.source || (answered ? `Supplier's answer recorded ${answered.recorded_at.slice(0, 10)}` : ''),
      verification: x.verification || latest('cbam.verification_statement')?.value || '',
    };
  }

  const [d, setD] = useState<Draft>(() => imp ? {
    product_id: imp.product_id, supplier_id: imp.supplier_id ?? '', import_date: imp.import_date,
    customs_reference: imp.customs_reference ?? '', cn_code: imp.cn_code, quantity: String(imp.quantity), unit: imp.unit,
    country: [imp.country_of_origin], installation_name: imp.installation_name ?? '', installation_id: imp.installation_id ?? '',
    direct: imp.direct_emissions?.toString() ?? '', indirect: imp.indirect_emissions?.toString() ?? '',
    basis: imp.emissions_basis ?? '', source: imp.emissions_source ?? '', verification: imp.verification_report ?? '',
    carbon_price: imp.carbon_price_paid_eur?.toString() ?? '', carbon_evidence: imp.carbon_price_evidence ?? '', notes: imp.notes ?? '',
  } : (productId ? fromProduct : (x: Draft) => x)({
    product_id: '', supplier_id: '', import_date: today(), customs_reference: '', cn_code: '', quantity: '', unit: 'tonne',
    country: [], installation_name: '', installation_id: '', direct: '', indirect: '', basis: '', source: '', verification: '',
    carbon_price: '', carbon_evidence: '', notes: '',
  }, productId ?? ''));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const year = d.import_date ? Number(d.import_date.slice(0, 4)) : null;
  const locked = [imp ? yearOf(imp) : null, year].some((y) => y != null && declarations.some((x) => x.year === y && x.status === 'submitted'));
  const readOnly = !canEdit || locked;
  const sector = sectorForCode(d.cn_code);
  const directOnly = sector === 'Iron & Steel' || sector === 'Aluminium' || sector === 'Hydrogen';

  const preview: ImportRow = {
    id: imp?.id ?? 'new', product_id: d.product_id, supplier_id: d.supplier_id || null, import_date: d.import_date,
    customs_reference: d.customs_reference || null, cn_code: d.cn_code.replace(/[\s.]/g, ''), quantity: num(d.quantity) ?? 0, unit: d.unit,
    country_of_origin: d.country[0] ?? '', installation_name: d.installation_name || null, installation_id: d.installation_id || null,
    direct_emissions: num(d.direct), indirect_emissions: num(d.indirect), emissions_basis: d.basis || null,
    emissions_source: d.source || null, verification_report: d.verification || null,
    carbon_price_paid_eur: num(d.carbon_price), carbon_price_evidence: d.carbon_evidence || null, notes: d.notes || null,
  };
  const issues = d.cn_code ? importIssues(preview) : [];
  const emb = embeddedEmissions(preview);

  async function save() {
    const cn = d.cn_code.replace(/[\s.]/g, '');
    if (!d.product_id) { setError('Choose the part.'); return; }
    if (!d.import_date) { setError('Enter the date the goods were released for free circulation.'); return; }
    if (!/^\d{4,10}$/.test(cn)) { setError('The CN code must be 4 to 10 digits.'); return; }
    const qty = num(d.quantity);
    if (qty == null || !(qty > 0)) { setError('Enter the net mass imported (a positive number).'); return; }
    if (d.country.length !== 1) { setError('Choose the country of origin.'); return; }
    const direct = num(d.direct), indirect = num(d.indirect), cp = num(d.carbon_price);
    if ([direct, indirect, cp].some((v) => v != null && !(v >= 0))) { setError('Emissions and carbon price must be zero or more.'); return; }
    if ((direct != null || indirect != null) && (!d.basis || !d.source.trim())) {
      setError('Say whether the emissions are actual or default values, and where they come from.'); return;
    }
    setSaving(true);
    const payload = {
      product_id: d.product_id, supplier_id: d.supplier_id || null, import_date: d.import_date,
      customs_reference: d.customs_reference.trim() || null, cn_code: cn, quantity: qty, unit: d.unit,
      country_of_origin: d.country[0], installation_name: d.installation_name.trim() || null,
      installation_id: d.installation_id.trim() || null, direct_emissions: direct, indirect_emissions: indirect,
      emissions_basis: direct != null || indirect != null ? d.basis || null : null,
      emissions_source: d.source.trim() || null, verification_report: d.verification.trim() || null,
      carbon_price_paid_eur: cp, carbon_price_evidence: d.carbon_evidence.trim() || null, notes: d.notes.trim() || null,
    };
    const res = imp
      ? await supabase.from('cbam_imports').update(payload).eq('id', imp.id)
      : await supabase.from('cbam_imports').insert(payload);
    setSaving(false);
    if (res.error) { setError(res.error.message); return; }
    onSaved();
  }

  async function remove() {
    if (!imp) return;
    const { error: err } = await supabase.from('cbam_imports').delete().eq('id', imp.id);
    setConfirmDelete(false);
    if (err) setError(err.message); else onSaved();
  }

  const part = products.find((p) => p.id === d.product_id);
  return (
    <DrawerShell
      title={imp ? `Import${imp.customs_reference ? ` ${imp.customs_reference}` : ''}` : 'Record an import'}
      subtitle={part ? `${part.part_number}${part.description ? ` · ${part.description}` : ''}` : 'A CBAM good released for free circulation in the EU'}
      footer={<>
        {imp && isAdmin && !locked && <Button variant="ghost" className="mr-auto text-gray-500" onClick={() => setConfirmDelete(true)}>Delete</Button>}
        <Button variant="outline" onClick={onCancel}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly && <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>}
      </>}
    >
      {locked && (
        <p className="text-sm text-gray-700 rounded-md bg-gray-50 border border-gray-100 px-3 py-2 flex gap-2">
          <Lock size={15} className="shrink-0 mt-0.5 text-gray-500" />
          The {year} declaration has been submitted, so this year&rsquo;s imports are locked. An admin can reopen it on the CBAM dashboard.
        </p>
      )}
      {issues.length > 0 && (
        <ul className="space-y-1.5">
          {issues.map((i) => (
            <li key={i.message} className={`text-sm flex gap-2 ${i.level === 'block' ? 'text-red-700' : 'text-amber-700'}`}>
              {i.level === 'block' ? <XCircle size={15} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5" />}
              {i.message}
            </li>
          ))}
        </ul>
      )}

      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {!productId && (
            <div className="sm:col-span-2">
              <Label required>Part</Label>
              <Select value={d.product_id || undefined} onValueChange={(v) => setD((x) => fromProduct(x, v))} disabled={readOnly}>
                <SelectTrigger><SelectValue placeholder="Choose a part in scope of CBAM…" /></SelectTrigger>
                <SelectContent>{cbamProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.part_number}{p.description ? ` · ${p.description}` : ''}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div><Label required>Import date</Label><Input type="date" value={d.import_date} onChange={(e) => set('import_date', e.target.value)} /></div>
          <div><Label>Customs reference</Label><Input value={d.customs_reference} onChange={(e) => set('customs_reference', e.target.value)} placeholder="MRN or entry number" /></div>
          <div>
            <Label required>CN code</Label>
            <Input value={d.cn_code} onChange={(e) => set('cn_code', e.target.value)} className="font-mono" placeholder="73269098" />
            {d.cn_code && <p className="text-xs text-gray-500 mt-1">{sector ?? 'Not under a CBAM heading'}</p>}
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <div><Label required>Net mass</Label><Input value={d.quantity} onChange={(e) => set('quantity', e.target.value)} inputMode="decimal" /></div>
            <div>
              <Label>Unit</Label>
              <Select value={d.unit} onValueChange={(v) => set('unit', v as Draft['unit'])} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="tonne">tonnes</SelectItem><SelectItem value="MWh">MWh</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div className="sm:col-span-2"><Label required>Country of origin</Label><CountryPicker value={d.country} onChange={(v) => set('country', v)} multiple={false} /></div>
          <div>
            <Label>Supplier</Label>
            <Select value={d.supplier_id || 'none'} onValueChange={(v) => set('supplier_id', v === 'none' ? '' : v)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Producing installation</Label><Input value={d.installation_name} onChange={(e) => set('installation_name', e.target.value)} /></div>
        </div>

        <div>
          <p className="text-sm font-medium text-gray-900">Embedded emissions</p>
          <p className="text-xs text-gray-500 mb-3">
            Per {d.unit === 'MWh' ? 'MWh' : 'tonne'}, from the producer or the Commission&rsquo;s default values.
            {directOnly && ` ${sector} counts direct emissions only (Annex II).`}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><Label>Direct (t CO₂e)</Label><Input value={d.direct} onChange={(e) => set('direct', e.target.value)} inputMode="decimal" /></div>
            <div>
              <Label>Indirect (t CO₂e)</Label>
              <Input value={d.indirect} onChange={(e) => set('indirect', e.target.value)} inputMode="decimal" placeholder={directOnly ? 'Not counted' : ''} />
            </div>
            <div>
              <Label>Basis</Label>
              <Select value={d.basis || undefined} onValueChange={(v) => set('basis', v as Draft['basis'])} disabled={readOnly}>
                <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent><SelectItem value="actual">Actual values</SelectItem><SelectItem value="default">Default values</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-3">
              <Label>Source</Label>
              <Input value={d.source} onChange={(e) => set('source', e.target.value)}
                placeholder={d.basis === 'default' ? 'Commission default values publication and its date' : 'Producer communication, with its date'} />
            </div>
            {d.basis === 'actual' && (
              <div className="sm:col-span-3"><Label>Verification report</Label><Input value={d.verification} onChange={(e) => set('verification', e.target.value)} placeholder="Verifier and report reference" /></div>
            )}
          </div>
          {emb && <p className="text-sm text-gray-700 mt-2">{emb.perUnit.toFixed(3)} t CO₂e per {d.unit === 'MWh' ? 'MWh' : 'tonne'} · <span className="font-medium">{emb.total.toFixed(2)} t CO₂e</span> for this import</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><Label>Carbon price paid abroad (EUR, whole import)</Label><Input value={d.carbon_price} onChange={(e) => set('carbon_price', e.target.value)} inputMode="decimal" /></div>
          <div><Label>Evidence of the carbon price</Label><Input value={d.carbon_evidence} onChange={(e) => set('carbon_evidence', e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>Notes</Label><Textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        </div>
      </fieldset>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this import?"
        description="It is removed from the year's totals and the declaration pack. The audit trail keeps a record that it existed."
        confirmLabel="Delete"
        onConfirm={remove}
      />
    </DrawerShell>
  );
}
