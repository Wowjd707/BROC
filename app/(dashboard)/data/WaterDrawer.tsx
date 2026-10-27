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
import { waterToGallons, WATER_UNITS } from '@/lib/conversions';

interface Site { id: string; name: string; }
interface Props {
  open: boolean;
  onClose: () => void;
  sites: Site[];
  onSaved: (entry: unknown) => void;
}

// Each source is a withdrawal, a discharge or on-site reuse (lib/water-core.ts
// classifies them; consumption = withdrawal − discharge). The labels say which.
const WATER_SOURCES = [
  { value: 'municipal_consumption',  label: 'Withdrawal — municipal supply' },
  { value: 'groundwater',            label: 'Withdrawal — groundwater' },
  { value: 'surface_water',          label: 'Withdrawal — surface water' },
  { value: 'stormwater',             label: 'Withdrawal — rainwater / stormwater collected' },
  { value: 'municipal_discharge',    label: 'Discharge — to municipal sewer' },
  { value: 'treated_discharge',      label: 'Discharge — treated effluent' },
  { value: 'recycled_water',         label: 'Recycled / reused on site' },
];


export function WaterDrawer({ open, onClose, sites, onSaved }: Props) {
  const [siteId, setSiteId]         = useState('');
  const [sourceType, setSourceType] = useState('');
  const [quantity, setQuantity]     = useState('');
  // Defaults to the unit the user reports in (their unit preference), not
  // always US gallons.
  const { units } = useUnits();
  const preferredUnit = ({ gal: 'gallons', L: 'liters', m3: 'cubic_meters' } as Record<string, string>)[units.water] ?? 'gallons';
  const [unit, setUnit]             = useState(preferredUnit);
  const [entryDate, setEntryDate]   = useState(() => todayLocal());
  const [notes, setNotes]           = useState('');
  const [dataQuality, setDataQuality] = useState<EntryDataQuality>('measured');
  const [estimationMethod, setEstimationMethod] = useState('');
  const [errors, setErrors]         = useState<Record<string, string>>({});
  const [saving, setSaving]         = useState(false);

  function validate() {
    const e: Record<string, string> = {};
    if (!siteId)     e.siteId     = 'Select a site.';
    if (!sourceType) e.sourceType = 'Select a source type.';
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
        metricType: 'water',
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
    setSiteId(''); setSourceType(''); setQuantity(''); setUnit(preferredUnit);
    setEntryDate(todayLocal()); setNotes(''); setErrors({});
    setDataQuality('measured'); setEstimationMethod('');
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { resetForm(); onClose(); } }}>
      <DrawerContent>
        <DialogHeader className="px-6 py-5 border-b border-gray-100">
          <DialogTitle>Log Water Entry</DialogTitle>
          <p className="text-sm text-gray-500">Enter the volume in whichever unit the meter or invoice uses.</p>
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
            <Label required>Source type</Label>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger error={errors.sourceType}><SelectValue placeholder="Select source…" /></SelectTrigger>
              <SelectContent>
                {WATER_SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.sourceType && <p className="text-xs text-red-600 mt-1">{errors.sourceType}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label required>Volume</Label>
              <Input type="number" step="any" min="0" value={quantity}
                onChange={(e) => setQuantity(e.target.value)} error={errors.quantity} />
            </div>
            <div>
              <Label required>Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WATER_UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
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
            placeholder="e.g. prior-year meter reading scaled by operating days"
            error={errors.estimationMethod}
          />

          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {quantity && unit && !isNaN(parseFloat(quantity)) && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
              <p className="text-xs text-blue-600 font-medium mb-0.5">Normalized volume</p>
              <p className="text-lg font-semibold text-blue-800">
                {waterToGallons(parseFloat(quantity), unit).toLocaleString()} gallons
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
