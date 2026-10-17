/**
 * Regulatory tracker — presentation logic for tracked ESG regimes.
 *
 * Mirrors `regulatory_items` (migration 024). Pure and dependency-free so it is
 * unit-testable, and so the rules about how a claim is *presented* are testable
 * separately from the claims themselves.
 *
 * The theme running through this file is that the tracker's value is not the
 * content — anyone can paste a deadline into a table — but its honesty about
 * how much each entry can be relied on. Two mechanisms carry that:
 *
 *   1. `confidence`, set when the entry is written.
 *   2. `staleness`, computed from `last_verified` at read time.
 *
 * The second is the one that decays. A "confirmed" entry checked in March is
 * not a confirmed entry in September — regulatory status moves, and a tracker
 * that hides its own age is worse than no tracker, because it converts a
 * user's healthy uncertainty into false confidence.
 */

/**
 * The domain a rule governs — what it is about, not where it applies.
 *
 * Geography lives in `jurisdiction`. Migration 024 conflated the two
 * ('ghg_accounting' | 'eu' | 'us' | 'other'), which filed PFAS, packaging and
 * deforestation under "eu" and hid all three from anyone filtering for the
 * subject they actually work on. Migration 033 separated them.
 *
 * Kept in the same order as CATEGORY_ORDER below, which is the reading order:
 * how you measure, then what you must publish, then what you must commit to,
 * then the product-side regimes.
 */
export type RegulatoryCategory =
  | 'carbon_accounting'
  | 'disclosure'
  | 'targets'
  | 'carbon_border'
  | 'chemicals'
  | 'packaging'
  | 'deforestation'
  | 'due_diligence'
  | 'product_stewardship'
  | 'other';

export type RegulatoryStage =
  | 'drafting' | 'consultation_open' | 'consultation_closed'
  | 'proposed' | 'in_negotiation' | 'adopted' | 'finalised'
  | 'in_force' | 'applying' | 'stayed' | 'enjoined'
  | 'vacated' | 'repealed' | 'withdrawn';

export type Confidence = 'confirmed' | 'high' | 'medium' | 'low';

export interface RegulatorySource {
  label: string;
  url: string;
  dated: string;
}

export interface RegulatoryItem {
  code: string;
  name: string;
  category: RegulatoryCategory;
  /**
   * The framework this workstream sits under, or null for a standalone
   * instrument with no parent body — a real category, not a gap in the data.
   */
  framework_code: string | null;
  jurisdiction: string;
  topics: string[];
  stage: RegulatoryStage;
  status_summary: string;
  key_points: string[];
  next_milestone: string | null;
  next_milestone_date: string | null;
  next_milestone_note: string | null;
  confidence: Confidence;
  confidence_note: string | null;
  sources: RegulatorySource[];
  last_verified: string;
  display_order: number;
}

/**
 * Coerce a database row into a `RegulatoryItem`.
 *
 * `key_points` and `sources` are JSONB, which the generated types surface as
 * `Json` — i.e. "could be anything". A blind cast would compile and then throw
 * at render time the first time a row was hand-edited into the wrong shape,
 * which for a table deploying organizations are explicitly invited to UPDATE is a question of
 * when, not whether.
 *
 * So this validates instead: malformed entries degrade to empty rather than
 * crashing the page. A source without a usable `url` is dropped, because an
 * unclickable citation is worse than a visibly absent one — it looks like
 * provenance without being provenance.
 */
export function toRegulatoryItem(row: {
  code: string; name: string; category: string; jurisdiction: string;
  framework_code?: string | null;
  topics: string[] | null; stage: string; status_summary: string;
  key_points: unknown; next_milestone: string | null;
  next_milestone_date: string | null; next_milestone_note: string | null;
  confidence: string; confidence_note: string | null;
  sources: unknown; last_verified: string; display_order: number;
}): RegulatoryItem {
  const keyPoints = Array.isArray(row.key_points)
    ? row.key_points.filter((p): p is string => typeof p === 'string')
    : [];

  const sources = Array.isArray(row.sources)
    ? row.sources.flatMap((raw): RegulatorySource[] => {
        if (typeof raw !== 'object' || raw === null) return [];
        const s = raw as Record<string, unknown>;
        if (typeof s.url !== 'string' || s.url.length === 0) return [];
        return [{
          url: s.url,
          label: typeof s.label === 'string' && s.label ? s.label : s.url,
          dated: typeof s.dated === 'string' ? s.dated : '',
        }];
      })
    : [];

  return {
    code: row.code,
    name: row.name,
    category: row.category as RegulatoryCategory,
    // Optional on the way in so a caller selecting a narrower column set — and
    // every test fixture written before 033 — still type-checks.
    framework_code: row.framework_code ?? null,
    jurisdiction: row.jurisdiction,
    topics: row.topics ?? [],
    stage: row.stage as RegulatoryStage,
    status_summary: row.status_summary,
    key_points: keyPoints,
    next_milestone: row.next_milestone,
    next_milestone_date: row.next_milestone_date,
    next_milestone_note: row.next_milestone_note,
    confidence: row.confidence as Confidence,
    confidence_note: row.confidence_note,
    sources,
    last_verified: row.last_verified,
    display_order: row.display_order,
  };
}

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<RegulatoryCategory, string> = {
  carbon_accounting: 'Carbon accounting',
  disclosure: 'Disclosure',
  targets: 'Targets',
  carbon_border: 'Carbon border',
  chemicals: 'Chemicals',
  packaging: 'Packaging',
  deforestation: 'Deforestation',
  due_diligence: 'Due diligence',
  product_stewardship: 'Product stewardship',
  other: 'Other',
};

/** One line on what each domain covers, for the filter chips' title text. */
export const CATEGORY_DESCRIPTIONS: Record<RegulatoryCategory, string> = {
  carbon_accounting: 'How emissions are measured and reported',
  disclosure: 'What must be published, and to whom',
  targets: 'What must be committed to',
  carbon_border: 'Carbon priced at a frontier',
  chemicals: 'Substance restriction and notification',
  packaging: 'Packaging design, recyclate and waste',
  deforestation: 'Land-conversion due diligence',
  due_diligence: 'Human rights and environmental supply chain duty',
  product_stewardship: 'Take-back, EPR and end-of-life',
  other: 'Everything else tracked here',
};

/** Reading order: measure, publish, commit, then the product-side regimes. */
export const CATEGORY_ORDER: RegulatoryCategory[] = [
  'carbon_accounting', 'disclosure', 'targets', 'carbon_border',
  'chemicals', 'packaging', 'deforestation', 'due_diligence',
  'product_stewardship', 'other',
];

/**
 * Badge tone per stage, using the variants `components/ui/badge.tsx` already
 * defines. Tone encodes "does this bind me today?", not "is this good news":
 * green means a live obligation, not an achievement.
 */
export const STAGE_META: Record<RegulatoryStage, { label: string; variant: string }> = {
  drafting:             { label: 'In drafting',          variant: 'secondary' },
  consultation_open:    { label: 'Consultation open',    variant: 'blue' },
  consultation_closed:  { label: 'Consultation closed',  variant: 'secondary' },
  proposed:             { label: 'Proposed',             variant: 'secondary' },
  in_negotiation:       { label: 'In negotiation',       variant: 'secondary' },
  adopted:              { label: 'Adopted, not applying', variant: 'warning' },
  finalised:            { label: 'Final, not yet effective', variant: 'warning' },
  in_force:             { label: 'In force',             variant: 'default' },
  applying:             { label: 'Applying now',         variant: 'default' },
  stayed:               { label: 'Stayed',               variant: 'purple' },
  enjoined:             { label: 'Enjoined',             variant: 'purple' },
  vacated:              { label: 'Vacated',              variant: 'destructive' },
  repealed:             { label: 'Repealed',             variant: 'destructive' },
  withdrawn:            { label: 'Withdrawn',            variant: 'destructive' },
};

/** True when the regime imposes an obligation today, as opposed to eventually. */
export function isBindingNow(stage: RegulatoryStage): boolean {
  return stage === 'in_force' || stage === 'applying';
}

export const CONFIDENCE_META: Record<Confidence, { label: string; variant: string; meaning: string }> = {
  confirmed: {
    label: 'Confirmed', variant: 'default',
    meaning: 'The official published text says this — Official Journal, Federal Register, or the standard-setter’s own document.',
  },
  high: {
    label: 'High', variant: 'blue',
    meaning: 'An official announcement or agreed political text says this, but the binding instrument was not read directly.',
  },
  medium: {
    label: 'Medium', variant: 'warning',
    meaning: 'Credible secondary reporting, typically legal analysis of a text we did not read ourselves. Verify before relying on it.',
  },
  low: {
    label: 'Low', variant: 'secondary',
    meaning: 'Commentary or speculation. Directionally useful, not a basis for a compliance decision.',
  },
};

// ─── Staleness ───────────────────────────────────────────────────────────────

export type Staleness = 'fresh' | 'ageing' | 'stale';

export const STALENESS_META: Record<Staleness, { label: string; variant: string }> = {
  fresh:  { label: 'Recently verified', variant: 'secondary' },
  ageing: { label: 'Verify before use', variant: 'warning' },
  stale:  { label: 'Out of date',       variant: 'destructive' },
};

export const AGEING_AFTER_DAYS = 45;
export const STALE_AFTER_DAYS = 120;

export function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(fromISO + 'T00:00:00Z');
  const to = Date.parse(toISO + 'T00:00:00Z');
  if (Number.isNaN(from) || Number.isNaN(to)) return NaN;
  return Math.round((to - from) / 86_400_000);
}

/**
 * How much the age of an entry should temper its stated confidence.
 *
 * The thresholds are deliberately short. In a normal reference work, six months
 * is current; in this subject matter a deadline moved twice in 2026 alone, so
 * an entry nobody has re-read in six weeks already deserves a hedge.
 */
export function staleness(lastVerified: string, today: string): Staleness {
  const age = daysBetween(lastVerified, today);
  if (Number.isNaN(age)) return 'stale';
  if (age >= STALE_AFTER_DAYS) return 'stale';
  if (age >= AGEING_AFTER_DAYS) return 'ageing';
  return 'fresh';
}

/**
 * The confidence a reader should actually apply, after ageing.
 *
 * A stale entry is capped at 'medium' however confidently it was written: the
 * text may still be accurate, but nobody has checked, and "confirmed as of five
 * months ago" is a different claim from "confirmed". Never upgrades.
 */
export function effectiveConfidence(
  stated: Confidence,
  lastVerified: string,
  today: string,
): Confidence {
  const order: Confidence[] = ['low', 'medium', 'high', 'confirmed'];
  const cap: Record<Staleness, Confidence> = {
    fresh: 'confirmed',
    ageing: 'high',
    stale: 'medium',
  };
  const capped = cap[staleness(lastVerified, today)];
  return order.indexOf(stated) <= order.indexOf(capped) ? stated : capped;
}

// ─── Milestones ──────────────────────────────────────────────────────────────

export type MilestoneUrgency = 'past' | 'imminent' | 'near' | 'later' | 'undated';

export const IMMINENT_WITHIN_DAYS = 90;
export const NEAR_WITHIN_DAYS = 365;

/**
 * `undated` is a first-class answer, not a missing value. "No date has been
 * announced" is real, common, and materially different from "we don't know the
 * date" — conflating them would invent certainty the regulator has not offered.
 */
export function milestoneUrgency(dateISO: string | null, today: string): MilestoneUrgency {
  if (!dateISO) return 'undated';
  const days = daysBetween(today, dateISO);
  if (Number.isNaN(days)) return 'undated';
  if (days < 0) return 'past';
  if (days <= IMMINENT_WITHIN_DAYS) return 'imminent';
  if (days <= NEAR_WITHIN_DAYS) return 'near';
  return 'later';
}

export const URGENCY_META: Record<MilestoneUrgency, { label: string; variant: string }> = {
  past:     { label: 'Date passed',   variant: 'secondary' },
  imminent: { label: 'Within 90 days', variant: 'destructive' },
  near:     { label: 'Within a year',  variant: 'warning' },
  later:    { label: 'Beyond a year',  variant: 'secondary' },
  undated:  { label: 'No date announced', variant: 'outline' },
};

/** Upcoming milestones, soonest first. Undated and past items are excluded. */
export function upcomingMilestones(items: RegulatoryItem[], today: string): RegulatoryItem[] {
  return items
    .filter((i) => {
      const u = milestoneUrgency(i.next_milestone_date, today);
      return u === 'imminent' || u === 'near' || u === 'later';
    })
    .sort((a, b) => (a.next_milestone_date ?? '').localeCompare(b.next_milestone_date ?? ''));
}

// ─── Filtering and grouping ──────────────────────────────────────────────────

export interface TrackerFilters {
  category: RegulatoryCategory | 'all';
  topic: string | 'all';
  search: string;
  bindingOnly: boolean;
}

export function filterItems(items: RegulatoryItem[], f: TrackerFilters): RegulatoryItem[] {
  const needle = f.search.trim().toLowerCase();
  return items.filter((i) => {
    if (f.category !== 'all' && i.category !== f.category) return false;
    if (f.topic !== 'all' && !i.topics.includes(f.topic)) return false;
    if (f.bindingOnly && !isBindingNow(i.stage)) return false;
    if (!needle) return true;
    // Key points are searched too: practitioners look for "hourly matching" or
    // "de minimis", which live in the detail rather than the title.
    const haystack = [
      i.name, i.code, i.jurisdiction, i.status_summary,
      ...i.topics, ...i.key_points,
    ].join(' ').toLowerCase();
    return haystack.includes(needle);
  });
}

export function allTopics(items: RegulatoryItem[]): string[] {
  return Array.from(new Set(items.flatMap((i) => i.topics))).sort();
}

export function groupByCategory(
  items: RegulatoryItem[],
): { category: RegulatoryCategory; label: string; items: RegulatoryItem[] }[] {
  return CATEGORY_ORDER
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      items: items
        .filter((i) => i.category === category)
        .sort((a, b) => a.display_order - b.display_order),
    }))
    .filter((g) => g.items.length > 0);
}

export interface TrackerSummary {
  total: number;
  bindingNow: number;
  imminent: number;
  needsReverification: number;
}

export function summarise(items: RegulatoryItem[], today: string): TrackerSummary {
  return {
    total: items.length,
    bindingNow: items.filter((i) => isBindingNow(i.stage)).length,
    imminent: items.filter((i) => milestoneUrgency(i.next_milestone_date, today) === 'imminent').length,
    needsReverification: items.filter((i) => staleness(i.last_verified, today) !== 'fresh').length,
  };
}

/** e.g. "30 December 2026". Undated renders as a phrase, never an em dash. */
export function formatMilestoneDate(dateISO: string | null): string {
  if (!dateISO) return 'No date announced';
  const d = new Date(dateISO + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return 'No date announced';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}
