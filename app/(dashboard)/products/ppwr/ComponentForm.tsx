'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DrawerShell } from '@/components/ui/drawer-shell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AlertTriangle, XCircle } from 'lucide-react';
import { MATERIALS, FUNCTIONS, componentIssues, gramsPerUnit, type ComponentRow, type Material, type PackagingFunction } from '@/lib/ppwr-core';
import type { Named, ValueRow } from '../eudr/types';

type Draft = {
  name: string; material: Material; material_detail: string; function: PackagingFunction; weight_g: string;
  units_per_packaging: string; reusable: boolean; food_contact: boolean; recycled: string; supplier_id: string;
  heavy_metals: string; pfas: string; conformity: string; notes: string;
};

/** ppwr.packaging_material answers, in the Annex IX material columns. */
const FROM_ANSWER: Record<string, Material> = {
  paper_cardboard: 'paper_cardboard', plastic: 'plastic', wood: 'wood', steel: 'ferrous_metal',
  aluminium: 'aluminium', glass: 'glass', composite: 'other', other: 'other',
};

const num = (v: string) => (v.trim() ? Number(v.replace(/,/g, '')) : null);

/**
 * One piece of a part's packaging. A new one starts from the supplier's latest
 * PPWR answers, where there are any; the user confirms each value.
 */
export function ComponentForm({
  component, productId, supplierId, suppliers, values, canEdit, isAdmin, onCancel, onSaved,
}: {
  component: ComponentRow | null;
  productId: string;
  supplierId: string | null;
  suppliers: Named[];
  values: ValueRow[];
  canEdit: boolean;
  isAdmin: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [d, setD] = useState<Draft>(() => {
    if (component) {
      return {
        name: component.name, material: component.material, material_detail: component.material_detail ?? '',
        function: component.function, weight_g: String(component.weight_g), units_per_packaging: String(component.units_per_packaging),
        reusable: component.reusable, food_contact: component.food_contact, recycled: component.recycled_content_pct?.toString() ?? '',
        supplier_id: component.supplier_id ?? '', heavy_metals: component.heavy_metals_evidence ?? '', pfas: component.pfas_evidence ?? '',
        conformity: component.conformity_reference ?? '', notes: component.notes ?? '',
      };
    }
    const latest = (key: string) => values
      .filter((v) => v.product_id === productId && v.field_key === key)
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0]?.value;
    const fn = latest('ppwr.packaging_function');
    return {
      name: '', material: FROM_ANSWER[latest('ppwr.packaging_material') ?? ''] ?? 'paper_cardboard', material_detail: '',
      function: fn === 'grouped' || fn === 'transport' ? fn : 'sales', weight_g: latest('ppwr.packaging_weight') ?? '',
      units_per_packaging: '1', reusable: latest('ppwr.reusable') === 'yes', food_contact: false,
      recycled: latest('ppwr.recycled_content') ?? '', supplier_id: supplierId ?? '',
      heavy_metals: latest('ppwr.substances_declaration') ?? '', pfas: '', conformity: '', notes: '',
    };
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const readOnly = !canEdit;

  const preview: ComponentRow = {
    id: component?.id ?? 'new', product_id: productId, name: d.name, material: d.material, material_detail: d.material_detail || null,
    function: d.function, weight_g: num(d.weight_g) ?? 0, units_per_packaging: num(d.units_per_packaging) ?? 1,
    reusable: d.reusable, food_contact: d.food_contact, recycled_content_pct: num(d.recycled), supplier_id: d.supplier_id || null,
    heavy_metals_evidence: d.heavy_metals || null, pfas_evidence: d.pfas || null, conformity_reference: d.conformity || null,
    notes: d.notes || null, is_active: true,
  };
  const issues = componentIssues(preview);
  const perUnit = num(d.weight_g) && num(d.units_per_packaging) ? gramsPerUnit(preview) : null;

  async function save() {
    if (!d.name.trim()) { setError('Name the packaging, for example "Outer carton" or "Pallet wrap".'); return; }
    const w = num(d.weight_g), u = num(d.units_per_packaging), r = num(d.recycled);
    if (w == null || !(w > 0)) { setError('Enter the weight of one piece of packaging, in grams.'); return; }
    if (u == null || !(u > 0)) { setError('Enter how many units of the part one piece holds (1 for packaging of a single unit).'); return; }
    if (r != null && !(r >= 0 && r <= 100)) { setError('Recycled content is a percentage from 0 to 100.'); return; }
    setSaving(true);
    const payload = {
      product_id: productId, name: d.name.trim(), material: d.material, material_detail: d.material_detail.trim() || null,
      function: d.function, weight_g: w, units_per_packaging: u, reusable: d.reusable, food_contact: d.food_contact,
      recycled_content_pct: r, supplier_id: d.supplier_id || null, heavy_metals_evidence: d.heavy_metals.trim() || null,
      pfas_evidence: d.pfas.trim() || null, conformity_reference: d.conformity.trim() || null, notes: d.notes.trim() || null,
    };
    const res = component
      ? await supabase.from('packaging_components').update(payload).eq('id', component.id)
      : await supabase.from('packaging_components').insert(payload);
    setSaving(false);
    if (res.error) { setError(res.error.message); return; }
    onSaved();
  }

  async function retire() {
    // Retired, not deleted: past reports were computed from it.
    const { error: err } = await supabase.from('packaging_components').update({ is_active: false }).eq('id', component!.id);
    setConfirmDelete(false);
    if (err) setError(err.message); else onSaved();
  }

  return (
    <DrawerShell
      title={component ? component.name : 'Add packaging'}
      subtitle="One piece of this part's packaging, as it is placed on the market."
      footer={<>
        {component && isAdmin && component.is_active && <Button variant="ghost" className="mr-auto text-gray-500" onClick={() => setConfirmDelete(true)}>Retire</Button>}
        <Button variant="outline" onClick={onCancel}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly && <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>}
      </>}
    >
      {issues.length > 0 && d.name && (
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
          <div className="sm:col-span-2"><Label required>Name</Label><Input value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="Outer carton" /></div>
          <div>
            <Label required>Material</Label>
            <Select value={d.material} onValueChange={(v) => set('material', v as Material)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MATERIALS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Material detail</Label><Input value={d.material_detail} onChange={(e) => set('material_detail', e.target.value)} placeholder="LDPE film, corrugated board…" /></div>
          <div>
            <Label required>Function</Label>
            <Select value={d.function} onValueChange={(v) => set('function', v as PackagingFunction)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FUNCTIONS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
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
          <div><Label required>Weight of one piece (g)</Label><Input value={d.weight_g} onChange={(e) => set('weight_g', e.target.value)} inputMode="decimal" /></div>
          <div>
            <Label required>Units of the part it holds</Label>
            <Input value={d.units_per_packaging} onChange={(e) => set('units_per_packaging', e.target.value)} inputMode="decimal" />
            {perUnit != null && <p className="text-xs text-gray-500 mt-1">{perUnit.toLocaleString(undefined, { maximumFractionDigits: 3 })} g per unit of the part</p>}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-800"><input type="checkbox" checked={d.reusable} onChange={(e) => set('reusable', e.target.checked)} />Reusable packaging</label>
          <label className="flex items-center gap-2 text-sm text-gray-800"><input type="checkbox" checked={d.food_contact} onChange={(e) => set('food_contact', e.target.checked)} />In contact with food</label>
          {d.material === 'plastic' && (
            <div><Label>Recycled content (%)</Label><Input value={d.recycled} onChange={(e) => set('recycled', e.target.value)} inputMode="decimal" /></div>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-gray-900">Evidence</p>
          <p className="text-xs text-gray-500 mb-3">A declaration, test report or document reference for each. Keep the documents themselves 5 years for single-use packaging and 10 for reusable (Art. 15(3)).</p>
          <div className="space-y-4">
            <div><Label>Heavy metals under 100 mg/kg (Art. 5(4))</Label><Input value={d.heavy_metals} onChange={(e) => set('heavy_metals', e.target.value)} placeholder="Supplier declaration, date" /></div>
            {d.food_contact && (
              <div><Label>PFAS below the Art. 5(5) limits</Label><Input value={d.pfas} onChange={(e) => set('pfas', e.target.value)} placeholder="Laboratory report, date" /></div>
            )}
            <div><Label>EU declaration of conformity (Art. 39)</Label><Input value={d.conformity} onChange={(e) => set('conformity', e.target.value)} placeholder="Manufacturer, reference, date" /></div>
            <div><Label>Notes</Label><Textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} /></div>
          </div>
        </div>
      </fieldset>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Retire ${component?.name ?? 'this packaging'}?`}
        description="It stops counting towards new packaging tonnes. It is kept on record, because reports already made were worked out from it."
        confirmLabel="Retire"
        onConfirm={retire}
      />
    </DrawerShell>
  );
}
