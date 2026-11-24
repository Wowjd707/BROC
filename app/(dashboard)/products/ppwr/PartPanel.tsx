'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Plus, ChevronRight, Lock, Trash2 } from 'lucide-react';
import { countryName } from '@/lib/eudr-core';
import {
  MATERIAL_LABEL, FUNCTION_LABEL, componentIssues, gramsPerUnit, isEuMemberState,
  type ComponentRow, type PlacementRow, type ReportRow,
} from '@/lib/ppwr-core';

const g = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

/** "DE" → Germany, "US-OR" → US-OR. */
export function jurisdictionName(j: string) {
  return j.includes('-') ? j : countryName(j);
}

/**
 * PPWR inside a part: its packaging, piece by piece, and the units of the part
 * made available in each country. Tonnes per country, registrations and the
 * reports themselves are on the PPWR dashboard.
 */
export function PpwrPartPanel({
  productId, components, placements, reports, canEdit, isAdmin, onOpenComponent, onChanged,
}: {
  productId: string;
  components: ComponentRow[];
  placements: PlacementRow[];
  reports: ReportRow[];
  canEdit: boolean;
  isAdmin: boolean;
  onOpenComponent: (id: string | null) => void;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const mine = components.filter((c) => c.product_id === productId && c.is_active);
  const myPlacements = placements.filter((p) => p.product_id === productId)
    .sort((a, b) => b.year - a.year || a.jurisdiction.localeCompare(b.jurisdiction) || (a.quarter ?? 0) - (b.quarter ?? 0));
  const perUnit = mine.reduce((s, c) => s + gramsPerUnit(c), 0);
  const locked = (p: PlacementRow) => reports.some((r) => r.jurisdiction === p.jurisdiction && r.year === p.year && r.status === 'submitted');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  async function remove(id: string) {
    const { error: err } = await supabase.from('packaging_placements').delete().eq('id', id);
    if (err) setError(err.message); else onChanged();
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">Packaging</p>
            <p className="text-xs text-gray-500">
              {mine.length ? `${g(perUnit)} g of packaging per unit of this part.` : 'Each piece of packaging the part goes out in.'}
            </p>
          </div>
          {canEdit && <Button size="sm" onClick={() => onOpenComponent(null)}><Plus size={13} className="mr-1" />Add packaging</Button>}
        </div>
        {mine.length === 0 ? (
          <p className="text-sm text-gray-500 rounded-md border border-dashed border-gray-200 px-3 py-3">
            No packaging recorded. Add each piece: the box, the bag, the pallet wrap, with its weight.
          </p>
        ) : (
          <ul className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
            {mine.map((c) => {
              const issues = componentIssues(c);
              const blocks = issues.filter((i) => i.level === 'block').length;
              return (
                <li key={c.id}>
                  <button className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50" onClick={() => onOpenComponent(c.id)}>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-gray-900">{c.name}</span>
                      <span className="block text-xs text-gray-500 truncate">
                        {[MATERIAL_LABEL[c.material], FUNCTION_LABEL[c.function], `${g(gramsPerUnit(c))} g per unit`, c.reusable ? 'reusable' : null, c.food_contact ? 'food contact' : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {blocks ? <Badge variant="destructive">Evidence missing</Badge> : issues.length ? <Badge variant="warning">{issues.length} to check</Badge> : <Badge variant="default">Complete</Badge>}
                    <ChevronRight size={14} className="text-gray-300" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">Quantities by country</p>
            <p className="text-xs text-gray-500">Units of this part first made available in each country, per year. They become packaging tonnes for EPR reports.</p>
          </div>
          {canEdit && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus size={13} className="mr-1" />Add</Button>}
        </div>
        {myPlacements.length === 0 ? (
          <p className="text-sm text-gray-500">None recorded.</p>
        ) : (
          <div className="border border-gray-100 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 text-left">
                <tr><th className="px-3 py-1.5">Where</th><th className="px-3 py-1.5">Period</th><th className="px-3 py-1.5 text-right">Units</th><th className="px-3 py-1.5 text-right">Packaging</th><th className="w-8" /></tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {myPlacements.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-1.5 text-gray-900">{jurisdictionName(p.jurisdiction)}{isEuMemberState(p.jurisdiction) && <span className="text-xs text-gray-400"> · EU</span>}</td>
                    <td className="px-3 py-1.5 text-gray-700">{p.year}{p.quarter ? ` Q${p.quarter}` : ''}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700">{Number(p.units).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700 whitespace-nowrap">{mine.length ? `${g((perUnit * Number(p.units)) / 1000)} kg` : '—'}</td>
                    <td className="px-2 py-1.5 text-gray-400">
                      {locked(p) ? <Lock size={13} aria-label="Reported" />
                        : isAdmin && <button onClick={() => remove(p.id)} aria-label="Remove" className="hover:text-red-600"><Trash2 size={13} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </section>

      {adding && <PlacementDialog productId={productId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); }} />}
    </div>
  );
}

function PlacementDialog({ productId, onClose, onSaved }: { productId: string; onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const [j, setJ] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState('');
  const [units, setUnits] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState('');

  async function save() {
    const code = j.trim().toUpperCase();
    if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(code)) { setError('Use a two-letter country code (DE), or a US state as US-OR.'); return; }
    const y = Number(year), q = quarter ? Number(quarter) : null, u = Number(units.replace(/,/g, ''));
    if (!(y >= 2000 && y <= 2100)) { setError('Enter the year.'); return; }
    if (q != null && !(q >= 1 && q <= 4)) { setError('The quarter is 1 to 4, or blank for the whole year.'); return; }
    if (!(u > 0)) { setError('Enter the number of units.'); return; }
    const { error: err } = await supabase.from('packaging_placements').insert({
      product_id: productId, jurisdiction: code, year: y, quarter: q, units: u, source: source.trim() || null,
    });
    if (err) setError(err.message.includes('uq_packaging_placements_period') ? 'There is already a figure for this part, place and period.' : err.message);
    else onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add quantities</DialogTitle>
          <DialogDescription>Units of this part first made available in one country (or US state) in one period.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label required>Country or state</Label><Input value={j} onChange={(e) => setJ(e.target.value.toUpperCase())} placeholder="DE or US-OR" /></div>
          <div><Label required>Units</Label><Input value={units} onChange={(e) => setUnits(e.target.value)} inputMode="decimal" /></div>
          <div><Label required>Year</Label><Input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" /></div>
          <div><Label>Quarter</Label><Input value={quarter} onChange={(e) => setQuarter(e.target.value)} inputMode="numeric" placeholder="Whole year" /></div>
          <div className="col-span-2"><Label>Source</Label><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="ERP sales report, date" /></div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
