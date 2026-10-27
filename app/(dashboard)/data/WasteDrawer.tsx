'use client';

import { useState } from 'react';
import { useUnits } from '@/components/layout/UnitPreferences';
import { todayLocal } from '@/lib/utils';
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DataQualityPicker } from '@/components/forms/DataQualityPicker';
import type { EntryDataQuality } from '@/lib/entry-data-quality';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { wasteToKg, WASTE_UNITS } from '@/lib/conversions';

interface Site { id: string; name: string; }
interface Props {
  open: boolean;
  onClose: () => void;
  sites: Site[];
  onSaved: (entry: unknown) => void;
}

const HAZARD_CLASSES = [
  { value: 'non_hazardous', label: 'Non-Hazardous' },
  { value: 'hazardous', label: 'Hazardous' },
];

const DISPOSAL_METHODS: Record<string, { value: string; label: string }[]> = {
  non_hazardous: [
    { value: 'non_hazardous_recycled',           label: 'Recycled — mixed' },
    { value: 'non_hazardous_recycled_metals',    label: 'Recycled — metals' },
    { value: 'non_hazardous_recycled_paper',     label: 'Recycled — paper / cardboard' },
    { value: 'non_hazardous_recycled_plastics',  label: 'Recycled — plastics' },
    { value: 'non_hazardous_landfilled',          label: 'Landfilled' },
    { value: 'non_hazardous_incinerated_energy',  label: 'Incinerated (with energy recovery)' },
    { value: 'non_hazardous_incinerated',         label: 'Incinerated (no energy recovery)' },
    { value: 'non_hazardous_composted',           label: 'Composted' },
    { value: 'non_hazardous_other',               label: 'Other' },
  ],
  hazardous: [
    { value: 'hazardous_treated',    label: 'Treated / Neutralized' },
    { value: 'hazardous_incinerated', label: 'Incinerated' },
    { value: 'hazardous_landfilled',  label: 'Landfilled (permitted)' },
    { value: 'hazardous_other',       label: 'Other' },
  ],
};


export function WasteDrawer({ open, onClose, sites, onSaved }: Props) {
  const [siteId, setSiteId]         = useState('');
  const [hazardClass, setHazardClass] = useState('non_hazardous');
  const [sourceType, setSourceType] = useState('');
  const [quantity, setQuantity]     = useState('');
  // Defaults to the unit the user reports in (their unit preference), not
  // always US kilograms.
  const { units } = useUnits();
  const preferredUnit = ({ kg: 'kg', t: 'metric_tons', lb: 'lbs' } as Record<string, string>)[units.waste] ?? 'kg';
  const [unit, setUnit]             = useState(preferredUnit);
  const [entryDate, setEntryDate]   = useState(() => todayLocal());
  const [notes, setNotes]           = useState('');
  const [dataQuality, setDataQuality] = useState<EntryDataQuality>('measured');
  const [estimationMethod, setEstimationMethod] = useState('');
  const [errors, setErrors]         = useState<Record<string, string>>({});
  const [saving, setSaving]         = useState(false);

  const disposalOptions = DISPOSAL_METHODS[hazardClass] ?? [];

  function validate() {
    const e: Record<string, string> = {};
    if (!siteId)     e.siteId     = 'Select a site.';
    if (!sourceType) e.sourceType = 'Select a disposal method.';
    if (!quantity || isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0)
      e.quantity = 'Enter a positive quantity.';
    if (dataQuality === 'estimated' && !estimationMethod.trim())
      e.estimationMethod = 'Say how it was estimated.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setErrors({});

    const res = await fetch('/api/entries/ehs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId,
        metricType: 'waste',
        sourceType,
        quantity: parseFloat(quantity),
        unit,
        entryDate,
        notes: notes || undefined,
        dataQuality,
        estimationMethod: dataQuality === 'estimated' ? estimationMethod : undefined,
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
    resetForm();
    onClose();
  }

  function resetForm() {
    setSiteId(''); setHazardClass('non_hazardous'); setSourceType('');
    setQuantity(''); setUnit(preferredUnit); setEntryDate(todayLocal()); setNotes(''); setErrors({});
    setDataQuality('measured'); setEstimationMethod('');
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { resetForm(); onClose(); } }}>
      <DrawerContent>
        <DialogHeader className="px-6 py-5 border-b border-gray-100">
          <DialogTitle>Log Waste Entry</DialogTitle>
          <p className="text-sm text-gray-500">Enter the quantity in whichever unit the waste manifest uses.</p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <Label required>Site</Label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger error={errors.siteId}><SelectValue placeholder="Select site…" /></SelectTrigger>
              <SelectContent>
                {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.siteId && <p className="text-xs text-red-600 mt-1">{errors.siteId}</p>}
          </div>

          <div>
            <Label required>Hazard class</Label>
            <div className="flex gap-2">
              {HAZARD_CLASSES.map((h) => (
                <button
                  key={h.value}
                  onClick={() => { setHazardClass(h.value); setSourceType(''); }}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${hazardClass === h.value ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label required>Disposal method</Label>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger error={errors.sourceType}><SelectValue placeholder="Select method…" /></SelectTrigger>
              <SelectContent>
                {disposalOptions.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.sourceType && <p className="text-xs text-red-600 mt-1">{errors.sourceType}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label required>Quantity</Label>
              <Input type="number" step="any" min="0" value={quantity}
                onChange={(e) => setQuantity(e.target.value)} error={errors.quantity} />
            </div>
            <div>
              <Label required>Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WASTE_UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label required>Entry date</Label>
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} max={todayLocal()} />
          </div>

          <DataQualityPicker
            value={dataQuality}
            onChange={setDataQuality}
            estimationMethod={estimationMethod}
            onEstimationMethodChange={setEstimationMethod}
            placeholder="e.g. container count × average load weight, no weighbridge ticket"
            error={errors.estimationMethod}
          />

          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {quantity && unit && !isNaN(parseFloat(quantity)) && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
              <p className="text-xs text-amber-600 font-medium mb-0.5">Normalized mass</p>
              <p className="text-lg font-semibold text-amber-800">
                {wasteToKg(parseFloat(quantity), unit).toLocaleString()} kg
              </p>
            </div>
          )}

          {errors.form && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-700">{errors.form}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <Button variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save entry'}</Button>
        </div>
      </DrawerContent>
    </Dialog>
  );
}
