'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DrawerShell } from '@/components/ui/drawer-shell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AlertTriangle, CheckCircle2, Download, Plus, X, XCircle } from 'lucide-react';
import {
  shipmentIssues, isReady, buildGeoJson, statementFields, countryName, toCountryCode,
} from '@/lib/eudr-core';
import { regulationsForProduct } from '@/lib/compliance-core';
import { CountryPicker } from './CountryPicker';
import {
  download, hsFor, today,
  type Assessment, type Link, type Named, type Org, type Plot, type ProductRow, type RuleRow, type Shipment, type ValueRow,
} from './types';

interface Common {
  org: Org | null;
  products: ProductRow[];
  rules: RuleRow[];
  suppliers: Named[];
  plots: Plot[];
  assessments: Assessment[];
  links: Link[];
  values: ValueRow[];
  canEdit: boolean;
  onChanged: () => void;
}

const ACTIVITY_LABEL = { import: 'Import (placing on the market)', export: 'Export', domestic: 'Domestic production' } as const;

/** Assessments that apply to a shipment: same country, and the shipment's supplier or "any supplier". */
export function assessmentsFor(s: Pick<Shipment, 'supplier_id' | 'countries_of_production'>, all: Assessment[]) {
  return all.filter((a) => s.countries_of_production.includes(a.country_code) && (!a.supplier_id || a.supplier_id === s.supplier_id));
}

export function issuesFor(s: Shipment, c: Pick<Common, 'org' | 'products' | 'rules' | 'plots' | 'assessments' | 'links'>) {
  const plotIds = new Set(c.links.filter((l) => l.shipment_id === s.id).map((l) => l.plot_id));
  const plots = c.plots.filter((p) => plotIds.has(p.id));
  const product = c.products.find((p) => p.id === s.product_id);
  const inScope = !!product && regulationsForProduct(product, c.rules).includes('eudr');
  const bytes = new Blob([JSON.stringify(buildGeoJson(plots))]).size;
  return { plots, issues: shipmentIssues(s, plots, assessmentsFor(s, c.assessments), {
    today: today(), productInScope: inScope, geoJsonBytes: bytes,
    operator: c.org ? { address: c.org.legal_address, eori: c.org.eori_number } : undefined,
  }) };
}

// ─── View ────────────────────────────────────────────────────────────────────

export function ShipmentView({ shipment, onEdit, ...c }: Common & { shipment: Shipment; onEdit: () => void }) {
  const supabase = createClient();
  const { plots, issues } = issuesFor(shipment, c);
  const ready = isReady(issues);
  const product = c.products.find((p) => p.id === shipment.product_id);
  const supplier = c.suppliers.find((x) => x.id === shipment.supplier_id);
  const assessments = assessmentsFor(shipment, c.assessments);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState({ ref: '', ver: '', date: today() });
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [error, setError] = useState('');

  const fields = statementFields({
    operator: { name: c.org?.name ?? '', address: c.org?.legal_address ?? null, eori: c.org?.eori_number ?? null },
    shipment: { ...shipment, upstream_references: shipment.upstream_references ?? [] },
    plots,
  });
  const base = `eudr-${shipment.reference.replace(/[^\w.-]+/g, '_')}`;

  function downloadStatement() {
    const csv = ['Annex II point,Field,Value', ...fields.map((f) => [f.point, f.label, f.value].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    download(`${base}-statement.csv`, csv, 'text/csv');
  }

  async function recordFiling() {
    if (!filed.ref.trim()) { setError('Enter the reference number TRACES gave the statement.'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const { error: err } = await supabase.from('eudr_shipments').update({
      status: 'filed', dds_reference: filed.ref.trim(), dds_verification_number: filed.ver.trim() || null,
      filed_at: filed.date, filed_by: user?.id ?? null,
    }).eq('id', shipment.id);
    if (err) { setError(err.message); return; }
    setFiling(false);
    c.onChanged();
  }

  async function withdraw() {
    const { error: err } = await supabase.from('eudr_shipments').update({ status: 'withdrawn' }).eq('id', shipment.id);
    setConfirmWithdraw(false);
    if (err) setError(err.message); else c.onChanged();
  }

  const statusBadge = shipment.status === 'filed'
    ? <Badge variant="default">Filed</Badge>
    : shipment.status === 'withdrawn' ? <Badge variant="secondary">Withdrawn</Badge>
      : ready ? <Badge variant="default">Ready to file</Badge> : <Badge variant="warning">Draft</Badge>;

  return (
    <DrawerShell
      title={<span className="inline-flex items-center gap-2">{shipment.reference} {statusBadge}</span>}
      subtitle={`${product?.part_number ?? 'Unknown product'} · ${ACTIVITY_LABEL[shipment.activity]}`}
      footer={<>
        {c.canEdit && shipment.status === 'filed' && (
          <Button variant="ghost" className="mr-auto text-gray-500" onClick={() => setConfirmWithdraw(true)}>Mark withdrawn</Button>
        )}
        <Button variant="outline" onClick={downloadStatement}><Download size={13} className="mr-1.5" />Statement</Button>
        <Button variant="outline" disabled={plots.length === 0}
          onClick={() => download(`${base}-plots.geojson`, JSON.stringify(buildGeoJson(plots), null, 2), 'application/geo+json')}>
          <Download size={13} className="mr-1.5" />GeoJSON
        </Button>
        {c.canEdit && shipment.status === 'draft' && <Button variant="outline" onClick={onEdit}>Edit</Button>}
        {c.canEdit && shipment.status === 'draft' && <Button disabled={!ready} onClick={() => setFiling(true)}>Record filing</Button>}
      </>}
    >
      {shipment.status === 'filed' && (
        <div className="rounded-md bg-emerald-50 border border-emerald-100 px-3 py-2 text-sm text-emerald-900">
          Filed {shipment.filed_at} · reference <span className="font-mono">{shipment.dds_reference}</span>
          {shipment.dds_verification_number && <> · verification <span className="font-mono">{shipment.dds_verification_number}</span></>}
          <p className="text-xs text-emerald-800/80 mt-0.5">The declared facts and plots are now locked; notes can still be added.</p>
        </div>
      )}

      {shipment.status === 'draft' && (
        <div>
          <p className="text-sm font-medium text-gray-900 mb-2">Ready to file?</p>
          {issues.length === 0 ? (
            <p className="text-sm text-emerald-700 inline-flex items-center gap-1.5"><CheckCircle2 size={15} />Everything the statement needs is here.</p>
          ) : (
            <ul className="space-y-1.5">
              {issues.map((i) => (
                <li key={i.message} className={`text-sm flex gap-2 ${i.level === 'block' ? 'text-red-700' : 'text-amber-700'}`}>
                  {i.level === 'block' ? <XCircle size={15} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5" />}
                  {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {filing && (
        <div className="rounded-md border border-gray-200 px-4 py-3 space-y-3">
          <p className="text-sm font-medium text-gray-900">Record the filing</p>
          <p className="text-xs text-gray-500">
            Upload the GeoJSON and enter the statement in TRACES, then record the numbers TRACES returns. Once recorded, the
            declared facts are locked.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><Label required>Reference number</Label><Input value={filed.ref} onChange={(e) => setFiled({ ...filed, ref: e.target.value })} className="font-mono" /></div>
            <div><Label>Verification number</Label><Input value={filed.ver} onChange={(e) => setFiled({ ...filed, ver: e.target.value })} className="font-mono" /></div>
            <div><Label required>Filed on</Label><Input type="date" value={filed.date} onChange={(e) => setFiled({ ...filed, date: e.target.value })} /></div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setFiling(false)}>Cancel</Button>
            <Button size="sm" onClick={recordFiling}>Record and lock</Button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <p className="text-sm font-medium text-gray-900 mb-2">Due diligence statement</p>
        <dl className="divide-y divide-gray-50 border border-gray-100 rounded-lg text-sm">
          {fields.map((f) => (
            <div key={`${f.point}-${f.label}`} className="grid grid-cols-[2.25rem_1fr] sm:grid-cols-[3rem_11rem_1fr] gap-x-2 gap-y-0.5 px-3 py-1.5">
              <dt className="text-xs text-gray-400 sm:row-span-1 row-span-2">{f.point ? `(${f.point})` : ''}</dt>
              <dt className="text-xs text-gray-500">{f.label}</dt>
              <dd className={`text-gray-900 break-words min-w-0 ${f.value === 'Missing' ? 'text-red-600' : ''}`}>{f.value || <span className="text-gray-400">—</span>}</dd>
            </div>
          ))}
        </dl>
        {shipment.status !== 'draft' && (
          <p className="text-xs text-gray-500 mt-1.5">Operator details show as they are now; TRACES holds the statement exactly as filed.</p>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-gray-900 mb-2">Plots ({plots.length})</p>
        {plots.length === 0 ? <p className="text-sm text-gray-500">None linked.</p> : (
          <ul className="text-sm text-gray-700 space-y-0.5">
            {plots.map((p) => <li key={p.id}>{p.name} · {countryName(p.country_code)} · {p.geometry.type}{p.area_ha ? ` · ${Number(p.area_ha).toFixed(2)} ha` : ''}</li>)}
          </ul>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-gray-900 mb-2">Risk assessments relied on</p>
        {assessments.length === 0 ? <p className="text-sm text-gray-500">None for these countries{supplier ? ` and ${supplier.name}` : ''}.</p> : (
          <ul className="text-sm text-gray-700 space-y-0.5">
            {assessments.map((a) => (
              <li key={a.id}>{countryName(a.country_code)} · {a.commodity} · {a.country_risk} country risk · {a.conclusion === 'negligible' ? 'negligible' : 'NOT negligible'} · {a.assessed_at}</li>
            ))}
          </ul>
        )}
      </div>

      {shipment.notes && <div><p className="text-sm font-medium text-gray-900 mb-1">Notes</p><p className="text-sm text-gray-700 whitespace-pre-wrap">{shipment.notes}</p></div>}

      <ConfirmDialog
        open={confirmWithdraw}
        onOpenChange={setConfirmWithdraw}
        title="Mark this statement withdrawn?"
        description="Do this after withdrawing it in TRACES. The shipment stays on record with its reference; it cannot be deleted."
        confirmLabel="Mark withdrawn"
        onConfirm={withdraw}
      />
    </DrawerShell>
  );
}

// ─── Add / edit ──────────────────────────────────────────────────────────────

type Draft = {
  product_id: string; supplier_id: string; reference: string; activity: Shipment['activity'];
  hs_code: string; description: string; net_mass_kg: string; supplementary_quantity: string; supplementary_unit: string;
  countries: string[]; production_from: string; production_to: string;
  upstream: { reference: string; verification: string }[]; plotIds: string[]; notes: string;
};

export function ShipmentForm({ shipment, onCancel, onSaved, ...c }: Common & {
  shipment: Shipment | null; onCancel: () => void; onSaved: (id: string) => void;
}) {
  const supabase = createClient();
  const eudrProducts = useMemo(
    // Keep the shipment's own product listed even if a scope rule has since changed, so editing never blanks it.
    () => c.products.filter((p) => p.id === shipment?.product_id || (p.is_active && regulationsForProduct(p, c.rules).includes('eudr'))),
    [c.products, c.rules, shipment?.product_id],
  );
  const linked = shipment ? c.links.filter((l) => l.shipment_id === shipment.id).map((l) => l.plot_id) : [];
  const [d, setD] = useState<Draft>(shipment ? {
    product_id: shipment.product_id, supplier_id: shipment.supplier_id ?? '', reference: shipment.reference,
    activity: shipment.activity, hs_code: shipment.hs_code ?? '', description: shipment.description ?? '',
    net_mass_kg: shipment.net_mass_kg?.toString() ?? '', supplementary_quantity: shipment.supplementary_quantity?.toString() ?? '',
    supplementary_unit: shipment.supplementary_unit ?? '', countries: shipment.countries_of_production,
    production_from: shipment.production_from ?? '', production_to: shipment.production_to ?? '',
    upstream: (shipment.upstream_references ?? []).map((u) => ({ reference: u.reference, verification: u.verification ?? '' })),
    plotIds: linked, notes: shipment.notes ?? '',
  } : {
    product_id: '', supplier_id: '', reference: '', activity: 'import', hs_code: '', description: '', net_mass_kg: '',
    supplementary_quantity: '', supplementary_unit: '', countries: [], production_from: '', production_to: '',
    upstream: [], plotIds: [], notes: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  /** Choosing a product fills what BROC already knows about it. */
  function chooseProduct(id: string) {
    const p = c.products.find((x) => x.id === id);
    const latest = (key: string) => c.values
      .filter((v) => v.product_id === id && v.field_key === key)
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0]?.value;
    const country = toCountryCode(latest('eudr.country_of_production'));
    setD((x) => ({
      ...x,
      product_id: id,
      supplier_id: x.supplier_id || p?.supplier_id || '',
      hs_code: x.hs_code || hsFor(p) || '',
      description: x.description || p?.description || '',
      countries: x.countries.length ? x.countries : country ? [country] : [],
      production_from: x.production_from,
    }));
  }

  const candidatePlots = c.plots.filter((p) => p.is_active && (!d.supplier_id || p.supplier_id === d.supplier_id || d.plotIds.includes(p.id)));

  async function save() {
    if (!d.product_id) { setError('Choose the product.'); return; }
    if (!d.reference.trim()) { setError('Enter a reference: PO, customs entry or your own.'); return; }
    const hs = d.hs_code.replace(/[\s.]/g, '');
    if (hs && !/^\d{4,10}$/.test(hs)) { setError('HS code must be 4 to 10 digits.'); return; }
    const num = (v: string) => (v.trim() ? Number(v.replace(/,/g, '')) : null);
    const mass = num(d.net_mass_kg), supp = num(d.supplementary_quantity);
    if ((mass != null && !(mass > 0)) || (supp != null && !(supp > 0))) { setError('Quantities must be positive numbers.'); return; }
    if (d.production_from && d.production_to && d.production_to < d.production_from) { setError('Production ends before it starts.'); return; }
    setSaving(true);
    const payload = {
      product_id: d.product_id, supplier_id: d.supplier_id || null, reference: d.reference.trim(), activity: d.activity,
      hs_code: hs || null, description: d.description.trim() || null, net_mass_kg: mass,
      supplementary_quantity: supp, supplementary_unit: d.supplementary_unit.trim() || null,
      countries_of_production: d.countries, production_from: d.production_from || null, production_to: d.production_to || null,
      upstream_references: d.upstream.filter((u) => u.reference.trim()).map((u) => ({ reference: u.reference.trim(), ...(u.verification.trim() ? { verification: u.verification.trim() } : {}) })),
      notes: d.notes.trim() || null,
    };
    const res = shipment
      ? await supabase.from('eudr_shipments').update(payload).eq('id', shipment.id).select('id').single()
      : await supabase.from('eudr_shipments').insert(payload).select('id').single();
    if (res.error || !res.data) { setSaving(false); setError(res.error?.message ?? 'Could not be saved.'); return; }
    const id = res.data.id as string;

    const remove = linked.filter((p) => !d.plotIds.includes(p));
    const add = d.plotIds.filter((p) => !linked.includes(p));
    if (remove.length) {
      const { error: e } = await supabase.from('eudr_shipment_plots').delete().eq('shipment_id', id).in('plot_id', remove);
      if (e) { setSaving(false); setError(`Saved, but plots could not be updated: ${e.message}`); return; }
    }
    if (add.length) {
      const { error: e } = await supabase.from('eudr_shipment_plots').insert(add.map((plot_id) => ({ shipment_id: id, plot_id })));
      if (e) { setSaving(false); setError(`Saved, but plots could not be linked: ${e.message}`); return; }
    }
    setSaving(false);
    onSaved(id);
  }

  return (
    <DrawerShell
      title={shipment ? `Edit ${shipment.reference}` : 'New shipment'}
      subtitle="One placing on the market or export, as its due diligence statement will describe it."
      footer={<>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Label required>Product</Label>
          <Select value={d.product_id || undefined} onValueChange={chooseProduct}>
            <SelectTrigger><SelectValue placeholder="Choose a product in scope of EUDR…" /></SelectTrigger>
            <SelectContent>
              {eudrProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.part_number}{p.description ? ` · ${p.description}` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
          {eudrProducts.length === 0 && <p className="text-xs text-amber-700 mt-1">No active product is in scope of EUDR under your scope rules (Products and Parts).</p>}
        </div>
        <div><Label required>Reference</Label><Input value={d.reference} onChange={(e) => set('reference', e.target.value)} placeholder="PO-4471 or customs entry" /></div>
        <div>
          <Label required>Activity</Label>
          <Select value={d.activity} onValueChange={(v) => set('activity', v as Draft['activity'])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(ACTIVITY_LABEL) as Draft['activity'][]).map((a) => <SelectItem key={a} value={a}>{ACTIVITY_LABEL[a]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Supplier</Label>
          <Select value={d.supplier_id || 'none'} onValueChange={(v) => set('supplier_id', v === 'none' ? '' : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {c.suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>HS code</Label><Input value={d.hs_code} onChange={(e) => set('hs_code', e.target.value)} className="font-mono" placeholder="401110" /></div>
        <div className="sm:col-span-2"><Label>Description</Label><Input value={d.description} onChange={(e) => set('description', e.target.value)} placeholder="Trade name, and scientific name where relevant" /></div>
        <div><Label>Net mass (kg)</Label><Input value={d.net_mass_kg} onChange={(e) => set('net_mass_kg', e.target.value)} inputMode="decimal" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Supplementary qty</Label><Input value={d.supplementary_quantity} onChange={(e) => set('supplementary_quantity', e.target.value)} inputMode="decimal" /></div>
          <div><Label>Unit</Label><Input value={d.supplementary_unit} onChange={(e) => set('supplementary_unit', e.target.value)} placeholder="p/st, m³" /></div>
        </div>
        <div className="sm:col-span-2">
          <Label>Countries of production</Label>
          <CountryPicker value={d.countries} onChange={(v) => set('countries', v)} />
        </div>
        <div><Label>Produced from</Label><Input type="date" value={d.production_from} onChange={(e) => set('production_from', e.target.value)} /></div>
        <div><Label>Produced to</Label><Input type="date" value={d.production_to} onChange={(e) => set('production_to', e.target.value)} /></div>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-900 mb-1">Plots</p>
        <p className="text-xs text-gray-500 mb-2">{d.supplier_id ? 'Plots from this supplier.' : 'All plots; choose a supplier to narrow the list.'} Add plots on the Plots tab.</p>
        {candidatePlots.length === 0 ? <p className="text-sm text-gray-400">No plots to choose from yet.</p> : (
          <div className="max-h-48 overflow-y-auto border border-gray-100 rounded-md divide-y divide-gray-50">
            {candidatePlots.map((p) => (
              <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <input type="checkbox" checked={d.plotIds.includes(p.id)}
                  onChange={(e) => set('plotIds', e.target.checked ? [...d.plotIds, p.id] : d.plotIds.filter((x) => x !== p.id))} />
                <span className="flex-1">{p.name}</span>
                <span className="text-xs text-gray-400">{countryName(p.country_code)} · {p.geometry.type}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-gray-900 mb-1">Upstream statements relied on</p>
        <p className="text-xs text-gray-500 mb-2">Reference and verification numbers of statements filed further up the chain (Annex II, point 4).</p>
        <div className="space-y-2">
          {d.upstream.map((u, i) => (
            <div key={i} className="flex gap-2">
              <Input value={u.reference} placeholder="Reference" className="font-mono"
                onChange={(e) => set('upstream', d.upstream.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} />
              <Input value={u.verification} placeholder="Verification" className="font-mono"
                onChange={(e) => set('upstream', d.upstream.map((x, j) => (j === i ? { ...x, verification: e.target.value } : x)))} />
              <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => set('upstream', d.upstream.filter((_, j) => j !== i))} aria-label="Remove"><X size={15} /></button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => set('upstream', [...d.upstream, { reference: '', verification: '' }])}>
            <Plus size={13} className="mr-1" />Add reference
          </Button>
        </div>
      </div>

      <div><Label>Notes</Label><Textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </DrawerShell>
  );
}
