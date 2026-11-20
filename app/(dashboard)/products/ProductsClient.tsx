'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DrawerContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { BulkImportDialog } from '@/components/forms/BulkImportDialog';
import { Package, Plus, Upload, Send, Search, ExternalLink, Trash2, History, ArrowRight } from 'lucide-react';
import {
  REGULATIONS, REGULATION_KEYS, fieldsFor, FIELD_BY_KEY, displayFieldValue, normalizeFieldValue,
  type RegulationKey, type ComplianceField,
} from '@/lib/compliance-catalog';
import {
  normalizeCode, regulationsForProduct, matchingRules, currentValues, fieldStatus, regulationProgress, validUntil,
  CODE_SYSTEMS, CODE_SYSTEM_KEYS, splitCodes, type CodeSystem, type ValueRow, type FieldStatus,
} from '@/lib/compliance-core';
import { PRODUCT_IMPORT_HEADERS } from '@/lib/product-import-core';

interface Product {
  id: string;
  part_number: string;
  description: string | null;
  hs_code: string | null;
  cn_code: string | null;
  hts_code: string | null;
  supplier_id: string | null;
  country_of_origin: string | null;
  business_unit_id: string | null;
  site_id: string | null;
  owner_user_id: string | null;
  notes: string | null;
  is_active: boolean;
}
interface Rule {
  id: string;
  regulation: string;
  code_system: string;
  cn_prefix: string;
  label: string | null;
  source_citation: string;
  source_url: string | null;
  last_verified: string;
}
interface Named { id: string; name: string }
export interface SurveyOption { id: string; title: string; regulation_type: string; fieldKeys: string[] }
type Value = ValueRow & { id: string; note: string | null };

interface Props {
  products: Product[];
  suppliers: (Named & { contact_email: string | null })[];
  businessUnits: Named[];
  sites: Named[];
  users: { id: string; label: string }[];
  rules: Rule[];
  values: Value[];
  surveys: SurveyOption[];
  role: string;
  loadError: string | null;
}

const STATUS_BADGE: Record<FieldStatus, { label: string; variant: 'default' | 'warning' | 'destructive' | 'secondary' }> = {
  current: { label: 'Current', variant: 'default' },
  expiring: { label: 'Expiring', variant: 'warning' },
  expired: { label: 'Expired', variant: 'destructive' },
  missing: { label: 'Missing', variant: 'secondary' },
};

const SOURCE_LABEL: Record<string, string> = { survey: 'Supplier survey', import: 'Import', manual: 'Entered by hand', document: 'From a document' };

type Draft = {
  part_number: string; description: string; hs_code: string; cn_code: string; hts_code: string;
  supplier_id: string; country_of_origin: string; business_unit_id: string; site_id: string;
  owner_user_id: string; notes: string;
};

const EMPTY_PRODUCT: Draft = {
  part_number: '', description: '', hs_code: '', cn_code: '', hts_code: '', supplier_id: '', country_of_origin: '',
  business_unit_id: '', site_id: '', owner_user_id: '', notes: '',
};

function draftOf(p: Product): Draft {
  return {
    part_number: p.part_number, description: p.description ?? '',
    hs_code: p.hs_code ?? '', cn_code: p.cn_code ?? '', hts_code: p.hts_code ?? '',
    supplier_id: p.supplier_id ?? '', country_of_origin: p.country_of_origin ?? '',
    business_unit_id: p.business_unit_id ?? '', site_id: p.site_id ?? '',
    owner_user_id: p.owner_user_id ?? '', notes: p.notes ?? '',
  };
}

const today = () => new Date().toISOString().slice(0, 10);

export function ProductsClient({
  products, suppliers, businessUnits, sites, users, rules, values, surveys, role, loadError,
}: Props) {
  const router = useRouter();
  const canEdit = role === 'admin' || role === 'editor';
  const isAdmin = role === 'admin';

  const [tab, setTab] = useState<'products' | 'scope'>('products');
  const [search, setSearch] = useState('');
  const [regFilter, setRegFilter] = useState<'all' | RegulationKey | 'none'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'gaps' | 'expiring' | 'complete'>('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The drawer: an existing product (view or edit), or a new one (edit).
  const [drawer, setDrawer] = useState<null | { id: string | null; mode: 'view' | 'edit' }>(null);
  const [showImport, setShowImport] = useState(false);
  const [asking, setAsking] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const now = today();
  const supplierName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const current = useMemo(() => currentValues(values), [values]);
  const regsByProduct = useMemo(
    () => new Map(products.map((p) => [p.id, regulationsForProduct(p, rules)])),
    [products, rules],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/[\s.\-]/g, '');
    return products.filter((p) => {
      if (!showInactive && !p.is_active) return false;
      if (q) {
        const text = `${p.part_number} ${p.description ?? ''}`.toLowerCase();
        const codes = [p.hs_code, p.cn_code, p.hts_code].filter(Boolean) as string[];
        const codeHit = /^\d+$/.test(qDigits) && codes.some((c) => c.startsWith(qDigits));
        if (!text.includes(q) && !codeHit) return false;
      }
      if (supplierFilter !== 'all' && p.supplier_id !== supplierFilter) return false;
      const regs = regsByProduct.get(p.id) ?? [];
      if (regFilter === 'none' && regs.length > 0) return false;
      if (regFilter !== 'all' && regFilter !== 'none' && !regs.includes(regFilter)) return false;
      if (statusFilter !== 'all') {
        const prog = regulationProgress(p.id, regFilter !== 'all' && regFilter !== 'none' ? [regFilter] : regs, current, now);
        const gaps = prog.some((r) => r.missing + r.expired > 0);
        const expiring = prog.some((r) => r.expiring > 0);
        if (statusFilter === 'gaps' && !gaps) return false;
        if (statusFilter === 'expiring' && !expiring) return false;
        if (statusFilter === 'complete' && (gaps || prog.length === 0)) return false;
      }
      return true;
    });
  }, [products, search, supplierFilter, regFilter, statusFilter, showInactive, regsByProduct, current, now]);

  const activeCount = products.filter((p) => p.is_active).length;
  const inactiveCount = products.length - activeCount;
  const inScope = products.filter((p) => p.is_active && (regsByProduct.get(p.id) ?? []).length > 0).length;
  const withCodes = products.filter((p) => p.is_active && (p.hs_code || p.cn_code || p.hts_code)).length;
  const drawerProduct = drawer?.id ? products.find((p) => p.id === drawer.id) ?? null : null;
  const allShownSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(allShownSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  if (loadError) {
    return (
      <div className="p-6">
        <Card><CardContent className="py-10 text-center text-sm text-red-700">
          Products could not be loaded: {loadError}. This usually means a database migration has not been applied;
          run <code className="mx-1">supabase/verify_install.sql</code> to see which.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Products and Parts</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            The parts you buy, import or place on the market, with the data each regulation needs. Which regulations
            apply comes from your scope rules on HS, CN or HTS codes; the values come from supplier surveys, imports or
            entries by hand, and each one carries its source and how long it stays valid.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}><Upload size={14} className="mr-1.5" />Import</Button>
            <Button size="sm" onClick={() => setDrawer({ id: null, mode: 'edit' })}><Plus size={14} className="mr-1.5" />Add product</Button>
          </div>
        )}
      </div>

      {notice && (
        <div className={`text-sm rounded-md px-3 py-2 flex items-start justify-between gap-3 ${notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          <span>{notice.text}</span>
          <button className="text-xs opacity-70 hover:opacity-100" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="products">Products ({activeCount})</TabsTrigger>
          <TabsTrigger value="scope">Which regulations apply ({rules.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-3 mt-4">
          {rules.length === 0 && withCodes > 0 && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 flex items-center justify-between gap-3">
              <span>
                No scope rules yet, so no product is in scope of any regulation, whatever its codes. BROC does not decide
                scope for you: list the codes each regulation covers, with their citation.
              </span>
              <Button size="sm" variant="outline" onClick={() => setTab('scope')}>Add scope rules <ArrowRight size={13} className="ml-1" /></Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search parts or codes" className="pl-8 w-60" />
            </div>
            <Select value={regFilter} onValueChange={(v) => setRegFilter(v as typeof regFilter)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All regulations</SelectItem>
                {REGULATION_KEYS.map((r) => <SelectItem key={r} value={r}>{REGULATIONS[r].label}</SelectItem>)}
                <SelectItem value="none">Not in scope</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any data status</SelectItem>
                <SelectItem value="gaps">Missing or expired data</SelectItem>
                <SelectItem value="expiring">Expiring in 30 days</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
              </SelectContent>
            </Select>
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suppliers</SelectItem>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {inactiveCount > 0 && (
              <label className="text-xs text-gray-600 inline-flex items-center gap-1.5">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                Show {inactiveCount} inactive
              </label>
            )}
            <span className="text-xs text-gray-500 ml-auto">{rows.length} shown · {inScope} in scope of a regulation</span>
            {canEdit && selected.size > 0 && (
              <Button size="sm" variant="outline" onClick={() => setAsking([...selected])}>
                <Send size={13} className="mr-1.5" />Ask supplier ({selected.size})
              </Button>
            )}
          </div>

          {products.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-sm text-gray-500">
              <Package className="mx-auto mb-2 text-gray-300" />
              No products yet. Import your parts list from your ERP or customs broker, or add one by hand.
            </CardContent></Card>
          ) : rows.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-sm text-gray-500">No products match these filters.</CardContent></Card>
          ) : (
            <div className="border border-gray-100 rounded-lg overflow-x-auto bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 text-left">
                  <tr>
                    {canEdit && (
                      <th className="w-8 px-3 py-2">
                        <input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label="Select all shown" />
                      </th>
                    )}
                    <th className="px-3 py-2">Part</th>
                    <th className="px-3 py-2">Codes</th>
                    <th className="px-3 py-2">Supplier</th>
                    <th className="px-3 py-2">Origin</th>
                    <th className="px-3 py-2">Data by regulation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((p) => {
                    const prog = regulationProgress(p.id, regsByProduct.get(p.id) ?? [], current, now);
                    const codes = CODE_SYSTEM_KEYS.filter((s) => p[`${s}_code`]);
                    return (
                      <tr key={p.id} className={`hover:bg-gray-50 cursor-pointer ${p.is_active ? '' : 'opacity-50'}`}
                        onClick={() => setDrawer({ id: p.id, mode: 'view' })}>
                        {canEdit && (
                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.part_number}`} />
                          </td>
                        )}
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900">{p.part_number}{!p.is_active && <span className="ml-2 text-xs font-normal text-gray-500">inactive</span>}</p>
                          {p.description && <p className="text-xs text-gray-500">{p.description}</p>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                          {codes.length === 0 ? <span className="text-gray-400">—</span> : codes.map((s) => (
                            <p key={s}><span className="text-gray-400 inline-block w-8">{CODE_SYSTEMS[s].label}</span><span className="font-mono">{p[`${s}_code`]}</span></p>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{p.supplier_id ? supplierName.get(p.supplier_id) : <span className="text-gray-400">—</span>}</td>
                        <td className="px-3 py-2 text-gray-700">{p.country_of_origin ?? <span className="text-gray-400">—</span>}</td>
                        <td className="px-3 py-2">
                          {prog.length === 0 ? <span className="text-xs text-gray-400">Not in scope</span> : (
                            <div className="flex flex-wrap gap-1.5">
                              {prog.map((r) => {
                                const gaps = r.missing + r.expired;
                                return (
                                  <Badge key={r.regulation} variant={gaps > 0 ? 'secondary' : r.expiring > 0 ? 'warning' : 'default'}>
                                    {REGULATIONS[r.regulation].label} {r.current + r.expiring}/{r.total}
                                  </Badge>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="scope" className="mt-4">
          <ScopeRules rules={rules} isAdmin={isAdmin} onChanged={() => router.refresh()} />
        </TabsContent>
      </Tabs>

      {/* Product drawer: view, edit, or add. */}
      <Dialog open={!!drawer} onOpenChange={(o) => { if (!o) setDrawer(null); }}>
        {drawer && (
          <DrawerContent className="max-w-2xl">
            {drawer.mode === 'edit' ? (
              <ProductForm
                product={drawerProduct}
                rules={rules}
                suppliers={suppliers}
                businessUnits={businessUnits}
                sites={sites}
                users={users}
                onCancel={() => (drawerProduct ? setDrawer({ id: drawerProduct.id, mode: 'view' }) : setDrawer(null))}
                onSaved={(id) => { setDrawer({ id, mode: 'view' }); router.refresh(); }}
              />
            ) : drawerProduct ? (
              <ProductDetail
                product={drawerProduct}
                regulations={regsByProduct.get(drawerProduct.id) ?? []}
                matched={matchingRules(drawerProduct, rules)}
                hasRules={rules.length > 0}
                values={values.filter((v) => v.product_id === drawerProduct.id)}
                current={current}
                supplierName={drawerProduct.supplier_id ? supplierName.get(drawerProduct.supplier_id) ?? null : null}
                owner={users.find((u) => u.id === drawerProduct.owner_user_id)?.label ?? null}
                bu={businessUnits.find((b) => b.id === drawerProduct.business_unit_id)?.name ?? null}
                site={sites.find((s) => s.id === drawerProduct.site_id)?.name ?? null}
                canEdit={canEdit}
                onEdit={() => setDrawer({ id: drawerProduct.id, mode: 'edit' })}
                onAsk={() => setAsking([drawerProduct.id])}
                onGoToScope={() => { setDrawer(null); setTab('scope'); }}
                onChanged={() => router.refresh()}
              />
            ) : null}
          </DrawerContent>
        )}
      </Dialog>

      <AskSupplierDialog
        productIds={asking}
        products={products}
        regsByProduct={regsByProduct}
        surveys={surveys}
        supplierName={supplierName}
        onClose={() => setAsking(null)}
        onCreatedSurvey={() => router.refresh()}
        onDone={(text, ok) => { setAsking(null); setSelected(new Set()); setNotice({ tone: ok ? 'ok' : 'error', text }); router.refresh(); }}
      />

      <BulkImportDialog
        open={showImport}
        onClose={() => { setShowImport(false); router.refresh(); }}
        title="Import products"
        intro={<>Only Part Number is required. A part number already on file is updated, and blank cells leave stored
          values alone, so you can re-upload a fresh ERP export. HS, CN and HTS codes each have their own column.
          Columns headed with a field key (for example <code>ppwr.packaging_weight</code>) are recorded as that
          field&rsquo;s value.</>}
        templateHref="/api/products/template"
        templateTitle="Download the product template"
        templateHint="Product columns, then one optional column per compliance field"
        importHref="/api/products/import"
        columns={PRODUCT_IMPORT_HEADERS}
        skippedLabel="Updated"
      />
    </div>
  );
}

// ─── Drawer layout ───────────────────────────────────────────────────────────

/** Header, scrolling body and footer, matching the data-entry drawers. */
function DrawerShell({ title, subtitle, children, footer }: {
  title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <>
      <DialogHeader className="px-6 py-5 border-b border-gray-100 pr-12">
        <DialogTitle>{title}</DialogTitle>
        {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
      </DialogHeader>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">{children}</div>
      {footer && <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">{footer}</div>}
    </>
  );
}

// ─── Add / edit ──────────────────────────────────────────────────────────────

function ProductForm({
  product, rules, suppliers, businessUnits, sites, users, onCancel, onSaved,
}: {
  product: Product | null;
  rules: Rule[];
  suppliers: Named[];
  businessUnits: Named[];
  sites: Named[];
  users: { id: string; label: string }[];
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const supabase = createClient();
  const [draft, setDraft] = useState<Draft>(product ? draftOf(product) : EMPTY_PRODUCT);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  // What the codes as typed would put in scope, before saving.
  const preview = useMemo(() => {
    const codes: Partial<Record<'hs_code' | 'cn_code' | 'hts_code', string | null>> = {};
    for (const s of CODE_SYSTEM_KEYS) {
      const c = normalizeCode(draft[`${s}_code`], s);
      if (c.ok) codes[`${s}_code`] = c.value;
    }
    return regulationsForProduct(codes, rules);
  }, [draft, rules]);

  async function save() {
    if (!draft.part_number.trim()) { setError('Part number is required.'); return; }
    const codes: Partial<Record<'hs_code' | 'cn_code' | 'hts_code', string | null>> = {};
    for (const system of CODE_SYSTEM_KEYS) {
      const c = normalizeCode(draft[`${system}_code`], system);
      if (!c.ok) { setError(c.error); return; }
      codes[`${system}_code`] = c.value;
    }
    setSaving(true);
    const payload = {
      part_number: draft.part_number.trim(),
      description: draft.description.trim() || null,
      ...codes,
      supplier_id: draft.supplier_id || null,
      country_of_origin: draft.country_of_origin.trim() || null,
      business_unit_id: draft.business_unit_id || null,
      site_id: draft.site_id || null,
      owner_user_id: draft.owner_user_id || null,
      notes: draft.notes.trim() || null,
    };
    const { data, error: err } = product
      ? await supabase.from('products').update(payload).eq('id', product.id).select('id').single()
      : await supabase.from('products').insert(payload).select('id').single();
    setSaving(false);
    if (err || !data) {
      setError(err?.message.includes('uq_products_org_part') ? 'That part number is already on file.' : err?.message ?? 'Could not be saved.');
      return;
    }
    onSaved(data.id);
  }

  const select = (k: 'supplier_id' | 'business_unit_id' | 'site_id' | 'owner_user_id', label: string, list: { id: string; name: string }[]) => (
    <div>
      <Label>{label}</Label>
      <Select value={draft[k] || 'none'} onValueChange={(v) => set(k, v === 'none' ? '' : v)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          {list.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <DrawerShell
      title={product ? `Edit ${product.part_number}` : 'Add product'}
      subtitle="Fill whichever customs codes you hold. Scope is worked out from them when you save."
      footer={<>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </>}
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label required>Part number</Label>
          <Input value={draft.part_number} onChange={(e) => set('part_number', e.target.value)} />
        </div>
        <div>
          <Label>Country of origin</Label>
          <Input value={draft.country_of_origin} onChange={(e) => set('country_of_origin', e.target.value)} placeholder="China" />
        </div>
        <div className="col-span-2">
          <Label>Description</Label>
          <Input value={draft.description} onChange={(e) => set('description', e.target.value)} />
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-900 mb-2">Customs codes</p>
        <div className="grid grid-cols-3 gap-4">
          {CODE_SYSTEM_KEYS.map((s) => (
            <div key={s}>
              <Label>{CODE_SYSTEMS[s].label} <span className="font-normal text-gray-400">· {s === 'hs' ? 'up to 6' : 'up to 10'} digits</span></Label>
              <Input value={draft[`${s}_code`]} onChange={(e) => set(`${s}_code`, e.target.value)} placeholder={CODE_SYSTEMS[s].example} className="font-mono" />
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {rules.length === 0
            ? 'No scope rules yet, so these codes put the product in scope of nothing.'
            : preview.length > 0
              ? <>With these codes it is in scope of <strong>{preview.map((r) => REGULATIONS[r].label).join(', ')}</strong>.</>
              : 'With these codes no scope rule applies.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {select('supplier_id', 'Supplier', suppliers)}
        {select('owner_user_id', 'Data owner', users.map((u) => ({ id: u.id, name: u.label })))}
        {select('business_unit_id', 'Business unit', businessUnits)}
        {select('site_id', 'Site', sites)}
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </DrawerShell>
  );
}

// ─── Product detail ──────────────────────────────────────────────────────────

function ProductDetail({
  product, regulations, matched, hasRules, values, current, supplierName, owner, bu, site, canEdit, onEdit, onAsk, onGoToScope, onChanged,
}: {
  product: Product;
  regulations: RegulationKey[];
  matched: Rule[];
  hasRules: boolean;
  values: Value[];
  current: Map<string, ValueRow>;
  supplierName: string | null;
  owner: string | null;
  bu: string | null;
  site: string | null;
  canEdit: boolean;
  onEdit: () => void;
  onAsk: () => void;
  onGoToScope: () => void;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const now = today();
  const [recording, setRecording] = useState<ComplianceField | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [confirmActive, setConfirmActive] = useState(false);
  const [error, setError] = useState('');
  const codes = CODE_SYSTEM_KEYS.filter((s) => product[`${s}_code`]);

  async function setActive(active: boolean) {
    const { error: err } = await supabase.from('products').update({ is_active: active }).eq('id', product.id);
    setConfirmActive(false);
    if (err) setError(err.message);
    else onChanged();
  }

  return (
    <DrawerShell
      title={product.part_number}
      subtitle={<>{product.description ?? 'No description'}{!product.is_active && <Badge variant="secondary" className="ml-2">Inactive</Badge>}</>}
      footer={canEdit ? <>
        <Button variant="ghost" className="mr-auto text-gray-500" onClick={() => (product.is_active ? setConfirmActive(true) : setActive(true))}>
          {product.is_active ? 'Deactivate' : 'Reactivate'}
        </Button>
        <Button variant="outline" onClick={onEdit}>Edit</Button>
        {regulations.length > 0 && product.is_active && <Button onClick={onAsk}><Send size={13} className="mr-1.5" />Ask supplier</Button>}
      </> : undefined}
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div className="col-span-2">
          <dt className="text-xs text-gray-500">Customs codes</dt>
          <dd className="text-gray-900">
            {codes.length === 0 ? <span className="text-gray-400">None</span> : (
              <span className="flex flex-wrap gap-x-5">{codes.map((s) => (
                <span key={s}><span className="text-gray-400">{CODE_SYSTEMS[s].label}</span> <span className="font-mono">{product[`${s}_code`]}</span></span>
              ))}</span>
            )}
          </dd>
        </div>
        {([
          ['Supplier', supplierName], ['Country of origin', product.country_of_origin],
          ['Data owner', owner], ['Business unit', bu], ['Site', site],
        ] as const).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-gray-500">{k}</dt>
            <dd className="text-gray-900">{v || <span className="text-gray-400">—</span>}</dd>
          </div>
        ))}
        {product.notes && (
          <div className="col-span-2">
            <dt className="text-xs text-gray-500">Notes</dt>
            <dd className="text-gray-900 whitespace-pre-wrap">{product.notes}</dd>
          </div>
        )}
      </dl>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {regulations.length === 0 && (
        <div className="text-sm text-gray-600 rounded-md bg-gray-50 border border-gray-100 px-3 py-3 space-y-2">
          <p>
            {!hasRules
              ? 'No scope rules exist yet, so no regulation applies to any product. List the codes each regulation covers, with their citation, and products are matched automatically.'
              : codes.length === 0
                ? 'Add an HS, CN or HTS code to see which regulations apply.'
                : 'None of your scope rules covers these codes, so no regulation applies to it here.'}
          </p>
          {(!hasRules || codes.length > 0) && (
            <Button size="sm" variant="outline" onClick={onGoToScope}>Review scope rules <ArrowRight size={13} className="ml-1" /></Button>
          )}
        </div>
      )}

      {regulations.map((reg) => (
        <div key={reg}>
          <p className="text-sm font-semibold text-gray-900">{REGULATIONS[reg].label} <span className="font-normal text-gray-500">· {REGULATIONS[reg].name}</span></p>
          <p className="text-xs text-gray-500 mb-2">
            In scope by {matched.filter((r) => r.regulation === reg).map((r) =>
              `${CODE_SYSTEMS[r.code_system as CodeSystem]?.label ?? 'CN'} ${r.cn_prefix} (${r.source_citation})`).join('; ')}
          </p>
          <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
            {fieldsFor(reg).map((f) => {
              const v = current.get(`${product.id}|${f.key}`);
              const status = fieldStatus(v, now);
              const history = values.filter((x) => x.field_key === f.key).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
              return (
                <div key={f.key} className="px-3 py-2.5">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500">{f.label}</p>
                      <p className="text-sm text-gray-900 break-words">
                        {v ? displayFieldValue(f, v.value, v.unit) : <span className="text-gray-400">Not collected</span>}
                      </p>
                      {v && (
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {SOURCE_LABEL[v.source] ?? v.source} · {v.recorded_at.slice(0, 10)}
                          {v.valid_to ? ` · valid to ${v.valid_to}` : ' · does not expire'}
                        </p>
                      )}
                    </div>
                    <Badge variant={STATUS_BADGE[status].variant}>{STATUS_BADGE[status].label}</Badge>
                    {history.length > 1 && (
                      <button className="text-gray-400 hover:text-gray-700 mt-0.5" onClick={() => setHistoryFor(historyFor === f.key ? null : f.key)}
                        aria-label={`History of ${f.label}`} title={`${history.length} values recorded`}>
                        <History size={14} />
                      </button>
                    )}
                    {canEdit && (
                      <button className="text-xs text-emerald-700 hover:underline whitespace-nowrap mt-0.5" onClick={() => setRecording(f)}>Record</button>
                    )}
                  </div>
                  {historyFor === f.key && (
                    <ul className="mt-2 space-y-1 text-xs text-gray-500 border-l-2 border-gray-100 pl-3">
                      {history.map((h) => (
                        <li key={h.id}>{h.recorded_at.slice(0, 10)}: {displayFieldValue(f, h.value, h.unit)} ({SOURCE_LABEL[h.source] ?? h.source}){h.note ? ` — ${h.note}` : ''}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <RecordValueDialog field={recording} productId={product.id} onClose={() => setRecording(null)} onSaved={() => { setRecording(null); onChanged(); }} />
      <ConfirmDialog
        open={confirmActive}
        onOpenChange={setConfirmActive}
        title={`Deactivate ${product.part_number}?`}
        description="It drops out of the list and of scope counts, and cannot be sent to suppliers. Its collected data and history are kept, and you can reactivate it at any time."
        confirmLabel="Deactivate"
        onConfirm={() => setActive(false)}
      />
    </DrawerShell>
  );
}

function RecordValueDialog({
  field, productId, onClose, onSaved,
}: { field: ComplianceField | null; productId: string; onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() { setValue(''); setNote(''); setError(''); }

  async function save() {
    if (!field) return;
    const norm = normalizeFieldValue(field, value);
    if (!norm.ok) { setError(norm.error); return; }
    setSaving(true);
    const from = today();
    const { error: err } = await supabase.from('product_compliance_values').insert({
      product_id: productId,
      field_key: field.key,
      value: norm.value,
      unit: field.unit ?? null,
      valid_from: from,
      valid_to: validUntil(from, field.validMonths),
      source: 'manual',
      note: note.trim() || null,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    reset();
    onSaved();
  }

  return (
    <Dialog open={!!field} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{field?.label}</DialogTitle>
          {field?.help && <DialogDescription>{field.help}</DialogDescription>}
        </DialogHeader>
        {field && (
          <div className="space-y-3 py-2">
            {field.type === 'select' || field.type === 'yes_no' ? (
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {(field.type === 'yes_no' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : field.options ?? [])
                    .map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : field.type === 'location' ? (
              <Textarea rows={4} value={value} onChange={(e) => setValue(e.target.value)} placeholder="GeoJSON, coordinates, or a postal address" />
            ) : (
              <Input value={value} onChange={(e) => setValue(e.target.value)} type={field.type === 'date' ? 'date' : 'text'}
                placeholder={field.unit ? `in ${field.unit}` : undefined} />
            )}
            <div>
              <Label>Note (optional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where this came from, e.g. supplier email of 3 March" />
            </div>
            <p className="text-xs text-gray-400">
              Saved as a new entry; earlier values stay in the history.
              {field.validMonths ? ` Valid for ${field.validMonths} months from today.` : ' Does not expire.'}
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ask a supplier ──────────────────────────────────────────────────────────

function AskSupplierDialog({
  productIds, products, regsByProduct, surveys, supplierName, onClose, onCreatedSurvey, onDone,
}: {
  productIds: string[] | null;
  products: Product[];
  regsByProduct: Map<string, RegulationKey[]>;
  surveys: SurveyOption[];
  supplierName: Map<string, string>;
  onClose: () => void;
  onCreatedSurvey: () => void;
  onDone: (text: string, ok: boolean) => void;
}) {
  const [surveyId, setSurveyId] = useState('');
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState<RegulationKey | null>(null);
  const [error, setError] = useState('');
  const chosen = products.filter((p) => productIds?.includes(p.id));
  const supplierIds = new Set(chosen.map((p) => p.supplier_id));
  const regs = [...new Set(chosen.flatMap((p) => regsByProduct.get(p.id) ?? []))].sort();
  const problem = chosen.some((p) => !p.is_active)
    ? 'Inactive products cannot be sent to suppliers. Reactivate them first.'
    : supplierIds.has(null)
      ? 'Every product needs a supplier before you can ask about it.'
      : supplierIds.size > 1 ? 'These products have different suppliers. Ask each supplier separately.' : null;

  const survey = surveys.find((s) => s.id === surveyId);
  const relevant = survey?.fieldKeys.filter((k) => regs.includes(FIELD_BY_KEY.get(k)?.regulation as RegulationKey)) ?? [];
  // Regulations these products need that no active survey collects.
  const uncovered = regs.filter((r) => !surveys.some((s) => s.fieldKeys.some((k) => FIELD_BY_KEY.get(k)?.regulation === r)));

  function reset() { setSurveyId(''); setError(''); }

  async function createSurvey(regulation: RegulationKey) {
    setCreating(regulation);
    setError('');
    const res = await fetch('/api/products/field-survey', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ regulation }),
    });
    const json = await res.json().catch(() => ({}));
    setCreating(null);
    if (!res.ok) { setError(json.error ?? `Request failed (${res.status}).`); return; }
    setSurveyId(json.id);
    onCreatedSurvey();
  }

  async function send() {
    setSending(true);
    setError('');
    const res = await fetch('/api/products/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productIds, surveyId }),
    });
    const json = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) { setError(json.error ?? `Request failed (${res.status}).`); return; }
    reset();
    onDone(json.message, json.sent !== false);
  }

  return (
    <Dialog open={!!productIds} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ask the supplier</DialogTitle>
          <DialogDescription>
            {chosen.length === 1 ? chosen[0].part_number : `${chosen.length} products`}
            {chosen[0]?.supplier_id && !problem ? ` · ${supplierName.get(chosen[0].supplier_id)}` : ''}
            {regs.length > 0 ? ` · in scope of ${regs.map((r) => REGULATIONS[r].label).join(', ')}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {problem ? <p className="text-sm text-amber-800">{problem}</p> : (
            <>
              {regs.length === 0 && (
                <p className="text-sm text-amber-800">
                  {chosen.length === 1 ? 'This product is' : 'These products are'} not in scope of any regulation, so
                  there are no product fields to fill. You can still send a survey, but nothing will be recorded on the product.
                </p>
              )}
              {surveys.length > 0 && (
                <div>
                  <Label required>Survey</Label>
                  <Select value={surveyId} onValueChange={setSurveyId}>
                    <SelectTrigger><SelectValue placeholder="Choose an active survey…" /></SelectTrigger>
                    <SelectContent>
                      {surveys.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.title} · {s.fieldKeys.length === 0 ? 'saves no product fields' : `fills ${s.fieldKeys.length} field${s.fieldKeys.length === 1 ? '' : 's'}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {survey && (
                    <p className={`text-xs mt-1.5 ${relevant.length === 0 && regs.length > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                      {relevant.length > 0
                        ? `Fills: ${relevant.map((k) => FIELD_BY_KEY.get(k)?.label).join(', ')}.`
                        : regs.length > 0
                          ? 'This survey fills none of these products’ fields; the answers would only sit in the survey.'
                          : 'Answers stay in the survey response.'}
                    </p>
                  )}
                </div>
              )}
              {uncovered.length > 0 && (
                <div className="rounded-md bg-gray-50 border border-gray-100 px-3 py-2.5 space-y-2">
                  <p className="text-xs text-gray-600">
                    No active survey collects {uncovered.map((r) => REGULATIONS[r].label).join(' or ')} product fields yet.
                    Create one with a question for each field; you can edit it on the{' '}
                    <Link href="/suppliers" className="text-emerald-700 underline">Suppliers page</Link> afterwards.
                  </p>
                  <div className="flex gap-2">
                    {uncovered.map((r) => (
                      <Button key={r} size="sm" variant="outline" onClick={() => createSurvey(r)} disabled={creating !== null}>
                        {creating === r ? 'Creating…' : `Create ${REGULATIONS[r].label} survey`}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {surveys.length === 0 && uncovered.length === 0 && (
                <p className="text-sm text-gray-600">
                  No active survey. Create one on the <Link href="/suppliers" className="text-emerald-700 underline">Suppliers page</Link> and activate it.
                </p>
              )}
              <p className="text-xs text-gray-500">
                One invitation goes to the supplier&rsquo;s contact email. Answers that fill a product field are recorded
                on {chosen.length === 1 ? 'this product' : `all ${chosen.length} products`}; if the answers differ by
                product (two plots, two installations), ask about each one separately.
              </p>
            </>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={send} disabled={!!problem || !surveyId || sending}>{sending ? 'Sending…' : 'Send'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Scope rules ─────────────────────────────────────────────────────────────

const EMPTY_RULE = {
  regulation: 'cbam' as RegulationKey, code_system: 'cn' as CodeSystem, codes: '', label: '',
  source_citation: '', source_url: '', last_verified: '',
};

function ScopeRules({ rules, isAdmin, onChanged }: { rules: Rule[]; isAdmin: boolean; onChanged: () => void }) {
  const supabase = createClient();
  const [draft, setDraft] = useState(EMPTY_RULE);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const [filter, setFilter] = useState<'all' | RegulationKey>('all');

  async function add() {
    setResult('');
    const raw = splitCodes(draft.codes);
    if (raw.length === 0) { setError('Enter at least one code or prefix.'); return; }
    const codes: string[] = [];
    for (const c of raw) {
      const n = normalizeCode(c, draft.code_system);
      if (!n.ok || !n.value) { setError(n.ok ? `"${c}" is empty.` : n.error); return; }
      codes.push(n.value);
    }
    if (!draft.source_citation.trim()) { setError('A citation is required: where in the legal text these codes are listed.'); return; }
    if (!draft.last_verified) { setError('Enter the date you last checked them against the source.'); return; }

    const existing = new Set(rules.filter((r) => r.regulation === draft.regulation && (r.code_system ?? 'cn') === draft.code_system).map((r) => r.cn_prefix));
    const unique = [...new Set(codes)];
    const fresh = unique.filter((c) => !existing.has(c));
    if (fresh.length === 0) { setError('All of those codes are already listed for this regulation and code system.'); return; }

    setSaving(true);
    const { error: err } = await supabase.from('compliance_scope_rules').insert(fresh.map((cn_prefix) => ({
      regulation: draft.regulation,
      code_system: draft.code_system,
      cn_prefix,
      label: draft.label.trim() || null,
      source_citation: draft.source_citation.trim(),
      source_url: draft.source_url.trim() || null,
      last_verified: draft.last_verified,
    })));
    setSaving(false);
    if (err) { setError(err.message); return; }
    const skipped = unique.length - fresh.length;
    setResult(`Added ${fresh.length} code${fresh.length === 1 ? '' : 's'}${skipped ? `; ${skipped} already listed` : ''}.`);
    setDraft({ ...EMPTY_RULE, regulation: draft.regulation, code_system: draft.code_system, source_citation: draft.source_citation, source_url: draft.source_url, last_verified: draft.last_verified });
    setError('');
    onChanged();
  }

  async function remove() {
    if (!deleting) return;
    const { error: err } = await supabase.from('compliance_scope_rules').delete().eq('id', deleting.id);
    setDeleting(null);
    if (err) setError(err.message);
    else onChanged();
  }

  const shown = filter === 'all' ? rules : rules.filter((r) => r.regulation === filter);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 max-w-3xl">
        A product is in scope of a regulation when its code in the rule&rsquo;s system (HS, CN or HTS) starts with one of
        the codes listed here. The first six digits are shared by all three, so a code of six digits or fewer matches
        whichever code a product has. BROC loads no list by default: enter the codes from the regulation&rsquo;s annex,
        with where they are cited and when you last checked, so anyone can trace why a part is in or out. A cited CBAM
        and EUDR list ready to load is in <code>supabase/content/scope-packs</code>.
      </p>

      {isAdmin && (
        <Card><CardContent className="py-4 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label required>Regulation</Label>
              <Select value={draft.regulation} onValueChange={(v) => setDraft({ ...draft, regulation: v as RegulationKey })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{REGULATION_KEYS.map((r) => <SelectItem key={r} value={r}>{REGULATIONS[r].label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label required>Code system</Label>
              <Select value={draft.code_system} onValueChange={(v) => setDraft({ ...draft, code_system: v as CodeSystem })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CODE_SYSTEM_KEYS.map((s) => <SelectItem key={s} value={s}>{CODE_SYSTEMS[s].label} · {CODE_SYSTEMS[s].name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>What they cover</Label>
              <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Iron and steel" />
            </div>
          </div>
          <div>
            <Label required>Codes or prefixes</Label>
            <Textarea rows={3} value={draft.codes} onChange={(e) => setDraft({ ...draft, codes: e.target.value })}
              placeholder={'One per line, or separated by commas. Paste a whole annex column if you like.\n7208\n7209 15'} className="font-mono" />
          </div>
          <div className="grid grid-cols-4 gap-3 items-end">
            <div className="col-span-2">
              <Label required>Citation</Label>
              <Input value={draft.source_citation} onChange={(e) => setDraft({ ...draft, source_citation: e.target.value })} placeholder="Regulation (EU) 2023/956, Annex I" />
            </div>
            <div>
              <Label>Source link</Label>
              <Input value={draft.source_url} onChange={(e) => setDraft({ ...draft, source_url: e.target.value })} placeholder="https://eur-lex.europa.eu/…" />
            </div>
            <div>
              <Label required>Last verified</Label>
              <Input type="date" value={draft.last_verified} onChange={(e) => setDraft({ ...draft, last_verified: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={add} disabled={saving}>{saving ? 'Adding…' : `Add ${splitCodes(draft.codes).length > 1 ? `${splitCodes(draft.codes).length} codes` : 'code'}`}</Button>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {result && !error && <p className="text-sm text-emerald-700">{result}</p>}
          </div>
        </CardContent></Card>
      )}

      {rules.length === 0 ? (
        <p className="text-sm text-gray-500">No scope rules yet.{!isAdmin && ' An admin can add them.'}</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All regulations</SelectItem>
                {REGULATION_KEYS.map((r) => <SelectItem key={r} value={r}>{REGULATIONS[r].label}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-xs text-gray-500">{shown.length} rule{shown.length === 1 ? '' : 's'}</span>
          </div>
          <div className="border border-gray-100 rounded-lg bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 text-left">
                <tr><th className="px-3 py-2">Regulation</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Covers</th><th className="px-3 py-2">Citation</th><th className="px-3 py-2">Verified</th>{isAdmin && <th />}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">{REGULATIONS[r.regulation as RegulationKey]?.label ?? r.regulation}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap"><span className="text-gray-400 inline-block w-8">{CODE_SYSTEMS[r.code_system as CodeSystem]?.label ?? 'CN'}</span><span className="font-mono">{r.cn_prefix}</span></td>
                    <td className="px-3 py-2 text-gray-700">{r.label ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.source_citation}
                      {r.source_url && <a href={r.source_url} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-emerald-700"><ExternalLink size={12} /></a>}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{r.last_verified}</td>
                    {isAdmin && (
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => setDeleting(r)} className="text-gray-400 hover:text-red-600" aria-label="Remove"><Trash2 size={14} /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title="Remove this scope rule?"
        description={deleting ? `${REGULATIONS[deleting.regulation as RegulationKey]?.label ?? deleting.regulation} ${CODE_SYSTEMS[deleting.code_system as CodeSystem]?.label ?? 'CN'} ${deleting.cn_prefix}: products with this code will no longer show as in scope. Their collected data is kept. The removal is recorded in the audit trail.` : ''}
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </div>
  );
}
