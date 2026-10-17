import 'server-only';
import { createServiceClient } from './supabase/server';
import { getAiProvider, AiProviderError } from './ai';
import {
  buildRegulatoryChangePrompt, parseRegulatoryChange, AI_TASK_MAX_TOKENS,
} from './ai/tasks';
import { findUngroundedFigures } from './ai/grounding';
import {
  evaluateSource, buildDiffExcerpt, excerptForSnapshot, sanitisePatch,
  type FetchResult, type ProposedPatch,
} from './regulatory-watch-core';

/**
 * The regulatory watch runner.
 *
 * Sequence per source, and the order matters:
 *
 *   fetch → normalise → hash → compare → (only if genuinely changed) ask a model
 *
 * Most runs stop at "compare" for most sources, so a typical run makes zero
 * model calls and costs nothing but bandwidth. That is not an optimisation, it
 * is the design: a model is expensive, occasionally wrong, and completely
 * unnecessary for answering "did this page change".
 *
 * Nothing here writes to `regulatory_items`. The runner's only outputs are
 * snapshots (the new baseline) and proposals (a queue). Applying a change is a
 * separate, human-initiated action in the API route.
 */

/** Per-source ceiling. A slow government site must not stall the whole run. */
const FETCH_TIMEOUT_MS = 20_000;
/** Enough for a long guidance page; guards against a multi-megabyte PDF. */
const MAX_BODY_BYTES = 2_000_000;

/**
 * A descriptive User-Agent. Several of these are public-sector sites with rate
 * limiting and abuse monitoring, and identifying the client honestly is both
 * courteous and the thing that keeps the tool from being blocked outright.
 */
const USER_AGENT =
  'RegulatoryWatch/1.0 (ESG platform source monitor; contact your deployment administrator)';

async function fetchSource(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    });

    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status} ${res.statusText}`.trim() };
    }

    // A PDF or spreadsheet cannot be diffed as text and would produce garbage.
    // Reported as a fetch failure so the reviewer is told to look, rather than
    // silently treated as unchanged.
    const type = res.headers.get('content-type') ?? '';
    if (type && !/text\/|html|xml|json/i.test(type)) {
      return { ok: false, error: `Source is ${type.split(';')[0]}, which this watcher cannot diff. Check it by hand.` };
    }

    const body = await res.text();
    if (body.length > MAX_BODY_BYTES) {
      return { ok: false, error: `Source is ${Math.round(body.length / 1000)}kB, above the size this watcher will process.` };
    }
    return { ok: true, body };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown fetch error';
    return {
      ok: false,
      error: message.includes('abort')
        ? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s`
        : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface WatchRunSummary {
  runId: string;
  sourcesChecked: number;
  sourcesChanged: number;
  sourcesFailed: number;
  proposalsCreated: number;
  aiUsed: boolean;
}

interface ItemRow {
  code: string;
  name: string;
  stage: string;
  status_summary: string;
  next_milestone: string | null;
  next_milestone_date: string | null;
  sources: unknown;
}

function sourceUrls(sources: unknown): string[] {
  if (!Array.isArray(sources)) return [];
  return sources
    .map((s) => (typeof s === 'object' && s !== null ? (s as Record<string, unknown>).url : null))
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
}

/**
 * Run the watch across every active tracked regime.
 *
 * Uses the service client because the reference tables carry no write policies
 * by design — the caller is responsible for having established that the user is
 * an admin before invoking this.
 */
export async function runRegulatoryWatch(options: {
  triggeredBy: string | null;
  triggerKind: 'manual' | 'scheduled';
  /** Limit to one regime, for re-checking a single entry. */
  onlyItemCode?: string;
}): Promise<WatchRunSummary> {
  const supabase = createServiceClient();
  const provider = getAiProvider();

  const { data: run, error: runError } = await supabase
    .from('regulatory_watch_runs')
    .insert({
      status: 'running',
      triggered_by: options.triggeredBy,
      trigger_kind: options.triggerKind,
      ai_used: false,
    })
    .select('id')
    .single();

  if (runError || !run) {
    throw new Error(`Could not start a watch run: ${runError?.message ?? 'unknown error'}`);
  }
  const runId = run.id as string;

  const totals = { checked: 0, changed: 0, failed: 0, proposals: 0 };
  let aiUsed = false;
  let aiProviderId: string | null = null;
  let aiModel: string | null = null;

  try {
    let query = supabase
      .from('regulatory_items')
      .select('code, name, stage, status_summary, next_milestone, next_milestone_date, sources')
      .eq('is_active', true);
    if (options.onlyItemCode) query = query.eq('code', options.onlyItemCode);

    const { data: items } = await query;

    for (const item of (items ?? []) as ItemRow[]) {
      for (const url of sourceUrls(item.sources)) {
        totals.checked += 1;

        const { data: previous } = await supabase
          .from('regulatory_source_snapshots')
          .select('content_hash, excerpt, fetched_at')
          .eq('item_code', item.code)
          .eq('source_url', url)
          .maybeSingle();

        const fetched = await fetchSource(url);
        const evaluation = evaluateSource(fetched, previous ?? null);

        if (evaluation.outcome === 'fetch_failed') {
          totals.failed += 1;
          // A source we could not read is worth a reviewer's attention, but it
          // carries no patch: there is nothing to propose from a page nobody saw.
          await supabase.from('regulatory_change_proposals').insert({
            run_id: runId, item_code: item.code, source_url: url,
            change_kind: 'fetch_failed',
            detected_summary: evaluation.summary,
            proposed_patch: {},
          });
          totals.proposals += 1;
          continue;
        }

        // Baseline is written for every readable outcome, including cosmetic
        // change — otherwise the same trivial diff would resurface every run.
        await supabase.from('regulatory_source_snapshots').upsert({
          item_code: item.code,
          source_url: url,
          content_hash: evaluation.hash,
          content_length: evaluation.normalised.length,
          excerpt: excerptForSnapshot(evaluation.normalised),
          fetched_at: new Date().toISOString(),
        }, { onConflict: 'item_code,source_url' });

        if (evaluation.outcome !== 'changed' || !evaluation.diff) continue;

        totals.changed += 1;
        const diffExcerpt = buildDiffExcerpt(evaluation.diff);

        let aiSummary: string | null = null;
        let ungrounded: { text: string; value: number }[] = [];
        let patch: ProposedPatch = {};

        if (provider) {
          try {
            const prompt = buildRegulatoryChangePrompt({
              itemName: item.name,
              itemCode: item.code,
              sourceUrl: url,
              currentStatusSummary: item.status_summary,
              currentStage: item.stage,
              currentMilestone: item.next_milestone,
              currentMilestoneDate: item.next_milestone_date,
              diffExcerpt,
            });

            const result = await provider.complete({
              system: prompt.system,
              messages: [{ role: 'user', content: prompt.user }],
              maxTokens: AI_TASK_MAX_TOKENS.summarise_regulatory_change,
            });

            if (result.stopReason !== 'refusal' && result.text) {
              const parsed = parseRegulatoryChange(result.text);
              aiSummary = parsed.summary;
              // Checked against the diff alone. A date the model echoed from
              // our own stored summary is not evidence the source said it.
              // Mapped to plain object literals rather than passed through as
              // the declared interface: Supabase's generated `Json` type has no
              // index signature, and a named interface is not structurally
              // assignable to it even when every field is JSON-safe.
              ungrounded = findUngroundedFigures(parsed.summary, prompt.context)
                .map((u) => ({ text: u.text, value: u.value }));
              patch = sanitisePatch(parsed.suggestedChanges).patch;
              aiUsed = true;
              aiProviderId = result.providerId;
              aiModel = result.model;
            }
          } catch (err) {
            // A model failure must not lose the detection. The deterministic
            // summary is already enough to review from, so the proposal is
            // written either way with the reason attached.
            aiSummary = err instanceof AiProviderError
              ? `The summarisation model could not be reached (${err.message}). The deterministic diff below is unaffected.`
              : 'The summarisation model failed. The deterministic diff below is unaffected.';
          }
        }

        await supabase.from('regulatory_change_proposals').insert({
          run_id: runId,
          item_code: item.code,
          source_url: url,
          change_kind: 'changed',
          detected_summary: evaluation.summary,
          diff_excerpt: diffExcerpt,
          ai_summary: aiSummary,
          ai_provider: aiProviderId,
          ai_model: aiModel,
          ai_ungrounded: ungrounded,
          proposed_patch: { ...patch },
        });
        totals.proposals += 1;
      }
    }

    await supabase.from('regulatory_watch_runs').update({
      status: 'complete',
      finished_at: new Date().toISOString(),
      sources_checked: totals.checked,
      sources_changed: totals.changed,
      sources_failed: totals.failed,
      proposals_created: totals.proposals,
      ai_used: aiUsed,
      ai_provider: aiProviderId,
      ai_model: aiModel,
    }).eq('id', runId);

    return {
      runId,
      sourcesChecked: totals.checked,
      sourcesChanged: totals.changed,
      sourcesFailed: totals.failed,
      proposalsCreated: totals.proposals,
      aiUsed,
    };
  } catch (error) {
    await supabase.from('regulatory_watch_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      sources_checked: totals.checked,
      sources_changed: totals.changed,
      sources_failed: totals.failed,
      proposals_created: totals.proposals,
      error: error instanceof Error ? error.message : 'Unknown error',
    }).eq('id', runId);
    throw error;
  }
}
