'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { fmtCO2e, formatDate } from '@/lib/utils';
import { totalsByCategory, primaryDataShare, METHOD_LABELS, type Scope3Method } from '@/lib/scope3';
import type { Scope3Category, Scope3Entry, Scope3Factor } from '@/lib/supabase/types';
import { scoreBand, type SupplierDeclaration, type SupplierScore } from '@/lib/supplier-data-core';
import { EvidenceCell } from '@/components/evidence/EvidencePanel';
import { evidenceCountKey } from '@/lib/evidence-core';
import { Scope3Drawer } from './Scope3Drawer';
import { FactorImportDialog } from './FactorImportDialog';
import { Plus, AlertCircle, Upload } from 'lucide-react';

type EntryRow = Scope3Entry & {
  suppliers: { name: string } | null;
  sites: { name: string } | null;
};

interface Props {
  userRole: string;
  scopeLabel: string;
  currentYear: number;
  initialEntries: EntryRow[];
  categories: Scope3Category[];
  factors: Scope3Factor[];
  suppliers: { id: string; name: string }[];
  sites: { id: string; name: string }[];
  declarations: SupplierDeclaration[];
  supplierScores: SupplierScore[];
  organizationId: string | null;
  evidenceCounts: Record<string, number>;
}

const BAND_BADGE: Record<string, 'default' | 'blue' | 'warning' | 'secondary'> = {
  strong: 'default',
  partial: 'blue',
  weak: 'warning',
  none: 'secondary',
};

const QUALITY_BADGE: Record<string, 'default' | 'secondary' | 'warning'> = {
  primary: 'default',
  secondary: 'secondary',
  estimated: 'warning',
};

export function Scope3Client({
  userRole, scopeLabel, currentYear, initialEntries, categories, factors, suppliers, sites,
  declarations, supplierScores, organizationId, evidenceCounts,
}: Props) {
  const router = useRouter();
  const canEdit = userRole === 'admin' || userRole === 'editor';

  const [entries, setEntries] = useState<EntryRow[]>(initialEntries);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [presetCategory, setPresetCategory] = useState<number | undefined>(undefined);
  const [factorImportOpen, setFactorImportOpen] = useState(false);
  const [presetDeclaration, setPresetDeclaration] = useState<SupplierDeclaration | undefined>(undefined);

  const categoryMeta = useMemo(
    () => new Map(categories.map(c => [c.category_number, c])),
    [categories],
  );

  const totals = useMemo(() => totalsByCategory(entries), [entries]);
  const grandTotal = useMemo(() => entries.reduce((s, e) => s + e.co2e_kg, 0), [entries]);
  const primaryShare = useMemo(() => primaryDataShare(entries), [entries]);

  const upstream = totals.filter(t => t.valueChain === 'upstream');
  const downstream = totals.filter(t => t.valueChain === 'downstream');
  const categoriesWithData = totals.filter(t => t.entryCount > 0).length;

  function openForCategory(n?: number) {
    setPresetCategory(n);
    setPresetDeclaration(undefined);
    setDrawerOpen(true);
  }

  /** Start a Category 1 entry pre-filled from a supplier's own declaration. */
  function applyDeclaration(d: SupplierDeclaration) {
    setPresetCategory(1);
    setPresetDeclaration(d);
    setDrawerOpen(true);
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Scope 3</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Value-chain emissions across the 15 GHG Protocol categories · {scopeLabel} · FY {currentYear}
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => openForCategory(undefined)}>
            <Plus size={14} className="mr-1.5" />Add Scope 3 entry
          </Button>
        )}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-5">
            <p className="text-xs text-gray-500 font-medium">Total Scope 3</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">{fmtCO2e(grandTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-5">
            <p className="text-xs text-gray-500 font-medium">Categories with data</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">{categoriesWithData}<span className="text-base text-gray-400"> / 15</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-5">
            <p className="text-xs text-gray-500 font-medium">Primary data share</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">{primaryShare.toFixed(1)}%</p>
            <p className="text-[11px] text-gray-400 mt-0.5">by emissions, not entry count</p>
          </CardContent>
        </Card>
      </div>

      {factors.length === 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex gap-3">
          <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-medium mb-0.5">No emission factor library loaded</p>
            <p>
              Scope 3 factor sets (EPA Supply Chain/USEEIO, DEFRA, EPA WARM, ecoinvent) are licensed
              separately and are not bundled with the platform. Load the library you&apos;re licensed for
              to calculate using library factors — you can still record supplier-specific entries by
              entering a factor and citing its source.
            </p>
          </div>
        </div>
      )}

      <Tabs defaultValue="categories">
        <TabsList className="mb-4">
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="entries">Entries ({entries.length})</TabsTrigger>
          <TabsTrigger value="supplier-data">Supplier data ({declarations.length})</TabsTrigger>
          <TabsTrigger value="factors">Factor library ({factors.length})</TabsTrigger>
        </TabsList>

        {/* ── Categories ─────────────────────────────────────────────── */}
        <TabsContent value="categories">
          <div className="space-y-6">
            {[
              { label: 'Upstream', rows: upstream },
              { label: 'Downstream', rows: downstream },
            ].map(group => (
              <div key={group.label}>
                <h2 className="text-sm font-semibold text-gray-700 mb-3">{group.label}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  {group.rows.map(t => {
                    const meta = categoryMeta.get(t.categoryNumber);
                    const share = grandTotal > 0 ? (t.co2eKg / grandTotal) * 100 : 0;
                    return (
                      <Card key={t.categoryNumber} className={t.entryCount === 0 ? 'opacity-60' : ''}>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="text-[11px] font-semibold text-gray-400">CATEGORY {t.categoryNumber}</span>
                            {t.entryCount > 0 && (
                              <span className="text-[11px] text-gray-400">{share.toFixed(0)}%</span>
                            )}
                          </div>
                          <p className="text-sm font-medium text-gray-900 leading-snug mb-2">{t.name}</p>
                          {t.entryCount > 0 ? (
                            <>
                              <p className="text-lg font-semibold text-gray-900">{fmtCO2e(t.co2eKg)}</p>
                              <p className="text-xs text-gray-400 mt-0.5">{t.entryCount} entr{t.entryCount === 1 ? 'y' : 'ies'}</p>
                            </>
                          ) : (
                            <p className="text-xs text-gray-400" title={meta?.description ?? ''}>No data yet</p>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => openForCategory(t.categoryNumber)}
                              className="text-xs text-emerald-700 hover:underline mt-2"
                            >
                              Add entry
                            </button>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* ── Entries ────────────────────────────────────────────────── */}
        <TabsContent value="entries">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {entries.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-500">
                  No Scope 3 entries for FY {currentYear} yet.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Cat.</th>
                      <th className="px-4 py-3 font-medium">Description</th>
                      <th className="px-4 py-3 font-medium">Method</th>
                      <th className="px-4 py-3 font-medium text-right">Activity</th>
                      <th className="px-4 py-3 font-medium text-right">Factor</th>
                      <th className="px-4 py-3 font-medium text-right">CO₂e</th>
                      <th className="px-4 py-3 font-medium">Quality</th>
                      <th className="px-4 py-3 font-medium">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(e => (
                      <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(e.entry_date)}</td>
                        <td className="px-4 py-3 text-gray-500">{e.category_number}</td>
                        <td className="px-4 py-3 text-gray-900">
                          {e.description || <span className="text-gray-400">—</span>}
                          {e.suppliers?.name && <span className="text-gray-400"> · {e.suppliers.name}</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {METHOD_LABELS[e.calculation_method as Scope3Method] ?? e.calculation_method}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">
                          {e.activity_value.toLocaleString()} <span className="text-gray-400">{e.activity_unit}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap" title={e.factor_source}>
                          {e.factor_value} <span className="text-gray-400">/{e.factor_unit}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">{fmtCO2e(e.co2e_kg)}</td>
                        <td className="px-4 py-3">
                          <Badge variant={QUALITY_BADGE[e.data_quality] ?? 'secondary'}>{e.data_quality}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <EvidenceCell
                            recordType="scope3_entry"
                            recordId={e.id}
                            title={`Category ${e.category_number} · ${e.description || 'no description'} · ${formatDate(e.entry_date)}`}
                            organizationId={organizationId}
                            canEdit={canEdit}
                            initialCount={evidenceCounts[evidenceCountKey('scope3_entry', e.id)] ?? 0}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Supplier data ──────────────────────────────────────────── */}
        <TabsContent value="supplier-data">
          <div className="space-y-6">
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800">
              Emission data your suppliers have declared — via CBAM factor records or CBAM survey
              responses. Using a declaration creates a <strong>Category 1</strong> entry with the
              supplier-specific method and <strong>primary</strong> data quality, citing the
              supplier&apos;s own disclosure as the source.
            </div>

            {/* Declarations */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Declared emission factors</h2>
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  {declarations.length === 0 ? (
                    <div className="py-12 text-center text-sm text-gray-500 px-6">
                      <p className="mb-1">No supplier declarations yet.</p>
                      <p className="text-xs text-gray-400">
                        Send suppliers a CBAM survey, or record their declared factors in the CBAM calculator.
                      </p>
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                          <th className="px-4 py-3 font-medium">Supplier</th>
                          <th className="px-4 py-3 font-medium">Product</th>
                          <th className="px-4 py-3 font-medium text-right">Declared intensity</th>
                          <th className="px-4 py-3 font-medium">Verified</th>
                          <th className="px-4 py-3 font-medium">Source</th>
                          <th className="px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {declarations.map((d, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-gray-900">{d.supplierName}</td>
                            <td className="px-4 py-3 text-gray-600">{d.product ?? '—'}</td>
                            <td className="px-4 py-3 text-right text-gray-900 whitespace-nowrap">
                              {d.intensityKgCo2e.toLocaleString()} <span className="text-gray-400">kg/{d.unit}</span>
                            </td>
                            <td className="px-4 py-3">
                              {d.verified
                                ? <Badge variant="default">Verified</Badge>
                                : <Badge variant="secondary">Self-declared</Badge>}
                            </td>
                            <td className="px-4 py-3 text-gray-600 max-w-xs truncate" title={d.sourceLabel}>
                              {d.sourceLabel}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              {canEdit && (
                                <button
                                  onClick={() => applyDeclaration(d)}
                                  className="text-sm text-emerald-700 hover:underline"
                                >
                                  Use for Category 1
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Supplier scores */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-1">Supplier data quality</h2>
              <p className="text-xs text-gray-500 mb-3">
                Transparent scoring — hover a score to see exactly which components it earned.
              </p>
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  {supplierScores.length === 0 ? (
                    <div className="py-12 text-center text-sm text-gray-500">No suppliers yet.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                          <th className="px-4 py-3 font-medium">Supplier</th>
                          <th className="px-4 py-3 font-medium">Data quality</th>
                          <th className="px-4 py-3 font-medium">Breakdown</th>
                          <th className="px-4 py-3 font-medium text-right">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...supplierScores].sort((a, b) => a.score - b.score).map(s => (
                          <tr key={s.supplierId ?? s.supplierName} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-gray-900">{s.supplierName}</td>
                            <td className="px-4 py-3">
                              <Badge variant={BAND_BADGE[scoreBand(s.score)]}>{scoreBand(s.score)}</Badge>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {s.components.map(c => (
                                  <span
                                    key={c.label}
                                    title={`${c.label}: ${c.points}/${c.max}`}
                                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                                      c.met ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'
                                    }`}
                                  >
                                    {c.label}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-medium text-gray-900">{s.score}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── Factor library ─────────────────────────────────────────── */}
        <TabsContent value="factors">
          {canEdit && (
            <div className="flex justify-end mb-3">
              <Button size="sm" variant="outline" onClick={() => setFactorImportOpen(true)}>
                <Upload size={14} className="mr-1.5" />Import factor library
              </Button>
            </div>
          )}
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {factors.length === 0 ? (
                <div className="py-16 text-center text-sm text-gray-500 px-6">
                  <p className="mb-1">No factors loaded.</p>
                  <p className="text-xs text-gray-400 max-w-lg mx-auto">
                    Import the factor library you are licensed for. Every factor must carry a cited
                    source and data year.
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                      <th className="px-4 py-3 font-medium">Cat.</th>
                      <th className="px-4 py-3 font-medium">Activity key</th>
                      <th className="px-4 py-3 font-medium">Method</th>
                      <th className="px-4 py-3 font-medium text-right">Factor</th>
                      <th className="px-4 py-3 font-medium">Region</th>
                      <th className="px-4 py-3 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factors.map(f => (
                      <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3 text-gray-500">{f.category_number}</td>
                        <td className="px-4 py-3 text-gray-900">
                          {f.label || f.activity_key}
                          {f.label && <span className="text-gray-400"> · {f.activity_key}</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {METHOD_LABELS[f.method as Scope3Method] ?? f.method}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900 whitespace-nowrap">
                          {f.factor_value} <span className="text-gray-400">kg/{f.activity_unit}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{f.region ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {f.factor_source}<span className="text-gray-400"> · {f.data_year}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Scope3Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        categories={categories}
        factors={factors}
        suppliers={suppliers}
        sites={sites}
        presetCategory={presetCategory}
        presetDeclaration={presetDeclaration}
        onSaved={(entry) => { setEntries(prev => [entry as EntryRow, ...prev]); router.refresh(); }}
      />

      <FactorImportDialog open={factorImportOpen} onClose={() => setFactorImportOpen(false)} />
    </div>
  );
}
