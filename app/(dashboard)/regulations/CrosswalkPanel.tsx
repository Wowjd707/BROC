'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  ExternalLink, ChevronDown, ArrowRight, TriangleAlert, GitMerge, Link2,
} from 'lucide-react';
import {
  watchlist, edgesFor, relationshipConfidence,
  RELATION_LABELS, RELATION_TONE,
  type RegulatoryRelationship, type RegulatoryFramework,
} from '@/lib/regulatory-crosswalk-core';
import { CONFIDENCE_META, STALENESS_META, staleness } from '@/lib/regulatory-core';
import { FrameworkDot } from './FrameworkChrome';

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

interface Props {
  frameworks: RegulatoryFramework[];
  relationships: RegulatoryRelationship[];
  /** code → display name, for both frameworks and standalone items. */
  names: Record<string, string>;
  /** code → framework accent colour, so an edge is recognisable by colour too. */
  accents: Record<string, string>;
  today: string;
}

const TONE_STYLE = {
  conflict:   'border-amber-200 bg-amber-50',
  dependency: 'border-blue-100 bg-blue-50/50',
  neutral:    'border-gray-200 bg-white',
} as const;

const TONE_ICON = {
  conflict: TriangleAlert,
  dependency: Link2,
  neutral: GitMerge,
} as const;

export function CrosswalkPanel({ frameworks, relationships, names, accents, today }: Props) {
  const binds = useMemo(() => watchlist(relationships), [relationships]);
  const rest = useMemo(
    () => relationships
      .filter((r) => !binds.includes(r))
      .sort((a, b) => a.display_order - b.display_order),
    [relationships, binds],
  );

  const label = (code: string) => names[code] ?? code;
  const accent = (code: string) => accents[code];

  if (relationships.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-gray-500">
            No relationships recorded yet. These are seeded as data — see
            <code className="mx-1 text-xs bg-gray-100 px-1 py-0.5 rounded">regulatory_relationships</code>
            and <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">docs/REGULATORY_CONTENT.md</code>.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Why this view exists, stated once. A crosswalk is unusual enough that
          a reader deserves to know what they are looking at. */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-600">
          How these regimes interact. Any single tracker will tell you that a rule
          changed; what it cannot tell you is where two rules answer the same
          question differently — which is where the work hides.
        </p>
      </div>

      {binds.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Divergence watchlist</h3>
            <span className="text-xs text-gray-500">
              {binds.length} place{binds.length === 1 ? '' : 's'} where you must satisfy
              both rules and cannot with one answer
            </span>
          </div>
          {binds.map((r) => (
            <RelationshipCard
              key={`${r.from_code}-${r.to_code}-${r.relation}`}
              relationship={r} label={label} accent={accent} today={today} leading
            />
          ))}
        </section>
      )}

      {rest.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">How they relate</h3>
          {rest.map((r) => (
            <RelationshipCard
              key={`${r.from_code}-${r.to_code}-${r.relation}`}
              relationship={r} label={label} accent={accent} today={today}
            />
          ))}
        </section>
      )}

      {frameworks.length > 0 && (
        <p className="text-xs text-gray-500">
          {frameworks.length} frameworks tracked. Open any regime above to see the
          relationships that touch it.
        </p>
      )}
    </div>
  );
}

function RelationshipCard({
  relationship: r, label, accent, today, leading = false,
}: {
  relationship: RegulatoryRelationship;
  label: (code: string) => string;
  accent: (code: string) => string | undefined;
  today: string;
  leading?: boolean;
}) {
  const [open, setOpen] = useState(leading);
  const tone = leading ? 'conflict' : RELATION_TONE[r.relation];
  const Icon = TONE_ICON[tone];

  // Aged, not stated. A crosswalk claim decays like any other — arguably
  // faster, since a divergence is usually resolved by one side moving.
  const effective = relationshipConfidence(r, today);
  const decayed = effective !== r.confidence;
  const age = staleness(r.last_verified, today);

  return (
    <div className={cn('rounded-xl border p-4', TONE_STYLE[tone])}>
      <div className="flex items-start gap-3">
        <Icon className={cn(
          'h-4 w-4 mt-0.5 shrink-0',
          tone === 'conflict' ? 'text-amber-600'
            : tone === 'dependency' ? 'text-blue-600' : 'text-gray-400',
        )} />

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
            <span className="inline-flex items-center gap-1.5 font-medium text-gray-900">
              <FrameworkDot color={accent(r.from_code)} size={8} />
              {label(r.from_code)}
            </span>
            <span className="inline-flex items-center gap-1 text-gray-500">
              <ArrowRight className="h-3 w-3" />
              {RELATION_LABELS[r.relation].outward.toLowerCase()}
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium text-gray-900">
              <FrameworkDot color={accent(r.to_code)} size={8} />
              {label(r.to_code)}
            </span>
          </div>

          <p className="text-sm font-medium text-gray-900">{r.title}</p>

          {r.is_watchlist && r.watchlist_detail && (
            <p className="text-sm text-amber-900">{r.watchlist_detail}</p>
          )}
          {(!r.is_watchlist || !r.watchlist_detail) && (
            <p className="text-sm text-gray-600">{r.note}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant={CONFIDENCE_META[effective].variant as BadgeVariant}>
              {CONFIDENCE_META[effective].label}
            </Badge>
            {decayed && (
              // Showing what it was, struck through, rather than silently
              // downgrading: the reader should see that the rating moved
              // because nobody re-checked, not because the facts changed.
              <span className="text-xs text-gray-400" title={STALENESS_META[age].label}>
                stated <s>{CONFIDENCE_META[r.confidence].label.toLowerCase()}</s>, aged
              </span>
            )}
            <span className="text-xs text-gray-500">verified {r.last_verified}</span>

            {(r.bullets.length > 0 || r.sources.length > 0) && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="ml-auto inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
              >
                {open ? 'Less' : 'Detail'}
                <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
              </button>
            )}
          </div>

          {open && (
            <div className="space-y-3 pt-2 border-t border-black/5">
              {r.bullets.length > 0 && (
                <ul className="space-y-1.5">
                  {r.bullets.map((b, i) => (
                    <li key={i} className="text-sm text-gray-700 flex gap-2">
                      <span className="text-gray-400 shrink-0">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}

              {r.sources.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Sources
                  </p>
                  {/* A relationship usually has no citation of its own, so these
                      are the instruments at each end. Saying so is the honest
                      framing — the reader should not think somebody published a
                      sentence asserting this. */}
                  <p className="text-xs text-gray-500 mb-2">
                    The instruments at each end. The relationship itself is a
                    reading of both, not a claim either body published.
                  </p>
                  <ul className="space-y-1">
                    {r.sources.map((s) => (
                      <li key={s.url}>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
                        >
                          {s.label}
                          <ExternalLink className="h-3 w-3" />
                          {s.dated && <span className="text-gray-400">{s.dated}</span>}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The relationships touching one regime, for the item detail view.
 *
 * Separate component because the framing differs: on the crosswalk tab the
 * reader is surveying, here they have already opened a rule and want to know
 * what else it drags in.
 */
export function RelatedRegimes({
  code, relationships, names, today,
}: {
  code: string;
  relationships: RegulatoryRelationship[];
  names: Record<string, string>;
  today: string;
}) {
  const edges = useMemo(() => edgesFor(code, relationships), [code, relationships]);
  if (edges.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
        Related regimes
      </p>
      <ul className="space-y-1.5">
        {edges.map((e) => (
          <li
            key={`${e.relationship.from_code}-${e.relationship.to_code}-${e.relationship.relation}`}
            className="text-sm flex flex-wrap items-baseline gap-x-2"
          >
            <span className={cn(
              'text-xs',
              e.tone === 'conflict' ? 'text-amber-700 font-medium' : 'text-gray-500',
            )}>
              {e.label}
            </span>
            <span className="text-gray-900">{names[e.otherCode] ?? e.otherCode}</span>
            {e.relationship.is_watchlist && (
              <span className="text-xs text-amber-700">· on the watchlist</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
