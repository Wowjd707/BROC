'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, ChevronRight } from 'lucide-react';
import { countryName } from '@/lib/eudr-core';
import { embeddedEmissions, importIssues, yearOf, summariseYear, type ImportRow } from '@/lib/cbam-core';

const t = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * CBAM inside a part: each import of it, with its embedded emissions. The
 * threshold and the annual declaration span all parts, so they live on the
 * CBAM dashboard; this shows the part's share of them.
 */
export function CbamPartPanel({
  productId, imports, canEdit, onOpenImport,
}: {
  productId: string;
  imports: ImportRow[];
  canEdit: boolean;
  onOpenImport: (id: string | null) => void;
}) {
  const mine = imports.filter((i) => i.product_id === productId).sort((a, b) => b.import_date.localeCompare(a.import_date));
  const year = new Date().getFullYear();
  const thisYear = summariseYear(mine, year);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Imports</p>
          <p className="text-xs text-gray-500">Each release for free circulation, with the emissions embedded in it.</p>
        </div>
        {canEdit && <Button size="sm" onClick={() => onOpenImport(null)}><Plus size={13} className="mr-1" />Record import</Button>}
      </div>

      {mine.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            [`${t(thisYear.thresholdMass)} t`, `imported in ${year}`],
            [`${t(thisYear.embedded)} t`, 'CO₂e embedded'],
            [String(thisYear.incomplete), 'missing emissions'],
          ].map(([v, l]) => (
            <div key={l} className="rounded-md bg-gray-50 px-2 py-2">
              <p className="text-base font-semibold text-gray-900">{v}</p>
              <p className="text-[11px] text-gray-500">{l}</p>
            </div>
          ))}
        </div>
      )}

      {mine.length === 0 ? (
        <p className="text-sm text-gray-500 rounded-md border border-dashed border-gray-200 px-3 py-3">
          No imports of this part recorded. Record each one from the customs declaration; the supplier&rsquo;s latest CBAM answers fill in the emissions.
        </p>
      ) : (
        <ul className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
          {mine.map((i) => {
            const e = embeddedEmissions(i);
            const blocks = importIssues(i).filter((x) => x.level === 'block').length;
            return (
              <li key={i.id}>
                <button className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50" onClick={() => onOpenImport(i.id)}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-gray-900">{i.import_date}{i.customs_reference ? ` · ${i.customs_reference}` : ''}</span>
                    <span className="block text-xs text-gray-500 truncate">
                      {t(Number(i.quantity))} {i.unit === 'MWh' ? 'MWh' : 't'} from {countryName(i.country_of_origin)}{i.installation_name ? ` · ${i.installation_name}` : ''}
                    </span>
                  </span>
                  {blocks > 0 ? <Badge variant="warning">Emissions missing</Badge>
                    : <span className="text-sm text-gray-700 whitespace-nowrap">{t(e!.total)} t CO₂e</span>}
                  {yearOf(i) < year && <span className="text-xs text-gray-400">{yearOf(i)}</span>}
                  <ChevronRight size={14} className="text-gray-300" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
