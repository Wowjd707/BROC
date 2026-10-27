/**
 * Pure mapping and validation for bulk goal uploads.
 *
 * A goal is a commitment, so this importer is the strictest of the set. Three
 * rules are inherited rather than invented, and each is enforced here because
 * the database cannot express any of them:
 *
 * **Not every goal type is valid for every metric.** GOAL_TYPES_BY_METRIC in
 * lib/goal-metrics.ts allows SBTi 1.5°C and Net Zero for greenhouse gas only.
 * Migration 021 says why in as many words: an SBTi pathway is defined on
 * emissions, and applying its 4.2%/yr to a water volume would be a fabricated
 * methodology. The `goal_type` CHECK still accepts sbti_15c on a water goal, so
 * refusing it is this module's job.
 *
 * **An SBTi target is derived, never typed.** The UI computes it with
 * calculateSBTiTarget from the baseline and the two years. A percentage read out
 * of a spreadsheet cell for an SBTi goal would be someone's arithmetic wearing
 * the name of a standard, and it would silently differ from the same goal
 * created through the form. So the column is ignored for that type and the value
 * is computed the same way.
 *
 * **base_year_emissions_kg and base_year_value must agree.** The first is the
 * GHG-only predecessor that several reports still read; 021 records that for a
 * GHG goal the application writes both together, and leaves the old one null for
 * water and waste "where it would be a unit lie" — gallons in a column named kg.
 *
 * Units are canonical and unconverted: kg CO₂e, US gallons, kg. A goal is
 * therefore directly comparable to a summed entry total, which is the only way
 * the two are guaranteed not to drift.
 */

import { GOAL_TYPES_BY_METRIC, type GoalMetric } from './goal-metrics';

export const GOAL_IMPORT_COLUMNS = [
  'name', 'metric', 'goal_type', 'scope', 'base_year', 'base_year_value',
  'target_year', 'reduction_percent', 'scope2_method', 'notes',
] as const;

export type GoalImportColumn = (typeof GOAL_IMPORT_COLUMNS)[number];

export const GOAL_COLUMN_LABELS: Record<GoalImportColumn, string> = {
  name: 'Goal Name',
  metric: 'Metric',
  goal_type: 'Goal Type',
  scope: 'Scope',
  base_year: 'Base Year',
  base_year_value: 'Base Year Value',
  target_year: 'Target Year',
  reduction_percent: 'Reduction Percent',
  scope2_method: 'Scope 2 Method',
  notes: 'Notes',
};

export const GOAL_IMPORT_HEADERS: string[] =
  GOAL_IMPORT_COLUMNS.map((c) => GOAL_COLUMN_LABELS[c]);

export const GOAL_EXAMPLE_ROW_NOTE = 'Example row — delete before uploading';

export const GOAL_METRICS: GoalMetric[] = ['ghg', 'water', 'waste'];

export const GOAL_METRIC_LABELS: Record<GoalMetric, string> = {
  ghg: 'Greenhouse gas (kg CO2e)',
  water: 'Water (US gallons)',
  waste: 'Waste (kg)',
};

export const GOAL_SCOPES = ['scope1_2', 'scope1', 'scope2'] as const;

export const GOAL_SCOPE_LABELS: Record<string, string> = {
  scope1_2: 'Scope 1 + 2',
  scope1: 'Scope 1 only',
  scope2: 'Scope 2 only',
};

export const SCOPE2_METHODS = ['market_based', 'location_based'] as const;

export const SCOPE2_METHOD_LABELS: Record<string, string> = {
  market_based: 'Market-based',
  location_based: 'Location-based',
};

/**
 * Header spellings that do not survive `lib/csv.ts`.
 *
 * "Goal Name" becomes goal_name rather than name, which fails loudly because a
 * name is required. The rest are convenience, except "Scope 2 Method", which
 * normalizes to scope_2_method — the same numeral-in-a-label trap the emissions
 * template hit with "Scope 1 Category", and optional in the same way.
 */
const HEADER_ALIASES: Record<string, GoalImportColumn> = {
  goal_name: 'name',
  goal: 'name',
  scope_2_method: 'scope2_method',
  scope2_accounting_method: 'scope2_method',
  accounting_method: 'scope2_method',
  reduction: 'reduction_percent',
  reduction_pct: 'reduction_percent',
  target_reduction_percent: 'reduction_percent',
  baseline: 'base_year_value',
  baseline_value: 'base_year_value',
  type: 'goal_type',
};

export function canonicalizeGoalRow(row: Record<string, string>): Record<string, string> {
  const out = { ...row };
  for (const [alias, canonical] of Object.entries(HEADER_ALIASES)) {
    if (out[alias] !== undefined && out[canonical] === undefined) {
      out[canonical] = out[alias];
    }
  }
  return out;
}

export interface MappedGoal {
  name: string;
  metric: GoalMetric;
  goalType: string;
  /** Only meaningful for a GHG goal; null otherwise, as the UI writes it. */
  scope: string | null;
  baseYear: number;
  baseYearValue: number | null;
  targetYear: number;
  /** Null until an absolute or SBTi target supplies one. */
  targetValue: number | null;
  targetUnit: string | null;
  scope2Method: string;
  notes: string | null;
  warnings: string[];
}

export type GoalRowResult =
  | { ok: true; goal: MappedGoal }
  | { ok: false; error: string }
  | { ok: false; error: string; duplicate: true };

/** Resolve a label or a stored key against a vocabulary, case-insensitively. */
function resolve(
  value: string,
  keys: readonly string[],
  labels: Record<string, string>,
): string | undefined {
  const lower = value.trim().toLowerCase();
  if (keys.includes(lower)) return lower;
  for (const [key, label] of Object.entries(labels)) {
    if (label.toLowerCase() === lower) return key;
  }
  return undefined;
}

export interface GoalMapContext {
  existingNames: Set<string>;
  /**
   * Derives the SBTi reduction, injected so this module stays pure and the
   * importer cannot drift from lib/calculations.ts.
   */
  sbtiReductionPct: (baseValue: number, baseYear: number, targetYear: number) => number;
}

export function mapGoalRow(
  input: Record<string, string>,
  ctx: GoalMapContext,
): GoalRowResult {
  const row = canonicalizeGoalRow(input);
  const text = (key: GoalImportColumn): string => (row[key] ?? '').trim();
  const warnings: string[] = [];

  const name = text('name');
  if (!name) return { ok: false, error: `Missing ${GOAL_COLUMN_LABELS.name}.` };

  if (ctx.existingNames.has(name.toLowerCase())) {
    return { ok: false, duplicate: true, error: `${name} is already one of your goals.` };
  }

  const metricRaw = text('metric');
  let metric: GoalMetric = 'ghg';
  if (metricRaw) {
    const resolved = resolve(metricRaw, GOAL_METRICS, GOAL_METRIC_LABELS) as GoalMetric | undefined;
    if (!resolved) {
      return {
        ok: false,
        error: `Unknown ${GOAL_COLUMN_LABELS.metric} "${metricRaw}". Expected greenhouse gas, water or waste.`,
      };
    }
    metric = resolved;
  }

  const allowedTypes = GOAL_TYPES_BY_METRIC[metric];
  const typeRaw = text('goal_type');
  let goalType = 'absolute';
  if (typeRaw) {
    const lower = typeRaw.toLowerCase();
    const hit = allowedTypes.find(
      (t) => t.value === lower || t.label.toLowerCase() === lower,
    );
    if (!hit) {
      // Say why rather than just listing the allowed values: a water goal typed
      // as SBTi is a methodology error, not a typo.
      const isGhgOnly = GOAL_TYPES_BY_METRIC.ghg.some(
        (t) => t.value === lower || t.label.toLowerCase() === lower,
      );
      return {
        ok: false,
        error: isGhgOnly
          ? `${GOAL_COLUMN_LABELS.goal_type} "${typeRaw}" applies to greenhouse gas only. `
            + 'It is defined on emissions, so using it for water or waste would invent a methodology.'
          : `Unknown ${GOAL_COLUMN_LABELS.goal_type} "${typeRaw}". Expected one of: `
            + allowedTypes.map((t) => t.label).join(', ') + '.',
      };
    }
    goalType = hit.value;
  }

  const baseYear = parseYear(text('base_year'));
  if (baseYear === null) {
    return {
      ok: false,
      error: `${GOAL_COLUMN_LABELS.base_year} must be a four-digit year, got "${text('base_year')}".`,
    };
  }

  const targetYear = parseYear(text('target_year'));
  if (targetYear === null) {
    return {
      ok: false,
      error: `${GOAL_COLUMN_LABELS.target_year} must be a four-digit year, got "${text('target_year')}".`,
    };
  }

  if (targetYear <= baseYear) {
    return {
      ok: false,
      error: `${GOAL_COLUMN_LABELS.target_year} (${targetYear}) must be after `
        + `${GOAL_COLUMN_LABELS.base_year} (${baseYear}).`,
    };
  }

  let baseYearValue: number | null = null;
  const baseRaw = text('base_year_value');
  if (baseRaw) {
    const parsed = Number(baseRaw.replace(/[,\s]/g, ''));
    if (!Number.isFinite(parsed) || parsed < 0) {
      return {
        ok: false,
        error: `${GOAL_COLUMN_LABELS.base_year_value} must be a number that is not negative, got "${baseRaw}".`,
      };
    }
    baseYearValue = parsed;
  }

  let targetValue: number | null = null;
  let targetUnit: string | null = null;

  const pctRaw = text('reduction_percent');
  let reductionPct: number | null = null;
  if (pctRaw) {
    const parsed = Number(pctRaw.replace(/[%\s]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
      return {
        ok: false,
        error: `${GOAL_COLUMN_LABELS.reduction_percent} must be above 0 and at most 100, got "${pctRaw}".`,
      };
    }
    reductionPct = parsed;
  }

  if (goalType === 'sbti_15c') {
    if (baseYearValue === null) {
      return {
        ok: false,
        error: 'An SBTi 1.5°C target is derived from the baseline, so '
          + `${GOAL_COLUMN_LABELS.base_year_value} is required for it.`,
      };
    }
    // Derived, never read from the file. A typed percentage here would be
    // somebody's arithmetic wearing the name of a standard.
    targetValue = ctx.sbtiReductionPct(baseYearValue, baseYear, targetYear);
    targetUnit = 'pct_reduction';
    if (reductionPct !== null) {
      warnings.push(
        `${name}: ${GOAL_COLUMN_LABELS.reduction_percent} was ignored. An SBTi 1.5°C target is `
        + `computed from the baseline and the years — this one works out at ${targetValue.toFixed(1)}%.`,
      );
    }
  } else if (goalType === 'absolute') {
    if (reductionPct === null) {
      return {
        ok: false,
        error: `${GOAL_COLUMN_LABELS.reduction_percent} is required for an absolute reduction target.`,
      };
    }
    targetValue = reductionPct;
    targetUnit = 'pct_reduction';
  } else if (reductionPct !== null) {
    // An intensity goal's percentage is a reduction in the RATIO. It is kept as
    // entered and never applied to absolute emissions: goalTargetValue returns
    // null for intensity goals (lib/goal-metrics.ts).
    targetValue = reductionPct;
    targetUnit = 'pct_reduction';
  }

  const scope2Raw = text('scope2_method');
  let scope2Method = 'market_based';
  if (scope2Raw) {
    const resolved = resolve(scope2Raw, SCOPE2_METHODS, SCOPE2_METHOD_LABELS);
    if (!resolved) {
      return {
        ok: false,
        error: `Unknown ${GOAL_COLUMN_LABELS.scope2_method} "${scope2Raw}". `
          + 'Expected market-based or location-based.',
      };
    }
    scope2Method = resolved;
  }

  // Scope belongs to a GHG goal only, matching what the form writes. A scope on
  // a water goal is not an error in the file so much as a category mistake, and
  // silently storing it would put a value in a column nothing reads.
  let scope: string | null = null;
  const scopeRaw = text('scope');
  if (metric === 'ghg') {
    if (scopeRaw) {
      const resolved = resolve(scopeRaw, GOAL_SCOPES, GOAL_SCOPE_LABELS);
      if (!resolved) {
        return {
          ok: false,
          error: `Unknown ${GOAL_COLUMN_LABELS.scope} "${scopeRaw}". Expected `
            + Object.values(GOAL_SCOPE_LABELS).join(', ') + '.',
        };
      }
      scope = resolved;
    } else {
      scope = 'scope1_2';
    }
  } else if (scopeRaw) {
    warnings.push(
      `${name}: ${GOAL_COLUMN_LABELS.scope} was ignored — it applies to greenhouse gas goals only.`,
    );
  }

  if (baseYearValue === null) {
    warnings.push(
      `${name}: no ${GOAL_COLUMN_LABELS.base_year_value}, so progress cannot be measured against `
      + 'this goal until a baseline is set.',
    );
  }

  return {
    ok: true,
    goal: {
      name, metric, goalType, scope, baseYear, baseYearValue,
      targetYear, targetValue, targetUnit, scope2Method,
      notes: text('notes') || null,
      warnings,
    },
  };
}

function parseYear(raw: string): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2200) return null;
  return parsed;
}

export interface GoalImportSummary {
  imported: number;
  skipped: number;
  failed: number;
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}
