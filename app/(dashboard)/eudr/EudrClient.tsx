'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DrawerContent } from '@/components/ui/dialog';
import { Plus, Ship } from 'lucide-react';
import { isReady, countryName } from '@/lib/eudr-core';
import { regulationsForProduct } from '@/lib/compliance-core';
import { ShipmentView, ShipmentForm, issuesFor } from './ShipmentDrawer';
import { PlotsTab } from './PlotsTab';
import { RiskTab } from './RiskTab';
import { WorkspaceNav } from '../products/WorkspaceNav';
import type { Assessment, Link, Named, Org, Plot, ProductRow, RuleRow, Shipment, ValueRow } from './types';

interface Props {
  org: Org | null;
  products: ProductRow[];
  rules: RuleRow[];
  suppliers: Named[];
  plots: Plot[];
  assessments: Assessment[];
  shipments: Shipment[];
  links: Link[];
  values: ValueRow[];
  role: string;
  loadError: string | null;
}

export function EudrClient(props: Props) {
  const { org, products, rules, suppliers, plots, assessments, shipments, links, values, role, loadError } = props;
  const router = useRouter();
  const canEdit = role === 'admin' || role === 'editor';
  const [tab, setTab] = useState<'shipments' | 'plots' | 'risk'>('shipments');
  const [drawer, setDrawer] = useState<null | { id: string | null; mode: 'view' | 'edit' }>(null);
  const [statusFilter, setStatusFilter] = useState<'open' | 'filed' | 'all'>('open');
  const refresh = () => router.refresh();

  const common = { org, products, rules, suppliers, plots, assessments, links, values, canEdit, onChanged: refresh };
  const product = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const inScopeCount = products.filter((p) => p.is_active && regulationsForProduct(p, rules).includes('eudr')).length;

  const rows = useMemo(() => shipments
    .filter((s) => statusFilter === 'all' || (statusFilter === 'open' ? s.status === 'draft' : s.status !== 'draft'))
    .map((s) => ({ s, ...issuesFor(s, common) })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [shipments, statusFilter, plots, assessments, links, products, rules]);

  const open = drawer?.id ? shipments.find((s) => s.id === drawer.id) ?? null : null;
  const drafts = shipments.filter((s) => s.status === 'draft');
  const readyCount = drafts.filter((s) => isReady(issuesFor(s, common).issues)).length;

  if (loadError) {
    return (
      <div className="p-4 sm:p-6">
        <Card><CardContent className="py-10 text-center text-sm text-red-700">
          EUDR data could not be loaded: {loadError}. This usually means a database migration has not been applied;
          run <code className="mx-1">supabase/verify_install.sql</code> to see which.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">Products and Parts</h1>
      <WorkspaceNav current="eudr" />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-gray-500 max-w-2xl">
            Each shipment you place on the EU market or export, the plots of land it came from, and the risk assessment it
            relies on. When nothing is missing, download the filing pack, file the statement in TRACES, and record the
            reference it returns.
          </p>
        </div>
        {canEdit && tab === 'shipments' && (
          <Button size="sm" onClick={() => setDrawer({ id: null, mode: 'edit' })}><Plus size={14} className="mr-1.5" />New shipment</Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Products in scope', inScopeCount],
          ['Draft shipments', drafts.length],
          ['Ready to file', readyCount],
          ['Filed', shipments.filter((s) => s.status === 'filed').length],
        ].map(([label, n]) => (
          <Card key={label as string}><CardContent className="py-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-2xl font-semibold text-gray-900">{n}</p>
          </CardContent></Card>
        ))}
      </div>

      <OperatorDetails org={org} canEdit={role === 'admin'} onChanged={refresh} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="shipments">Shipments ({shipments.length})</TabsTrigger>
          <TabsTrigger value="plots">Plots ({plots.length})</TabsTrigger>
          <TabsTrigger value="risk"><span className="sm:hidden">Risk</span><span className="hidden sm:inline">Risk assessments</span>&nbsp;({assessments.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="shipments" className="space-y-3 mt-4">
          <div className="flex flex-wrap gap-2">
            {(['open', 'filed', 'all'] as const).map((f) => (
              <Button key={f} size="sm" variant={statusFilter === f ? 'default' : 'outline'} onClick={() => setStatusFilter(f)}>
                {f === 'open' ? 'Drafts' : f === 'filed' ? 'Filed or withdrawn' : 'All'}
              </Button>
            ))}
          </div>
          {rows.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-sm text-gray-500">
              <Ship className="mx-auto mb-2 text-gray-300" />
              {shipments.length === 0
                ? inScopeCount === 0
                  ? 'No products are in scope of EUDR yet. Add scope rules on Products and Parts first.'
                  : 'No shipments yet. Add one for each placing on the market or export.'
                : 'No shipments match.'}
            </CardContent></Card>
          ) : (
            <div className="border border-gray-100 rounded-lg bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 text-left">
                  <tr><th className="px-3 py-2">Reference</th><th className="hidden md:table-cell px-3 py-2">Product</th><th className="hidden md:table-cell px-3 py-2">Countries</th>
                    <th className="hidden md:table-cell px-3 py-2">Net mass</th><th className="hidden md:table-cell px-3 py-2">Plots</th><th className="px-3 py-2">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map(({ s, plots: ps, issues }) => {
                    const blocks = issues.filter((i) => i.level === 'block').length;
                    return (
                      <tr key={s.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDrawer({ id: s.id, mode: 'view' })}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900">{s.reference}</p>
                          <p className="md:hidden text-xs text-gray-500">
                            {[product.get(s.product_id)?.part_number, s.countries_of_production.map(countryName).join(', '),
                              s.net_mass_kg != null ? `${Number(s.net_mass_kg).toLocaleString()} kg` : null,
                              `${ps.length} plot${ps.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                          </p>
                        </td>
                        <td className="hidden md:table-cell px-3 py-2 text-gray-700">{product.get(s.product_id)?.part_number ?? '—'}</td>
                        <td className="hidden md:table-cell px-3 py-2 text-gray-700">{s.countries_of_production.map(countryName).join(', ') || <span className="text-gray-400">—</span>}</td>
                        <td className="hidden md:table-cell px-3 py-2 text-gray-700">{s.net_mass_kg != null ? `${Number(s.net_mass_kg).toLocaleString()} kg` : '—'}</td>
                        <td className="hidden md:table-cell px-3 py-2 text-gray-700">{ps.length}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {s.status === 'filed' ? <Badge variant="default">Filed · {s.dds_reference}</Badge>
                            : s.status === 'withdrawn' ? <Badge variant="secondary">Withdrawn</Badge>
                              : blocks === 0 ? <Badge variant="default">Ready to file</Badge>
                                : <Badge variant="warning">{blocks} to resolve</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="plots" className="mt-4">
          <PlotsTab plots={plots} suppliers={suppliers} products={products} values={values} links={links} canEdit={canEdit} onChanged={refresh} />
        </TabsContent>

        <TabsContent value="risk" className="mt-4">
          <RiskTab assessments={assessments} suppliers={suppliers} canEdit={canEdit} onChanged={refresh} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!drawer} onOpenChange={(o) => { if (!o) setDrawer(null); }}>
        {drawer && (
          <DrawerContent className="max-w-3xl">
            {drawer.mode === 'edit' ? (
              <ShipmentForm {...common} shipment={open}
                onCancel={() => (open ? setDrawer({ id: open.id, mode: 'view' }) : setDrawer(null))}
                onSaved={(id) => { setDrawer({ id, mode: 'view' }); refresh(); }} />
            ) : open ? (
              <ShipmentView {...common} shipment={open} onEdit={() => setDrawer({ id: open.id, mode: 'edit' })} />
            ) : null}
          </DrawerContent>
        )}
      </Dialog>
    </div>
  );
}

/** Annex II point 1: the operator's name, address and EORI number. */
function OperatorDetails({ org, canEdit, onChanged }: { org: Org | null; canEdit: boolean; onChanged: () => void }) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(org?.legal_address ?? '');
  const [eori, setEori] = useState(org?.eori_number ?? '');
  const [error, setError] = useState('');
  if (!org) return null;
  const missing = !org.legal_address || !org.eori_number;

  async function save() {
    const e = eori.trim().toUpperCase();
    if (e && !/^[A-Z]{2}[A-Z0-9]{1,15}$/.test(e)) { setError('An EORI number is a two-letter country code followed by up to 15 letters or digits.'); return; }
    const { error: err } = await supabase.from('organizations').update({ legal_address: address.trim() || null, eori_number: e || null }).eq('id', org!.id);
    if (err) { setError(err.message); return; }
    setEditing(false);
    onChanged();
  }

  return (
    <Card><CardContent className="py-3">
      {editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_14rem_auto] gap-3 items-end">
          <div><Label>Registered address</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          <div><Label>EORI number</Label><Input value={eori} onChange={(e) => setEori(e.target.value)} className="font-mono" placeholder="NL123456789" /></div>
          <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button><Button size="sm" onClick={save}>Save</Button></div>
          {error && <p className="sm:col-span-3 text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 text-sm">
          <p className="text-gray-700">
            <span className="text-xs text-gray-500 mr-2">Operator</span>{org.name}
            <span className="text-gray-400"> · </span>{org.legal_address ?? <span className="text-amber-700">no address</span>}
            <span className="text-gray-400"> · EORI </span>{org.eori_number ? <span className="font-mono">{org.eori_number}</span> : <span className="text-amber-700">not set</span>}
          </p>
          {canEdit && <Button size="sm" variant={missing ? 'default' : 'outline'} onClick={() => setEditing(true)}>{missing ? 'Add details' : 'Edit'}</Button>}
        </div>
      )}
    </CardContent></Card>
  );
}
