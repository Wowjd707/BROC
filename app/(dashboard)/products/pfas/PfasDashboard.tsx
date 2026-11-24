'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DrawerContent } from '@/components/ui/dialog';
import { Download, ExternalLink, Search } from 'lucide-react';
import {
  REGIMES, declarationIssues, regimesFor, inventoryCsv, STALE_MONTHS,
  type DeclarationRow, type SubstanceRow,
} from '@/lib/pfas-core';
import { Breadcrumb } from '../Breadcrumb';
import { DeclarationForm } from './DeclarationForm';
import { download, today, type Named } from '../eudr/types';

interface Part { id: string; part_number: string; description: string | null; supplier_id: string | null; country_of_origin: string | null; is_active: boolean }

interface Props {
  products: Part[];
  suppliers: Named[];
  declarations: DeclarationRow[];
  substances: SubstanceRow[];
  role: string;
  loadError: string | null;
}

export function PfasDashboard({ products, suppliers, declarations, substances, role, loadError }: Props) {
  const router = useRouter();
  const canEdit = role === 'admin' || role === 'editor';
  const [tab, setTab] = useState<'parts' | 'regimes' | 'substances'>('parts');
  const [filter, setFilter] = useState<'all' | 'unknown' | 'intentionally_added' | 'gaps'>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const now = today();

  const active = products.filter((p) => p.is_active);
  const declFor = useMemo(() => new Map(declarations.map((d) => [d.product_id, d])), [declarations]);
  const rows = active.map((p) => {
    const d = declFor.get(p.id) ?? null;
    return { p, d, issues: declarationIssues(d, substances, now), regimes: regimesFor(d, p) };
  });
  const shown = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (q && !`${r.p.part_number} ${r.p.description ?? ''}`.toLowerCase().includes(q)) return false;
    if (filter === 'unknown') return (r.d?.status ?? 'unknown') === 'unknown';
    if (filter === 'intentionally_added') return r.d?.status === 'intentionally_added';
    if (filter === 'gaps') return r.issues.length > 0;
    return true;
  });
  const count = (fn: (r: (typeof rows)[number]) => boolean) => rows.filter(fn).length;
  const unknown = count((r) => (r.d?.status ?? 'unknown') === 'unknown');
  const added = count((r) => r.d?.status === 'intentionally_added');
  const stale = count((r) => r.issues.some((i) => i.message.includes('months ago')));
  const byRegime = REGIMES.map((g) => ({ g, parts: rows.filter((r) => r.regimes.some((x) => x.code === g.code)) }));
  const substanceIndex = useMemo(() => {
    const m = new Map<string, { name: string; cas: string | null; parts: Set<string> }>();
    for (const s of substances) {
      const d = declarations.find((x) => x.id === s.declaration_id);
      if (!d || d.status !== 'intentionally_added') continue;
      const key = s.cas_number ?? s.name.toLowerCase();
      const e = m.get(key) ?? { name: s.name, cas: s.cas_number, parts: new Set<string>() };
      e.parts.add(d.product_id);
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.parts.size - a.parts.size);
  }, [substances, declarations]);
  const partName = new Map(products.map((p) => [p.id, p.part_number]));

  if (loadError) {
    return (
      <div className="p-4 sm:p-6">
        <Card><CardContent className="py-10 text-center text-sm text-red-700">
          PFAS data could not be loaded: {loadError}. This usually means a database migration has not been applied;
          run <code className="mx-1">supabase/verify_install.sql</code> to see which.
        </CardContent></Card>
      </div>
    );
  }

  const kpis: { label: string; value: string | number; sub: string; tone?: 'warn' }[] = [
    { label: 'Parts declared', value: `${active.length - unknown} of ${active.length}`, sub: 'with an evidenced answer' },
    { label: 'No declaration', value: unknown, sub: 'not known to be PFAS-free', tone: unknown ? 'warn' : undefined },
    { label: 'Intentionally added PFAS', value: added, sub: `${substanceIndex.length} distinct substance${substanceIndex.length === 1 ? '' : 's'}` },
    { label: 'Declarations to renew', value: stale, sub: `older than ${STALE_MONTHS} months`, tone: stale ? 'warn' : undefined },
    ...byRegime.map(({ g, parts }) => ({
      label: g.code === 'EPA-PFAS-TSCA' ? 'US imports to review (TSCA)' : g.code === 'US-MN' ? 'Minnesota: report' : g.code === 'US-ME' ? 'Maine: 2032 prohibition' : g.code,
      value: parts.length, sub: g.code === 'US-MN' ? 'intentionally added, sold in MN' : g.code === 'US-ME' ? 'intentionally added, sold in ME' : 'PFAS parts imported into the US',
      tone: parts.length ? 'warn' as const : undefined,
    })),
  ];

  const openRow = rows.find((r) => r.p.id === open) ?? null;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <Breadcrumb current="PFAS" />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">PFAS</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Whether each part contains intentionally added PFAS, the substances and evidence, and which PFAS rules each part
            touches given where it is sold. These flag parts to check; they are not a legal determination. Record declarations
            in a part&rsquo;s PFAS tab, or here.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => download(`pfas-inventory-${now}.csv`, inventoryCsv(active, declarations, substances), 'text/csv')}>
          <Download size={13} className="mr-1.5" />PFAS inventory
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
          <TabsTrigger value="parts">Parts ({active.length})</TabsTrigger>
          <TabsTrigger value="regimes">Rules ({REGIMES.length})</TabsTrigger>
          <TabsTrigger value="substances">Substances ({substanceIndex.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="parts" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-60">
              <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search parts" className="pl-8 w-full" />
            </div>
            {([['all', 'All'], ['unknown', 'No declaration'], ['intentionally_added', 'Contains PFAS'], ['gaps', 'Needs attention']] as const).map(([k, l]) => (
              <Button key={k} size="sm" variant={filter === k ? 'default' : 'outline'} onClick={() => setFilter(k)}>{l}</Button>
            ))}
          </div>
          <div className="border border-gray-100 rounded-lg bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 text-left">
                <tr><th className="px-3 py-2">Part</th><th className="px-3 py-2">Answer</th><th className="hidden md:table-cell px-3 py-2">Markets</th><th className="hidden md:table-cell px-3 py-2">Rules to check</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {shown.length === 0 ? <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-500">No parts match.</td></tr> : shown.map(({ p, d, issues, regimes }) => (
                  <tr key={p.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(p.id)}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900">{p.part_number}</p>
                      {p.description && <p className="text-xs text-gray-500">{p.description}</p>}
                      <p className="md:hidden text-xs text-gray-500">{[d?.markets.join(', '), regimes.map((r) => r.code).join(', ')].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={(d?.status ?? 'unknown') === 'none' ? 'default' : d?.status === 'intentionally_added' ? 'warning' : 'secondary'}>
                        {d?.status === 'none' ? 'None' : d?.status === 'intentionally_added' ? 'Contains PFAS' : 'No declaration'}
                      </Badge>
                      {issues.length > 0 && (d?.status ?? 'unknown') !== 'unknown' && <p className="text-xs text-amber-700 mt-1">{issues.length} to check</p>}
                    </td>
                    <td className="hidden md:table-cell px-3 py-2 text-gray-700">{d?.markets.join(', ') || <span className="text-gray-400">—</span>}</td>
                    <td className="hidden md:table-cell px-3 py-2 text-gray-700">{regimes.map((r) => r.code).join(', ') || <span className="text-gray-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="regimes" className="mt-4 space-y-3">
          {byRegime.map(({ g, parts }) => (
            <Card key={g.code}><CardContent className="py-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-gray-900">{g.name}</p>
                <Badge variant={parts.length ? 'warning' : 'secondary'}>{parts.length} part{parts.length === 1 ? '' : 's'}</Badge>
              </div>
              <p className="text-sm text-gray-700">{g.summary}</p>
              {parts.length > 0 && <p className="text-xs text-gray-600">Parts: {parts.map((r) => r.p.part_number).join(', ')}</p>}
              <p className="text-[11px] text-gray-500 flex flex-wrap gap-x-3">
                {g.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">{s.label}<ExternalLink size={10} /></a>)}
                <span>Last verified {g.verified}</span>
              </p>
            </CardContent></Card>
          ))}
          <p className="text-xs text-gray-500">
            PFAS in food-contact packaging (EU, from 12 August 2026) is checked with packaging, on the PPWR dashboard. The EU
            universal PFAS restriction is still a proposal; the regulatory tracker follows it.
          </p>
        </TabsContent>

        <TabsContent value="substances" className="mt-4">
          {substanceIndex.length === 0 ? <p className="text-sm text-gray-500">No intentionally added PFAS recorded on any part.</p> : (
            <div className="border border-gray-100 rounded-lg bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 text-left"><tr><th className="px-3 py-2">Substance</th><th className="px-3 py-2">CAS number</th><th className="px-3 py-2">Parts</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {substanceIndex.map((s) => (
                    <tr key={`${s.cas}-${s.name}`}>
                      <td className="px-3 py-2 text-gray-900">{s.name}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">{s.cas ?? <span className="font-sans text-amber-700">missing</span>}</td>
                      <td className="px-3 py-2 text-gray-700">{[...s.parts].map((id) => partName.get(id)).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!openRow} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        {openRow && (
          <DrawerContent className="max-w-2xl">
            <DeclarationForm key={openRow.p.id} declaration={openRow.d} substances={substances} productId={openRow.p.id}
              supplierId={openRow.p.supplier_id} suppliers={suppliers} canEdit={canEdit}
              onCancel={() => setOpen(null)} onSaved={() => { setOpen(null); router.refresh(); }} />
          </DrawerContent>
        )}
      </Dialog>
    </div>
  );
}
