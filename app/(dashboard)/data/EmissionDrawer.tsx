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
import { fmtCO2e, fmt, todayLocal } from '@/lib/utils';
import { Info } from 'lucide-react';
import { isUsSite } from '@/lib/country-core';

interface Site { id: string; name: string; zip_code: string | null; country?: string | null; }
interface RefrigerantFactor { refrigerant_code: string; refrigerant_name: string; gwp_100_year: number; is_montreal_protocol?: boolean; }

interface Props {
  open: boolean;
  onClose: () => void;
  sites: Site[];
  refrigerantFactors: RefrigerantFactor[];
  onSaved: (entry: unknown) => void;
}


export function EmissionDrawer({ open, onClose, sites, refrigerantFactors, onSaved }: Props) {

  // Form state
  const [siteId, setSiteId]             = useState('');
  const [scope, setScope]               = useState<'scope1' | 'scope2'>('scope2');
  const [sourceType, setSourceType]     = useState('');
  const [scope1Category, setScope1Category] = useState('');
  const [refrigerantCode, setRefrigerantCode] = useState('');
  const [quantity, setQuantity]         = useState('');
  const [unit, setUnit]                 = useState('');
  const [entryDate, setEntryDate]       = useState(() => todayLocal());
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
  // Grid electricity, bought on contract or not. Purchased renewables are a
  // market-based claim, so they always take the contractual path.
  const isElectricity = scope === 'scope2' && (sourceType === 'electricity' || sourceType === 'renewable_purchased');
  const isPurchasedRenewable = scope === 'scope2' && sourceType === 'renewable_purchased';
  const effectiveMethod: 'location_based' | 'market_based' = isPurchasedRenewable ? 'market_based' : accountingMethod;

  // Preview the location-based factor for a US site from the reference table:
  // its ZIP, else the US national average. A site outside the US, or with an
  // organization grid factor, is priced on save (the server applies custom
  // factors first). There is deliberately no built-in number here: a
  // hard-coded fallback drifts from the table it claims to mirror.
  const selectedSite = sites.find((s) => s.id === siteId);
  // The same rule the server prices by (lib/country-core.ts).
  const siteIsUs = isUsSite(selectedSite?.country);

  useEffect(() => {
    if (!isElectricity || !siteIsUs) return;
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;

    let cancelled = false;
    async function fetchFactor() {
      const supabase = createClient();
      const zip = site!.zip_code;
      if (zip) {
        const { data } = await supabase
          .from('scope2_emission_factors')
          .select('co2e_factor, factor_source')
          .eq('factor_type', 'electricity')
          .eq('geographic_scope', 'zip_code')
          .eq('geographic_identifier', zip)
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (data) { setLocationFactor(Number(data.co2e_factor)); setFactorSource(`${data.factor_source} (ZIP ${zip})`); return; }
      }
      const { data: national } = await supabase
        .from('scope2_emission_factors')
        .select('co2e_factor, factor_source')
        .eq('factor_type', 'electricity')
        .eq('geographic_scope', 'national_average')
        .eq('geographic_identifier', 'US')
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (national) { setLocationFactor(Number(national.co2e_factor)); setFactorSource(`${national.factor_source} (US national average)`); }
      else { setLocationFactor(null); setFactorSource(''); }
    }
    void fetchFactor();
    return () => { cancelled = true; };
  }, [siteId, isElectricity, siteIsUs, sites]);

  const shownLocationFactor = isElectricity && siteId && siteIsUs ? locationFactor : null;

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
  const preview = useMemo((): { co2e: number; label: string; outsideScopes?: boolean } | null => {
    if (!quantity || !unit || !sourceType) return null;
    const q = parseFloat(quantity);
    if (isNaN(q) || q <= 0) return null;

    try {
      const { quantityNormalized } = normalizeEmissionInput(q, unit, scope, sourceType);

      if (scope === 'scope2' && sourceType === 'renewable_generated') {
        return { co2e: 0, label: 'Generated and used on site: no Scope 2 emissions' };
      }
      if (scope === 'scope2' && isElectricity) {
        // Market-based with a contract: the contractual factor. Otherwise the
        // location-based figure; the market-based one (residual mix, or grid
        // average where none exists) is worked out on save.
        const factor = effectiveMethod === 'market_based'
          ? (supplierFactor ? parseFloat(supplierFactor) : NaN)
          : (shownLocationFactor ?? NaN);
        if (isNaN(factor)) return null;
        const co2e = quantityNormalized * factor;
        const basis = effectiveMethod === 'market_based' ? 'market-based' : 'location-based';
        return { co2e, label: `${fmt(quantityNormalized)} kWh × ${factor} kg CO₂e/kWh (${basis})` };
      }
      if (isRefrigerant) {
        const rf = refrigerantFactors.find((r) => r.refrigerant_code === refrigerantCode);
        if (!rf) return null;
        const co2e = quantityNormalized * rf.gwp_100_year;
        // HCFCs are reported outside the scopes, so the preview says so
        // rather than showing a Scope 1 figure the saved row will not carry.
        return {
          co2e,
          label: `${fmt(quantityNormalized, 2)} kg × GWP ${rf.gwp_100_year} (reference GWP; a custom GWP applies on save)`,
          outsideScopes: rf.is_montreal_protocol === true,
        };
      }
      // Other sources need the server-side factor lookup; shown after save.
      return null;
    } catch {
      return null;
    }
  }, [quantity, unit, sourceType, scope, isElectricity, effectiveMethod, supplierFactor, shownLocationFactor, isRefrigerant, refrigerantCode, refrigerantFactors]);

  function validate() {
    const e: Record<string, string> = {};
    if (!siteId)     e.siteId     = 'Select a site.';
    if (!sourceType) e.sourceType = 'Select a source type.';
    if (!quantity || isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0)
      e.quantity = 'Enter a positive quantity.';
    if (!unit)       e.unit       = 'Select a unit.';
    if (!entryDate)  e.entryDate  = 'Select a date.';
    if (isRefrigerant && !refrigerantCode) e.refrigerantCode = 'Select refrigerant type.';
    if (isElectricity && effectiveMethod === 'market_based' && (supplierFactor === '' || isNaN(parseFloat(supplierFactor)))) {
      e.supplierFactor = 'Enter the contractual factor (0 for certificates retired on your behalf).';
    }
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
        accountingMethod: effectiveMethod,
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
    setQuantity(''); setUnit(''); setEntryDate(todayLocal()); setNotes('');
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
                  {/* A refrigerant loss is fugitive; a fuel burned is not. */}
                  {SCOPE1_CATEGORIES
                    .filter((c) => (isRefrigerant ? c.value === 'fugitive_emissions' : c.value !== 'fugitive_emissions'))
                    .map((c) => (
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

          {/* Scope 2 source notes */}
          {scope === 'scope2' && sourceType === 'renewable_generated' && (
            <p className="text-xs text-gray-500 flex gap-1">
              <Info size={12} className="mt-0.5 shrink-0" />
              Electricity generated and used on site carries no Scope 2 emissions; it is recorded for
              energy totals. If its certificates were sold, enter it as grid electricity instead.
            </p>
          )}
          {scope === 'scope2' && sourceType === 'district_heating' && (
            <p className="text-xs text-gray-500 flex gap-1">
              <Info size={12} className="mt-0.5 shrink-0" />
              Priced at this site&apos;s heat or steam supplier factor — add it as a &ldquo;Scope 2 heat/steam
              (site)&rdquo; custom factor on the Emission factors page. An electricity grid factor does not apply.
            </p>
          )}

          {/* Scope 2 accounting method toggle */}
          {isElectricity && !isPurchasedRenewable && (
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
              {siteId && !siteIsUs && (
                <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                  <Info size={11} />
                  Outside the US: priced on save from this site&apos;s grid factor. Add a &ldquo;Scope 2 grid
                  (site)&rdquo; custom factor on the Emission factors page if it has none.
                </p>
              )}
              {shownLocationFactor !== null && (
                <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                  <Info size={11} />
                  Location factor: {shownLocationFactor} kg CO₂e/kWh ({factorSource})
                </p>
              )}
              {accountingMethod === 'location_based' && (
                <p className="text-xs text-gray-400 mt-1">
                  Both figures are stored. Without a contract, the market-based figure uses the residual
                  mix for the site&apos;s market, or the grid average where none exists (disclosed in reports).
                </p>
              )}
            </div>
          )}

          {/* Market-based instrument + factor */}
          {isElectricity && effectiveMethod === 'market_based' && (
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
                <Label required>Supplier / contractual emission factor (kg CO₂e/kWh)</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="e.g. 0 for certificates retired on your behalf"
                  value={supplierFactor}
                  onChange={(e) => setSupplierFactor(e.target.value)}
                  error={errors.supplierFactor}
                />
                {errors.supplierFactor
                  ? <p className="text-xs text-red-600 mt-1">{errors.supplierFactor}</p>
                  : (
                    <p className="text-xs text-gray-400 mt-1">
                      From the supplier disclosure, PPA or certificate. Note the contract or certificate
                      reference in Notes so the claim can be traced.
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
              max={todayLocal()}
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
              <p className="text-xs text-emerald-600 font-medium mb-0.5">
                {preview.outsideScopes ? 'Estimated CO₂e — outside the scopes (Montreal Protocol gas)' : 'Estimated CO₂e'}
              </p>
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
