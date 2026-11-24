'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { MapPin, Plus, Download } from 'lucide-react';
import {
  parseGeolocation, geometryAreaHa, needsPolygon, countryName, toCountryCode, buildGeoJson,
  type ParsedPlot,
} from '@/lib/eudr-core';
import { CountryPicker } from './CountryPicker';
import { download, type Plot, type Named, type ProductRow, type ValueRow, type Link } from './types';

export function fmtArea(ha: number | null) {
  return ha == null ? '—' : `${ha < 10 ? ha.toFixed(2) : Math.round(ha).toLocaleString()} ha`;
}

export function PlotsTab({
  plots, suppliers, products, values, links, canEdit, onChanged,
}: {
  plots: Plot[]; suppliers: Named[]; products: ProductRow[]; values: ValueRow[]; links: Link[];
  canEdit: boolean; onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState('all');
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const uses = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of links) m.set(l.plot_id, (m.get(l.plot_id) ?? 0) + 1);
    return m;
  }, [links]);

  // Supplier geolocation answers not yet turned into plots.
  const imported = new Set(plots.map((p) => p.source_value_id).filter(Boolean));
  const pending = values.filter((v) => v.field_key === 'eudr.geolocation' && !imported.has(v.id));

  const shown = supplierFilter === 'all' ? plots : plots.filter((p) => p.supplier_id === supplierFilter);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <p className="text-sm text-gray-600 max-w-3xl">
          Every plot of land a shipment came from, as TRACES will receive it: WGS 84, longitude first, six decimals. A plot
          over 4 hectares (other than for cattle) needs a polygon, not a point (Art. 2(28)).
        </p>
        <div className="flex gap-2">
          {plots.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => download('plots.geojson', JSON.stringify(buildGeoJson(shown), null, 2), 'application/geo+json')}>
              <Download size={14} className="mr-1.5" />GeoJSON
            </Button>
          )}
          {canEdit && pending.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>Import {pending.length} from supplier answers</Button>
          )}
          {canEdit && <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} className="mr-1.5" />Add plots</Button>}
        </div>
      </div>

      {plots.length > 0 && (
        <Select value={supplierFilter} onValueChange={setSupplierFilter}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All suppliers</SelectItem>
            {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {plots.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-gray-500">
          <MapPin className="mx-auto mb-2 text-gray-300" />
          No plots yet. Paste a supplier&rsquo;s GeoJSON or coordinates{pending.length > 0 ? ', or import the geolocation answers suppliers have sent' : ''}.
        </CardContent></Card>
      ) : (
        <div className="border border-gray-100 rounded-lg bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 text-left">
              <tr><th className="px-3 py-2">Plot</th><th className="hidden md:table-cell px-3 py-2">Country</th><th className="px-3 py-2">Shape</th>
                <th className="hidden md:table-cell px-3 py-2">Area</th><th className="hidden md:table-cell px-3 py-2">Supplier</th><th className="hidden md:table-cell px-3 py-2">Shipments</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {shown.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2">
                    <p className="text-gray-900">{p.name}</p>
                    {(p.producer_name || p.commodity) && <p className="text-xs text-gray-500">{[p.producer_name, p.commodity].filter(Boolean).join(' · ')}</p>}
                    <p className="md:hidden text-xs text-gray-500">{[countryName(p.country_code), fmtArea(p.area_ha), p.supplier_id ? supplierName.get(p.supplier_id) : null].filter(Boolean).join(' · ')}</p>
                  </td>
                  <td className="hidden md:table-cell px-3 py-2">{countryName(p.country_code)}</td>
                  <td className="px-3 py-2 text-xs">
                    {p.geometry.type}
                    {needsPolygon(p) && <Badge variant="warning" className="ml-2">Needs polygon</Badge>}
                  </td>
                  <td className="hidden md:table-cell px-3 py-2 text-xs text-gray-700">{fmtArea(p.area_ha)}</td>
                  <td className="hidden md:table-cell px-3 py-2 text-gray-700">{p.supplier_id ? supplierName.get(p.supplier_id) ?? '—' : '—'}</td>
                  <td className="hidden md:table-cell px-3 py-2 text-xs text-gray-600">{uses.get(p.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddPlotsDialog open={adding} suppliers={suppliers} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); }} />
      <ImportAnswersDialog open={importing} pending={pending} products={products} values={values}
        onClose={() => setImporting(false)} onSaved={() => { setImporting(false); onChanged(); }} />
    </div>
  );
}

interface PlotDefaults { supplier_id: string; country: string[]; commodity: string; producer: string; name: string }

/** Turn parsed plots into rows, filling gaps from the defaults the user chose. */
function rowsFrom(parsed: ParsedPlot[], d: PlotDefaults) {
  return parsed.map((p, i) => {
    const country = p.country ?? d.country[0] ?? null;
    const computed = geometryAreaHa(p.geometry);
    return {
      supplier_id: d.supplier_id || null,
      name: p.name ?? (parsed.length > 1 ? `${d.name || 'Plot'} ${i + 1}` : d.name || 'Plot 1'),
      producer_name: p.producerName ?? (d.producer.trim() || null),
      country_code: country,
      commodity: d.commodity.trim() || null,
      geometry: p.geometry,
      area_ha: computed != null ? Math.round(computed * 10000) / 10000 : p.areaHa,
    };
  });
}

export function AddPlotsDialog({ open, suppliers, preset, onClose, onSaved }: {
  open: boolean; suppliers: Named[]; onClose: () => void; onSaved: () => void;
  /** Filled in when adding from a part: its supplier, country and commodity. */
  preset?: { supplier_id?: string | null; country?: string | null; commodity?: string | null };
}) {
  const supabase = createClient();
  const [text, setText] = useState('');
  const [d, setD] = useState<PlotDefaults>({
    supplier_id: preset?.supplier_id ?? '', country: preset?.country ? [preset.country] : [],
    commodity: preset?.commodity ?? '', producer: '', name: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = useMemo(() => (text.trim() ? parseGeolocation(text) : { plots: [], errors: [] }), [text]);
  const rows = rowsFrom(parsed.plots, d);
  const missingCountry = rows.some((r) => !r.country_code);

  function reset() { setText(''); setError(''); }

  async function save() {
    if (rows.length === 0) { setError('Nothing readable to save.'); return; }
    if (missingCountry) { setError('Choose the country for plots whose file does not give one.'); return; }
    setSaving(true);
    const { error: err } = await supabase.from('eudr_plots').insert(rows.map((r) => ({ ...r, country_code: r.country_code!, source: 'manual' })));
    setSaving(false);
    if (err) { setError(err.message); return; }
    reset();
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add plots</DialogTitle>
          <DialogDescription>Paste a GeoJSON file&rsquo;s contents, or one &ldquo;latitude, longitude&rdquo; pair per line.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs"
            placeholder={'{"type":"FeatureCollection","features":[…]}\n\nor\n\n-3.4653, -62.2159\n-3.4701, -62.2203'} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Supplier</Label>
              <Select value={d.supplier_id || 'none'} onValueChange={(v) => setD({ ...d, supplier_id: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Country, where the file does not say</Label>
              <CountryPicker value={d.country} onChange={(v) => setD({ ...d, country: v })} multiple={false} />
            </div>
            <div><Label>Commodity</Label><Input value={d.commodity} onChange={(e) => setD({ ...d, commodity: e.target.value })} placeholder="Rubber" /></div>
            <div><Label>Producer</Label><Input value={d.producer} onChange={(e) => setD({ ...d, producer: e.target.value })} /></div>
            <div className="col-span-2"><Label>Name, where the file does not give one</Label><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Fazenda Boa Vista" /></div>
          </div>
          {text.trim() && (
            <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-xs space-y-1">
              <p className="text-gray-700">{rows.length} plot{rows.length === 1 ? '' : 's'} read{parsed.errors.length ? `, ${parsed.errors.length} problem${parsed.errors.length === 1 ? '' : 's'}` : ''}.</p>
              {rows.slice(0, 5).map((r, i) => (
                <p key={i} className="text-gray-500">
                  {r.name}: {r.geometry.type}, {r.country_code ? countryName(r.country_code) : 'no country'}{r.area_ha ? `, ${fmtArea(r.area_ha)}` : ''}
                  {needsPolygon({ geometry: r.geometry, area_ha: r.area_ha, commodity: r.commodity }) && <span className="text-amber-700"> · over 4 ha as a point</span>}
                </p>
              ))}
              {parsed.errors.map((e) => <p key={e} className="text-red-600">{e}</p>)}
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={save} disabled={saving || rows.length === 0}>{saving ? 'Saving…' : `Save ${rows.length || ''} plot${rows.length === 1 ? '' : 's'}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Supplier answers to "Geolocation of the plots" become plots: one per point
 * or polygon, tied to the product's supplier, in the country the supplier gave
 * for the same product. Answers that cannot be read are listed, not skipped.
 */
function ImportAnswersDialog({ open, pending, products, values, onClose, onSaved }: {
  open: boolean; pending: ValueRow[]; products: ProductRow[]; values: ValueRow[]; onClose: () => void; onSaved: () => void;
}) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const product = new Map(products.map((p) => [p.id, p]));

  const plan = useMemo(() => pending.map((v) => {
    const p = product.get(v.product_id);
    const countryAnswer = values
      .filter((x) => x.product_id === v.product_id && x.field_key === 'eudr.country_of_production')
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0]?.value;
    const commodity = values
      .filter((x) => x.product_id === v.product_id && x.field_key === 'eudr.commodity')
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0]?.value ?? '';
    const parsed = parseGeolocation(v.value);
    const rows = rowsFrom(parsed.plots, {
      supplier_id: p?.supplier_id ?? '', country: toCountryCode(countryAnswer) ? [toCountryCode(countryAnswer)!] : [],
      commodity, producer: '', name: p ? `${p.part_number} plot` : 'Plot',
    }).map((r) => ({ ...r, source: 'survey', source_value_id: v.id }));
    return { value: v, product: p, rows, errors: parsed.errors, noCountry: rows.some((r) => !r.country_code) };
  }), [pending, values]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = plan.filter((x) => x.rows.length > 0 && !x.noCountry);

  async function save() {
    setSaving(true);
    const { error: err } = await supabase.from('eudr_plots').insert(ok.flatMap((x) => x.rows.map((r) => ({ ...r, country_code: r.country_code! }))));
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import plots from supplier answers</DialogTitle>
          <DialogDescription>Each geolocation answer becomes plots, tied to the product&rsquo;s supplier and the country the supplier gave.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2 max-h-[50vh] overflow-y-auto">
          {plan.map((x) => (
            <div key={x.value.id} className="rounded-md border border-gray-100 px-3 py-2 text-xs">
              <p className="text-gray-900 font-medium">{x.product?.part_number ?? 'Unknown product'} <span className="font-normal text-gray-400">· answered {x.value.recorded_at.slice(0, 10)}</span></p>
              {x.rows.length > 0 && <p className="text-gray-600">{x.rows.length} plot{x.rows.length === 1 ? '' : 's'}{x.rows[0].country_code ? ` in ${countryName(x.rows[0].country_code)}` : ''}</p>}
              {x.noCountry && <p className="text-amber-700">No country of production recorded for this product, so it is left out. Record it on the product, or add these plots by hand.</p>}
              {x.errors.map((e) => <p key={e} className="text-red-600">{e}</p>)}
              {x.rows.length === 0 && x.errors.length === 0 && <p className="text-gray-500">Nothing readable.</p>}
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || ok.length === 0}>
            {saving ? 'Importing…' : `Import ${ok.reduce((s, x) => s + x.rows.length, 0)} plots`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
