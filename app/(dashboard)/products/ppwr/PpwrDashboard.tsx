'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DrawerContent } from '@/components/ui/dialog';
import { DrawerShell } from '@/components/ui/drawer-shell';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AlertTriangle, CheckCircle2, Download, Plus, XCircle, Boxes } from 'lucide-react';
import {
  MATERIALS, FUNCTIONS, MATERIAL_LABEL, componentIssues, jurisdictionReport, jurisdictionsFor, reportIssues, reportCsv, isEuMemberState,
  type ComponentRow, type PlacementRow, type RegistrationRow, type ReportRow,
} from '@/lib/ppwr-core';
import { Breadcrumb } from '../Breadcrumb';
import { ComponentForm } from './ComponentForm';
import { jurisdictionName } from './PartPanel';
import { download, today, type Named, type Org, type ValueRow } from '../eudr/types';

const t = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
/** Column heads short enough for a drawer; the CSV carries the full Annex IX names. */
const SHORT: Record<string, string> = { glass: 'Glass', plastic: 'Plastic', paper_cardboard: 'Paper', ferrous_metal: 'Ferrous', aluminium: 'Alu.', wood: 'Wood', other: 'Other' };

interface Props {
  org: Org | null;
  products: { id: string; part_number: string; description: string | null; supplier_id: string | null; is_active: boolean }[];
  suppliers: Named[];
  values: ValueRow[];
  components: ComponentRow[];
  placements: PlacementRow[];
  registrations: RegistrationRow[];
  reports: ReportRow[];
  role: string;
  loadError: string | null;
}

const FULFILMENT = { own: 'Individually', pro: 'Producer responsibility organisation', authorised_representative: 'Authorised representative' } as const;

export function PpwrDashboard({ org, products, suppliers, values, components, placements, registrations, reports, role, loadError }: Props) {
  const router = useRouter();
  const canEdit = role === 'admin' || role === 'editor';
  const isAdmin = role === 'admin';
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => [...new Set([thisYear, thisYear - 1, ...placements.map((p) => p.year)])].sort((a, b) => b - a), [placements, thisYear]);
  const [year, setYear] = useState(thisYear);
  const [tab, setTab] = useState<'countries' | 'registrations' | 'packaging'>('countries');
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [openComponent, setOpenComponent] = useState<string | null>(null);
  const [editReg, setEditReg] = useState<null | { reg: RegistrationRow | null }>(null);
  const refresh = () => router.refresh();

  const product = new Map(products.map((p) => [p.id, p]));
  const regFor = (j: string) => registrations.find((r) => r.jurisdiction === j) ?? null;
  const reportFor = (j: string) => reports.find((r) => r.jurisdiction === j && r.year === year) ?? null;
  const places = jurisdictionsFor(placements, year);
  const rows = places.map((j) => {
    const rep = jurisdictionReport(placements, components, j, year);
    return { j, rep, issues: reportIssues(rep, regFor(j), components, placements), report: reportFor(j) };
  });
  const active = components.filter((c) => c.is_active);
  const componentGaps = active.filter((c) => componentIssues(c).length > 0);
  const foodContactGaps = active.filter((c) => componentIssues(c).some((i) => i.level === 'block'));
  const euMissingReg = rows.filter((r) => r.rep.eu && !regFor(r.j)).length;
  const totalTonnes = rows.reduce((s, r) => s + r.rep.total, 0);
  const lastYear = year - 1;
  const dueLastYear = jurisdictionsFor(placements, lastYear).filter(isEuMemberState);
  const submittedLastYear = dueLastYear.filter((j) => reports.some((r) => r.jurisdiction === j && r.year === lastYear && r.status === 'submitted')).length;

  if (loadError) {
    return (
      <div className="p-4 sm:p-6">
        <Card><CardContent className="py-10 text-center text-sm text-red-700">
          Packaging data could not be loaded: {loadError}. This usually means a database migration has not been applied;
          run <code className="mx-1">supabase/verify_install.sql</code> to see which.
        </CardContent></Card>
      </div>
    );
  }

  const kpis: { label: string; value: string | number; sub: string; tone?: 'warn' }[] = [
    { label: `Packaging placed in ${year}`, value: `${t(totalTonnes)} t`, sub: `in ${places.length} ${places.length === 1 ? 'country' : 'countries or states'}` },
    { label: 'Parts with packaging', value: new Set(active.map((c) => c.product_id)).size, sub: `${active.length} packaging pieces` },
    { label: 'Missing EU registrations', value: euMissingReg, sub: 'Member States with packaging, no registration', tone: euMissingReg ? 'warn' : undefined },
    { label: 'Food contact without PFAS evidence', value: foodContactGaps.length, sub: 'Art. 5(5), in force since 12 Aug 2026', tone: foodContactGaps.length ? 'warn' : undefined },
    { label: 'Packaging to check', value: componentGaps.length, sub: 'evidence or recycled content missing', tone: componentGaps.length ? 'warn' : undefined },
    { label: `EU reports for ${lastYear}`, value: dueLastYear.length ? `${submittedLastYear} of ${dueLastYear.length}` : '—', sub: `submitted; due ${lastYear + 1}-06-01`, tone: dueLastYear.length > submittedLastYear ? 'warn' : undefined },
  ];

  const openRow = rows.find((r) => r.j === openReport) ?? null;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <Breadcrumb current="PPWR" />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">PPWR and packaging EPR</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Packaging tonnes by country, worked out from each part&rsquo;s packaging and the units placed there; your
            registration in each; and the report pack to file with each register or scheme. Record packaging and quantities
            in a part&rsquo;s PPWR tab.
          </p>
        </div>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {kpis.map((k) => (
          <Card key={k.label}><CardContent className="py-3">
            <p className="text-xs text-gray-500">{k.label}</p>
            <p className={`text-2xl font-semibold ${k.tone === 'warn' ? 'text-amber-700' : 'text-gray-900'}`}>{k.value}</p>
            <p className="text-xs text-gray-500">{k.sub}</p>
          </CardContent></Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="countries">By country ({places.length})</TabsTrigger>
          <TabsTrigger value="registrations">Registrations ({registrations.length})</TabsTrigger>
          <TabsTrigger value="packaging">Packaging ({active.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="countries" className="mt-4">
          {rows.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-sm text-gray-500">
              <Boxes className="mx-auto mb-2 text-gray-300" />
              No quantities recorded for {year}. Add them from a part&rsquo;s PPWR tab: units per country, per year.
            </CardContent></Card>
          ) : (
            <div className="border border-gray-100 rounded-lg bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 text-left">
                  <tr><th className="px-3 py-2">Country or state</th><th className="px-3 py-2 text-right">Packaging</th>
                    <th className="hidden md:table-cell px-3 py-2">Registration</th><th className="hidden md:table-cell px-3 py-2">Due</th><th className="px-3 py-2">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map(({ j, rep, issues, report }) => {
                    const reg = regFor(j);
                    const blocks = issues.filter((i) => i.level === 'block').length;
                    return (
                      <tr key={j} className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpenReport(j)}>
                        <td className="px-3 py-2">
                          <p className="text-gray-900">{jurisdictionName(j)}{rep.eu && <span className="text-xs text-gray-400"> · EU</span>}</p>
                          <p className="md:hidden text-xs text-gray-500">{reg?.registration_number ?? 'not registered'}{rep.due ? ` · due ${rep.due}` : ''}</p>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap text-gray-900">{t(rep.total)} t</td>
                        <td className="hidden md:table-cell px-3 py-2 text-gray-700">{reg ? reg.registration_number ?? 'number missing' : <span className="text-amber-700">none</span>}</td>
                        <td className="hidden md:table-cell px-3 py-2 text-gray-700">{rep.due ?? 'per scheme'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {report?.status === 'submitted' ? <Badge variant="default">Submitted</Badge>
                            : blocks ? <Badge variant="warning">{blocks} to resolve</Badge> : <Badge variant="secondary">Ready</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="registrations" className="mt-4 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <p className="text-sm text-gray-600 max-w-2xl">
              A producer registers in each Member State where it first makes packaging available (Art. 44(2)), directly or
              through a producer responsibility organisation (Art. 46), with an authorised representative where it is not
              established there (Art. 45(3)). US state programmes can be recorded the same way.
            </p>
            {canEdit && <Button size="sm" className="self-start" onClick={() => setEditReg({ reg: null })}><Plus size={13} className="mr-1" />Add registration</Button>}
          </div>
          {registrations.length === 0 ? <p className="text-sm text-gray-500">None recorded.</p> : (
            <ul className="divide-y divide-gray-50 border border-gray-100 rounded-lg bg-white">
              {registrations.map((r) => (
                <li key={r.id}>
                  <button className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50" onClick={() => setEditReg({ reg: r })}>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-gray-900">{jurisdictionName(r.jurisdiction)}{r.register_name ? ` · ${r.register_name}` : ''}</span>
                      <span className="block text-xs text-gray-500">{FULFILMENT[r.fulfilment]}{r.pro_name ? `: ${r.pro_name}` : ''}{r.authorised_representative ? `: ${r.authorised_representative}` : ''}</span>
                    </span>
                    <span className="font-mono text-xs text-gray-700">{r.registration_number ?? <span className="text-amber-700 font-sans">number missing</span>}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="packaging" className="mt-4">
          {active.length === 0 ? <p className="text-sm text-gray-500">No packaging recorded yet. Add it from a part&rsquo;s PPWR tab.</p> : (
            <div className="border border-gray-100 rounded-lg bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 text-left">
                  <tr><th className="px-3 py-2">Packaging</th><th className="hidden md:table-cell px-3 py-2">Part</th><th className="hidden md:table-cell px-3 py-2">Material</th><th className="px-3 py-2">Evidence</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {[...active].sort((a, b) => componentIssues(b).length - componentIssues(a).length).map((c) => {
                    const issues = componentIssues(c);
                    return (
                      <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpenComponent(c.id)}>
                        <td className="px-3 py-2"><p className="text-gray-900">{c.name}</p><p className="md:hidden text-xs text-gray-500">{product.get(c.product_id)?.part_number} · {MATERIAL_LABEL[c.material]}</p></td>
                        <td className="hidden md:table-cell px-3 py-2 text-gray-700">{product.get(c.product_id)?.part_number ?? '—'}</td>
                        <td className="hidden md:table-cell px-3 py-2 text-gray-700">{MATERIAL_LABEL[c.material]}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {issues.some((i) => i.level === 'block') ? <Badge variant="destructive">PFAS evidence missing</Badge>
                            : issues.length ? <Badge variant="warning">{issues.length} to check</Badge> : <Badge variant="default">Complete</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!openReport || !!openComponent} onOpenChange={(o) => { if (!o) { setOpenReport(null); setOpenComponent(null); } }}>
        {openRow && (
          <DrawerContent className="max-w-2xl">
            <ReportPanel key={`${openRow.j}-${year}`} jurisdiction={openRow.j} year={year} rep={openRow.rep} issues={openRow.issues}
              reg={regFor(openRow.j)} report={openRow.report} operator={org?.name ?? ''} products={product}
              canEdit={canEdit} isAdmin={isAdmin} onChanged={refresh} />
          </DrawerContent>
        )}
        {openComponent && (() => {
          const c = components.find((x) => x.id === openComponent);
          return c ? (
            <DrawerContent className="max-w-2xl">
              <ComponentForm component={c} productId={c.product_id} supplierId={product.get(c.product_id)?.supplier_id ?? null}
                suppliers={suppliers} values={values} canEdit={canEdit} isAdmin={isAdmin}
                onCancel={() => setOpenComponent(null)} onSaved={() => { setOpenComponent(null); refresh(); }} />
            </DrawerContent>
          ) : null;
        })()}
      </Dialog>

      {editReg && <RegistrationDialog reg={editReg.reg} canEdit={canEdit} isAdmin={isAdmin} onClose={() => setEditReg(null)} onSaved={() => { setEditReg(null); refresh(); }} />}
    </div>
  );
}

function ReportPanel({ jurisdiction, year, rep, issues, reg, report, operator, products, canEdit, isAdmin, onChanged }: {
  jurisdiction: string; year: number; rep: ReturnType<typeof jurisdictionReport>; issues: ReturnType<typeof reportIssues>;
  reg: RegistrationRow | null; report: ReportRow | null; operator: string; products: Map<string, { part_number: string }>;
  canEdit: boolean; isAdmin: boolean; onChanged: () => void;
}) {
  const supabase = createClient();
  const [submit, setSubmit] = useState<null | { on: string; ref: string }>(null);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [error, setError] = useState('');
  const submitted = report?.status === 'submitted';

  async function record() {
    if (!submit?.ref.trim()) { setError('Enter the reference the register or scheme gave.'); return; }
    const payload = { jurisdiction, year, status: 'submitted', submitted_on: submit.on, reference: submit.ref.trim() };
    const res = report
      ? await supabase.from('epr_reports').update(payload).eq('id', report.id)
      : await supabase.from('epr_reports').insert(payload);
    if (res.error) { setError(res.error.message); return; }
    setSubmit(null); onChanged();
  }
  async function reopen() {
    setConfirmReopen(false);
    const { error: err } = await supabase.from('epr_reports').update({ status: 'draft' }).eq('id', report!.id);
    if (err) setError(err.message); else onChanged();
  }

  return (
    <DrawerShell
      title={`${jurisdictionName(jurisdiction)} · ${year}`}
      subtitle={rep.eu ? `Report due ${rep.due} (Art. 44(7))${rep.smallProducer ? ' · under 10 t: Annex IX, Part B, point 2' : ''}` : 'Deadline and format set by the scheme'}
      footer={<>
        {submitted && isAdmin && <Button variant="ghost" className="mr-auto text-gray-500" onClick={() => setConfirmReopen(true)}>Reopen</Button>}
        <Button variant="outline" onClick={() => download(`packaging-${jurisdiction}-${year}.csv`, reportCsv(rep, reg, operator), 'text/csv')}>
          <Download size={13} className="mr-1.5" />Report pack
        </Button>
        {!submitted && isAdmin && canEdit && <Button onClick={() => setSubmit({ on: today(), ref: '' })}>Record submission</Button>}
      </>}
    >
      {submitted && (
        <p className="rounded-md bg-emerald-50 border border-emerald-100 px-3 py-2 text-sm text-emerald-900">
          Submitted {report!.submitted_on} · reference <span className="font-mono">{report!.reference}</span>. The quantities behind it are locked.
        </p>
      )}
      {!submitted && (issues.length === 0
        ? <p className="text-sm text-emerald-700 inline-flex items-center gap-1.5"><CheckCircle2 size={15} />Nothing outstanding for this report.</p>
        : (
          <ul className="space-y-1.5">
            {issues.map((i) => (
              <li key={i.message} className={`text-sm flex gap-2 ${i.level === 'block' ? 'text-red-700' : 'text-amber-700'}`}>
                {i.level === 'block' ? <XCircle size={15} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5" />}{i.message}
              </li>
            ))}
          </ul>
        ))}

      <div className="border border-gray-100 rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-[11px] text-gray-500 text-left">
            <tr><th className="px-2 py-1.5">Tonnes</th>{MATERIALS.map((m) => <th key={m.key} className="px-1.5 py-1.5 text-right font-medium">{SHORT[m.key]}</th>)}<th className="px-2 py-1.5 text-right">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {FUNCTIONS.map((f) => {
              const by = rep.byFunction[f.key];
              return (
                <tr key={f.key}>
                  <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{f.label.replace(' packaging', '')}</td>
                  {MATERIALS.map((m) => <td key={m.key} className="px-1.5 py-1.5 text-right text-gray-700">{by[m.key] ? t(by[m.key]) : '·'}</td>)}
                  <td className="px-2 py-1.5 text-right text-gray-900">{t(Object.values(by).reduce((a, b) => a + b, 0))}</td>
                </tr>
              );
            })}
            <tr className="font-medium">
              <td className="px-2 py-1.5">Total</td>
              {MATERIALS.map((m) => <td key={m.key} className="px-1.5 py-1.5 text-right">{rep.tonnes[m.key] ? t(rep.tonnes[m.key]) : '·'}</td>)}
              <td className="px-2 py-1.5 text-right">{t(rep.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-gray-700">Reusable {t(rep.reusableTonnes)} t · single-use {t(rep.singleUseTonnes)} t · {rep.units.toLocaleString()} units of parts</p>
      {rep.partsWithoutPackaging.length > 0 && (
        <p className="text-sm text-amber-700">Without packaging recorded: {rep.partsWithoutPackaging.map((id) => products.get(id)?.part_number ?? id).join(', ')}</p>
      )}

      {submit && (
        <div className="rounded-md border border-gray-200 px-4 py-3 space-y-3">
          <p className="text-sm font-medium text-gray-900">Record the submission</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label required>Submitted on</Label><Input type="date" value={submit.on} onChange={(e) => setSubmit({ ...submit, on: e.target.value })} /></div>
            <div><Label required>Reference</Label><Input value={submit.ref} onChange={(e) => setSubmit({ ...submit, ref: e.target.value })} className="font-mono" /></div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setSubmit(null)}>Cancel</Button>
            <Button size="sm" onClick={record}>Record and lock</Button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <ConfirmDialog open={confirmReopen} onOpenChange={setConfirmReopen} title="Reopen this report?"
        description="Its quantities become editable again so a correction can be made. Resubmit with the register, then record the new reference."
        confirmLabel="Reopen" onConfirm={reopen} />
    </DrawerShell>
  );
}

function RegistrationDialog({ reg, canEdit, isAdmin, onClose, onSaved }: {
  reg: RegistrationRow | null; canEdit: boolean; isAdmin: boolean; onClose: () => void; onSaved: () => void;
}) {
  const supabase = createClient();
  const [d, setD] = useState({
    jurisdiction: reg?.jurisdiction ?? '', register_name: reg?.register_name ?? '', registration_number: reg?.registration_number ?? '',
    fulfilment: reg?.fulfilment ?? 'pro', pro_name: reg?.pro_name ?? '', authorised_representative: reg?.authorised_representative ?? '',
    registered_on: reg?.registered_on ?? '', notes: reg?.notes ?? '',
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));

  async function save() {
    const j = d.jurisdiction.trim().toUpperCase();
    if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(j)) { setError('Use a two-letter country code (DE), or a US state as US-OR.'); return; }
    const payload = {
      jurisdiction: j, register_name: d.register_name.trim() || null, registration_number: d.registration_number.trim() || null,
      fulfilment: d.fulfilment, pro_name: d.pro_name.trim() || null, authorised_representative: d.authorised_representative.trim() || null,
      registered_on: d.registered_on || null, notes: d.notes.trim() || null,
    };
    const res = reg ? await supabase.from('epr_registrations').update(payload).eq('id', reg.id) : await supabase.from('epr_registrations').insert(payload);
    if (res.error) setError(res.error.message.includes('duplicate') ? 'There is already a registration for this country or state.' : res.error.message);
    else onSaved();
  }
  async function remove() {
    const { error: err } = await supabase.from('epr_registrations').delete().eq('id', reg!.id);
    if (err) setError(err.message); else onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{reg ? `Registration · ${jurisdictionName(reg.jurisdiction)}` : 'Add registration'}</DialogTitle>
          <DialogDescription>Your entry in a country&rsquo;s register of producers, and who meets the obligations.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={!canEdit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label required>Country or state</Label><Input value={d.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value.toUpperCase())} placeholder="DE or US-OR" disabled={!!reg} /></div>
          <div><Label>Register</Label><Input value={d.register_name} onChange={(e) => set('register_name', e.target.value)} placeholder="Name of the register" /></div>
          <div><Label>Registration number</Label><Input value={d.registration_number} onChange={(e) => set('registration_number', e.target.value)} className="font-mono" /></div>
          <div><Label>Registered on</Label><Input type="date" value={d.registered_on} onChange={(e) => set('registered_on', e.target.value)} /></div>
          <div className="sm:col-span-2">
            <Label>Obligations met by</Label>
            <Select value={d.fulfilment} onValueChange={(v) => set('fulfilment', v)} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(FULFILMENT) as (keyof typeof FULFILMENT)[]).map((k) => <SelectItem key={k} value={k}>{FULFILMENT[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {d.fulfilment === 'pro' && <div className="sm:col-span-2"><Label>Producer responsibility organisation</Label><Input value={d.pro_name} onChange={(e) => set('pro_name', e.target.value)} /></div>}
          {d.fulfilment === 'authorised_representative' && <div className="sm:col-span-2"><Label>Authorised representative</Label><Input value={d.authorised_representative} onChange={(e) => set('authorised_representative', e.target.value)} /></div>}
          <div className="sm:col-span-2"><Label>Notes</Label><Textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        </fieldset>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <DialogFooter>
          {reg && isAdmin && <Button variant="ghost" className="mr-auto text-gray-500" onClick={remove}>Delete</Button>}
          <Button variant="outline" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</Button>
          {canEdit && <Button onClick={save}>Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
