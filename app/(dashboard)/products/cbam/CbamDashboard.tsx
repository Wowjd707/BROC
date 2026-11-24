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
import { Dialog, DrawerContent } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AlertTriangle, CheckCircle2, Download, Plus, XCircle, Factory } from 'lucide-react';
import { countryName } from '@/lib/eudr-core';
import {
  summariseYear, certificatesFor, declarationIssues, declarationCsv, embeddedEmissions, importIssues, yearOf,
  type ImportRow, type DeclarationRow,
} from '@/lib/cbam-core';
import { Breadcrumb } from '../Breadcrumb';
import { ImportForm } from './ImportForm';
import { download, today, type Named, type Org, type ProductRow, type RuleRow, type ValueRow } from '../eudr/types';

const t = (n: number, dp = 2) => n.toLocaleString(undefined, { maximumFractionDigits: dp });
const eur = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

interface Props {
  org: Org | null;
  products: (ProductRow & { country_of_origin: string | null })[];
  rules: RuleRow[];
  suppliers: Named[];
  values: ValueRow[];
  imports: ImportRow[];
  declarations: DeclarationRow[];
  role: string;
  loadError: string | null;
}

export function CbamDashboard({ org, products, rules, suppliers, values, imports, declarations, role, loadError }: Props) {
  const router = useRouter();
  const canEdit = role === 'admin' || role === 'editor';
  const isAdmin = role === 'admin';
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => [...new Set([thisYear, ...imports.map(yearOf), ...declarations.map((d) => d.year)])]
    .filter((y) => y >= 2026).sort((a, b) => b - a), [imports, declarations, thisYear]);
  const [year, setYear] = useState(years[0] ?? thisYear);
  const [tab, setTab] = useState<'imports' | 'declaration'>('imports');
  const [open, setOpen] = useState<null | { id: string | null }>(null);

  const summary = useMemo(() => summariseYear(imports, year), [imports, year]);
  const decl = declarations.find((d) => d.year === year) ?? null;
  const certs = certificatesFor(summary, decl);
  const issues = declarationIssues(summary, decl);
  const product = new Map(products.map((p) => [p.id, p]));
  const rows = imports.filter((i) => yearOf(i) === year);
  const refresh = () => router.refresh();

  if (loadError) {
    return (
      <div className="p-4 sm:p-6">
        <Card><CardContent className="py-10 text-center text-sm text-red-700">
          CBAM data could not be loaded: {loadError}. This usually means a database migration has not been applied;
          run <code className="mx-1">supabase/verify_install.sql</code> to see which.
        </CardContent></Card>
      </div>
    );
  }

  const pct = Math.min(100, (summary.thresholdMass / summary.threshold.tonnes) * 100);
  const declStatus = !summary.obligationsApply ? 'Not required so far' : decl?.status === 'submitted' ? `Submitted ${decl.submitted_on}` : 'Draft';

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <Breadcrumb current="CBAM" />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">CBAM</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Imports of CBAM goods across all your parts, the 50-tonne threshold, and the annual declaration you submit in the
            CBAM registry by 30 September. Record imports from a part&rsquo;s CBAM tab, or here. For a what-if figure
            before anything is imported, use the <Link href="/suppliers/cbam" className="text-emerald-700 hover:underline">CBAM estimator</Link>.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          {canEdit && <Button size="sm" onClick={() => setOpen({ id: null })}><Plus size={14} className="mr-1.5" />Record import</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="sm:col-span-2"><CardContent className="py-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs text-gray-500">Net mass imported in {year}</p>
            <p className="text-xs text-gray-500">threshold {summary.threshold.tonnes} t</p>
          </div>
          <p className="text-2xl font-semibold text-gray-900">{t(summary.thresholdMass, 1)} t</p>
          <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full ${summary.exceeded ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-gray-600 mt-1.5">
            {summary.exceeded
              ? 'Above the threshold: every CBAM obligation applies to the emissions in all goods imported this year (Art. 2a(2)).'
              : summary.outsideThresholdGoods
                ? 'Electricity or hydrogen imported: those obligations apply whatever the mass (Art. 2a(4)).'
                : `${t(summary.threshold.tonnes - summary.thresholdMass, 1)} t below the threshold; under it, an importer is exempt (Art. 2a(1)).`}
          </p>
        </CardContent></Card>
        <Card><CardContent className="py-3">
          <p className="text-xs text-gray-500">Embedded emissions</p>
          <p className="text-2xl font-semibold text-gray-900">{t(summary.embedded, 1)} t</p>
          <p className="text-xs text-gray-500">{summary.actualShare == null ? 'CO₂e' : `${Math.round(summary.actualShare * 100)}% on actual values`}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3">
          <p className="text-xs text-gray-500">Missing emissions</p>
          <p className={`text-2xl font-semibold ${summary.incomplete ? 'text-amber-700' : 'text-gray-900'}`}>{summary.incomplete}</p>
          <p className="text-xs text-gray-500">of {summary.imports} import{summary.imports === 1 ? '' : 's'}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3">
          <p className="text-xs text-gray-500">Certificates to surrender</p>
          <p className="text-2xl font-semibold text-gray-900">{t(certs.net, 0)}</p>
          <p className="text-xs text-gray-500">{certs.estimatedCostEur != null ? `about ${eur(certs.estimatedCostEur)}` : 'record quarterly prices for a cost'}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3">
          <p className="text-xs text-gray-500">Declaration due</p>
          <p className="text-2xl font-semibold text-gray-900">{summary.due}</p>
          <p className="text-xs text-gray-500">{declStatus}</p>
        </CardContent></Card>
        <Card className="sm:col-span-2"><CardContent className="py-3">
          <p className="text-xs text-gray-500 mb-1">Before the declaration</p>
          {issues.length === 0 ? (
            <p className="text-sm text-emerald-700 inline-flex items-center gap-1.5"><CheckCircle2 size={15} />
              {summary.obligationsApply ? 'Nothing outstanding.' : 'Nothing to declare unless the threshold is crossed.'}</p>
          ) : (
            <ul className="space-y-1">
              {issues.map((i) => (
                <li key={i.message} className={`text-sm flex gap-2 ${i.level === 'block' ? 'text-red-700' : 'text-amber-700'}`}>
                  {i.level === 'block' ? <XCircle size={15} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5" />}{i.message}
                </li>
              ))}
            </ul>
          )}
        </CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="imports">Imports ({rows.length})</TabsTrigger>
          <TabsTrigger value="declaration">Declaration {year}</TabsTrigger>
        </TabsList>

        <TabsContent value="imports" className="mt-4">
          {rows.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-sm text-gray-500">
              <Factory className="mx-auto mb-2 text-gray-300" />
              No imports recorded for {year}. Record each release of a CBAM good, from its part or here.
            </CardContent></Card>
          ) : (
            <div className="border border-gray-100 rounded-lg bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 text-left">
                  <tr>
                    <th className="px-3 py-2">Import</th><th className="hidden md:table-cell px-3 py-2">Part</th>
                    <th className="hidden md:table-cell px-3 py-2">CN code</th><th className="hidden md:table-cell px-3 py-2">Origin</th>
                    <th className="px-3 py-2 text-right">Net mass</th><th className="px-3 py-2 text-right">t CO₂e</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((i) => {
                    const e = embeddedEmissions(i);
                    const blocks = importIssues(i).filter((x) => x.level === 'block').length;
                    const p = product.get(i.product_id);
                    return (
                      <tr key={i.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpen({ id: i.id })}>
                        <td className="px-3 py-2">
                          <p className="text-gray-900">{i.import_date}{i.customs_reference ? ` · ${i.customs_reference}` : ''}</p>
                          <p className="md:hidden text-xs text-gray-500">{[p?.part_number, i.cn_code, countryName(i.country_of_origin)].filter(Boolean).join(' · ')}</p>
                        </td>
                        <td className="hidden md:table-cell px-3 py-2 text-gray-700">{p?.part_number ?? '—'}</td>
                        <td className="hidden md:table-cell px-3 py-2 font-mono text-xs text-gray-700">{i.cn_code}</td>
                        <td className="hidden md:table-cell px-3 py-2 text-gray-700">{countryName(i.country_of_origin)}</td>
                        <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">{t(Number(i.quantity))} {i.unit === 'MWh' ? 'MWh' : 't'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {blocks > 0 || !e ? <Badge variant="warning">Missing</Badge> : <span className="text-gray-900">{t(e.total)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="declaration" className="mt-4 space-y-4">
          <DeclarationPanel key={`${year}-${decl?.id ?? 'new'}`} year={year} decl={decl} summary={summary} operator={org?.name ?? ''}
            canEdit={canEdit} isAdmin={isAdmin} onChanged={refresh} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        {open && (
          <DrawerContent className="max-w-2xl">
            <ImportForm imp={open.id ? imports.find((i) => i.id === open.id) ?? null : null}
              products={products} rules={rules} suppliers={suppliers} values={values} declarations={declarations}
              canEdit={canEdit} isAdmin={isAdmin} onCancel={() => setOpen(null)} onSaved={() => { setOpen(null); refresh(); }} />
          </DrawerContent>
        )}
      </Dialog>
    </div>
  );
}

type DeclDraft = {
  declarant: string; cp: string; cpSource: string; fa: string; faSource: string;
  q1: string; q2: string; q3: string; q4: string; priceSource: string; notes: string;
};

function DeclarationPanel({ year, decl, summary, operator, canEdit, isAdmin, onChanged }: {
  year: number; decl: DeclarationRow | null; summary: ReturnType<typeof summariseYear>; operator: string;
  canEdit: boolean; isAdmin: boolean; onChanged: () => void;
}) {
  const supabase = createClient();
  const s = (v: unknown) => (v == null ? '' : String(v));
  const [d, setD] = useState<DeclDraft>({
    declarant: s(decl?.authorised_declarant_number), cp: s(decl?.carbon_price_deduction), cpSource: s(decl?.carbon_price_deduction_source),
    fa: s(decl?.free_allocation_adjustment), faSource: s(decl?.free_allocation_source),
    q1: s(decl?.price_q1_eur), q2: s(decl?.price_q2_eur), q3: s(decl?.price_q3_eur), q4: s(decl?.price_q4_eur),
    priceSource: s(decl?.price_source), notes: s(decl?.notes),
  });
  const [submit, setSubmit] = useState<null | { on: string; ref: string }>(null);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof DeclDraft>(k: K, v: string) => { setSaved(false); setD((x) => ({ ...x, [k]: v })); };
  const submitted = decl?.status === 'submitted';
  const readOnly = !canEdit || submitted;
  const n = (v: string) => (v.trim() ? Number(v.replace(/,/g, '')) : null);
  const draftRow = { ...(decl ?? {} as DeclarationRow), carbon_price_deduction: n(d.cp), free_allocation_adjustment: n(d.fa),
    price_q1_eur: n(d.q1), price_q2_eur: n(d.q2), price_q3_eur: n(d.q3), price_q4_eur: n(d.q4) };
  const certs = certificatesFor(summary, draftRow);

  async function save(extra: Record<string, unknown> = {}) {
    const nums = [d.cp, d.fa, d.q1, d.q2, d.q3, d.q4].map(n);
    if (nums.some((v) => v != null && !(v >= 0))) { setError('Deductions and prices must be zero or more.'); return false; }
    if (n(d.cp) != null && !d.cpSource.trim()) { setError('Say where the carbon price deduction comes from.'); return false; }
    if (n(d.fa) != null && !d.faSource.trim()) { setError('Say where the free allocation adjustment comes from.'); return false; }
    const payload = {
      year, authorised_declarant_number: d.declarant.trim() || null,
      carbon_price_deduction: n(d.cp), carbon_price_deduction_source: d.cpSource.trim() || null,
      free_allocation_adjustment: n(d.fa), free_allocation_source: d.faSource.trim() || null,
      price_q1_eur: n(d.q1), price_q2_eur: n(d.q2), price_q3_eur: n(d.q3), price_q4_eur: n(d.q4),
      price_source: d.priceSource.trim() || null, notes: d.notes.trim() || null, ...extra,
    };
    const res = decl
      ? await supabase.from('cbam_declarations').update(payload).eq('id', decl.id)
      : await supabase.from('cbam_declarations').insert(payload);
    if (res.error) { setError(res.error.message); return false; }
    setError(''); setSaved(true); onChanged();
    return true;
  }

  async function reopen() {
    setConfirmReopen(false);
    const { error: err } = await supabase.from('cbam_declarations').update({ status: 'draft' }).eq('id', decl!.id);
    if (err) setError(err.message); else onChanged();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-600 max-w-2xl">
          What the declaration asks for (Art. 6(2)): the quantity of each type of goods, their embedded emissions, the
          certificates to surrender, and the verification reports. Download the pack and enter it in the CBAM registry;
          BROC does not submit it.
        </p>
        <Button size="sm" variant="outline" disabled={summary.imports === 0}
          onClick={() => download(`cbam-declaration-${year}.csv`, declarationCsv(summary, { ...draftRow, authorised_declarant_number: d.declarant || null,
            carbon_price_deduction_source: d.cpSource || null, free_allocation_source: d.faSource || null, price_source: d.priceSource || null }, operator), 'text/csv')}>
          <Download size={13} className="mr-1.5" />Declaration pack
        </Button>
      </div>

      {submitted && (
        <div className="rounded-md bg-emerald-50 border border-emerald-100 px-3 py-2 text-sm text-emerald-900 flex items-center justify-between gap-3 flex-wrap">
          <span>Submitted {decl!.submitted_on} · registry reference <span className="font-mono">{decl!.registry_reference}</span>. The year&rsquo;s imports are locked.</span>
          {isAdmin && <Button size="sm" variant="outline" onClick={() => setConfirmReopen(true)}>Reopen</Button>}
        </div>
      )}

      <div className="border border-gray-100 rounded-lg bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 text-left">
            <tr><th className="px-3 py-2">Type of goods</th><th className="px-3 py-2 text-right">Quantity</th>
              <th className="px-3 py-2 text-right">t CO₂e</th><th className="hidden md:table-cell px-3 py-2">Actual values</th>
              <th className="hidden md:table-cell px-3 py-2">Origin</th><th className="hidden md:table-cell px-3 py-2">Verification reports</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {summary.lines.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">No imports in {year}.</td></tr>
            ) : summary.lines.map((l) => (
              <tr key={l.cn_code}>
                <td className="px-3 py-2"><p className="font-mono text-gray-900">{l.cn_code}</p><p className="text-xs text-gray-500">{l.sector ?? 'not under a CBAM heading'}</p></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{t(l.quantity)} {l.unit === 'MWh' ? 'MWh' : 't'}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{t(l.embedded)}{l.incomplete > 0 && <span className="block text-xs text-amber-700">{l.incomplete} missing</span>}</td>
                <td className="hidden md:table-cell px-3 py-2 text-gray-700">{l.actualShare == null ? '—' : `${Math.round(l.actualShare * 100)}%`}</td>
                <td className="hidden md:table-cell px-3 py-2 text-gray-700">{l.countries.map(countryName).join(', ')}</td>
                <td className="hidden md:table-cell px-3 py-2 text-xs text-gray-600">{l.verificationReports.join('; ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <fieldset disabled={readOnly} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><Label>Authorised CBAM declarant number</Label><Input value={d.declarant} onChange={(e) => set('declarant', e.target.value)} className="font-mono" /></div>
          <div />
          <div><Label>Carbon price deduction (certificates, Art. 9)</Label><Input value={d.cp} onChange={(e) => set('cp', e.target.value)} inputMode="decimal" /></div>
          <div><Label>Source</Label><Input value={d.cpSource} onChange={(e) => set('cpSource', e.target.value)} placeholder="Registry calculation, evidence held" /></div>
          <div><Label>Free allocation adjustment (certificates)</Label><Input value={d.fa} onChange={(e) => set('fa', e.target.value)} inputMode="decimal" /></div>
          <div><Label>Source</Label><Input value={d.faSource} onChange={(e) => set('faSource', e.target.value)} placeholder="Implementing Regulation (EU) 2025/2620, registry calculation" /></div>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">Certificate price per quarter (EUR)</p>
          <p className="text-xs text-gray-500 mb-2">For the cost estimate only. For 2026 the Commission publishes a quarterly average EU ETS auction price (Implementing Regulation (EU) 2025/2548).</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(['q1', 'q2', 'q3', 'q4'] as const).map((q) => (
              <div key={q}><Label>{q.toUpperCase()}</Label><Input value={d[q]} onChange={(e) => set(q, e.target.value)} inputMode="decimal" /></div>
            ))}
            <div className="col-span-2 sm:col-span-4"><Label>Price source</Label><Input value={d.priceSource} onChange={(e) => set('priceSource', e.target.value)} placeholder="Commission, Price of CBAM certificates page, and date" /></div>
          </div>
        </div>
        <div><Label>Notes</Label><Textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </fieldset>

      <div className="rounded-md bg-gray-50 border border-gray-100 px-3 py-2 text-sm text-gray-800 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <span>Embedded <b>{t(certs.gross)}</b></span>
        <span>Less deductions <b>{t(certs.carbonPriceDeduction + certs.freeAllocationAdjustment)}</b></span>
        <span>To surrender <b>{t(certs.net, 0)}</b></span>
        <span>Estimated cost <b>{certs.estimatedCostEur != null ? eur(certs.estimatedCostEur) : '—'}</b></span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!readOnly && (
        <div className="flex flex-wrap gap-2 justify-end items-center">
          {saved && <span className="text-sm text-emerald-700 mr-auto">Saved.</span>}
          <Button variant="outline" onClick={() => save()}>Save</Button>
          {isAdmin && <Button onClick={() => setSubmit({ on: today(), ref: '' })}>Record submission</Button>}
        </div>
      )}

      {submit && (
        <div className="rounded-md border border-gray-200 px-4 py-3 space-y-3">
          <p className="text-sm font-medium text-gray-900">Record the submission</p>
          <p className="text-xs text-gray-500">After submitting in the CBAM registry, record the date and reference. The year&rsquo;s imports are then locked.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label required>Submitted on</Label><Input type="date" value={submit.on} onChange={(e) => setSubmit({ ...submit, on: e.target.value })} /></div>
            <div><Label required>Registry reference</Label><Input value={submit.ref} onChange={(e) => setSubmit({ ...submit, ref: e.target.value })} className="font-mono" /></div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setSubmit(null)}>Cancel</Button>
            <Button size="sm" onClick={async () => {
              if (!submit.ref.trim()) { setError('Enter the reference the registry gave.'); return; }
              if (await save({ status: 'submitted', submitted_on: submit.on, registry_reference: submit.ref.trim() })) setSubmit(null);
            }}>Record and lock</Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmReopen}
        onOpenChange={setConfirmReopen}
        title={`Reopen the ${year} declaration?`}
        description="Its imports become editable again so a correction can be made. Resubmit in the registry, then record the new reference here."
        confirmLabel="Reopen"
        onConfirm={reopen}
      />
    </div>
  );
}
