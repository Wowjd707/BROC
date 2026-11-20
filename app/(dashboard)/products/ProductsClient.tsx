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
import { Package, Plus, Upload, Send, Search, ExternalLink, Trash2, History } from 'lucide-react';
import {
  REGULATIONS, REGULATION_KEYS, fieldsFor, displayFieldValue, normalizeFieldValue,
  type RegulationKey, type ComplianceField,
} from '@/lib/compliance-catalog';
import {
  normalizeCn, regulationsForCn, currentValues, fieldStatus, regulationProgress, validUntil,
  type ValueRow, type FieldStatus,
} from '@/lib/compliance-core';
import { PRODUCT_IMPORT_HEADERS } from '@/lib/product-import-core';

interface Product {
  id: string;
  part_number: string;
  description: string | null;
  cn_code: string | null;
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
  cn_prefix: string;
  label: string | null;
  source_citation: string;
  source_url: string | null;
  last_verified: string;
}
interface Named { id: string; name: string }
interface Survey { id: string; title: string; regulation_type: string; status: string }
type Value = ValueRow & { id: string; note: string | null };

interface Props {
  products: Product[];
  suppliers: (Named & { contact_email: string | null })[];
  businessUnits: Named[];
  sites: Named[];
  users: { id: string; label: string }[];
  rules: Rule[];
  values: Value[];
  surveys: Survey[];
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

const EMPTY_PRODUCT = {
  part_number: '', description: '', cn_code: '', supplier_id: '', country_of_origin: '',
  business_unit_id: '', site_id: '', owner_user_id: '', notes: '',
};

const today = () => new Date().toISOString().slice(0, 10);

export function ProductsClient({
  products, suppliers, businessUnits, sites, users, rules, values, surveys, role, loadError,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const canEdit = role === 'admin' || role === 'editor';
  const isAdmin = role === 'admin';

  const [search, setSearch] = useState('');
  const [regFilter, setRegFilter] = useState<'all' | RegulationKey | 'none'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'gaps' | 'expiring' | 'complete'>('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | { id: string | null; draft: typeof EMPTY_PRODUCT }>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [asking, setAsking] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const now = today();
  const supplierName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const current = useMemo(() => currentValues(values), [values]);
  const regsByProduct = useMemo(
    () => new Map(products.map((p) => [p.id, regulationsForCn(p.cn_code, rules)])),
    [products, rules],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !`${p.part_number} ${p.description ?? ''} ${p.cn_code ?? ''}`.toLowerCase().includes(q)) return false;
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
  }, [products, search, supplierFilter, regFilter, statusFilter, regsByProduct, current, now]);

  const inScope = products.filter((p) => (regsByProduct.get(p.id) ?? []).length > 0).length;
  const open = openId ? products.find((p) => p.id === openId) ?? null : null;

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  // ── Product create / edit ────────────────────────────────────────────────
  function startEdit(p: Product | null) {
    setFormError('');
    setEditing({
      id: p?.id ?? null,
      draft: p ? {
        part_number: p.part_number, description: p.description ?? '', cn_code: p.cn_code ?? '',
        supplier_id: p.supplier_id ?? '', country_of_origin: p.country_of_origin ?? '',
        business_unit_id: p.business_unit_id ?? '', site_id: p.site_id ?? '',
        owner_user_id: p.owner_user_id ?? '', notes: p.notes ?? '',
      } : EMPTY_PRODUCT,
    });
  }

  async function saveProduct() {
    if (!editing) return;
    const d = editing.draft;
    if (!d.part_number.trim()) { setFormError('Part number is required.'); return; }
    const cn = normalizeCn(d.cn_code);
    if (!cn.ok) { setFormError(cn.error); return; }
    setSaving(true);
    const payload = {
      part_number: d.part_number.trim(),
      description: d.description.trim() || null,
      cn_code: cn.value,
      supplier_id: d.supplier_id || null,
      country_of_origin: d.country_of_origin.trim() || null,
      business_unit_id: d.business_unit_id || null,
      site_id: d.site_id || null,
      owner_user_id: d.owner_user_id || null,
      notes: d.notes.trim() || null,
    };
    const { error } = editing.id
      ? await supabase.from('products').update(payload).eq('id', editing.id)
      : await supabase.from('products').insert(payload);
    setSaving(false);
    if (error) {
      setFormError(error.message.includes('uq_products_org_part') ? 'That part number is already on file.' : error.message);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  if (loadError) {
    return (
      <div className="p-6">
        <Card><CardContent className="py-10 text-center text-sm text-red-700">
          Products could not be loaded: {loadError}. If this is a new install step, run migration 043 and
          <code className="mx-1">supabase/verify_install.sql</code>.
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Products &amp; parts</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            The parts you buy, import or place on the market, with the data each regulation needs. Which
            regulations apply comes from your CN-code scope rules; the values come from supplier surveys, imports
            or entries by hand, and each one carries its source and how long it stays valid.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}><Upload size={14} className="mr-1.5" />Import</Button>
            <Button size="sm" onClick={() => startEdit(null)}><Plus size={14} className="mr-1.5" />Add product</Button>
          </div>
        )}
      </div>

      {notice && (
        <p className={`text-sm rounded-md px-3 py-2 ${notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {notice.text}
        </p>
      )}

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Products ({products.length})</TabsTrigger>
          <TabsTrigger value="scope">Which regulations apply ({rules.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-3 mt-4">
          {rules.length === 0 && products.length > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
              No scope rules yet, so no product is in scope of any regulation. Add the CN codes each regulation
              covers under &ldquo;Which regulations apply&rdquo;.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Part, description or CN code" className="pl-8 w-64" />
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
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
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
          ) : (
            <div className="border border-gray-100 rounded-lg overflow-x-auto bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 text-left">
                  <tr>
                    {canEdit && <th className="w-8 px-3 py-2" />}
                    <th className="px-3 py-2">Part</th>
                    <th className="px-3 py-2">CN code</th>
                    <th className="px-3 py-2">Supplier</th>
                    <th className="px-3 py-2">Origin</th>
                    <th className="px-3 py-2">Data by regulation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((p) => {
                    const prog = regulationProgress(p.id, regsByProduct.get(p.id) ?? [], current, now);
                    return (
                      <tr key={p.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpenId(p.id)}>
                        {canEdit && (
                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.part_number}`} />
                          </td>
                        )}
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900">{p.part_number}</p>
                          {p.description && <p className="text-xs text-gray-500">{p.description}</p>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">{p.cn_code ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{p.supplier_id ? supplierName.get(p.supplier_id) : <span className="text-gray-400">—</span>}</td>
                        <td className="px-3 py-2 text-gray-700">{p.country_of_origin ?? '—'}</td>
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

      {/* Product detail */}
      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        {open && (
          <DrawerContent className="max-w-2xl">
            <ProductDetail
              product={open}
              regulations={regsByProduct.get(open.id) ?? []}
              values={values.filter((v) => v.product_id === open.id)}
              current={current}
              supplierName={open.supplier_id ? supplierName.get(open.supplier_id) ?? null : null}
              owner={users.find((u) => u.id === open.owner_user_id)?.label ?? null}
              bu={businessUnits.find((b) => b.id === open.business_unit_id)?.name ?? null}
              site={sites.find((s) => s.id === open.site_id)?.name ?? null}
              canEdit={canEdit}
              onEdit={() => startEdit(open)}
              onAsk={() => setAsking([open.id])}
              onChanged={() => router.refresh()}
            />
          </DrawerContent>
        )}
      </Dialog>

      {/* Create / edit */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit product' : 'Add product'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3 py-2">
              {([
                ['part_number', 'Part number', true], ['description', 'Description', false], ['cn_code', 'CN code', false],
                ['country_of_origin', 'Country of origin', false],
              ] as const).map(([k, label, req]) => (
                <div key={k} className={k === 'description' ? 'col-span-2' : ''}>
                  <Label required={req}>{label}</Label>
                  <Input value={editing.draft[k]} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, [k]: e.target.value } })}
                    placeholder={k === 'cn_code' ? '7208 51 20' : undefined} />
                </div>
              ))}
              {([
                ['supplier_id', 'Supplier', suppliers],
                ['business_unit_id', 'Business unit', businessUnits],
                ['site_id', 'Site', sites],
                ['owner_user_id', 'Data owner', users.map((u) => ({ id: u.id, name: u.label }))],
              ] as const).map(([k, label, list]) => (
                <div key={k}>
                  <Label>{label}</Label>
                  <Select value={editing.draft[k] || 'none'} onValueChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, [k]: v === 'none' ? '' : v } })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {list.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              <div className="col-span-2">
                <Label>Notes</Label>
                <Textarea rows={2} value={editing.draft.notes} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, notes: e.target.value } })} />
              </div>
              {formError && <p className="col-span-2 text-sm text-red-600">{formError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveProduct} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AskSupplierDialog
        productIds={asking}
        products={products}
        surveys={surveys}
        supplierName={supplierName}
        onClose={() => setAsking(null)}
        onDone={(text, ok) => { setAsking(null); setSelected(new Set()); setNotice({ tone: ok ? 'ok' : 'error', text }); router.refresh(); }}
      />

      <BulkImportDialog
        open={showImport}
        onClose={() => { setShowImport(false); router.refresh(); }}
        title="Import products"
        intro={<>Only Part Number is required. A part number already on file is updated, and blank cells leave stored
          values alone, so you can re-upload a fresh ERP export. Columns headed with a field key (for example{' '}
          <code>ppwr.packaging_weight</code>) are recorded as that field&rsquo;s value.</>}
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

// ─── Product detail ──────────────────────────────────────────────────────────

function ProductDetail({
  product, regulations, values, current, supplierName, owner, bu, site, canEdit, onEdit, onAsk, onChanged,
}: {
  product: Product;
  regulations: RegulationKey[];
  values: Value[];
  current: Map<string, ValueRow>;
  supplierName: string | null;
  owner: string | null;
  bu: string | null;
  site: string | null;
  canEdit: boolean;
  onEdit: () => void;
  onAsk: () => void;
  onChanged: () => void;
}) {
  const now = today();
  const [recording, setRecording] = useState<ComplianceField | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle>{product.part_number}</DialogTitle>
        <DialogDescription>{product.description ?? 'No description'}</DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {[
          ['CN code', product.cn_code], ['Supplier', supplierName], ['Country of origin', product.country_of_origin],
          ['Data owner', owner], ['Business unit', bu], ['Site', site],
        ].map(([k, v]) => (
          <div key={k as string}>
            <dt className="text-xs text-gray-500">{k}</dt>
            <dd className="text-gray-900">{v || <span className="text-gray-400">—</span>}</dd>
          </div>
        ))}
      </dl>

      {canEdit && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>
          {regulations.length > 0 && <Button size="sm" variant="outline" onClick={onAsk}><Send size={13} className="mr-1.5" />Ask supplier</Button>}
        </div>
      )}

      {regulations.length === 0 && (
        <p className="text-sm text-gray-500 rounded-md bg-gray-50 border border-gray-100 px-3 py-2">
          {product.cn_code
            ? 'No scope rule covers this CN code, so no regulation applies to it here.'
            : 'Add a CN code to see which regulations apply.'}
        </p>
      )}

      {regulations.map((reg) => (
        <div key={reg}>
          <p className="text-sm font-semibold text-gray-900 mb-2">{REGULATIONS[reg].label} <span className="font-normal text-gray-500">· {REGULATIONS[reg].name}</span></p>
          <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
            {fieldsFor(reg).map((f) => {
              const v = current.get(`${product.id}|${f.key}`);
              const status = fieldStatus(v, now);
              const history = values.filter((x) => x.field_key === f.key).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
              return (
                <div key={f.key} className="px-3 py-2">
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
                      <button className="text-gray-400 hover:text-gray-700" onClick={() => setHistoryFor(historyFor === f.key ? null : f.key)} aria-label="History">
                        <History size={14} />
                      </button>
                    )}
                    {canEdit && (
                      <button className="text-xs text-emerald-700 hover:underline whitespace-nowrap" onClick={() => setRecording(f)}>Record</button>
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
    </div>
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
    setValue(''); setNote(''); setError('');
    onSaved();
  }

  return (
    <Dialog open={!!field} onOpenChange={(o) => { if (!o) { setValue(''); setNote(''); setError(''); onClose(); } }}>
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
              <Textarea rows={4} value={value} onChange={(e) => setValue(e.target.value)} placeholder='GeoJSON, coordinates, or a postal address' />
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
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ask a supplier ──────────────────────────────────────────────────────────

function AskSupplierDialog({
  productIds, products, surveys, supplierName, onClose, onDone,
}: {
  productIds: string[] | null;
  products: Product[];
  surveys: Survey[];
  supplierName: Map<string, string>;
  onClose: () => void;
  onDone: (text: string, ok: boolean) => void;
}) {
  const [surveyId, setSurveyId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const chosen = products.filter((p) => productIds?.includes(p.id));
  const supplierIds = new Set(chosen.map((p) => p.supplier_id));
  const problem = supplierIds.has(null)
    ? 'Every product needs a supplier before you can ask about it.'
    : supplierIds.size > 1 ? 'These products have different suppliers. Ask each supplier separately.' : null;

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
    setSurveyId('');
    onDone(json.message, json.sent !== false);
  }

  return (
    <Dialog open={!!productIds} onOpenChange={(o) => { if (!o) { setError(''); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ask the supplier</DialogTitle>
          <DialogDescription>
            {chosen.length === 1 ? chosen[0].part_number : `${chosen.length} products`}
            {chosen[0]?.supplier_id && !problem ? ` · ${supplierName.get(chosen[0].supplier_id)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {problem ? <p className="text-sm text-amber-800">{problem}</p> : surveys.length === 0 ? (
            <p className="text-sm text-gray-600">
              No active survey. Create one on the <Link href="/suppliers" className="text-emerald-700 underline">Suppliers page</Link>,
              mark the questions that should save to a product field, and activate it.
            </p>
          ) : (
            <>
              <div>
                <Label required>Survey</Label>
                <Select value={surveyId} onValueChange={setSurveyId}>
                  <SelectTrigger><SelectValue placeholder="Choose a survey…" /></SelectTrigger>
                  <SelectContent>{surveys.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <p className="text-xs text-gray-500">
                One invitation goes to the supplier&rsquo;s contact email. Answers to questions that save to a product field
                are recorded on {chosen.length === 1 ? 'this product' : `all ${chosen.length} products`}; if the answers
                differ by product, ask about each one separately.
              </p>
            </>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={!!problem || !surveyId || sending}>{sending ? 'Sending…' : 'Send'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Scope rules ─────────────────────────────────────────────────────────────

const EMPTY_RULE = { regulation: 'cbam' as RegulationKey, cn_prefix: '', label: '', source_citation: '', source_url: '', last_verified: '' };

function ScopeRules({ rules, isAdmin, onChanged }: { rules: Rule[]; isAdmin: boolean; onChanged: () => void }) {
  const supabase = createClient();
  const [draft, setDraft] = useState(EMPTY_RULE);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Rule | null>(null);

  async function add() {
    const cn = normalizeCn(draft.cn_prefix);
    if (!cn.ok || !cn.value) { setError(cn.ok ? 'Enter a CN code or prefix.' : cn.error); return; }
    if (!draft.source_citation.trim()) { setError('A citation is required: where in the legal text this code is listed.'); return; }
    if (!draft.last_verified) { setError('Enter the date you last checked it against the source.'); return; }
    setSaving(true);
    const { error: err } = await supabase.from('compliance_scope_rules').insert({
      regulation: draft.regulation,
      cn_prefix: cn.value,
      label: draft.label.trim() || null,
      source_citation: draft.source_citation.trim(),
      source_url: draft.source_url.trim() || null,
      last_verified: draft.last_verified,
    });
    setSaving(false);
    if (err) { setError(err.message.includes('duplicate') ? 'That code is already listed for this regulation.' : err.message); return; }
    setDraft({ ...EMPTY_RULE, regulation: draft.regulation, source_citation: draft.source_citation, source_url: draft.source_url, last_verified: draft.last_verified });
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 max-w-3xl">
        A product is in scope of a regulation when its CN code starts with one of the codes listed here. BROC ships no
        list of its own: enter the codes from the regulation&rsquo;s annex, each with where it is cited and when you last
        checked it, so anyone can trace why a part is in or out.
      </p>

      {isAdmin && (
        <Card><CardContent className="py-4 grid grid-cols-6 gap-3 items-end">
          <div>
            <Label required>Regulation</Label>
            <Select value={draft.regulation} onValueChange={(v) => setDraft({ ...draft, regulation: v as RegulationKey })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{REGULATION_KEYS.map((r) => <SelectItem key={r} value={r}>{REGULATIONS[r].label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label required>CN code or prefix</Label>
            <Input value={draft.cn_prefix} onChange={(e) => setDraft({ ...draft, cn_prefix: e.target.value })} placeholder="7208" />
          </div>
          <div className="col-span-2">
            <Label>What it covers</Label>
            <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Flat-rolled iron or steel" />
          </div>
          <div className="col-span-2">
            <Label required>Last verified</Label>
            <Input type="date" value={draft.last_verified} onChange={(e) => setDraft({ ...draft, last_verified: e.target.value })} />
          </div>
          <div className="col-span-3">
            <Label required>Citation</Label>
            <Input value={draft.source_citation} onChange={(e) => setDraft({ ...draft, source_citation: e.target.value })} placeholder="Regulation (EU) 2023/956, Annex I" />
          </div>
          <div className="col-span-2">
            <Label>Source link</Label>
            <Input value={draft.source_url} onChange={(e) => setDraft({ ...draft, source_url: e.target.value })} placeholder="https://eur-lex.europa.eu/…" />
          </div>
          <Button onClick={add} disabled={saving}>{saving ? 'Adding…' : 'Add'}</Button>
          {error && <p className="col-span-6 text-sm text-red-600">{error}</p>}
        </CardContent></Card>
      )}

      {rules.length === 0 ? (
        <p className="text-sm text-gray-500">No scope rules yet.{!isAdmin && ' An admin can add them.'}</p>
      ) : (
        <div className="border border-gray-100 rounded-lg bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 text-left">
              <tr><th className="px-3 py-2">Regulation</th><th className="px-3 py-2">CN code</th><th className="px-3 py-2">Covers</th><th className="px-3 py-2">Citation</th><th className="px-3 py-2">Verified</th>{isAdmin && <th />}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">{REGULATIONS[r.regulation as RegulationKey]?.label ?? r.regulation}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.cn_prefix}</td>
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
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title="Remove this scope rule?"
        description={deleting ? `${REGULATIONS[deleting.regulation as RegulationKey]?.label ?? deleting.regulation} ${deleting.cn_prefix}: products with this code will no longer show as in scope. Their collected data is kept. The removal is recorded in the audit trail.` : ''}
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </div>
  );
}

