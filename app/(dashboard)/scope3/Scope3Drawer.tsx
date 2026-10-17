'use client';

import { useState, useMemo } from 'react';
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtCO2e } from '@/lib/utils';
import {
  METHOD_LABELS, defaultDataQuality, unitsCompatible,
  type Scope3Method, type DataQuality,
} from '@/lib/scope3';
import type { Scope3Category, Scope3Factor } from '@/lib/supabase/types';
import type { SupplierDeclaration } from '@/lib/supplier-data-core';

interface Props {
  open: boolean;
  onClose: () => void;
  categories: Scope3Category[];
  factors: Scope3Factor[];
  suppliers: { id: string; name: string }[];
  sites: { id: string; name: string }[];
  presetCategory?: number;
  /** When set, prefills a supplier-specific Category 1 entry from the supplier's own disclosure. */
  presetDeclaration?: SupplierDeclaration;
  onSaved: (entry: unknown) => void;
}

const TODAY = new Date().toISOString().split('T')[0];

const COMMON_UNITS = [
  'USD', 'kg', 'tonnes', 'miles', 'km', 'passenger-mile', 'passenger-km',
  'tonne-km', 'tonne-mile', 'kWh', 'MWh', 'liters', 'gallons', 'units',
];

export function Scope3Drawer({
  open, onClose, categories, factors, suppliers, sites, presetCategory, presetDeclaration, onSaved,
}: Props) {
  /** The method a category typically uses, keeping `current` if it is one of them. */
  const methodFor = (category: string, current: Scope3Method): Scope3Method => {
    const typical = categories.find(c => c.category_number === parseInt(category))?.typical_methods ?? [];
    return typical.length > 0 && !typical.includes(current) ? (typical[0] as Scope3Method) : current;
  };

  const [categoryNumber, setCategoryNumber] = useState<string>('1');
  const [method, setMethod] = useState<Scope3Method>(() => methodFor('1', 'spend_based'));
  const [activityValue, setActivityValue] = useState('');
  const [activityUnit, setActivityUnit] = useState('USD');
  const [entryDate, setEntryDate] = useState(TODAY);
  const [factorMode, setFactorMode] = useState<'library' | 'manual'>('library');
  const [factorId, setFactorId] = useState('');
  const [factorValue, setFactorValue] = useState('');
  const [factorUnit, setFactorUnit] = useState('USD');
  const [factorSource, setFactorSource] = useState('');
  const [factorDataYear, setFactorDataYear] = useState(String(new Date().getFullYear()));
  const [supplierId, setSupplierId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [description, setDescription] = useState('');
  const [dataQuality, setDataQuality] = useState<DataQuality | ''>('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Apply the presets once each time the drawer opens. Done during render with
  // a remembered "was it open" flag — React's pattern for adjusting state when
  // a prop changes — rather than in effects that render the form twice.
  //
  // Prefilling from a supplier's own declaration means: supplier-specific
  // method, the declared intensity as the factor, and the disclosure itself as
  // the source.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && presetCategory) {
      setCategoryNumber(String(presetCategory));
      setMethod(m => methodFor(String(presetCategory), m));
    }
    if (open && presetDeclaration) {
      const d = presetDeclaration;
      setMethod('supplier_specific');
      setFactorMode('manual');
      setFactorValue(String(d.intensityKgCo2e));
      setFactorUnit(d.unit);
      setActivityUnit(d.unit);
      setFactorSource(d.sourceLabel);
      setFactorDataYear(String(d.dataYear ?? new Date().getFullYear()));
      setSupplierId(d.supplierId ?? '');
      setDescription(d.product ? `${d.product} — ${d.supplierName}` : d.supplierName);
      setDataQuality('primary');
    }
  }

  const catNum = parseInt(categoryNumber);
  const category = categories.find(c => c.category_number === catNum);

  // Factors available for the chosen category
  const availableFactors = useMemo(
    () => factors.filter(f => f.category_number === catNum),
    [factors, catNum],
  );

  // Changing category defaults the method to one that category typically uses.
  function changeCategory(next: string) {
    setCategoryNumber(next);
    setMethod(m => methodFor(next, m));
  }

  // Picking a library factor adopts its unit, and the activity unit too when
  // the current one cannot be converted to it.
  const selectedFactor = availableFactors.find(f => f.id === factorId);
  function changeFactor(nextId: string) {
    setFactorId(nextId);
    const f = availableFactors.find(x => x.id === nextId);
    if (!f) return;
    setFactorUnit(f.activity_unit);
    if (!activityUnit || !unitsCompatible(activityUnit, f.activity_unit)) {
      setActivityUnit(f.activity_unit);
    }
  }

  const effectiveFactorValue = factorMode === 'library'
    ? (selectedFactor ? Number(selectedFactor.factor_value) : null)
    : (factorValue ? parseFloat(factorValue) : null);
  const effectiveFactorUnit = factorMode === 'library'
    ? (selectedFactor?.activity_unit ?? '')
    : factorUnit;

  const qty = parseFloat(activityValue);
  const unitMismatch = Boolean(
    activityUnit && effectiveFactorUnit && !unitsCompatible(activityUnit, effectiveFactorUnit),
  );
  const preview = (!isNaN(qty) && effectiveFactorValue != null && !unitMismatch)
    ? qty * effectiveFactorValue
    : null;

  function validate() {
    const e: Record<string, string> = {};
    if (!activityValue || isNaN(qty) || qty < 0) e.activityValue = 'Enter a non-negative activity value.';
    if (!activityUnit) e.activityUnit = 'Select a unit.';
    if (!entryDate) e.entryDate = 'Select a date.';
    if (factorMode === 'library' && !factorId) e.factor = 'Select a factor from the library.';
    if (factorMode === 'manual') {
      if (!factorValue || isNaN(parseFloat(factorValue))) e.factor = 'Enter a factor value.';
      if (!factorSource.trim()) e.factorSource = 'A cited source is required for every factor.';
    }
    if (unitMismatch) e.activityUnit = `A factor per ${effectiveFactorUnit} cannot be applied to ${activityUnit}.`;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);

    const res = await fetch('/api/entries/scope3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categoryNumber: catNum,
        method,
        activityValue: qty,
        activityUnit,
        entryDate,
        factorId: factorMode === 'library' ? factorId : undefined,
        factorValue: factorMode === 'manual' ? parseFloat(factorValue) : undefined,
        factorUnit: factorMode === 'manual' ? factorUnit : undefined,
        factorSource: factorMode === 'manual' ? factorSource.trim() : undefined,
        factorDataYear: factorMode === 'manual' ? parseInt(factorDataYear) : undefined,
        supplierId: supplierId || undefined,
        siteId: siteId || undefined,
        description: description || undefined,
        dataQuality: dataQuality || undefined,
        notes: notes || undefined,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      let message = 'Failed to save entry.';
      try { message = (await res.json()).error ?? message; } catch { /* keep default */ }
      setErrors({ form: message });
      return;
    }

    const { entry } = await res.json();
    onSaved(entry);
    reset();
    onClose();
  }

  function reset() {
    setActivityValue(''); setFactorId(''); setFactorValue(''); setFactorSource('');
    setSupplierId(''); setSiteId(''); setDescription(''); setNotes('');
    setDataQuality(''); setErrors({});
  }

  const impliedQuality = dataQuality || defaultDataQuality(method);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DrawerContent>
        <DialogHeader className="px-6 py-5 border-b border-gray-100">
          <DialogTitle>Add Scope 3 entry</DialogTitle>
          <p className="text-sm text-gray-500">CO₂e is calculated and stored server-side.</p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <Label required>Category</Label>
            <Select value={categoryNumber} onValueChange={changeCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c.category_number} value={String(c.category_number)}>
                    {c.category_number}. {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {category && <p className="text-xs text-gray-400 mt-1">{category.description}</p>}
          </div>

          <div>
            <Label required>Calculation method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as Scope3Method)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(category?.typical_methods?.length
                  ? category.typical_methods
                  : Object.keys(METHOD_LABELS)
                ).map(m => (
                  <SelectItem key={m} value={m}>
                    {METHOD_LABELS[m as Scope3Method] ?? m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400 mt-1">Implies <strong>{impliedQuality}</strong> data quality unless overridden.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label required>Activity value</Label>
              <Input type="number" step="any" min="0" value={activityValue}
                onChange={(e) => setActivityValue(e.target.value)} error={errors.activityValue} />
            </div>
            <div>
              <Label required>Activity unit</Label>
              <Select value={activityUnit} onValueChange={setActivityUnit}>
                <SelectTrigger error={errors.activityUnit}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {errors.activityUnit && <p className="text-xs text-red-600 -mt-3">{errors.activityUnit}</p>}

          {/* Factor source */}
          <div>
            <Label required>Emission factor</Label>
            <div className="flex gap-2 mb-2">
              {(['library', 'manual'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => { setFactorMode(mode); setErrors({}); }}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    factorMode === mode
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {mode === 'library' ? 'From library' : 'Supplier-specific'}
                </button>
              ))}
            </div>

            {factorMode === 'library' ? (
              availableFactors.length === 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No factors loaded for category {catNum}. Import a factor library, or switch to
                  supplier-specific and cite the source.
                </p>
              ) : (
                <Select value={factorId} onValueChange={changeFactor}>
                  <SelectTrigger error={errors.factor}><SelectValue placeholder="Select factor…" /></SelectTrigger>
                  <SelectContent>
                    {availableFactors.map(f => (
                      <SelectItem key={f.id} value={f.id}>
                        {(f.label || f.activity_key)} — {f.factor_value} kg/{f.activity_unit} ({f.factor_source} {f.data_year})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label required>Factor (kg CO₂e per unit)</Label>
                    <Input type="number" step="any" min="0" value={factorValue}
                      onChange={(e) => setFactorValue(e.target.value)} error={errors.factor} />
                  </div>
                  <div>
                    <Label required>Per unit</Label>
                    <Select value={factorUnit} onValueChange={setFactorUnit}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COMMON_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label required>Source / provenance</Label>
                    <Input value={factorSource} placeholder="e.g. Supplier PCF declaration 2025-02"
                      onChange={(e) => setFactorSource(e.target.value)} error={errors.factorSource} />
                  </div>
                  <div>
                    <Label>Data year</Label>
                    <Input type="number" value={factorDataYear}
                      onChange={(e) => setFactorDataYear(e.target.value)} />
                  </div>
                </div>
                {errors.factorSource && <p className="text-xs text-red-600">{errors.factorSource}</p>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Supplier (optional)</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Site (optional)</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger><SelectValue placeholder="Organization-wide" /></SelectTrigger>
                <SelectContent>
                  {sites.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label required>Entry date</Label>
              <Input type="date" value={entryDate} max={TODAY}
                onChange={(e) => setEntryDate(e.target.value)} error={errors.entryDate} />
            </div>
            <div>
              <Label>Data quality override</Label>
              <Select value={dataQuality} onValueChange={(v) => setDataQuality(v as DataQuality)}>
                <SelectTrigger><SelectValue placeholder={`Default (${impliedQuality})`} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">Primary</SelectItem>
                  <SelectItem value="secondary">Secondary</SelectItem>
                  <SelectItem value="estimated">Estimated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Input value={description} placeholder="e.g. Q1 steel purchases"
              onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {preview != null && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
              <p className="text-xs text-emerald-600 font-medium mb-0.5">Estimated CO₂e</p>
              <p className="text-lg font-semibold text-emerald-800">{fmtCO2e(preview)}</p>
              <p className="text-[11px] text-emerald-600/80 mt-1">Final value is calculated and stored on save.</p>
            </div>
          )}

          {errors.form && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-700">{errors.form}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save entry'}</Button>
        </div>
      </DrawerContent>
    </Dialog>
  );
}
