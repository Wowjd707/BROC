'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
   ExternalLink, ChevronDown, CalendarClock,
  Info, Search, CircleCheck, GitMerge, BookOpen, Layers,
} from 'lucide-react';
import { InfoBubble } from '@/components/ui/info-bubble';
import { WatchQueue, type Proposal, type WatchRun } from './WatchQueue';
import { CapabilityPanel } from './CapabilityPanel';
import { CrosswalkPanel } from './CrosswalkPanel';
import { GlossaryPanel } from './GlossaryPanel';
import {
  watchlist, groupByFramework, ungrouped,
  type RegulatoryFramework, type RegulatoryRelationship, type GlossaryTerm,
} from '@/lib/regulatory-crosswalk-core';
import {
  FrameworkDot, FrameworkKey, FrameworkFilter, FrameworkHeader, NEUTRAL_ACCENT,
} from './FrameworkChrome';
import type { RegimeReadiness } from '@/lib/capability-readiness-core';
import {
  CATEGORY_LABELS, CATEGORY_ORDER, STAGE_META, CONFIDENCE_META, STALENESS_META, URGENCY_META,
  staleness, effectiveConfidence, milestoneUrgency, upcomingMilestones,
  filterItems, groupByCategory, summarise, allTopics, formatMilestoneDate,
  type RegulatoryItem, type RegulatoryCategory,
} from '@/lib/regulatory-core';

interface Update {
  item_code: string;
  update_date: string;
  headline: string;
  detail: string | null;
  source_url: string;
}

interface Props {
  items: RegulatoryItem[];
  updates: Update[];
  today: string;
  proposals: Proposal[];
  lastRun: WatchRun | null;
  isAdmin: boolean;
  aiConfigured: boolean;
  aiModel: string | null;
  readiness: Record<string, RegimeReadiness>;
  reportingYear: number;
  frameworks: RegulatoryFramework[];
  relationships: RegulatoryRelationship[];
  glossary: GlossaryTerm[];
  /** code → display name, covering both frameworks and standalone workstreams. */
  names: Record<string, string>;
}

/**
 * Three views, not three pages.
 *
 * The crosswalk and the glossary are about the same content as the regime list
 * and are read in the same sitting — "what does CSRD say" and "what does CSRD
 * collide with" are one question asked twice. Splitting them onto their own
 * routes would make the second one something you have to already know to go
 * looking for.
 */
type TabKey = 'regimes' | 'crosswalk' | 'glossary';

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

const TOPIC_LABELS: Record<string, string> = {
  climate: 'Climate', disclosure: 'Disclosure', chemicals: 'Chemicals',
  packaging: 'Packaging', deforestation: 'Deforestation', due_diligence: 'Due diligence',
  value_chain: 'Value chain', trade: 'Trade', energy: 'Energy', land: 'Land',
  targets: 'Targets', social: 'Social', waste: 'Waste', water: 'Water',
  circularity: 'Circularity', claims: 'Claims', nature: 'Nature',
  offsets: 'Offsets', product: 'Product', product_stewardship: 'Product stewardship',
};

/**
 * Topics are free-form `text[]` on the row, so a content pack can introduce one
 * this build has never heard of. The fallback capitalises rather than printing
 * the raw slug, so a new topic reads as a label in the dropdown instead of as
 * the only lowercase entry in the list.
 */
const topicLabel = (t: string) => {
  const known = TOPIC_LABELS[t];
  if (known) return known;
  const words = t.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function RegulationsClient({
  items, updates, today, proposals, lastRun, isAdmin, aiConfigured, aiModel,
  readiness, reportingYear, frameworks, relationships, glossary, names,
}: Props) {
  const [tab, setTab] = useState<TabKey>('regimes');
  const [framework, setFramework] = useState<string>('all');
  // Framework is the default grouping because it is the one the flat list could
  // not express: five GHG Protocol workstreams reading as one body rewriting
  // itself. Domain stays available — it is the better lens when the question is
  // "what governs packaging" rather than "what is this body doing".
  const [groupBy, setGroupBy] = useState<'framework' | 'domain'>('framework');
  const [category, setCategory] = useState<RegulatoryCategory | 'all'>('all');
  const [topic, setTopic] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [bindingOnly, setBindingOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showLegend, setShowLegend] = useState(false);

  const filtered = useMemo(() => {
    const scoped = framework === 'all'
      ? items
      : items.filter((i) => i.framework_code === framework);
    return filterItems(scoped, { category, topic, search, bindingOnly });
  }, [items, framework, category, topic, search, bindingOnly]);

  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  // `groupByFramework` drops frameworks with nothing under them, so an empty
  // result set collapses to nothing rather than to a page of empty headings.
  const fwGroups = useMemo(
    () => groupByFramework(frameworks, filtered),
    [frameworks, filtered],
  );
  const standalone = useMemo(() => ungrouped(filtered), [filtered]);

  // Keyed by both framework and workstream code, because either may appear as
  // an end of a crosswalk edge and a reader should not have to know which kind
  // of thing they are looking at to recognise the colour.
  const accentByCode = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of frameworks) m[f.code] = f.accent_color ?? NEUTRAL_ACCENT;
    for (const i of items) {
      if (i.framework_code && m[i.framework_code]) m[i.code] = m[i.framework_code];
    }
    return m;
  }, [frameworks, items]);

  // Counted before the framework filter is applied, so the numbers on the chips
  // do not change as you click between them.
  const fwCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of items) {
      if (i.framework_code) m[i.framework_code] = (m[i.framework_code] ?? 0) + 1;
    }
    return m;
  }, [items]);
  const summary = useMemo(() => summarise(items, today), [items, today]);
  const upcoming = useMemo(() => upcomingMilestones(items, today).slice(0, 6), [items, today]);
  const topics = useMemo(() => allTopics(items), [items]);
  const binds = useMemo(() => watchlist(relationships), [relationships]);

  const updatesByItem = useMemo(() => {
    const m = new Map<string, Update[]>();
    for (const u of updates) {
      const list = m.get(u.item_code);
      if (list) list.push(u); else m.set(u.item_code, [u]);
    }
    return m;
  }, [updates]);

  function toggle(code: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  const oldestVerified = items.reduce<string | null>(
    (acc, i) => (acc === null || i.last_verified < acc ? i.last_verified : acc), null,
  );

  return (
    <div className="p-6 lg:p-8 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Regulatory tracker</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            Where each ESG regime actually stands, what happens next, and how far each
            answer can be trusted. Every entry carries its sources and the date a human
            last checked it.
          </p>
          {/* The disclaimer used to be a full-width banner. It is a bubble now,
              but the claim itself still reads on the page unopened — only the
              three sentences of detail moved behind the click. A disclaimer
              with no visible text is a disclaimer nobody saw. */}
          <div className="mt-2.5">
            <InfoBubble
              label="Scope of this tracker, and what it is not"
              tone="caution"
              triggerText="Reference only — not legal advice"
              title="Reference only — not legal advice"
            >
              <p>
                This tracker records what published sources say about each regime. It
                does not tell you whether a regime applies to your organization, and it
                does not assess your compliance — both need legal judgement on your own
                facts.
              </p>
              <p>
                Confirm anything you intend to rely on against the primary source linked
                on each entry.
              </p>
            </InfoBubble>
          </div>
        </div>
        <FrameworkKey frameworks={frameworks} />
      </div>

      {/* ── Views ──────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Regulatory views"
        className="inline-flex flex-wrap gap-0.5 rounded-full border-[1.5px] border-gray-200 bg-white p-[3px]"
      >
        <SegButton
          active={tab === 'regimes'} onClick={() => setTab('regimes')}
          icon={Layers} label="Regimes" count={items.length}
        />
        <SegButton
          active={tab === 'crosswalk'} onClick={() => setTab('crosswalk')}
          icon={GitMerge} label="How they relate" count={relationships.length}
          /* The divergence count, not the relationship count, is the number
             worth putting on the control — it is the only one that costs money
             to find out about late. */
          alert={binds.length > 0 ? binds.length : undefined}
        />
        <SegButton
          active={tab === 'glossary'} onClick={() => setTab('glossary')}
          icon={BookOpen} label="Glossary" count={glossary.length}
        />
      </div>

      {tab === 'crosswalk' && (
        <CrosswalkPanel
          frameworks={frameworks}
          relationships={relationships}
          names={names}
          accents={accentByCode}
          today={today}
        />
      )}

      {tab === 'glossary' && <GlossaryPanel terms={glossary} />}

      {tab === 'regimes' && (
        <div className="space-y-6">
        <WatchQueue
          proposals={proposals}
          lastRun={lastRun}
          isAdmin={isAdmin}
          aiConfigured={aiConfigured}
          aiModel={aiModel}
        />

        {/* ── Headline metrics ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Regimes tracked" value={summary.total} />
          <MetricCard label="Binding today" value={summary.bindingNow}
            hint="In force or applying now" />
          <MetricCard label="Milestones within 90 days" value={summary.imminent}
            tone={summary.imminent > 0 ? 'urgent' : 'normal'} />
          <MetricCard label="Entries to re-verify" value={summary.needsReverification}
            tone={summary.needsReverification > 0 ? 'warn' : 'normal'}
            hint={oldestVerified ? `Oldest check: ${formatMilestoneDate(oldestVerified)}` : undefined} />
        </div>

        {/* ── What's next ────────────────────────────────────────────────── */}
        {upcoming.length > 0 && (
          <Card>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <CalendarClock size={16} className="text-gray-400" />
                <h2 className="text-sm font-medium text-gray-900">What lands next</h2>
              </div>
              <ol className="space-y-2">
                {upcoming.map((i) => {
                  const urgency = milestoneUrgency(i.next_milestone_date, today);
                  return (
                    <li key={i.code} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                      <span className="font-mono text-xs text-gray-500 w-32 flex-shrink-0">
                        {formatMilestoneDate(i.next_milestone_date)}
                      </span>
                      <span className="font-medium text-gray-900">{i.name}</span>
                      <span className="text-gray-500">{i.next_milestone}</span>
                      <Badge variant={URGENCY_META[urgency].variant as BadgeVariant}>
                        {URGENCY_META[urgency].label}
                      </Badge>
                    </li>
                  );
                })}
              </ol>
              <p className="text-xs text-gray-400 pt-1">
                Regimes whose next step has no announced date are excluded here, and
                say so on their own entry.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <FrameworkFilter
            frameworks={frameworks}
            counts={fwCounts}
            value={framework}
            onChange={setFramework}
          />

          <div className="flex flex-wrap items-center gap-2">
            {/* "All domains", not "All" — it sits directly under a row whose
                first chip is "All frameworks", and two unqualified "All"s one
                above the other read as the same control twice. */}
            <FilterChip active={category === 'all'} onClick={() => setCategory('all')}>
              All domains ({items.length})
            </FilterChip>
            {/* Driven by CATEGORY_ORDER so a new domain appears here the moment
                it is seeded, rather than needing this list edited too. Domains
                with nothing in them are hidden — an empty chip reads as a gap in
                coverage rather than as a filter nobody has content for. */}
            {CATEGORY_ORDER.map((c) => ({ c, n: items.filter((i) => i.category === c).length }))
              .filter(({ n }) => n > 0)
              .map(({ c, n }) => (
                <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
                  {CATEGORY_LABELS[c]} ({n})
                </FilterChip>
              ))}
            <span className="w-px h-5 bg-gray-200 mx-1" />
            <FilterChip active={bindingOnly} onClick={() => setBindingOnly((v) => !v)}>
              Binding today only
            </FilterChip>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search regimes, deadlines, key points…"
                className="pl-9"
              />
            </div>
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700"
            >
              <option value="all">All topics</option>
              {topics.map((t) => <option key={t} value={t}>{topicLabel(t)}</option>)}
            </select>
            <div className="inline-flex items-center gap-1.5 text-sm text-gray-500">
              <span className="text-xs uppercase tracking-wide text-gray-400">Group by</span>
              <GroupToggle value={groupBy} onChange={setGroupBy} />
            </div>
            <button
              type="button"
              onClick={() => setShowLegend((v) => !v)}
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
            >
              <Info size={14} /> How to read this
            </button>
          </div>

          {showLegend && <ConfidenceLegend />}
        </div>

        {/* ── Entries ────────────────────────────────────────────────────── */}
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-gray-500 text-center py-10">
              No regimes match these filters.
            </CardContent>
          </Card>
        ) : groupBy === 'framework' ? (
          <>
            {fwGroups.map(({ framework: f, items: rows }) => (
              <section key={f.code} className="space-y-3">
                <FrameworkHeader framework={f} />
                <div className="space-y-3">
                  {rows.map((item) => (
                    <RegulationCard
                      key={item.code}
                      item={item}
                      accent={f.accent_color ?? NEUTRAL_ACCENT}
                      frameworkLabel={f.short_name ?? f.name}
                      today={today}
                      updates={updatesByItem.get(item.code) ?? []}
                      readiness={readiness[item.code] ?? null}
                      reportingYear={reportingYear}
                      open={expanded.has(item.code)}
                      onToggle={() => toggle(item.code)}
                    />
                  ))}
                </div>
              </section>
            ))}

            {/* Kept visible rather than folded away. A standalone instrument
                with no parent body is legitimate, and hiding it would make the
                tracker look like it covers less than it does. */}
            {standalone.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">
                  Standalone instruments
                  <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">
                    no parent framework
                  </span>
                </h2>
                <div className="space-y-3">
                  {standalone.map((item) => (
                    <RegulationCard
                      key={item.code}
                      item={item}
                      today={today}
                      updates={updatesByItem.get(item.code) ?? []}
                      readiness={readiness[item.code] ?? null}
                      reportingYear={reportingYear}
                      open={expanded.has(item.code)}
                      onToggle={() => toggle(item.code)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          groups.map((g) => (
            <section key={g.category} className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                {g.label}
              </h2>
              <div className="space-y-3">
                {g.items.map((item) => (
                  <RegulationCard
                    key={item.code}
                    item={item}
                    accent={item.framework_code ? accentByCode[item.framework_code] : undefined}
                    today={today}
                    updates={updatesByItem.get(item.code) ?? []}
                    readiness={readiness[item.code] ?? null}
                    reportingYear={reportingYear}
                    open={expanded.has(item.code)}
                    onToggle={() => toggle(item.code)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
        </div>
      )}
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function SegButton({ active, onClick, icon: Icon, label, count, alert }: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  count: number;
  alert?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5',
        'text-xs font-semibold transition-colors',
        active
          ? 'bg-gray-900 text-white'
          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
      )}
    >
      <Icon size={14} className={active ? 'text-white/80' : 'text-gray-400'} />
      {label}
      <span className={cn('tabular-nums text-[10px]', active ? 'text-white/60' : 'text-gray-400')}>
        {count}
      </span>
      {alert !== undefined && (
        <span className={cn(
          'rounded-full px-1.5 py-px text-[10px] font-bold',
          active ? 'bg-amber-300 text-amber-950' : 'bg-amber-100 text-amber-700',
        )}>
          {alert} to watch
        </span>
      )}
    </button>
  );
}

function GroupToggle({ value, onChange }: {
  value: 'framework' | 'domain';
  onChange: (v: 'framework' | 'domain') => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-gray-200 bg-white p-[2px]">
      {(['framework', 'domain'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'rounded-full px-2.5 py-1 text-xs capitalize transition-colors',
            value === v
              ? 'bg-gray-900 font-semibold text-white'
              : 'text-gray-500 hover:text-gray-900',
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function MetricCard({ label, value, hint, tone = 'normal' }: {
  label: string; value: number; hint?: string; tone?: 'normal' | 'urgent' | 'warn';
}) {
  const toneClass =
    tone === 'urgent' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-gray-900';
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <p className={cn('text-2xl font-semibold mt-1', toneClass)}>{value}</p>
        {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function FilterChip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 rounded-lg text-sm transition-colors border',
        active
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700 font-medium'
          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50',
      )}
    >
      {children}
    </button>
  );
}

function ConfidenceLegend() {
  return (
    <Card>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium text-gray-900">How to read a confidence rating</p>
        <dl className="space-y-2">
          {(['confirmed', 'high', 'medium', 'low'] as const).map((c) => (
            <div key={c} className="flex gap-3 text-sm">
              <dt className="flex-shrink-0 w-24">
                <Badge variant={CONFIDENCE_META[c].variant as BadgeVariant}>
                  {CONFIDENCE_META[c].label}
                </Badge>
              </dt>
              <dd className="text-gray-600">{CONFIDENCE_META[c].meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-gray-500 border-t border-gray-100 pt-3">
          A rating is capped as the entry ages, because &ldquo;confirmed five months
          ago&rdquo; is a weaker claim than &ldquo;confirmed&rdquo;. Where that has
          happened the entry shows the original rating struck through, alongside the
          rating you should actually apply.
        </p>
      </CardContent>
    </Card>
  );
}

function RegulationCard({
  item, today, updates, readiness, reportingYear, open, onToggle,
  accent, frameworkLabel,
}: {
  item: RegulatoryItem; today: string; updates: Update[];
  readiness: RegimeReadiness | null; reportingYear: number;
  open: boolean; onToggle: () => void;
  /** The parent framework's colour. Absent for a standalone instrument. */
  accent?: string;
  /** Shown only where the framework is not already the heading above. */
  frameworkLabel?: string;
}) {
  const stage = STAGE_META[item.stage];
  const stale = staleness(item.last_verified, today);
  const effective = effectiveConfidence(item.confidence, item.last_verified, today);
  const wasDowngraded = effective !== item.confidence;
  const urgency = milestoneUrgency(item.next_milestone_date, today);

  return (
    // The spine, not a tint: a filled card would put the framework's colour
    // behind the stage and confidence badges, where colour already means
    // something else entirely.
    <Card style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}>
      <CardContent className="space-y-3">

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">{item.name}</h3>
              <span className="font-mono text-xs text-gray-400">{item.code}</span>
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
              {frameworkLabel && (
                <span className="inline-flex items-center gap-1.5 font-semibold text-gray-600">
                  <FrameworkDot color={accent} size={8} />
                  {frameworkLabel}
                </span>
              )}
              {frameworkLabel && <span className="text-gray-300">·</span>}
              {item.jurisdiction}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={stage.variant as BadgeVariant}>{stage.label}</Badge>
            {wasDowngraded ? (
              <span className="inline-flex items-center gap-1">
                <span className="text-xs text-gray-400 line-through">
                  {CONFIDENCE_META[item.confidence].label}
                </span>
                <Badge variant={CONFIDENCE_META[effective].variant as BadgeVariant}>
                  {CONFIDENCE_META[effective].label}
                </Badge>
              </span>
            ) : (
              <Badge variant={CONFIDENCE_META[effective].variant as BadgeVariant}>
                {CONFIDENCE_META[effective].label}
              </Badge>
            )}
            {stale !== 'fresh' && (
              <Badge variant={STALENESS_META[stale].variant as BadgeVariant}>
                {STALENESS_META[stale].label}
              </Badge>
            )}
          </div>
        </div>

        <p className="text-sm text-gray-700">{item.status_summary}</p>

        {item.next_milestone && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <CalendarClock size={14} className="text-gray-400 self-center" />
              <span className="text-sm font-medium text-gray-900">
                {formatMilestoneDate(item.next_milestone_date)}
              </span>
              <span className="text-sm text-gray-600">— {item.next_milestone}</span>
              <Badge variant={URGENCY_META[urgency].variant as BadgeVariant}>
                {URGENCY_META[urgency].label}
              </Badge>
            </div>
            {item.next_milestone_note && (
              <p className="text-xs text-gray-500 mt-2">{item.next_milestone_note}</p>
            )}
          </div>
        )}

        {readiness?.biggestGap && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <span className="text-xs font-medium text-amber-800 uppercase tracking-wide">
              Your gap
            </span>
            <span className="text-gray-900 font-medium">{readiness.biggestGap.label}</span>
            <span className="text-gray-600">— {readiness.biggestGap.result.detail}</span>
          </div>
        )}

        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:text-emerald-800 font-medium"
        >
          <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
          {open ? 'Hide detail' : 'What we have for it, key points and sources'}
        </button>

        {open && (
          <div className="space-y-4 pt-1 border-t border-gray-100">
            {readiness && (
              <div className="pt-3">
                <CapabilityPanel readiness={readiness} reportingYear={reportingYear} />
              </div>
            )}

            {item.key_points.length > 0 && (
              <div className="pt-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                  What to know
                </p>
                <ul className="space-y-1.5">
                  {item.key_points.map((p, idx) => (
                    <li key={idx} className="flex gap-2 text-sm text-gray-700">
                      <CircleCheck size={14} className="text-gray-300 flex-shrink-0 mt-0.5" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {updates.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                  What changed
                </p>
                <ul className="space-y-2">
                  {updates.map((u, idx) => (
                    <li key={idx} className="text-sm">
                      <span className="font-mono text-xs text-gray-500 mr-2">{u.update_date}</span>
                      <a href={u.source_url} target="_blank" rel="noopener noreferrer"
                         className="text-gray-900 hover:text-emerald-700">
                        {u.headline}
                      </a>
                      {u.detail && <p className="text-gray-600 mt-0.5">{u.detail}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {item.confidence_note && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Why this rating
                </p>
                <p className="text-sm text-gray-600">{item.confidence_note}</p>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Sources
              </p>
              <ul className="space-y-1">
                {item.sources.map((s, idx) => (
                  <li key={idx}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-baseline gap-1.5 text-sm text-emerald-700 hover:underline">
                      {s.label}
                      <ExternalLink size={11} className="flex-shrink-0 self-center" />
                    </a>
                    <span className="text-xs text-gray-400 ml-2">{s.dated}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {item.topics.map((t) => (
                <Badge key={t} variant="outline">{topicLabel(t)}</Badge>
              ))}
              <span className="text-xs text-gray-400 ml-auto">
                Last verified {formatMilestoneDate(item.last_verified)}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
