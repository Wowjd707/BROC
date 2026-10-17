import { createServerClient } from '@/lib/supabase/server';
import { RegulationsClient } from './RegulationsClient';
import { toRegulatoryItem } from '@/lib/regulatory-core';
import { getAiStatus } from '@/lib/ai';
import { getReadinessFacts } from '@/lib/capability-readiness';
import {
  evaluateCapabilities, summariseRegime,
  type CapabilityRow, type RegimeReadiness,
} from '@/lib/capability-readiness-core';
import { sanitisePatch } from '@/lib/regulatory-watch-core';
import {
  toRelationship,
  type RegulatoryFramework, type RegulatoryRelationship, type GlossaryTerm,
} from '@/lib/regulatory-crosswalk-core';
import type { Proposal } from './WatchQueue';
import { activeOrg } from '@/lib/active-org';

/**
 * The regulatory tracker is reference data, not tenant data — every
 * organization sees the same rows, and none of it is scoped by site or
 * business unit. So this page deliberately does NOT take the reporting-scope
 * filter that the inventory pages do: narrowing CBAM by business unit would be
 * meaningless, and offering the control would imply otherwise.
 */
export default async function RegulationsPage() {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from('users')
        .select('role, organizations!users_organization_id_fkey(reporting_year_start), active_organization:organizations!users_active_organization_id_fkey(reporting_year_start)')
        .eq('id', user.id)
        .single()
    : { data: null };

  const fyStart = activeOrg(profile)?.reporting_year_start ?? 1;
  const now = new Date();
  const reportingYear = now.getMonth() + 1 >= fyStart ? now.getFullYear() : now.getFullYear() - 1;

  const [
    { data: items }, { data: updates }, { data: proposals }, { data: runs },
    { data: capabilities }, { data: frameworkRows }, { data: relationshipRows },
    { data: glossaryRows },
  ] = await Promise.all([
    supabase
      .from('regulatory_items')
      .select('*')
      .eq('is_active', true)
      .order('display_order'),
    supabase
      .from('regulatory_updates')
      .select('item_code, update_date, headline, detail, source_url')
      .order('update_date', { ascending: false })
      .limit(40),
    supabase
      .from('regulatory_change_proposals')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('regulatory_watch_runs')
      .select('started_at, finished_at, status, sources_checked, sources_changed, sources_failed, ai_used, ai_model')
      .order('started_at', { ascending: false })
      .limit(1),
    supabase
      .from('regulatory_capabilities')
      .select('item_code, capability_key, label, description, route, probe, probe_arg, necessity, display_order')
      .eq('is_active', true)
      .order('display_order'),
    // Frameworks, the crosswalk and the glossary are all reference content on
    // the same footing as the items: same RLS, same read-for-everyone posture,
    // so they fetch alongside rather than behind a second round trip.
    supabase
      .from('regulatory_frameworks')
      .select('code, name, short_name, publisher, domain, tagline, description, status_headline, accent_color, display_order')
      .eq('is_active', true)
      .order('display_order'),
    supabase
      .from('regulatory_relationships')
      .select('from_code, to_code, relation, title, note, bullets, is_watchlist, watchlist_detail, confidence, sources, last_verified, display_order')
      .eq('is_active', true)
      .order('display_order'),
    supabase
      .from('regulatory_glossary')
      .select('term, expansion, definition, is_acronym')
      .order('term'),
  ]);

  // Computed on the server so every card agrees on what "today" is. Deriving it
  // per-component would let the freshness badges disagree across a midnight
  // boundary, which is exactly the kind of small incoherence that makes a
  // reference tool feel untrustworthy.
  const today = new Date().toISOString().slice(0, 10);

  const parsedItems = (items ?? []).map(toRegulatoryItem);
  const itemsByCode = new Map(parsedItems.map((i) => [i.code, i]));

  // Mapped field by field rather than cast. The select above happens to match
  // the interface today; a cast would keep compiling on the day it stops.
  const frameworks: RegulatoryFramework[] = (frameworkRows ?? []).map((f) => ({
    code: f.code,
    name: f.name,
    short_name: f.short_name,
    publisher: f.publisher,
    domain: f.domain,
    tagline: f.tagline,
    description: f.description,
    status_headline: f.status_headline,
    accent_color: f.accent_color,
    display_order: f.display_order,
  }));

  // `toRelationship` returns null for a relation verb this build does not
  // render. Dropping it is deliberate: an edge drawn with a guessed verb
  // asserts something about two regimes that nobody actually wrote.
  const relationships: RegulatoryRelationship[] = (relationshipRows ?? [])
    .flatMap((r) => {
      const parsed = toRelationship(r);
      return parsed ? [parsed] : [];
    });

  const glossary: GlossaryTerm[] = (glossaryRows ?? []).map((t) => ({
    term: t.term,
    expansion: t.expansion,
    definition: t.definition,
    is_acronym: t.is_acronym,
  }));

  // Either end of a relationship may name a framework or a single workstream,
  // so both go into one lookup. Items are written last: where a code somehow
  // exists in both tables, the workstream is the more specific thing to name.
  const names: Record<string, string> = {};
  for (const f of frameworks) names[f.code] = f.short_name ?? f.name;
  for (const i of parsedItems) names[i.code] = i.name;

  // The proposal carries a suggested patch; the reviewer needs to see it
  // against the CURRENT values to judge it, so the two are joined here rather
  // than making the client fetch the item again.
  const queue: Proposal[] = (proposals ?? []).flatMap((p) => {
    const current = itemsByCode.get(p.item_code);
    if (!current) return [];
    const ungrounded = Array.isArray(p.ai_ungrounded)
      ? (p.ai_ungrounded as unknown[]).flatMap((u) => {
          if (typeof u !== 'object' || u === null) return [];
          const o = u as Record<string, unknown>;
          return typeof o.text === 'string' && typeof o.value === 'number'
            ? [{ text: o.text, value: o.value }]
            : [];
        })
      : [];
    return [{
      id: p.id,
      item_code: p.item_code,
      item_name: current.name,
      source_url: p.source_url,
      change_kind: p.change_kind as Proposal['change_kind'],
      detected_summary: p.detected_summary,
      diff_excerpt: p.diff_excerpt,
      ai_summary: p.ai_summary,
      ai_provider: p.ai_provider,
      ai_model: p.ai_model,
      ai_ungrounded: ungrounded,
      // Re-sanitised on read as well as on write: a row hand-edited in the
      // database should not be able to render a field the UI will not apply.
      proposed_patch: sanitisePatch(p.proposed_patch).patch,
      created_at: p.created_at,
      current: current as unknown as Record<string, unknown>,
    }];
  });

  // Readiness is computed from the organization's own data — no model, and it
  // works with the AI layer off. One facts pass serves all 39 capability rows.
  const facts = await getReadinessFacts(reportingYear, fyStart);
  const byRegime: Record<string, RegimeReadiness> = {};
  for (const item of parsedItems) {
    const rows = ((capabilities ?? []) as CapabilityRow[])
      .filter((c) => c.item_code === item.code);
    if (rows.length === 0) continue;
    byRegime[item.code] = summariseRegime(evaluateCapabilities(rows, facts));
  }

  const aiStatus = getAiStatus();

  return (
    <RegulationsClient
      items={parsedItems}
      updates={updates ?? []}
      today={today}
      proposals={queue}
      lastRun={runs?.[0] ?? null}
      isAdmin={profile?.role === 'admin'}
      readiness={byRegime}
      reportingYear={reportingYear}
      aiConfigured={aiStatus.enabled}
      aiModel={aiStatus.model ?? null}
      frameworks={frameworks}
      relationships={relationships}
      glossary={glossary}
      names={names}
    />
  );
}
