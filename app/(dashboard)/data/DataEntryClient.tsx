'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmissionDrawer } from './EmissionDrawer';
import { WaterDrawer } from './WaterDrawer';
import { WasteDrawer } from './WasteDrawer';
import { ImportDialog } from './ImportDialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatDate, fmtCO2e, fmt, scopeLabel } from '@/lib/utils';
import { SCOPE1_CATEGORY_LABELS } from '@/lib/emission-factor-types';
import { EvidenceCell } from '@/components/evidence/EvidencePanel';
import { evidenceCountKey, type EvidenceRecordType } from '@/lib/evidence-core';
import { sourceLabel } from '@/lib/source-labels';
import Link from 'next/link';
import { Plus, Trash2, FileText, Droplets, Recycle, Upload, Stethoscope, SlidersHorizontal } from 'lucide-react';
import type { EmissionEntry, EhsEntry } from '@/lib/supabase/types';

interface Site { id: string; name: string; city: string | null; state: string | null; zip_code: string | null; }
interface RefrigerantFactor { refrigerant_code: string; refrigerant_name: string; gwp_100_year: number; }

interface Props {
  sites: Site[];
  initialEmissions: Array<EmissionEntry & { sites: { name: string } | null }>;
  initialEhsEntries: Array<EhsEntry & { sites: { name: string } | null }>;
  refrigerantFactors: RefrigerantFactor[];
  /** Null only if the profile lookup failed; evidence is then unavailable. */
  organizationId: string | null;
  userRole: string;
  initialEvidenceCounts: Record<string, number>;
}

export function DataEntryClient({
  sites, initialEmissions, initialEhsEntries, refrigerantFactors,
  organizationId, userRole, initialEvidenceCounts,
}: Props) {
  const supabase = createClient();
  const { toast } = useToast();
  const canEdit = userRole === 'admin' || userRole === 'editor';

  const [emissions, setEmissions] = useState(initialEmissions);
  const [ehsEntries, setEhsEntries] = useState(initialEhsEntries);

  const [emissionDrawerOpen, setEmissionDrawerOpen] = useState(false);
  const [waterDrawerOpen, setWaterDrawerOpen]       = useState(false);
  const [wasteDrawerOpen, setWasteDrawerOpen]       = useState(false);
  const [importOpen, setImportOpen]                 = useState(false);

  const [deletingEntry, setDeletingEntry] = useState<{ id: string; table: 'emission_entries' | 'ehs_entries' } | null>(null);

  // Counts come from the server so every row shows its state without a query
  // per row. Each cell tracks its own from there.
  const evidenceCounts = initialEvidenceCounts;

  // In-page filters. The sidebar scope narrows which sites are loaded at all;
  // these narrow what is shown within that, so the two compose.
  const [siteFilter, setSiteFilter]   = useState('all');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [fromDate, setFromDate]       = useState('');
  const [toDate, setToDate]           = useState('');
  const [deleting, setDeleting] = useState(false);

  const matchesFilters = (e: { site_id: string | null; entry_date: string }) => {
    // An entity-level metric has no site, so it cannot match a specific site
    // filter. Showing it anyway would attribute an organization-wide figure to
    // one plant — the same misstatement the empty-scope rule guards against.
    if (siteFilter !== 'all' && e.site_id !== siteFilter) return false;
    if (fromDate && e.entry_date < fromDate) return false;
    if (toDate && e.entry_date > toDate) return false;
    return true;
  };

  const filteredEmissions = emissions.filter(
    (e) => matchesFilters(e) && (scopeFilter === 'all' || e.scope === scopeFilter),
  );
  const filteredEhs = ehsEntries.filter(matchesFilters);

  const waterEntries = filteredEhs.filter((e) => e.metric_type === 'water');
  const wasteEntries = filteredEhs.filter((e) => e.metric_type === 'waste');

  const filtersActive =
    siteFilter !== 'all' || scopeFilter !== 'all' || fromDate !== '' || toDate !== '';

  function clearFilters() {
    setSiteFilter('all'); setScopeFilter('all'); setFromDate(''); setToDate('');
  }

  /** Evidence affordance for one row, with its count from the bulk fetch. */
  function evidenceCell(recordType: EvidenceRecordType, recordId: string, title: string) {
    return (
      <EvidenceCell
        recordType={recordType}
        recordId={recordId}
        title={title}
        organizationId={organizationId}
        canEdit={canEdit}
        initialCount={evidenceCounts[evidenceCountKey(recordType, recordId)] ?? 0}
      />
    );
  }

  // ── Soft-delete ──────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deletingEntry) return;
    setDeleting(true);
    // .select() so an update RLS filtered out comes back as zero rows. Without
    // it a refused delete still removed the row from the screen, and it
    // reappeared on the next load — still counted in every total.
    const { data, error } = await supabase.from(deletingEntry.table)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', deletingEntry.id)
      .select('id');

    if (error || !data?.length) {
      toast(error?.message ?? 'That entry could not be deleted.', 'error');
      setDeleting(false);
      setDeletingEntry(null);
      return;
    }

    if (deletingEntry.table === 'emission_entries') {
      setEmissions((prev) => prev.filter((e) => e.id !== deletingEntry.id));
    } else {
      setEhsEntries((prev) => prev.filter((e) => e.id !== deletingEntry.id));
    }
    setDeleting(false);
    setDeletingEntry(null);
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Environmental Data Entry</h1>
          <p className="text-sm text-gray-500 mt-1">Log emissions, water and waste for your sites, or import a spreadsheet.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Upload size={14} className="text-emerald-600" />
            Import data
          </button>
          <Link
            href="/data/factors"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <SlidersHorizontal size={14} className="text-emerald-600" />
            Emission factors
          </Link>
          <Link
            href="/data/review"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Stethoscope size={14} className="text-emerald-600" />
            Data review
          </Link>
        </div>
      </div>

      {/* Filters — these narrow within whatever the sidebar scope already loaded */}
      <div className="flex items-end gap-3 flex-wrap mb-5 pb-5 border-b border-gray-100">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Site</label>
          <select
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            className="border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="all">All sites in scope</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Scope</label>
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            className="border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="all">Scope 1 &amp; 2</option>
            <option value="scope1">Scope 1 only</option>
            <option value="scope2">Scope 2 only</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="border border-gray-200 rounded-md px-2 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        {filtersActive && (
          <button onClick={clearFilters} className="text-xs text-emerald-700 hover:underline pb-2">
            Clear filters
          </button>
        )}
      </div>

      <Tabs defaultValue="emissions">
        <TabsList>
          <TabsTrigger value="emissions"><FileText size={13} className="mr-1.5" />Emissions</TabsTrigger>
          <TabsTrigger value="water"><Droplets size={13} className="mr-1.5" />Water</TabsTrigger>
          <TabsTrigger value="waste"><Recycle size={13} className="mr-1.5" />Waste</TabsTrigger>
        </TabsList>

        {/* ── Emissions ─────────────────────────────────────────────────── */}
        <TabsContent value="emissions">
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">Emission entries</p>
                <p className="text-xs text-gray-400 mt-0.5">{filteredEmissions.length}{filtersActive ? ` of ${emissions.length}` : ''} entries</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => setEmissionDrawerOpen(true)}>
                  <Plus size={14} />Add entry
                </Button>
              </div>
            </div>

            {filteredEmissions.length === 0 ? (
              <EmptyState
                icon={<FileText size={28} className="text-gray-300" />}
                title="No emission entries yet"
                description="Log your first electricity, natural gas, fuel, or refrigerant entry to get started."
                action={<Button size="sm" onClick={() => setEmissionDrawerOpen(true)}><Plus size={13} />Add first entry</Button>}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 font-medium">
                      <th className="text-left px-6 py-3">Date</th>
                      <th className="text-left px-4 py-3">Site</th>
                      <th className="text-left px-4 py-3">Scope</th>
                      <th className="text-left px-4 py-3">Source</th>
                      <th className="text-right px-4 py-3">Quantity</th>
                      <th className="text-right px-4 py-3">CO₂e</th>
                      <th className="text-left px-4 py-3">Method</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredEmissions.map((e) => (
                      <tr key={e.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-6 py-3 text-gray-700 whitespace-nowrap">{formatDate(e.entry_date)}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{e.sites?.name ?? '—'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={e.scope === 'scope1' ? 'blue' : 'purple'}>
                            {scopeLabel(e.scope)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {sourceLabel(e.source_type)}
                          {e.source_detail && <span className="text-gray-400"> ({e.source_detail})</span>}
                          {e.scope === 'scope1' && (
                            <span className="block text-[11px] text-gray-400">
                              {e.scope1_category
                                ? SCOPE1_CATEGORY_LABELS[e.scope1_category] ?? e.scope1_category
                                : <span className="text-amber-600">Unclassified</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                          {fmt(e.quantity)} {e.unit}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                          {fmtCO2e(e.co2e_kg)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-gray-400">
                            {e.accounting_method === 'market_based' ? 'Market' : 'Location'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-0.5">
                            {evidenceCell('emission_entry', e.id, `${sourceLabel(e.source_type)} · ${formatDate(e.entry_date)} · ${e.sites?.name ?? 'no site'}`)}
                            <button
                              onClick={() => setDeletingEntry({ id: e.id, table: 'emission_entries' })}
                              className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Delete entry"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Water ─────────────────────────────────────────────────────── */}
        <TabsContent value="water">
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">Water entries</p>
                <p className="text-xs text-gray-400 mt-0.5">{waterEntries.length} entries</p>
              </div>
              <Button size="sm" onClick={() => setWaterDrawerOpen(true)}>
                <Plus size={14} />Add entry
              </Button>
            </div>

            {waterEntries.length === 0 ? (
              <EmptyState
                icon={<Droplets size={28} className="text-gray-300" />}
                title="No water entries yet"
                description="Track municipal consumption, groundwater, and discharge."
                action={<Button size="sm" onClick={() => setWaterDrawerOpen(true)}><Plus size={13} />Add first entry</Button>}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 font-medium">
                      <th className="text-left px-6 py-3">Date</th>
                      <th className="text-left px-4 py-3">Site</th>
                      <th className="text-left px-4 py-3">Source</th>
                      <th className="text-right px-4 py-3">Volume (gal)</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {waterEntries.map((e) => (
                      <tr key={e.id} className="hover:bg-gray-50/50">
                        <td className="px-6 py-3 text-gray-700">{formatDate(e.entry_date)}</td>
                        <td className="px-4 py-3 text-gray-600">{e.sites?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-600">{sourceLabel(e.source_type)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {fmt(e.quantity_normalized)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-0.5">
                            {evidenceCell('ehs_entry', e.id, `${sourceLabel(e.source_type)} · ${formatDate(e.entry_date)} · ${e.sites?.name ?? 'no site'}`)}
                            <button
                              onClick={() => setDeletingEntry({ id: e.id, table: 'ehs_entries' })}
                              className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Waste ─────────────────────────────────────────────────────── */}
        <TabsContent value="waste">
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">Waste entries</p>
                <p className="text-xs text-gray-400 mt-0.5">{wasteEntries.length} entries</p>
              </div>
              <Button size="sm" onClick={() => setWasteDrawerOpen(true)}>
                <Plus size={14} />Add entry
              </Button>
            </div>

            {wasteEntries.length === 0 ? (
              <EmptyState
                icon={<Recycle size={28} className="text-gray-300" />}
                title="No waste entries yet"
                description="Track recycled, landfilled, composted, and hazardous waste."
                action={<Button size="sm" onClick={() => setWasteDrawerOpen(true)}><Plus size={13} />Add first entry</Button>}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 font-medium">
                      <th className="text-left px-6 py-3">Date</th>
                      <th className="text-left px-4 py-3">Site</th>
                      <th className="text-left px-4 py-3">Disposal method</th>
                      <th className="text-right px-4 py-3">Mass (kg)</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {wasteEntries.map((e) => (
                      <tr key={e.id} className="hover:bg-gray-50/50">
                        <td className="px-6 py-3 text-gray-700">{formatDate(e.entry_date)}</td>
                        <td className="px-4 py-3 text-gray-600">{e.sites?.name ?? '—'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={
                            e.source_type.includes('recycled') || e.source_type.includes('composted') ? 'default' :
                            e.source_type.includes('hazardous') ? 'destructive' : 'secondary'
                          }>
                            {sourceLabel(e.source_type)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {fmt(e.quantity_normalized)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-0.5">
                            {evidenceCell('ehs_entry', e.id, `${sourceLabel(e.source_type)} · ${formatDate(e.entry_date)} · ${e.sites?.name ?? 'no site'}`)}
                            <button
                              onClick={() => setDeletingEntry({ id: e.id, table: 'ehs_entries' })}
                              className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Drawers */}
      <EmissionDrawer
        open={emissionDrawerOpen}
        onClose={() => setEmissionDrawerOpen(false)}
        sites={sites}
        refrigerantFactors={refrigerantFactors}
        onSaved={(entry) => setEmissions((prev) => [entry as (typeof prev)[number], ...prev])}
      />
      <WaterDrawer
        open={waterDrawerOpen}
        onClose={() => setWaterDrawerOpen(false)}
        sites={sites}
        onSaved={(entry) => setEhsEntries((prev) => [entry as (typeof prev)[number], ...prev])}
      />
      <WasteDrawer
        open={wasteDrawerOpen}
        onClose={() => setWasteDrawerOpen(false)}
        sites={sites}
        onSaved={(entry) => setEhsEntries((prev) => [entry as (typeof prev)[number], ...prev])}
      />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />


      <ConfirmDialog
        open={!!deletingEntry}
        onOpenChange={(o) => !o && setDeletingEntry(null)}
        title="Delete this entry?"
        description="The entry will be marked as deleted. This action cannot be undone."
        confirmLabel="Delete entry"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  );
}

function EmptyState({ icon, title, description, action }: {
  icon: React.ReactNode; title: string; description: string; action: React.ReactNode;
}) {
  return (
    <div className="py-16 text-center">
      <div className="inline-flex items-center justify-center mb-3">{icon}</div>
      <p className="text-sm font-medium text-gray-700 mb-1">{title}</p>
      <p className="text-xs text-gray-400 mb-4 max-w-xs mx-auto">{description}</p>
      {action}
    </div>
  );
}
