'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  buildUnitTree, flattenUnitTree, encodeScope, parseScope,
} from '@/lib/scope-filter-core';
import { Building2, ChevronDown, Layers, MapPin, Boxes, Settings2 } from 'lucide-react';

interface Props {
  sites: { id: string; name: string; business_unit_id?: string | null }[];
  units: { id: string; parent_id: string | null; name: string; sort_order?: number }[];
  groups: { id: string; name: string }[];
}

/**
 * Reporting-scope selector.
 *
 * The selection lives in the URL rather than React state so that server
 * components can read it and filter at the query — and so a filtered view is
 * shareable and survives a refresh. Changing scope is a navigation.
 */
export function ScopePicker({ sites, units, groups }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const current = parseScope(searchParams.get('scope'));
  const unitNodes = flattenUnitTree(buildUnitTree(units));

  const label =
    current.kind === 'all' ? 'All sites'
    : current.kind === 'site' ? sites.find(s => s.id === current.id)?.name ?? 'Unknown site'
    : current.kind === 'business_unit' ? units.find(u => u.id === current.id)?.name ?? 'Unknown unit'
    : groups.find(g => g.id === current.id)?.name ?? 'Unknown group';

  function select(scope: Parameters<typeof encodeScope>[0]) {
    const params = new URLSearchParams(searchParams.toString());
    const encoded = encodeScope(scope);
    if (encoded === 'all') params.delete('scope');
    else params.set('scope', encoded);

    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  }

  const isActive = (kind: string, id?: string) =>
    current.kind === kind && (id === undefined || current.id === id);

  const itemClass = (active: boolean) =>
    cn(
      'w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-gray-50',
      active ? 'text-emerald-700 font-medium bg-emerald-50' : 'text-gray-700',
    );

  return (
    <div className="mt-3 relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-sm"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Building2 size={14} className="text-gray-500 flex-shrink-0" />
          <span className="text-gray-700 truncate">{label}</span>
        </div>
        <ChevronDown
          size={14}
          className={cn('text-gray-400 flex-shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <>
          {/* Click-away layer */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 max-h-96 overflow-y-auto">
            <button onClick={() => select({ kind: 'all' })} className={itemClass(isActive('all'))}>
              All sites
            </button>

            {units.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                  <Layers size={10} /> Business units
                </div>
                {unitNodes.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => select({ kind: 'business_unit', id: u.id })}
                    className={itemClass(isActive('business_unit', u.id))}
                    style={{ paddingLeft: `${12 + u.depth * 12}px` }}
                  >
                    {u.name}
                  </button>
                ))}
              </>
            )}

            {groups.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                  <Boxes size={10} /> Groups
                </div>
                {groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => select({ kind: 'group', id: g.id })}
                    className={itemClass(isActive('group', g.id))}
                  >
                    {g.name}
                  </button>
                ))}
              </>
            )}

            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <MapPin size={10} /> Sites
            </div>
            {sites.map((s) => (
              <button
                key={s.id}
                onClick={() => select({ kind: 'site', id: s.id })}
                className={itemClass(isActive('site', s.id))}
              >
                {s.name}
                {!s.business_unit_id && (
                  <span className="block text-[10px] text-amber-600">No business unit</span>
                )}
              </button>
            ))}

            {/* The picker is where you notice a site is missing or mislabelled,
                so it is also where the way to fix that should be. */}
            <div className="border-t border-gray-100 mt-1 pt-1">
              <Link
                href="/settings?tab=sites"
                onClick={() => setOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                <Settings2 size={13} className="text-gray-400" />
                Manage sites
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
