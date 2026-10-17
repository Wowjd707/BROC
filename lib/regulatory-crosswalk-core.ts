/**
 * The crosswalk: how tracked regimes relate to one another.
 *
 * This is the part of the tracker a team cannot assemble from eleven separate
 * newsletters. Any one of them will tell you that CSRD changed. None will tell
 * you that California references a frozen GHG Protocol version while the GHG
 * Protocol rewrites it, because that fact lives *between* two regimes and
 * belongs to neither.
 *
 * Pure and dependency-free, like the rest of `*-core.ts`: the logic worth
 * getting right is the logic that runs without a database.
 */

import { effectiveConfidence, type Confidence, type RegulatorySource } from './regulatory-core';

export type RelationKind =
  | 'merging_with'
  | 'references'
  | 'depends_on'
  | 'aligns_with'
  | 'diverges_from'
  | 'watch';

export const RELATION_KINDS: RelationKind[] = [
  'merging_with', 'references', 'depends_on', 'aligns_with', 'diverges_from', 'watch',
];

/**
 * Relationships are stored directionally but read from both ends, and for two
 * of the six the direction carries the meaning: California *references* the
 * GHG Protocol, and the GHG Protocol is *referenced by* California — those are
 * different sentences about different obligations.
 *
 * For the symmetric kinds both phrasings are the same, which is not an
 * oversight: "merging with" reads correctly whichever end you are standing at.
 */
export const RELATION_LABELS: Record<RelationKind, { outward: string; inward: string }> = {
  merging_with:  { outward: 'Merging with',   inward: 'Merging with' },
  references:    { outward: 'References',     inward: 'Referenced by' },
  depends_on:    { outward: 'Depends on',     inward: 'Depended on by' },
  aligns_with:   { outward: 'Aligns with',    inward: 'Aligns with' },
  diverges_from: { outward: 'Diverges from',  inward: 'Diverges from' },
  watch:         { outward: 'Watch',          inward: 'Watch' },
};

/** Rendering weight. A divergence is the one that costs money to discover late. */
export const RELATION_TONE: Record<RelationKind, 'conflict' | 'dependency' | 'neutral'> = {
  merging_with:  'neutral',
  references:    'dependency',
  depends_on:    'dependency',
  aligns_with:   'neutral',
  diverges_from: 'conflict',
  watch:         'neutral',
};

export interface RegulatoryRelationship {
  from_code: string;
  to_code: string;
  relation: RelationKind;
  title: string;
  note: string;
  bullets: string[];
  is_watchlist: boolean;
  watchlist_detail: string | null;
  confidence: Confidence;
  sources: RegulatorySource[];
  last_verified: string;
  display_order: number;
}

export interface RegulatoryFramework {
  code: string;
  name: string;
  short_name: string | null;
  publisher: string;
  domain: string;
  tagline: string | null;
  description: string | null;
  status_headline: string | null;
  accent_color: string | null;
  display_order: number;
}

export interface GlossaryTerm {
  term: string;
  expansion: string | null;
  definition: string;
  is_acronym: boolean;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

function asSources(value: unknown): RegulatorySource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): RegulatorySource[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const s = raw as Record<string, unknown>;
    if (typeof s.url !== 'string' || s.url.length === 0) return [];
    return [{
      url: s.url,
      label: typeof s.label === 'string' && s.label ? s.label : s.url,
      dated: typeof s.dated === 'string' ? s.dated : '',
    }];
  });
}

function isRelationKind(value: unknown): value is RelationKind {
  return typeof value === 'string' && (RELATION_KINDS as string[]).includes(value);
}

/**
 * Coerce a database row, validating the JSONB rather than casting it.
 *
 * Returns null for a row whose `relation` is not one we render. A relationship
 * kind this build does not understand is dropped rather than guessed at: an
 * edge drawn with the wrong verb asserts something about two regimes that
 * nobody wrote.
 */
export function toRelationship(row: {
  from_code: string; to_code: string; relation: string; title: string;
  note: string; bullets: unknown; is_watchlist: boolean;
  watchlist_detail: string | null; confidence: string;
  sources: unknown; last_verified: string; display_order: number;
}): RegulatoryRelationship | null {
  if (!isRelationKind(row.relation)) return null;
  return {
    from_code: row.from_code,
    to_code: row.to_code,
    relation: row.relation,
    title: row.title,
    note: row.note,
    bullets: asStringArray(row.bullets),
    is_watchlist: row.is_watchlist,
    watchlist_detail: row.watchlist_detail,
    confidence: row.confidence as Confidence,
    sources: asSources(row.sources),
    last_verified: row.last_verified,
    display_order: row.display_order,
  };
}

/** One end of a relationship, seen from a particular code. */
export interface CrosswalkEdge {
  relationship: RegulatoryRelationship;
  /** The code at the far end. */
  otherCode: string;
  /** True when this code is the `from` end. */
  outward: boolean;
  label: string;
  tone: 'conflict' | 'dependency' | 'neutral';
}

/**
 * Every relationship touching `code`, normalised so the caller never has to
 * care which column it was stored in.
 *
 * Sorted with conflicts first: if a team reads one line of this panel, the
 * line worth reading is the one where two rules disagree.
 */
export function edgesFor(
  code: string,
  relationships: RegulatoryRelationship[],
): CrosswalkEdge[] {
  const toneOrder = { conflict: 0, dependency: 1, neutral: 2 };
  return relationships
    .filter((r) => r.from_code === code || r.to_code === code)
    .map((r): CrosswalkEdge => {
      const outward = r.from_code === code;
      return {
        relationship: r,
        otherCode: outward ? r.to_code : r.from_code,
        outward,
        label: outward
          ? RELATION_LABELS[r.relation].outward
          : RELATION_LABELS[r.relation].inward,
        tone: RELATION_TONE[r.relation],
      };
    })
    .sort((a, b) =>
      toneOrder[a.tone] - toneOrder[b.tone]
      || a.relationship.display_order - b.relationship.display_order);
}

/**
 * The divergence watchlist: relationships where a company must satisfy both
 * ends and cannot with one answer.
 *
 * Only rows carrying an explanation qualify. The database enforces the same
 * rule with a CHECK, and this repeats it rather than trusting it, because a
 * flagged divergence with nothing to say about the bind reads as a warning
 * with no content — worse than not flagging it.
 */
export function watchlist(relationships: RegulatoryRelationship[]): RegulatoryRelationship[] {
  return relationships
    .filter((r) => r.is_watchlist && !!r.watchlist_detail?.trim())
    .sort((a, b) => a.display_order - b.display_order);
}

/**
 * Relationship confidence, aged.
 *
 * Crosswalk claims decay exactly as item claims do — arguably faster, since a
 * divergence is usually resolved by one side moving. Reusing the item rule
 * rather than inventing a second one keeps a single answer to "how old is too
 * old" across the module.
 */
export function relationshipConfidence(
  relationship: RegulatoryRelationship,
  today: string,
): Confidence {
  return effectiveConfidence(relationship.confidence, relationship.last_verified, today);
}

/** Frameworks in display order, each with the items that belong to it. */
export function groupByFramework<T extends { framework_code: string | null; display_order: number }>(
  frameworks: RegulatoryFramework[],
  items: T[],
): { framework: RegulatoryFramework; items: T[] }[] {
  return [...frameworks]
    .sort((a, b) => a.display_order - b.display_order)
    .map((framework) => ({
      framework,
      items: items
        .filter((i) => i.framework_code === framework.code)
        .sort((a, b) => a.display_order - b.display_order),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Items belonging to no framework.
 *
 * Kept deliberately visible rather than hidden: a standalone instrument with
 * no parent body is legitimate, and silently dropping it from a grouped view
 * would make the tracker look like it covers less than it does.
 */
export function ungrouped<T extends { framework_code: string | null; display_order: number }>(
  items: T[],
): T[] {
  return items
    .filter((i) => !i.framework_code)
    .sort((a, b) => a.display_order - b.display_order);
}

/** Acronyms and terms, each alphabetical, acronyms first. */
export function sortGlossary(terms: GlossaryTerm[]): GlossaryTerm[] {
  return [...terms].sort((a, b) => {
    if (a.is_acronym !== b.is_acronym) return a.is_acronym ? -1 : 1;
    return a.term.localeCompare(b.term);
  });
}
