'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, XCircle, ExternalLink } from 'lucide-react';
import {
  STATUS_LABEL, BASIS_LABEL, declarationIssues, regimesFor, type DeclarationRow, type SubstanceRow,
} from '@/lib/pfas-core';
import { today } from '../eudr/types';

/**
 * PFAS inside a part: the declaration, its substances, what it still lacks,
 * and which PFAS rules the part touches given where it is sold.
 */
export function PfasPartPanel({
  product, declaration, substances, canEdit, onEdit,
}: {
  product: { id: string; country_of_origin: string | null };
  declaration: DeclarationRow | null;
  substances: SubstanceRow[];
  canEdit: boolean;
  onEdit: () => void;
}) {
  const mine = declaration ? substances.filter((s) => s.declaration_id === declaration.id) : [];
  const issues = declarationIssues(declaration, substances, today());
  const regimes = regimesFor(declaration, product);
  const status = declaration?.status ?? 'unknown';

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">Declaration</p>
            <p className="text-xs text-gray-500">Whether the part contains intentionally added PFAS, and on what evidence.</p>
          </div>
          {canEdit && <Button size="sm" onClick={onEdit}>{declaration ? 'Edit' : 'Record declaration'}</Button>}
        </div>
        <div className="rounded-lg border border-gray-100 px-3 py-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge variant={status === 'none' ? 'default' : status === 'intentionally_added' ? 'warning' : 'secondary'}>{STATUS_LABEL[status]}</Badge>
          </div>
          {declaration && status !== 'unknown' && (
            <p className="text-xs text-gray-600">
              {declaration.basis ? BASIS_LABEL[declaration.basis] : ''}{declaration.evidence ? ` · ${declaration.evidence}` : ''}{declaration.declared_on ? ` · ${declaration.declared_on}` : ''}
            </p>
          )}
          <p className="text-xs text-gray-600">Markets: {declaration?.markets.length ? declaration.markets.join(', ') : <span className="text-gray-400">none recorded</span>}</p>
        </div>
        {issues.length > 0 && (
          <ul className="space-y-1.5 mt-3">
            {issues.map((i) => (
              <li key={i.message} className={`text-sm flex gap-2 ${i.level === 'block' ? 'text-red-700' : 'text-amber-700'}`}>
                {i.level === 'block' ? <XCircle size={15} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5" />}{i.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      {mine.length > 0 && (
        <section>
          <p className="text-sm font-semibold text-gray-900 mb-2">Substances</p>
          <ul className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
            {mine.map((s) => (
              <li key={s.id} className="px-3 py-2">
                <p className="text-sm text-gray-900">{s.name} {s.cas_number && <span className="font-mono text-xs text-gray-500">{s.cas_number}</span>}</p>
                <p className="text-xs text-gray-500">{[s.function, s.component, s.amount_low != null ? `${s.amount_low}${s.amount_high != null && Number(s.amount_high) !== Number(s.amount_low) ? `–${s.amount_high}` : ''} ${({ ppm: 'ppm', percent: '%', mg_per_unit: 'mg per unit' })[s.amount_unit ?? 'ppm']}` : null].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <p className="text-sm font-semibold text-gray-900 mb-1">Rules to check</p>
        {regimes.length === 0 ? (
          <p className="text-sm text-gray-500">
            {status === 'intentionally_added' ? 'None of the PFAS rules BROC follows is triggered by the markets recorded.' : 'None, unless the part contains intentionally added PFAS.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {regimes.map((r) => (
              <li key={r.code} className="rounded-md bg-amber-50 border border-amber-100 px-3 py-2.5">
                <p className="text-sm font-medium text-gray-900">{r.name}</p>
                <p className="text-xs text-gray-700 mt-1">{r.summary}</p>
                <p className="text-[11px] text-gray-500 mt-1.5 flex flex-wrap gap-x-3">
                  {r.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">{s.label}<ExternalLink size={10} /></a>)}
                  <span>Last verified {r.verified}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
