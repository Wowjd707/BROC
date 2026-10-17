/**
 * Regulatory capability readiness.
 *
 * Turns "what does this platform do about CBAM, and how far along are we"
 * into an answer computed from the organization's own data.
 *
 * Every fact used here already exists in the database. Which capability serves
 * which regime is curated in `regulatory_capabilities` (migration 026); how
 * much data the organization holds is arithmetic. No model is involved, so this
 * works with the AI layer off — which is the default — and it cannot invent a
 * regulatory claim, because it never makes one.
 *
 * ─── What this deliberately does not say ────────────────────────────────────
 *
 * It never says an organization is compliant, and never says a regime applies
 * to them. It says: here is what this platform can do, and here is how much of
 * your data is in place. The distance between "we hold the data" and "the
 * obligation is met" is legal judgement, and this module stays on its own side
 * of that line. The wording of every status below is chosen with that in mind
 * — "3 of 5 sites have data", never "60% compliant".
 *
 * Pure and dependency-free so it is unit-testable.
 */

export type ReadinessStatus =
  | 'ready'      // the data this capability needs is in place
  | 'partial'    // some of it
  | 'absent'     // the capability exists, but there is no data behind it yet
  | 'not_built'  // this platform does not do this
  | 'no_action'  // nothing to do, and that is the right answer
  | 'unknown';   // a probe we cannot evaluate

export const STATUS_META: Record<ReadinessStatus, { label: string; variant: string; rank: number }> = {
  // `rank` orders the gap list: the things a user should act on first.
  absent:    { label: 'No data yet',      variant: 'destructive', rank: 0 },
  partial:   { label: 'Partial',          variant: 'warning',     rank: 1 },
  not_built: { label: 'Not in this tool', variant: 'purple',      rank: 2 },
  unknown:   { label: 'Unknown',          variant: 'secondary',   rank: 3 },
  ready:     { label: 'In place',         variant: 'default',     rank: 4 },
  no_action: { label: 'Nothing to do',    variant: 'secondary',   rank: 5 },
};

export type Necessity = 'required' | 'supporting' | 'informational';

export interface CapabilityRow {
  item_code: string;
  capability_key: string;
  label: string | null;
  description: string;
  route: string | null;
  probe: string;
  probe_arg: string | null;
  necessity: Necessity;
  display_order: number;
}

/**
 * Facts gathered once per page load, server-side, and shared by every probe.
 *
 * Deliberately a flat bag of counts rather than a query per capability: 39
 * capability rows across 21 regimes would otherwise be 39 round trips to say
 * things like "how many sites have data", which several of them ask.
 */
export interface ReadinessFacts {
  sitesTotal: number;
  sitesWithCurrentYearEmissions: number;
  scope3CategoriesWithData: number;
  cbamCalculations: number;
  /** Keyed by lower-cased survey_type. */
  surveysByType: Record<string, { sent: number; responded: number }>;
  suppliersCount: number;
  /** Keyed by framework code. */
  frameworkCoverage: Record<string, { covered: number; total: number }>;
  materialityExists: boolean;
  materialityComplete: boolean;
  /** `metric_type:source_type` keys that have data in the reporting year. */
  socialMetricsWithData: string[];
  /** 'water' | 'waste' families that have data. */
  ehsFamiliesWithData: string[];
  evidence: { withEvidence: number; total: number };
  /** Active goals per metric family. */
  goalsByMetric: Record<string, number>;
}

export interface ProbeResult {
  status: ReadinessStatus;
  /** One line the user reads. Concrete counts, never a percentage of "compliance". */
  detail: string;
}

function ratio(part: number, whole: number): ReadinessStatus {
  if (whole === 0) return 'absent';
  if (part === 0) return 'absent';
  return part >= whole ? 'ready' : 'partial';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Evaluate one capability against the gathered facts.
 *
 * An unrecognised probe returns `unknown` rather than throwing: a curated row
 * naming a probe nobody implemented yet should degrade to "we can't tell",
 * not take down the page.
 */
export function evaluateProbe(
  probe: string,
  probeArg: string | null,
  facts: ReadinessFacts,
): ProbeResult {
  switch (probe) {
    case 'not_built':
      return { status: 'not_built', detail: 'Not available in this platform.' };

    case 'no_action':
      return { status: 'no_action', detail: 'No action needed.' };

    case 'scope12_site_coverage': {
      const { sitesWithCurrentYearEmissions: have, sitesTotal: total } = facts;
      if (total === 0) {
        return { status: 'absent', detail: 'No active sites yet — add sites before entering data.' };
      }
      return {
        status: ratio(have, total),
        detail: `${have} of ${plural(total, 'site has', 'sites have')} current-year data.`,
      };
    }

    case 'scope3_categories': {
      const n = facts.scope3CategoriesWithData;
      return {
        status: n === 0 ? 'absent' : n >= 15 ? 'ready' : 'partial',
        detail: n === 0
          ? 'No Scope 3 categories have data.'
          : `${n} of 15 categories have data.`,
      };
    }

    case 'cbam_calculations': {
      const n = facts.cbamCalculations;
      return {
        status: n === 0 ? 'absent' : 'ready',
        detail: n === 0 ? 'No calculations saved.' : `${plural(n, 'calculation', 'calculations')} saved.`,
      };
    }

    case 'supplier_survey': {
      const key = (probeArg ?? '').toLowerCase();
      const s = facts.surveysByType[key];
      if (!s || s.sent === 0) {
        return { status: 'absent', detail: 'No questionnaires sent.' };
      }
      return {
        status: s.responded === 0 ? 'partial' : ratio(s.responded, s.sent),
        detail: `${s.responded} of ${s.sent} sent questionnaires answered.`,
      };
    }

    case 'suppliers_registered': {
      const n = facts.suppliersCount;
      return {
        status: n === 0 ? 'absent' : 'ready',
        detail: n === 0 ? 'No suppliers registered.' : `${plural(n, 'supplier', 'suppliers')} registered.`,
      };
    }

    case 'disclosure_coverage': {
      const c = facts.frameworkCoverage[probeArg ?? ''];
      if (!c || c.total === 0) {
        return { status: 'unknown', detail: 'This framework is not loaded in the disclosure catalog.' };
      }
      return {
        status: ratio(c.covered, c.total),
        detail: `${c.covered} of ${c.total} requirements answered or satisfied by data.`,
      };
    }

    case 'materiality_assessment': {
      if (!facts.materialityExists) {
        return { status: 'absent', detail: 'No assessment started.' };
      }
      return facts.materialityComplete
        ? { status: 'ready', detail: 'Assessment complete.' }
        : { status: 'partial', detail: 'Assessment started but not complete.' };
    }

    case 'sg_metric': {
      const key = probeArg ?? '';
      const has = facts.socialMetricsWithData.includes(key);
      return has
        ? { status: 'ready', detail: 'Data recorded this year.' }
        : { status: 'absent', detail: 'No data recorded this year.' };
    }

    case 'ehs_metric': {
      const family = probeArg ?? '';
      const has = facts.ehsFamiliesWithData.includes(family);
      return has
        ? { status: 'ready', detail: `${family === 'water' ? 'Water' : 'Waste'} data recorded this year.` }
        : { status: 'absent', detail: `No ${family} data recorded this year.` };
    }

    case 'evidence_coverage': {
      const { withEvidence, total } = facts.evidence;
      if (total === 0) return { status: 'absent', detail: 'No entries to attach evidence to yet.' };
      return {
        status: ratio(withEvidence, total),
        detail: `${withEvidence} of ${total} entries have a source document attached.`,
      };
    }

    case 'goal_for_metric': {
      const n = facts.goalsByMetric[probeArg ?? 'ghg'] ?? 0;
      return {
        status: n === 0 ? 'absent' : 'ready',
        detail: n === 0 ? 'No active target set.' : `${plural(n, 'active target', 'active targets')}.`,
      };
    }

    default:
      return { status: 'unknown', detail: 'No readiness check is implemented for this capability.' };
  }
}

// ─── Rolling up ──────────────────────────────────────────────────────────────

export interface EvaluatedCapability extends CapabilityRow {
  result: ProbeResult;
}

export function evaluateCapabilities(
  rows: CapabilityRow[],
  facts: ReadinessFacts,
): EvaluatedCapability[] {
  return rows
    .map((row) => ({ ...row, result: evaluateProbe(row.probe, row.probe_arg, facts) }))
    .sort((a, b) => a.display_order - b.display_order);
}

export interface RegimeReadiness {
  /** Capabilities that carry actual data, ordered worst-first. */
  capabilities: EvaluatedCapability[];
  /** The single most useful next action, or null when there isn't one. */
  biggestGap: EvaluatedCapability | null;
  counts: Record<ReadinessStatus, number>;
  /** True when nothing in this platform serves the regime at all. */
  nothingBuilt: boolean;
}

/**
 * Pick the one thing worth doing next.
 *
 * Ordered by status severity first, then by necessity — a `required`
 * capability with no data outranks a `supporting` one that is merely partial.
 * `not_built` and `no_action` are never the "biggest gap": neither is
 * something the user can act on in this tool, and offering them as a next step
 * would be advice to go do something we cannot help with.
 */
export function summariseRegime(evaluated: EvaluatedCapability[]): RegimeReadiness {
  const counts: Record<ReadinessStatus, number> = {
    ready: 0, partial: 0, absent: 0, not_built: 0, no_action: 0, unknown: 0,
  };
  for (const c of evaluated) counts[c.result.status] += 1;

  const necessityRank: Record<Necessity, number> = {
    required: 0, supporting: 1, informational: 2,
  };

  const actionable = evaluated.filter(
    (c) => c.result.status === 'absent' || c.result.status === 'partial',
  );
  actionable.sort((a, b) => {
    const byStatus = STATUS_META[a.result.status].rank - STATUS_META[b.result.status].rank;
    if (byStatus !== 0) return byStatus;
    const byNecessity = necessityRank[a.necessity] - necessityRank[b.necessity];
    if (byNecessity !== 0) return byNecessity;
    return a.display_order - b.display_order;
  });

  return {
    capabilities: evaluated,
    biggestGap: actionable[0] ?? null,
    counts,
    nothingBuilt: evaluated.length > 0
      && evaluated.every((c) => c.result.status === 'not_built' || c.result.status === 'no_action'),
  };
}
