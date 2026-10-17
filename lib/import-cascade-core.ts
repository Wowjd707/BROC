/**
 * Cascading options and suggestions for staged imports.
 *
 * One rule shapes this whole module: **the cascade may narrow a choice, and it
 * may suggest a value, but it never silently decides one that changes which
 * total a number lands in.**
 *
 * The temptation is obvious. A user picks diesel, so set Scope 1 and move on.
 * But diesel is Scope 1 only when it is burned in equipment the organization
 * owns or controls. The same litre in a third-party haulier's truck is Scope 3
 * Category 4, and `DECISIONS.md` records as a standing decision that Scope 3 is
 * never folded into a Scope 1+2 total. An autofill that quietly picks Scope 1
 * from the fuel is a mechanism for producing exactly that misstatement, at
 * import scale, with nothing on screen to say it happened.
 *
 * So `suggestScope` returns a suggestion carrying its reason and whether it
 * needs confirming. The review screen shows it pre-filled and marked as
 * machine-set, and anything still machine-set at commit is written to the
 * adjustment log with `origin: 'auto'`. An assurance provider can then ask what
 * the file said, what the system proposed, and what a person decided — three
 * different questions that a silent autofill collapses into one unanswerable
 * one.
 *
 * Pure and dependency-free, like the other `*-core.ts` modules. Catalogs are
 * passed in rather than imported so this stays testable without a database and
 * so an organization's own metrics flow through the same rules as the seeded ones.
 */

export type EntryFamily = 'emissions' | 'water' | 'waste' | 'social' | 'governance';

export type Scope = 'scope1' | 'scope2';

export type Scope1Category =
  | 'stationary_combustion'
  | 'mobile_combustion'
  | 'process_emissions'
  | 'fugitive_emissions';

/**
 * A metric the platform can hold, as `sustainability_metrics` defines it.
 * Passed in rather than read here — the table is the source of truth and a
 * deploying organization may have added rows to it.
 */
export interface MetricCatalogEntry {
  metricType: string;
  sourceType: string;
  label: string;
  canonicalUnit: string;
  aggregation: 'sum' | 'point_in_time' | 'average';
}

/** A value the cascade proposes, and what a reviewer needs to judge it. */
export interface Suggestion<T> {
  value: T | null;
  /** False when the suggestion is certain enough to apply without a human. */
  requiresConfirmation: boolean;
  /** Shown next to the field. Written for a reporting analyst, not a developer. */
  reason: string;
}

// ─── Fuel → Scope 1 category ─────────────────────────────────────────────────

/**
 * Which Scope 1 categories a fuel can legitimately fall into.
 *
 * This narrows a dropdown; it does not decide. Where a fuel genuinely has two
 * common uses the list stays two long and no default is offered, because
 * guessing between a boiler and a fleet is guessing at the emission factor.
 *
 * Absent from this map means "no constraint" — every category stays available.
 */
const SCOPE1_CATEGORIES_BY_SOURCE: Record<string, Scope1Category[]> = {
  // Burned in fixed plant. A natural-gas vehicle fleet exists but is rare
  // enough that offering it by default would mislead more often than help.
  natural_gas: ['stationary_combustion', 'mobile_combustion'],
  fuel_oil_no2: ['stationary_combustion'],
  fuel_oil_no4: ['stationary_combustion'],
  fuel_oil_no6: ['stationary_combustion'],
  coal_anthracite: ['stationary_combustion'],
  coal_bituminous: ['stationary_combustion'],
  coal_subbituminous: ['stationary_combustion'],
  coal_lignite: ['stationary_combustion'],
  wood_biomass: ['stationary_combustion'],
  kerosene: ['stationary_combustion'],

  // Genuinely ambiguous. Diesel runs standby generators and it runs fleets;
  // propane and LPG heat buildings and run forklifts. Two entries, same fuel,
  // different category, and only the person who owns the data knows which.
  diesel: ['stationary_combustion', 'mobile_combustion'],
  gasoline: ['mobile_combustion', 'stationary_combustion'],
  propane: ['stationary_combustion', 'mobile_combustion'],
  lpg: ['stationary_combustion', 'mobile_combustion'],

  // Leaks, not combustion. The only fuel-like source with one honest answer.
  refrigerants: ['fugitive_emissions'],

  other_combustion: [
    'stationary_combustion', 'mobile_combustion',
    'process_emissions', 'fugitive_emissions',
  ],
};

/** Scope 2 sources take no Scope 1 category at all. */
const SCOPE2_SOURCES = new Set([
  'electricity', 'district_heating', 'renewable_purchased', 'renewable_generated',
]);

/**
 * The Scope 1 categories still open for a source, in the order they should be
 * offered. An unknown source is unconstrained rather than empty: an organization who
 * has added their own source type should get every option, not none.
 */
export function scope1CategoriesFor(sourceType: string): Scope1Category[] {
  if (SCOPE2_SOURCES.has(sourceType)) return [];
  return SCOPE1_CATEGORIES_BY_SOURCE[sourceType] ?? [
    'stationary_combustion', 'mobile_combustion',
    'process_emissions', 'fugitive_emissions',
  ];
}

/**
 * The category to pre-fill, if any.
 *
 * Offered only where the fuel has exactly one legitimate category. Where two
 * are open the suggestion is null and the reviewer picks — a default of
 * "stationary" on diesel would be right most of the time, and the times it was
 * wrong would be a fleet silently reported as a boiler.
 */
export function suggestScope1Category(sourceType: string): Suggestion<Scope1Category> {
  const options = scope1CategoriesFor(sourceType);

  if (options.length === 0) {
    return {
      value: null,
      requiresConfirmation: false,
      reason: 'Scope 2 sources are not split by Scope 1 category.',
    };
  }
  if (options.length === 1) {
    return {
      value: options[0],
      requiresConfirmation: false,
      reason: `${humanize(sourceType)} only arises as ${humanize(options[0])}.`,
    };
  }
  return {
    value: null,
    requiresConfirmation: true,
    reason: `${humanize(sourceType)} is used both ways — ${options
      .map(humanize).join(' and ')}. Pick the one that matches this equipment.`,
  };
}

// ─── Source → scope ──────────────────────────────────────────────────────────

/**
 * The scope to pre-fill, and whether a person must confirm it.
 *
 * Purchased energy is safe to set: buying grid electricity is Scope 2 by
 * definition, and there is no ownership question to get wrong.
 *
 * Combustion fuels are not. They are Scope 1 **if the organization owns or
 * controls the equipment**, and that fact is not in the fuel, the site or the
 * quantity — it is in the boundary, which lives in the consolidation settings
 * and in the head of whoever collected the data. So the fuel suggests Scope 1
 * and says why it might be wrong.
 */
export function suggestScope(sourceType: string): Suggestion<Scope> {
  if (SCOPE2_SOURCES.has(sourceType)) {
    return {
      value: 'scope2',
      requiresConfirmation: false,
      reason: 'Purchased energy is Scope 2 regardless of who owns the equipment.',
    };
  }

  if (sourceType === 'refrigerants') {
    return {
      value: 'scope1',
      requiresConfirmation: true,
      reason:
        'Refrigerant leakage from equipment you own or control is Scope 1. ' +
        'Leakage from leased equipment outside your boundary is Scope 3.',
    };
  }

  if (SCOPE1_CATEGORIES_BY_SOURCE[sourceType]) {
    return {
      value: 'scope1',
      requiresConfirmation: true,
      reason:
        `${humanize(sourceType)} is Scope 1 when burned in equipment you own or control. ` +
        'Burned on your behalf by a third party — a haulier, a landlord — it is Scope 3, ' +
        'which must not enter the Scope 1+2 total. Confirm against your boundary.',
    };
  }

  return {
    value: null,
    requiresConfirmation: true,
    reason: `No scope can be inferred from "${sourceType}". Choose one.`,
  };
}

// ─── Family → available metrics ──────────────────────────────────────────────

/**
 * Which metrics are offered once a family is chosen.
 *
 * Read from the catalog rather than hardcoded, so an organization who adds a row to
 * `sustainability_metrics` gets it in the importer without a release — the
 * "config over hardcoding" rule in CLAUDE.md, and the reason that table exists.
 */
export function metricsForFamily(
  family: Exclude<EntryFamily, 'emissions'>,
  catalog: MetricCatalogEntry[],
): MetricCatalogEntry[] {
  const wanted = FAMILY_METRIC_TYPES[family];
  return catalog
    .filter((m) => wanted.includes(m.metricType))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The `metric_type` values each importer family covers.
 *
 * Water and waste are one family each. Social and governance are groupings of
 * several, which is why this is a map rather than an identity: a reviewer
 * thinks "safety numbers", not "the safety metric_type".
 */
const FAMILY_METRIC_TYPES: Record<Exclude<EntryFamily, 'emissions'>, string[]> = {
  water: ['water'],
  waste: ['waste'],
  social: ['safety', 'workforce', 'training'],
  governance: ['governance'],
};

/**
 * The unit an entry of this metric must end up in.
 *
 * Always the metric's own canonical unit, never the family's. Migration 023
 * records why: `safety` holds both incident counts and hours worked, so a unit
 * inferred from the family would turn a count into a duration. There is no
 * suggestion to confirm here — the catalog is authoritative.
 */
export function canonicalUnitFor(
  metricType: string,
  sourceType: string,
  catalog: MetricCatalogEntry[],
): string | null {
  const hit = catalog.find(
    (m) => m.metricType === metricType && m.sourceType === sourceType,
  );
  return hit?.canonicalUnit ?? null;
}

/**
 * True when this metric must not be summed over a reporting period.
 *
 * Surfaced during review because an import is where it goes wrong at volume:
 * twelve monthly headcount rows look like a year of data and sum to twelve
 * workforces. The importer does not block it — monthly headcount is legitimate
 * to store — it warns, so nobody discovers the aggregation rule from a report.
 */
export function isPointInTime(
  metricType: string,
  sourceType: string,
  catalog: MetricCatalogEntry[],
): boolean {
  const hit = catalog.find(
    (m) => m.metricType === metricType && m.sourceType === sourceType,
  );
  return hit?.aggregation === 'point_in_time';
}

// ─── Applying the cascade to a staged row ────────────────────────────────────

/** One field the cascade proposes to change, ready for the adjustment log. */
export interface ProposedAdjustment {
  field: string;
  from: string | null;
  to: string | null;
  reason: string;
  /** True where a reviewer must look at it before this row may be committed. */
  requiresConfirmation: boolean;
}

/**
 * Work out what the cascade would change about an emissions row.
 *
 * Returns proposals rather than a mutated row. The caller decides whether to
 * apply them, and every applied proposal becomes a logged adjustment — which is
 * the difference between a system that corrected your file and a system that
 * can tell you how.
 *
 * A field the file already filled in is never overwritten. An operator who
 * wrote `scope2` against diesel has said something, and silently replacing it
 * would hide a disagreement worth seeing; it surfaces as a conflict instead.
 */
export function proposeEmissionAdjustments(row: {
  sourceType: string;
  scope: string | null;
  scope1Category: string | null;
}): ProposedAdjustment[] {
  const out: ProposedAdjustment[] = [];

  const scope = suggestScope(row.sourceType);
  if (!row.scope && scope.value) {
    out.push({
      field: 'scope',
      from: null,
      to: scope.value,
      reason: scope.reason,
      requiresConfirmation: scope.requiresConfirmation,
    });
  } else if (row.scope && scope.value && row.scope !== scope.value) {
    // Not an error. Leased-asset fuel legitimately sits outside Scope 1, and
    // the file may be right. Flag it and let a person look.
    out.push({
      field: 'scope',
      from: row.scope,
      to: null,
      reason:
        `The file says ${row.scope}, but ${humanize(row.sourceType)} is normally ` +
        `${scope.value}. Both can be correct depending on your boundary — confirm which applies.`,
      requiresConfirmation: true,
    });
  }

  const effectiveScope = row.scope ?? scope.value;
  if (effectiveScope === 'scope1') {
    const category = suggestScope1Category(row.sourceType);
    const allowed = scope1CategoriesFor(row.sourceType);

    if (!row.scope1Category && category.value) {
      out.push({
        field: 'scope1Category',
        from: null,
        to: category.value,
        reason: category.reason,
        requiresConfirmation: category.requiresConfirmation,
      });
    } else if (!row.scope1Category && category.requiresConfirmation) {
      out.push({
        field: 'scope1Category',
        from: null,
        to: null,
        reason: category.reason,
        requiresConfirmation: true,
      });
    } else if (
      row.scope1Category &&
      allowed.length > 0 &&
      !allowed.includes(row.scope1Category as Scope1Category)
    ) {
      out.push({
        field: 'scope1Category',
        from: row.scope1Category,
        to: null,
        reason:
          `${humanize(row.scope1Category)} is not a category ${humanize(row.sourceType)} ` +
          `arises in. Expected ${allowed.map(humanize).join(' or ')}.`,
        requiresConfirmation: true,
      });
    }
  }

  return out;
}

/** `mobile_combustion` → `mobile combustion`. Labels come from source-labels. */
function humanize(key: string): string {
  return key.replace(/_/g, ' ');
}
