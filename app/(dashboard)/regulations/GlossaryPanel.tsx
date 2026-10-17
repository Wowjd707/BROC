'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { sortGlossary, type GlossaryTerm } from '@/lib/regulatory-crosswalk-core';

/**
 * Terms and acronyms.
 *
 * Worth a panel of its own because acronym density is the first barrier a
 * newcomer to this field hits, and it is a barrier before any of the content
 * is actually hard. A sustainability team is exactly where newcomers arrive.
 */
export function GlossaryPanel({ terms }: { terms: GlossaryTerm[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = sortGlossary(terms);
    if (!q) return sorted;
    return sorted.filter((t) =>
      t.term.toLowerCase().includes(q)
      || (t.expansion ?? '').toLowerCase().includes(q)
      || t.definition.toLowerCase().includes(q));
  }, [terms, query]);

  const acronyms = filtered.filter((t) => t.is_acronym);
  const words = filtered.filter((t) => !t.is_acronym);

  if (terms.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-gray-500">
            No glossary terms seeded. These are data — see
            <code className="mx-1 text-xs bg-gray-100 px-1 py-0.5 rounded">regulatory_glossary</code>.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search terms and acronyms"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-gray-500">Nothing matches “{query}”.</p>
      )}

      {acronyms.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Acronyms <span className="text-xs font-normal text-gray-500">({acronyms.length})</span>
          </h3>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {acronyms.map((t) => (
              <div key={t.term} className="min-w-0">
                <dt className="text-sm font-medium text-gray-900">
                  {t.term}
                  {t.expansion && (
                    <span className="ml-2 font-normal text-gray-500">{t.expansion}</span>
                  )}
                </dt>
                {/* The expansion is usually the whole answer for an acronym, so
                    the definition only earns space when it says something the
                    expansion does not. */}
                {t.definition && t.definition !== `${t.term} stands for ${t.expansion}.` && (
                  <dd className="text-sm text-gray-600 mt-0.5">{t.definition}</dd>
                )}
              </div>
            ))}
          </dl>
        </section>
      )}

      {words.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Terms <span className="text-xs font-normal text-gray-500">({words.length})</span>
          </h3>
          <dl className="space-y-3">
            {words.map((t) => (
              <div key={t.term}>
                <dt className="text-sm font-medium text-gray-900">{t.term}</dt>
                <dd className="text-sm text-gray-600 mt-0.5">{t.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
