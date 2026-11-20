'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { countries, countryName } from '@/lib/eudr-core';

/** Pick one or more countries by typing a name or code. Stores ISO 3166 alpha-2 codes. */
export function CountryPicker({
  value, onChange, multiple = true, placeholder = 'Type a country',
}: { value: string[]; onChange: (codes: string[]) => void; multiple?: boolean; placeholder?: string }) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return countries()
      .filter((c) => !value.includes(c.code) && (c.name.toLowerCase().includes(s) || c.code.toLowerCase() === s))
      .slice(0, 8);
  }, [q, value]);

  function add(code: string) {
    onChange(multiple ? [...value, code] : [code]);
    setQ('');
  }

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-800 text-xs px-2 py-0.5">
              {countryName(c)} <span className="text-emerald-600/70">{c}</span>
              <button type="button" onClick={() => onChange(value.filter((x) => x !== c))} aria-label={`Remove ${countryName(c)}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {(multiple || value.length === 0) && (
        <div className="relative">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
            onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { e.preventDefault(); add(matches[0].code); } }} />
          {matches.length > 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-md max-h-56 overflow-y-auto">
              {matches.map((c) => (
                <button key={c.code} type="button" onClick={() => add(c.code)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 flex justify-between">
                  <span>{c.name}</span><span className="text-gray-400 text-xs">{c.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
