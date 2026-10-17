'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DataQualityPicker } from '@/components/forms/DataQualityPicker';
import type { EntryDataQuality } from '@/lib/entry-data-quality';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  SCOPE1_SOURCE_TYPES, SCOPE2_SOURCE_TYPES,
  SCOPE1_CATEGORIES, suggestScope1Category,
} from '@/lib/emission-factor-types';
import { getUnitsForSource, normalizeEmissionInput } from '@/lib/conversions';
import { fmtCO2e, fmt } from '@/lib/utils';
import { Info } from 'lucide-react';

interface Site { id: string; name: string; zip_code: string | null; }
interface RefrigerantFactor { refrigerant_code: string; refrigerant_name: string; gwp_100_year: number; }

interface Props {
  open: boolean;
  onClose: () => void;
  sites: Site[];
  refrigerantFactors: RefrigerantFactor[];
  onSaved: (entry: unknown) => void;
}

const TODAY = new Date().toISOString().split('T')[0];

export function EmissionDrawer({ open, onClose, sites, refrigerantFactors, onSaved }: Props) {

  // Form state
  const [siteId, setSiteId]             = useState('');
  const [scope, setScope]               = useState<'scope1' | 'scope2'>('scope2');
  const [sourceType, setSourceType]     = useState('');
  const [scope1Category, setScope1Category] = useState('');
  const [refrigerantCode, setRefrigerantCode] = useState('');
  const [quantity, setQuantity]         = useState('');
  const [unit, setUnit]                 = useState('');
  const [entryDate, setEntryDate]       = useState(TODAY);
  const [notes, setNotes]               = useState('');
  // Distinguishes a meter read from a gap-filled estimate. Without it the two
  // are indistinguishable in every report and to an assurance provider, and the
  // estimated share of the inventory cannot be disclosed.
  const [dataQuality, setDataQuality]   = useState<EntryDataQuality>('calculated');
  const [estimationMethod, setEstimationMethod] = useState('');
  // Scope 2 market-based
  const [accountingMethod, setAccountingMethod] = useState<'location_based' | 'market_based'>('location_based');
  const [instrumentType, setInstrumentType]     = useState('');
  const [supplierFactor, setSupplierFactor]     = useState('');

  // Computed state
  const [locationFactor, setLocationFactor]   = useState<number | null>(null);
  const [factorSource, setFactorSource]       = useState<string>('');
  const [errors, setErrors]                   = useState<Record<string, string>>({});
  const [saving, setSaving]                   = useState(false);

  const isRefrigerant = sourceType === 'refrigerants';
  const sourceOptions = scope === 'scope1' ? SCOPE1_SOURCE_TYPES : SCOPE2_SOURCE_TYPES;
  const isElectricity = sourceType === 'electricity' && scope === 'scope2';

  // Fetch the location-based factor when a Scope 2 electricity site is chosen.
  // The fetched value is only USED while that is still the selection (see
  // `shownLocationFactor`), so nothing has to be reset synchronously here.
  useEffect(() => {
    if (!isElectricity) return;
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;

    let cancelled = false;
    async function fetchFactor() {
      const zip = site!.zip_code;
      if (zip) {
        const { data } = await createClient()
          .from('scope2_emission_factors')
          .select('co2e_factor, factor_source, geographic_identifier')
          .eq('factor_type', 'electricity')
          .eq('geographic_scope', 'zip_code')
          .eq('geographic_identifier', zip)
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (data) { setLocationFactor(data.co2e_factor); setFactorSource(data.factor_source); return; }
      }
      if (cancelled) return;
      // Fallback national average
      setLocationFactor(0.386); setFactorSource('eGRID2023 (national average)');
    }
    void fetchFactor();
    return () => { cancelled = true; };
  }, [siteId, isElectricity, sites]);

  const shownLocationFactor = isElectricity && siteId ? locationFactor : null;

  // Changing scope resets the source and everything derived from it; changing
  // the source picks its default unit and pre-selects the likely Scope 1
  // category. Done in the handlers rather than in effects, so one user action
  // is one render. Ambiguous fuels (diesel, gasoline, propane) get no category
  // suggestion, so the user has to choose rather than inherit a guess.
  function changeScope(next: 'scope1' | 'scope2') {
    if (next === scope) return;
    setScope(next);
    setSourceType('');
    setUnit('');
    setScope1Category('');
    setAccountingMethod('location_based');
  }

  function changeSourceType(next: string) {
    setSourceType(next);
    setUnit(next ? (getUnitsForSource(scope, next)[0]?.value ?? '') : '');
    setScope1Category(scope === 'scope1' && next ? (suggestScope1Category(next) ?? '') : '');
  }

  // Live CO2e preview, derived from the form rather than stored.
  const preview = useMemo((): { co2e: number; label: string } | null => {
    if (!quantity || !unit || !sourceType) return null;
    const q = parseFloat(quantity);
    if (isNaN(q) || q <= 0) return null;

    try {
      const { quantityNormalized } = normalizeEmissionInput(q, unit, scope, sourceType);

      if (scope === 'scope2' && isElectricity) {
        const factor = accountingMethod === 'market_based' && supplierFactor
          ? parseFloat(supplierFactor)
          : (shownLocationFactor ?? 0.386);
        if (isNaN(factor)) return null;
        const co2e = quantityNormalized * factor;
        return { co2e, label: `${fmt(quantityNormalized)} kWh × ${factor} kg CO₂e/kWh` };
      }
      if (isRefrigerant) {
        const rf = refrigerantFactors.find((r) => r.refrigerant_code === refrigerantCode);
        if (!rf) return null;
        const co2e = quantityNormalized * rf.gwp_100_year;
        return { co2e, label: `${fmt(quantityNormalized, 2)} kg × GWP ${rf.gwp_100_year}` };
      }
      // Other sources need the server-side factor lookup; shown after save.
      return null;
    } catch {
      return null;
    }
  }, [quantity, unit, sourceType, scope, isElectricity, accountingMethod, supplierFactor, shownLocationFactor, isRefrigerant, refrigerantCode, refrigerantFactors]);

  function validate() {
    const e: Record<string, string> = {};
    if (!siteId)     e.siteId     = 'Select a site.';
    if (!sourceType) e.sourceType = 'Select a source type.';
    if (!quantity || isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0)
      e.quantity = 'Enter a positive quantity.';
    if (!unit)       e.unit       = 'Select a unit.';
    if (!entryDate)  e.entryDate  = 'Select a date.';
    if (isRefrigerant && !refrigerantCode) e.refrigerantCode = 'Select refrigerant type.';
    if (scope === 'scope1' && !scope1Category) {
      e.scope1Category = 'Select a source category — frameworks require Scope 1 split by category.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setErrors({});

    // The server does all factor lookup + CO₂e calculation (single authoritative
    // path). The browser only sends the raw activity data it collected.
    const res = await fetch('/api/entries/emission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId,
        scope,
        sourceType,
        scope1Category: scope === 'scope1' ? scope1Category : undefined,
        refrigerantCode: isRefrigerant ? refrigerantCode : undefined,
        quantity: parseFloat(quantity),
        unit,
        entryDate,
        accountingMethod,
        instrumentType: instrumentType || undefined,
        supplierFactor: supplierFactor ? parseFloat(supplierFactor) : undefined,
        dataQuality,
        estimationMethod: dataQuality === 'estimated' ? estimationMethod : undefined,
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
    resetForm();
    onClose();
  }

  function resetForm() {
    setSiteId(''); setScope('scope2'); setSourceType(''); setScope1Category(''); setRefrigerantCode('');
    setQuantity(''); setUnit(''); setEntryDate(TODAY); setNotes('');
    setAccountingMethod('location_based'); setInstrumentType(''); setSupplierFactor('');
    setErrors({});
  }

  const unitOptions = sourceType ? getUnitsForSource(scope, sourceType) : [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { resetForm(); onClose(); } }}>
      <DrawerContent>
        <DialogHeader className="px-6 py-5 border-b border-gray-100">
          <DialogTitle>Log Emission Entry</DialogTitle>
          <p className="text-sm text-gray-500">CO₂e is calculated automatically and stored.</p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Site */}
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

          {/* Scope */}
          <div>
            <Label required>Scope</Label>
            <div className="flex gap-2">
              {(['scope1', 'scope2'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => changeScope(s)}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${scope === s ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                >
                  {s === 'scope1' ? 'Scope 1 (Direct)' : 'Scope 2 (Indirect)'}
                </button>
              ))}
            </div>
          </div>

          {/* Source type */}
          <div>
            <Label required>Source type</Label>
            <Select value={sourceType} onValueChange={changeSourceType}>
              <SelectTrigger error={errors.sourceType}><SelectValue placeholder="Select source…" /></SelectTrigger>
              <SelectContent>
                {sourceOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.sourceType && <p className="text-xs text-red-600 mt-1">{errors.sourceType}</p>}
          </div>

          {/* Scope 1 source category (GHG Protocol) */}
          {scope === 'scope1' && sourceType && (
            <div>
              <Label required>Source category</Label>
              <Select value={scope1Category} onValueChange={setScope1Category}>
                <SelectTrigger error={errors.scope1Category}>
                  <SelectValue placeholder="Select category…" />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE1_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.scope1Category
                ? <p className="text-xs text-red-600 mt-1">{errors.scope1Category}</p>
                : (
                  <p className="text-xs text-gray-400 mt-1">
                    {SCOPE1_CATEGORIES.find((c) => c.value === scope1Category)?.help
                      ?? 'Frameworks require Scope 1 reported by source category.'}
                  </p>
                )}
            </div>
          )}

          {/* Refrigerant type (conditional) */}
          {isRefrigerant && (
            <div>
              <Label required>Refrigerant type</Label>
              <Select value={refrigerantCode} onValueChange={setRefrigerantCode}>
                <SelectTrigger error={errors.refrigerantCode}><SelectValue placeholder="Select refrigerant…" /></SelectTrigger>
                <SelectContent>
                  {refrigerantFactors.map((r) => (
                    <SelectItem key={r.refrigerant_code} value={r.refrigerant_code}>
                      {r.refrigerant_name} (GWP: {r.gwp_100_year.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.refrigerantCode && <p className="text-xs text-red-600 mt-1">{errors.refrigerantCode}</p>}
            </div>
          )}

          {/* Scope 2 accounting method toggle */}
          {isElectricity && (
            <div>
              <Label>Accounting method</Label>
              <div className="flex gap-2">
                {(['location_based', 'market_based'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setAccountingMethod(m)}
                    className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-colors ${accountingMethod === m ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {m === 'location_based' ? 'Location-Based' : 'Market-Based'}
                  </button>
                ))}
              </div>
              {shownLocationFactor !== null && (
                <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                  <Info size={11} />
                  Location factor: {shownLocationFactor} kg CO₂e/kWh ({factorSource})
                </p>
              )}
            </div>
          )}

          {/* Market-based instrument + factor */}
          {isElectricity && accountingMethod === 'market_based' && (
            <div className="space-y-3 pl-3 border-l-2 border-emerald-200">
              <div>
                <Label>Instrument type</Label>
                <Select value={instrumentType} onValueChange={setInstrumentType}>
                  <SelectTrigger><SelectValue placeholder="Select instrument…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rec">Renewable Energy Certificate (REC)</SelectItem>
                    <SelectItem value="ppa">Power Purchase Agreement (PPA)</SelectItem>
                    <SelectItem value="green_tariff">Green Tariff</SelectItem>
                    <SelectItem value="supplier_specific">Supplier-Specific Factor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Supplier / contractual emission factor (kg CO₂e/kWh)</Label>
                <Input
                  type="number"
                  step="0.001"
                  placeholder="e.g. 0.0 for renewable PPA"
                  value={supplierFactor}
                  onChange={(e) => setSupplierFactor(e.target.value)}
                />
                {!supplierFactor && (
                  <p className="text-xs text-amber-600 mt-1">
                    Using US residual mix (0.455 kg CO₂e/kWh) — update when contractual factor is available.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Quantity + unit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label required>Quantity</Label>
              <Input
                type="number"
                step="any"
                min="0"
                placeholder="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                error={errors.quantity}
              />
            </div>
            <div>
              <Label required>Unit</Label>
              <Select value={unit} onValueChange={setUnit} disabled={!sourceType}>
                <SelectTrigger error={errors.unit}><SelectValue placeholder="Unit…" /></SelectTrigger>
                <SelectContent>
                  {unitOptions.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date */}
          <div>
            <Label required>Entry date</Label>
            <Input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              max={TODAY}
              error={errors.entryDate}
            />
          </div>

          <DataQualityPicker
            value={dataQuality}
            onChange={setDataQuality}
            estimationMethod={estimationMethod}
            onEstimationMethodChange={setEstimationMethod}
          />

          {/* Notes */}
          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Invoice number, meter ID, etc."
              rows={2}
            />
          </div>

          {/* CO2e preview */}
          {preview && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
              <p className="text-xs text-emerald-600 font-medium mb-0.5">Estimated CO₂e</p>
              <p className="text-lg font-semibold text-emerald-800">{fmtCO2e(preview.co2e)}</p>
              <p className="text-xs text-emerald-600 mt-0.5">{preview.label}</p>
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
          <Button variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save entry'}
          </Button>
        </div>
      </DrawerContent>
    </Dialog>
  );
}
