'use client';

import { useState, useTransition, useRef, useEffect, useMemo } from 'react';
import type { TablesInsert } from '@/lib/supabase/types';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  CBAM_COMMODITIES, CBAM_COUNTRIES, SECTOR_COLORS,
  searchCBAMCommodities, calculateCBAM,
  type CBAMCommodity,
} from '@/lib/cbam-data';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  ArrowLeft, Calculator, Save, Trash2, BookOpen, History,
  ChevronDown, Info, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sentinel for the "no supplier" option in a Select.
 *
 * Radix reserves the empty string on `Select.Root` to mean "nothing selected,
 * show the placeholder", so an `Item` may not carry it — doing so throws at
 * render. The state still stores `''` for none (both save paths read
 * `supplierId || null`, and the free-text fallback is gated on it being
 * falsy); only the menu item needs a distinct value, mapped back on change.
 */
const NO_SUPPLIER = '__none__';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Supplier { id: string; name: string; country: string | null }

interface SavedFactor {
  id: string;
  organization_id: string;
  supplier_id: string | null;
  supplier_name: string;
  cn_code: string;
  commodity_name: string;
  emission_factor: number;
  factor_unit: string;
  factor_source: string | null;
  notes: string | null;
  created_at: string;
}

interface SavedCalculation {
  id: string;
  organization_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  cn_code: string;
  commodity_name: string;
  sector: string | null;
  country_of_origin: string;
  quantity: number;
  mass_unit: string;
  quantity_tonnes: number;
  emission_factor: number;
  factor_type: string;
  factor_source: string | null;
  total_tco2e: number;
  certificate_price_eur: number;
  estimated_cost_eur: number;
  notes: string | null;
  created_at: string;
}

interface Props {
  userRole: string;
  organizationId: string;
  initialSuppliers: Supplier[];
  initialSavedFactors: SavedFactor[];
  initialCalculations: SavedCalculation[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number, dp = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

// ─── Commodity combobox ───────────────────────────────────────────────────────

function CommoditySearch({
  value,
  onChange,
}: {
  value: CBAMCommodity | null;
  onChange: (c: CBAMCommodity | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchCBAMCommodities(query).slice(0, 25), [query]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function select(c: CBAMCommodity) {
    onChange(c);
    setQuery('');
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setQuery('');
  }

  return (
    <div ref={ref} className="relative">
      {value ? (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-emerald-300 bg-emerald-50">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                CN {value.cnCode}
              </span>
              <span
                className={cn(
                  'text-xs font-medium px-1.5 py-0.5 rounded',
                  SECTOR_COLORS[value.sector],
                )}
              >
                {value.sector}
              </span>
            </div>
            <p className="text-sm font-medium text-gray-900 mt-1">{value.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              EU default: {fmt(value.defaultFactor, 4)} tCO₂e / {value.unit}
            </p>
          </div>
          <button
            onClick={clear}
            className="text-gray-400 hover:text-gray-600 text-xs mt-0.5 flex-shrink-0"
          >
            ✕
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder="Search by CN code (e.g. 7208) or name (e.g. steel, cement)…"
              className="pr-8"
            />
            <ChevronDown
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
          </div>

          {open && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-72 overflow-y-auto">
              {results.length === 0 ? (
                <p className="text-sm text-gray-500 px-3 py-2">No commodities found.</p>
              ) : (
                results.map((c) => (
                  <button
                    key={c.cnCode}
                    onMouseDown={(e) => { e.preventDefault(); select(c); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                        CN {c.cnCode}
                      </span>
                      <span
                        className={cn(
                          'text-xs font-medium px-1.5 py-0.5 rounded',
                          SECTOR_COLORS[c.sector],
                        )}
                      >
                        {c.sector}
                      </span>
                    </div>
                    <p className="text-sm text-gray-900 mt-0.5">{c.name}</p>
                    <p className="text-xs text-gray-400">
                      Default: {fmt(c.defaultFactor, 4)} tCO₂e / {c.unit}
                    </p>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CBAMCalculatorClient({
  userRole,
  organizationId,
  initialSuppliers,
  initialSavedFactors,
  initialCalculations,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [isPending, startTransition] = useTransition();

  const canEdit = userRole === 'admin' || userRole === 'editor';

  // ─── Saved data state
  const [savedFactors, setSavedFactors] = useState<SavedFactor[]>(initialSavedFactors);
  const [calculations, setCalculations] = useState<SavedCalculation[]>(initialCalculations);

  // ─── Calculator form state
  const [commodity, setCommodity] = useState<CBAMCommodity | null>(null);
  const [country, setCountry] = useState('');
  const [quantity, setQuantity] = useState('');
  // The mass unit for goods. Electricity is always MWh, which every use below
  // handles by checking the commodity — so this never needs to hold 'MWh'.
  const [massUnit, setMassUnit] = useState<'kg' | 'tonnes'>('tonnes');
  const [factorMode, setFactorMode] = useState<'eu_default' | 'supplier_provided'>('eu_default');
  const [customFactor, setCustomFactor] = useState('');
  // No default price. A built-in figure goes stale within weeks and then
  // silently prices every estimate; the user enters the price they are using.
  const [certPrice, setCertPrice] = useState('');
  const priceEntered = parseFloat(certPrice) > 0;

  // Save calculation extras
  const [calcNotes, setCalcNotes] = useState('');
  const [calcSupplierName, setCalcSupplierName] = useState('');
  const [calcSupplierId, setCalcSupplierId] = useState<string>('');

  // Save factor panel (shown inline when supplier factor is entered)
  const [saveFactorName, setSaveFactorName] = useState('');
  const [saveFactorSource, setSaveFactorSource] = useState('');
  const [saveFactorSupplierId, setSaveFactorSupplierId] = useState<string>('');
  const [saveFactorNotes, setSaveFactorNotes] = useState('');
  const [showSaveFactorForm, setShowSaveFactorForm] = useState(false);

  // UI state
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [deletingFactorId, setDeletingFactorId] = useState<string | null>(null);
  const [deletingCalcId, setDeletingCalcId] = useState<string | null>(null);

  // ─── Live calculation ─────────────────────────────────────────────────────

  const activeFactor =
    factorMode === 'eu_default'
      ? commodity?.defaultFactor ?? null
      : parseFloat(customFactor) || null;

  const result = useMemo(() => {
    if (!commodity || !quantity || !country || activeFactor === null) return null;
    const qty = parseFloat(quantity);
    const price = parseFloat(certPrice) > 0 ? parseFloat(certPrice) : 0;
    if (isNaN(qty) || qty <= 0) return null;
    return calculateCBAM({
      commodity,
      quantity: qty,
      massUnit: commodity.unit === 'MWh' ? 'MWh' : massUnit,
      emissionFactor: activeFactor,
      factorType: factorMode,
      certificatePriceEur: price,
    });
  }, [commodity, quantity, country, activeFactor, massUnit, factorMode, certPrice]);

  function flash(msg: string, isError = false) {
    if (isError) { setError(msg); setSuccessMsg(''); }
    else { setSuccessMsg(msg); setError(''); }
    setTimeout(() => { setError(''); setSuccessMsg(''); }, 4000);
  }

  // ─── Save calculation ─────────────────────────────────────────────────────

  async function handleSaveCalc() {
    if (!result || !commodity) return;
    if (!priceEntered) { flash('Enter the certificate price you are using before saving.', true); return; }
    setError('');
    const qty = parseFloat(quantity);
    const price = parseFloat(certPrice);

    const row: TablesInsert<'cbam_calculations'> = {
      organization_id: organizationId,
      supplier_id: calcSupplierId || null,
      supplier_name: calcSupplierName || null,
      cn_code: commodity.cnCode,
      commodity_name: commodity.name,
      sector: commodity.sector,
      country_of_origin: country,
      quantity: qty,
      mass_unit: commodity.unit === 'MWh' ? 'MWh' : massUnit,
      quantity_tonnes: result.quantityTonnes,
      emission_factor: activeFactor!,
      factor_type: factorMode,
      factor_source: factorMode === 'eu_default'
        ? 'EU Commission Implementing Regulation (EU) 2023/1773'
        : saveFactorSource || null,
      total_tco2e: result.totalTCO2e,
      certificate_price_eur: price,
      estimated_cost_eur: result.estimatedCostEur,
      notes: calcNotes || null,
    };

    startTransition(async () => {
      const { data, error: err } = await supabase
        .from('cbam_calculations')
        .insert(row)
        .select()
        .single();

      if (err) { flash(`Failed to save: ${err.message}`, true); return; }
      setCalculations((prev) => [data as SavedCalculation, ...prev]);
      setCalcNotes('');
      flash('Calculation saved.');
    });
  }

  // ─── Save supplier factor ─────────────────────────────────────────────────

  async function handleSaveFactor() {
    if (!commodity || !customFactor || !saveFactorName) return;
    const factor = parseFloat(customFactor);
    if (isNaN(factor) || factor <= 0) { flash('Enter a valid emission factor.', true); return; }

    const row: TablesInsert<'cbam_supplier_factors'> = {
      organization_id: organizationId,
      supplier_id: saveFactorSupplierId || null,
      supplier_name: saveFactorName,
      cn_code: commodity.cnCode,
      commodity_name: commodity.name,
      emission_factor: factor,
      factor_unit: commodity.unit,
      factor_source: saveFactorSource || null,
      notes: saveFactorNotes || null,
    };

    startTransition(async () => {
      const { data, error: err } = await supabase
        .from('cbam_supplier_factors')
        .insert(row)
        .select()
        .single();

      if (err) { flash(`Failed to save factor: ${err.message}`, true); return; }
      setSavedFactors((prev) => [data as SavedFactor, ...prev]);
      setShowSaveFactorForm(false);
      setSaveFactorName('');
      setSaveFactorSource('');
      setSaveFactorSupplierId('');
      setSaveFactorNotes('');
      flash('Supplier factor saved.');
    });
  }

  // ─── Delete handlers ──────────────────────────────────────────────────────

  async function handleDeleteFactor(id: string) {
    startTransition(async () => {
      const { error: err } = await supabase
        .from('cbam_supplier_factors')
        .delete()
        .eq('id', id);
      if (err) { flash(`Delete failed: ${err.message}`, true); return; }
      setSavedFactors((prev) => prev.filter((f) => f.id !== id));
      flash('Factor deleted.');
    });
  }

  async function handleDeleteCalc(id: string) {
    startTransition(async () => {
      const { error: err } = await supabase
        .from('cbam_calculations')
        .delete()
        .eq('id', id);
      if (err) { flash(`Delete failed: ${err.message}`, true); return; }
      setCalculations((prev) => prev.filter((c) => c.id !== id));
      flash('Calculation deleted.');
    });
  }

  // ─── Load a saved factor into the calculator ──────────────────────────────
  function loadFactor(f: SavedFactor) {
    const c = CBAM_COMMODITIES.find((com) => com.cnCode === f.cn_code);
    if (c) {
      setCommodity(c);
      setFactorMode('supplier_provided');
      setCustomFactor(String(f.emission_factor));
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/suppliers"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft size={14} />
          Suppliers
        </Link>
        <div className="h-4 w-px bg-gray-300" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Calculator size={20} className="text-emerald-600" />
            CBAM Calculator
          </h1>
          <p className="text-sm text-gray-500">
            EU Carbon Border Adjustment Mechanism — estimate embedded emissions and certificate costs
          </p>
        </div>
      </div>

      {/* Regulatory notice */}
      <div className="flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
        <Info size={14} className="flex-shrink-0 mt-0.5" />
        <span>
          Default emission factors are sourced from EU Implementing Regulation 2023/1773 Annex III.
          These are fallback values for use when verified supplier data is unavailable.
          Consult a CBAM compliance advisor before submitting declarations to customs authorities.
          Certificate price fluctuates with the EU ETS market — update it to reflect current rates.
        </span>
      </div>

      {/* Alert / Success banners */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertCircle size={14} className="flex-shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      <Tabs defaultValue="calculator">
        <TabsList>
          <TabsTrigger value="calculator">
            <Calculator size={14} className="mr-1.5" />
            Calculator
          </TabsTrigger>
          <TabsTrigger value="factors">
            <BookOpen size={14} className="mr-1.5" />
            Supplier Factors
            {savedFactors.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">
                {savedFactors.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">
            <History size={14} className="mr-1.5" />
            History
            {calculations.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">
                {calculations.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── CALCULATOR TAB ─────────────────────────────────────────────── */}
        <TabsContent value="calculator" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

            {/* Form: col-span 3 */}
            <div className="lg:col-span-3 space-y-5">

              {/* Step 1 — Commodity */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700">
                    1 — Select Commodity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CommoditySearch value={commodity} onChange={setCommodity} />
                  {commodity?.notes && (
                    <p className="mt-2 text-xs text-amber-700 flex items-start gap-1.5">
                      <Info size={12} className="flex-shrink-0 mt-0.5" />
                      {commodity.notes}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Step 2 — Import details */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700">
                    2 — Import Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-xs font-medium text-gray-600 mb-1 block">
                      Country of Origin
                    </Label>
                    <Select value={country} onValueChange={setCountry}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select country…" />
                      </SelectTrigger>
                      <SelectContent>
                        {CBAM_COUNTRIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-gray-600 mb-1 block">
                      {commodity?.unit === 'MWh' ? 'Energy Volume' : 'Mass / Quantity'}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="Enter quantity"
                        className="flex-1"
                      />
                      {commodity?.unit === 'MWh' ? (
                        <div className="flex items-center px-3 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-600 font-medium">
                          MWh
                        </div>
                      ) : (
                        <Select
                          value={massUnit}
                          onValueChange={(v) => setMassUnit(v as 'kg' | 'tonnes')}
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="tonnes">Tonnes</SelectItem>
                            <SelectItem value="kg">kg</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Step 3 — Emission Factor */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700">
                    3 — Emission Factor
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Mode toggle */}
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => setFactorMode('eu_default')}
                      className={cn(
                        'flex-1 py-2 text-sm font-medium transition-colors',
                        factorMode === 'eu_default'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50',
                      )}
                    >
                      EU Default
                    </button>
                    <button
                      onClick={() => setFactorMode('supplier_provided')}
                      className={cn(
                        'flex-1 py-2 text-sm font-medium transition-colors border-l border-gray-200',
                        factorMode === 'supplier_provided'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50',
                      )}
                    >
                      Supplier-Provided
                    </button>
                  </div>

                  {factorMode === 'eu_default' ? (
                    <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                      {commodity ? (
                        <div className="space-y-1">
                          <p className="text-xs text-gray-500">EU default factor (Reg. 2023/1773 Annex III)</p>
                          <p className="text-lg font-semibold text-gray-900">
                            {fmt(commodity.defaultFactor, 4)}{' '}
                            <span className="text-sm font-normal text-gray-500">
                              tCO₂e / {commodity.unit}
                            </span>
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">Select a commodity to see its EU default factor.</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">
                          Emission Factor (tCO₂e / {commodity?.unit ?? 'tonne'})
                        </Label>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={customFactor}
                          onChange={(e) => setCustomFactor(e.target.value)}
                          placeholder="e.g. 1.25"
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          Enter the factor provided by your supplier per {commodity?.unit ?? 'tonne'} of product.
                        </p>
                      </div>

                      {/* Save factor toggle */}
                      {canEdit && customFactor && parseFloat(customFactor) > 0 && (
                        <button
                          onClick={() => setShowSaveFactorForm(!showSaveFactorForm)}
                          className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                        >
                          <Save size={12} />
                          {showSaveFactorForm ? 'Cancel saving factor' : 'Save this factor for reuse…'}
                        </button>
                      )}

                      {showSaveFactorForm && (
                        <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 space-y-3">
                          <p className="text-xs font-semibold text-emerald-800">Save Supplier Factor</p>
                          <div>
                            <Label className="text-xs text-gray-600 mb-1 block">Supplier / Source Name *</Label>
                            <Input
                              value={saveFactorName}
                              onChange={(e) => setSaveFactorName(e.target.value)}
                              placeholder="e.g. Acme Steel GmbH"
                              className="bg-white"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-gray-600 mb-1 block">Link to Existing Supplier</Label>
                            <Select
                              value={saveFactorSupplierId}
                              onValueChange={(v) => setSaveFactorSupplierId(v === NO_SUPPLIER ? '' : v)}
                            >
                              <SelectTrigger className="bg-white">
                                <SelectValue placeholder="Optional — link to supplier record" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NO_SUPPLIER}>None</SelectItem>
                                {initialSuppliers.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs text-gray-600 mb-1 block">Source / Reference</Label>
                            <Input
                              value={saveFactorSource}
                              onChange={(e) => setSaveFactorSource(e.target.value)}
                              placeholder="e.g. Supplier declaration, invoice 2024-01"
                              className="bg-white"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-gray-600 mb-1 block">Notes</Label>
                            <Input
                              value={saveFactorNotes}
                              onChange={(e) => setSaveFactorNotes(e.target.value)}
                              placeholder="Optional notes"
                              className="bg-white"
                            />
                          </div>
                          <Button
                            size="sm"
                            onClick={handleSaveFactor}
                            disabled={!saveFactorName || isPending}
                          >
                            <Save size={12} className="mr-1.5" />
                            Save Factor
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Step 4 — Certificate Price */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700">
                    4 — EU ETS Certificate Price
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 font-medium">€</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={certPrice}
                      onChange={(e) => setCertPrice(e.target.value)}
                      placeholder="Price"
                      className="w-36"
                    />
                    <span className="text-sm text-gray-500">per tCO₂e</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">
                    Enter the CBAM certificate price you are using. Certificates are priced from EU ETS
                    allowance auction prices published by the European Commission, so check the current
                    figure (for example on the{' '}
                    <a
                      href="https://ember-climate.org/data/carbon-price-viewer/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      Ember Carbon Price Viewer
                    </a>
                    ) before relying on an estimate.
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Results panel: col-span 2 */}
            <div className="lg:col-span-2 space-y-4">
              <Card className={cn(
                'sticky top-6 transition-all',
                result ? 'border-emerald-200 shadow-sm' : 'opacity-70',
              )}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-gray-700">Result</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {result ? (
                    <>
                      <div className="space-y-3">
                        {/* Quantity normalised */}
                        <div className="flex justify-between items-baseline text-sm">
                          <span className="text-gray-500">
                            Quantity ({commodity?.unit === 'MWh' ? 'MWh' : 'tonnes'})
                          </span>
                          <span className="font-medium text-gray-900">
                            {fmt(result.quantityTonnes, 3)}
                          </span>
                        </div>

                        {/* Factor used */}
                        <div className="flex justify-between items-baseline text-sm">
                          <span className="text-gray-500">Factor used</span>
                          <span className="font-medium text-gray-900">
                            {fmt(activeFactor!, 4)} tCO₂e / {commodity?.unit}
                          </span>
                        </div>
                        <div className="flex justify-end">
                          <Badge
                            variant={factorMode === 'eu_default' ? 'secondary' : 'blue'}
                            className="text-xs"
                          >
                            {factorMode === 'eu_default' ? 'EU Default' : 'Supplier-Provided'}
                          </Badge>
                        </div>

                        <div className="border-t border-gray-100 pt-3" />

                        {/* tCO2e */}
                        <div>
                          <p className="text-xs text-gray-500 mb-0.5">Embedded Emissions</p>
                          <p className="text-2xl font-bold text-gray-900">
                            {fmt(result.totalTCO2e, 3)}
                            <span className="text-sm font-normal text-gray-500 ml-1">tCO₂e</span>
                          </p>
                        </div>

                        {/* Certificate cost */}
                        <div>
                          <p className="text-xs text-gray-500 mb-0.5">
                            Gross certificate cost
                          </p>
                          {priceEntered ? (
                            <>
                              <p className="text-2xl font-bold text-emerald-700">
                                €{fmt(result.estimatedCostEur, 2)}
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                @ €{fmt(parseFloat(certPrice), 2)} / tCO₂e
                              </p>
                            </>
                          ) : (
                            <p className="text-sm text-gray-400 mt-1">Enter a certificate price (step 4).</p>
                          )}
                          {/* Embedded emissions × price is an upper bound, not the bill: the
                              certificates owed are reduced for EU ETS free allocation still
                              being phased out and for carbon price paid at origin. */}
                          <p className="text-[11px] text-gray-400 mt-1 max-w-xs">
                            Before the adjustment for EU ETS free allocation and for any carbon price paid in
                            the country of origin (Regulation (EU) 2023/956, Articles 31 and 9), both of which
                            reduce the certificates actually owed.
                          </p>
                        </div>
                      </div>

                      {/* Save section */}
                      {canEdit && (
                        <div className="border-t border-gray-100 pt-4 space-y-3">
                          <p className="text-xs font-medium text-gray-600">Save to History</p>
                          <div>
                            <Label className="text-xs text-gray-500 mb-1 block">
                              Supplier Name (optional)
                            </Label>
                            <Select value={calcSupplierId} onValueChange={(v) => {
                              const id = v === NO_SUPPLIER ? '' : v;
                              setCalcSupplierId(id);
                              const s = initialSuppliers.find((x) => x.id === id);
                              setCalcSupplierName(s ? s.name : '');
                            }}>
                              <SelectTrigger className="text-xs">
                                <SelectValue placeholder="Select or leave blank" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NO_SUPPLIER}>None</SelectItem>
                                {initialSuppliers.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {!calcSupplierId && (
                              <Input
                                className="mt-1.5 text-xs"
                                value={calcSupplierName}
                                onChange={(e) => setCalcSupplierName(e.target.value)}
                                placeholder="Or type a name…"
                              />
                            )}
                          </div>
                          <div>
                            <Label className="text-xs text-gray-500 mb-1 block">Notes</Label>
                            <Input
                              className="text-xs"
                              value={calcNotes}
                              onChange={(e) => setCalcNotes(e.target.value)}
                              placeholder="Optional notes"
                            />
                          </div>
                          <Button
                            className="w-full"
                            size="sm"
                            onClick={handleSaveCalc}
                            disabled={isPending || !priceEntered}
                          >
                            <Save size={12} className="mr-1.5" />
                            Save Calculation
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-8 text-gray-400 text-sm">
                      <Calculator size={28} className="mx-auto mb-2 opacity-30" />
                      Complete the form to see your CBAM estimate.
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Breakdown hint */}
              {result && commodity && (
                <div className="text-xs text-gray-500 space-y-1 px-1">
                  <p className="font-medium text-gray-600">Calculation</p>
                  <p>
                    {fmt(result.quantityTonnes, 3)} {commodity.unit}
                    {' × '}
                    {fmt(activeFactor!, 4)} tCO₂e/{commodity.unit}
                    {' = '}
                    <strong>{fmt(result.totalTCO2e, 3)} tCO₂e</strong>
                  </p>
                  <p>
                    {fmt(result.totalTCO2e, 3)} tCO₂e
                    {priceEntered ? (
                      <>
                        {' × '}€{fmt(parseFloat(certPrice), 2)}
                        {' = '}
                        <strong>€{fmt(result.estimatedCostEur, 2)}</strong> gross
                      </>
                    ) : ' × certificate price (not entered)'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── SUPPLIER FACTORS TAB ─────────────────────────────────────────── */}
        <TabsContent value="factors" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saved Supplier Emission Factors</CardTitle>
              <p className="text-sm text-gray-500 mt-0.5">
                Supplier-provided factors stored ad-hoc. Use these to override EU defaults in the
                calculator when a supplier has shared verified emission data.
              </p>
            </CardHeader>
            <CardContent>
              {savedFactors.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <BookOpen size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No supplier factors saved yet.</p>
                  <p className="text-xs mt-1">
                    Switch to the Calculator tab, select Supplier-Provided, enter a factor, and save it.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                        <th className="text-left py-2 pr-4 font-medium">Supplier</th>
                        <th className="text-left py-2 pr-4 font-medium">CN Code</th>
                        <th className="text-left py-2 pr-4 font-medium">Commodity</th>
                        <th className="text-right py-2 pr-4 font-medium">Factor</th>
                        <th className="text-left py-2 pr-4 font-medium">Source</th>
                        <th className="text-left py-2 pr-4 font-medium">Saved</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {savedFactors.map((f) => (
                        <tr key={f.id} className="hover:bg-gray-50 group">
                          <td className="py-2.5 pr-4 font-medium text-gray-900">
                            {f.supplier_name}
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                              CN {f.cn_code}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-gray-600 max-w-[220px] truncate">
                            {f.commodity_name}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-semibold text-gray-900">
                            {fmt(f.emission_factor, 4)}
                            <span className="text-xs font-normal text-gray-500 ml-1">
                              tCO₂e/{f.factor_unit}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-gray-500 text-xs max-w-[160px] truncate">
                            {f.factor_source ?? '—'}
                          </td>
                          <td className="py-2.5 pr-4 text-gray-400 text-xs whitespace-nowrap">
                            {fmtDate(f.created_at)}
                          </td>
                          <td className="py-2.5">
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-emerald-600 hover:text-emerald-700"
                                onClick={() => loadFactor(f)}
                              >
                                Use
                              </Button>
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                                  onClick={() => setDeletingFactorId(f.id)}
                                >
                                  <Trash2 size={12} />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── HISTORY TAB ──────────────────────────────────────────────────── */}
        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Calculation History</CardTitle>
              <p className="text-sm text-gray-500 mt-0.5">
                Saved CBAM estimates. Useful for tracking exposure across suppliers and commodity shipments.
              </p>
            </CardHeader>
            <CardContent>
              {calculations.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <History size={28} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No calculations saved yet.</p>
                  <p className="text-xs mt-1">
                    Run a calculation and click &ldquo;Save Calculation&rdquo; to build a history.
                  </p>
                </div>
              ) : (
                <>
                  {/* Summary stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                    {[
                      {
                        label: 'Total Calculations',
                        value: calculations.length,
                        unit: '',
                      },
                      {
                        label: 'Total Embedded Emissions',
                        value: fmt(
                          calculations.reduce((s, c) => s + c.total_tco2e, 0),
                          2,
                        ),
                        unit: 'tCO₂e',
                      },
                      {
                        label: 'Total Est. CBAM Cost',
                        value: `€${fmt(
                          calculations.reduce((s, c) => s + c.estimated_cost_eur, 0),
                          2,
                        )}`,
                        unit: '',
                      },
                      {
                        label: 'Supplier-Provided Factors',
                        value: calculations.filter((c) => c.factor_type === 'supplier_provided').length,
                        unit: '',
                      },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-lg border border-gray-200 p-3 bg-gray-50"
                      >
                        <p className="text-xs text-gray-500">{stat.label}</p>
                        <p className="text-lg font-semibold text-gray-900 mt-0.5">
                          {stat.value}
                          {stat.unit && (
                            <span className="text-xs font-normal text-gray-500 ml-1">
                              {stat.unit}
                            </span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                          <th className="text-left py-2 pr-3 font-medium">Date</th>
                          <th className="text-left py-2 pr-3 font-medium">Supplier</th>
                          <th className="text-left py-2 pr-3 font-medium">Commodity</th>
                          <th className="text-left py-2 pr-3 font-medium">Country</th>
                          <th className="text-right py-2 pr-3 font-medium">Quantity</th>
                          <th className="text-right py-2 pr-3 font-medium">tCO₂e</th>
                          <th className="text-right py-2 pr-3 font-medium">Est. Cost</th>
                          <th className="text-left py-2 pr-3 font-medium">Factor</th>
                          <th className="py-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {calculations.map((c) => (
                          <tr key={c.id} className="hover:bg-gray-50 group">
                            <td className="py-2.5 pr-3 text-gray-400 text-xs whitespace-nowrap">
                              {fmtDate(c.created_at)}
                            </td>
                            <td className="py-2.5 pr-3 text-gray-700 font-medium">
                              {c.supplier_name ?? <span className="text-gray-400">—</span>}
                            </td>
                            <td className="py-2.5 pr-3 max-w-[180px]">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded text-gray-600">
                                  CN {c.cn_code}
                                </span>
                                <span className="text-gray-700 text-xs">{c.commodity_name}</span>
                              </div>
                            </td>
                            <td className="py-2.5 pr-3 text-gray-600 text-xs">
                              {c.country_of_origin}
                            </td>
                            <td className="py-2.5 pr-3 text-right text-gray-700 text-xs whitespace-nowrap">
                              {fmt(c.quantity, 2)} {c.mass_unit}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-semibold text-gray-900">
                              {fmt(c.total_tco2e, 3)}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-semibold text-emerald-700">
                              €{fmt(c.estimated_cost_eur, 2)}
                            </td>
                            <td className="py-2.5 pr-3">
                              <Badge
                                variant={c.factor_type === 'eu_default' ? 'secondary' : 'blue'}
                                className="text-xs"
                              >
                                {c.factor_type === 'eu_default' ? 'EU Default' : 'Supplier'}
                              </Badge>
                            </td>
                            <td className="py-2.5">
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-red-500 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => setDeletingCalcId(c.id)}
                                >
                                  <Trash2 size={12} />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Confirm dialogs ────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={deletingFactorId !== null}
        onOpenChange={(o) => { if (!o) setDeletingFactorId(null); }}
        title="Delete supplier factor?"
        description="This will permanently remove this saved emission factor."
        onConfirm={() => { if (deletingFactorId) { handleDeleteFactor(deletingFactorId); setDeletingFactorId(null); } }}
        loading={isPending}
      />

      <ConfirmDialog
        open={deletingCalcId !== null}
        onOpenChange={(o) => { if (!o) setDeletingCalcId(null); }}
        title="Delete calculation?"
        description="This will permanently remove this saved calculation."
        onConfirm={() => { if (deletingCalcId) { handleDeleteCalc(deletingCalcId); setDeletingCalcId(null); } }}
        loading={isPending}
      />
    </div>
  );
}
