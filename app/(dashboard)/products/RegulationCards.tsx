'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import { REGULATIONS, type RegulationKey } from '@/lib/compliance-catalog';
import { regulationProgress, type ValueRow } from '@/lib/compliance-core';
import { summariseYear, type ImportRow } from '@/lib/cbam-core';

export interface RegulationStat { label: string; value: string; tone?: 'warn' }

/** The dashboards that exist. A regulation without one filters the list instead. */
export const DASHBOARDS: Partial<Record<RegulationKey, string>> = { eudr: '/products/eudr', cbam: '/products/cbam' };

const t = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

/**
 * One card per regulation with scope rules: how many parts it covers, how much
 * of their supplier data is current, and the regulation's own headline figures.
 */
export function RegulationCards({
  regulations, partsInScope, current, now, eudr, cbamImports, onFilter,
}: {
  regulations: RegulationKey[];
  partsInScope: Record<RegulationKey, string[]>;
  current: Map<string, ValueRow>;
  now: string;
  eudr: { ready: number; drafts: number; filed: number };
  cbamImports: ImportRow[];
  onFilter: (reg: RegulationKey) => void;
}) {
  if (regulations.length === 0) return null;
  const year = new Date().getFullYear();
  const cbam = summariseYear(cbamImports, year);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {regulations.map((reg) => {
        const ids = partsInScope[reg] ?? [];
        let have = 0, total = 0;
        for (const id of ids) {
          const p = regulationProgress(id, [reg], current, now)[0];
          if (p) { have += p.current + p.expiring; total += p.total; }
        }
        const stats: RegulationStat[] = [
          { label: 'parts in scope', value: String(ids.length) },
          { label: 'supplier data current', value: total ? `${Math.round((have / total) * 100)}%` : '—', tone: total && have < total ? 'warn' : undefined },
        ];
        if (reg === 'eudr') {
          stats.push({ label: 'ready to file', value: String(eudr.ready) });
          stats.push({ label: 'drafts to resolve', value: String(eudr.drafts - eudr.ready), tone: eudr.drafts - eudr.ready ? 'warn' : undefined });
        }
        if (reg === 'cbam') {
          stats.push({ label: `t imported in ${year} (of ${cbam.threshold.tonnes})`, value: t(cbam.thresholdMass), tone: cbam.exceeded ? 'warn' : undefined });
          stats.push({ label: 't CO₂e embedded', value: t(cbam.embedded) });
        }
        const href = DASHBOARDS[reg];
        return (
          <Card key={reg}><CardContent className="py-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{REGULATIONS[reg].label}</p>
                <p className="text-xs text-gray-500">{REGULATIONS[reg].name}</p>
              </div>
              {href ? (
                <Link href={href} className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1 whitespace-nowrap">
                  Dashboard <ArrowRight size={12} />
                </Link>
              ) : (
                <button className="text-xs text-emerald-700 hover:underline whitespace-nowrap" onClick={() => onFilter(reg)}>Show parts</button>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
              {stats.map((s) => (
                <div key={s.label}>
                  <dd className={`text-lg font-semibold leading-tight ${s.tone === 'warn' ? 'text-amber-700' : 'text-gray-900'}`}>{s.value}</dd>
                  <dt className="text-[11px] text-gray-500 leading-tight">{s.label}</dt>
                </div>
              ))}
            </dl>
          </CardContent></Card>
        );
      })}
    </div>
  );
}
