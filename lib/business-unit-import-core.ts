/**
 * Pure mapping and validation for bulk business-unit uploads.
 *
 * The hierarchy is what makes this different from the site and supplier
 * importers. A business unit can name a parent, and a flat file has no way to
 * guarantee the parent appears first — somebody exporting an org chart will list
 * it alphabetically or by division, not in dependency order. So parents are
 * resolved by name in a second pass, after every row exists, which means the
 * file may declare a child before its parent and still load.
 *
 * That freedom brings the failure the database already guards against:
 * migration 015 has a trigger refusing a cycle (A→B→A) because a recursive
 * roll-up over one would hang. The trigger is the backstop, not the interface —
 * a cycle written into a spreadsheet should be reported as "rows 4, 7 and 9
 * form a loop", not as a Postgres exception mentioning a trigger name. So
 * `findCycles` looks for them here first.
 */

export const UNIT_IMPORT_COLUMNS = [
  'name', 'code', 'parent', 'sort_order', 'description',
] as const;

export type UnitImportColumn = (typeof UNIT_IMPORT_COLUMNS)[number];

export const UNIT_COLUMN_LABELS: Record<UnitImportColumn, string> = {
  name: 'Unit Name',
  code: 'Code',
  parent: 'Parent Unit',
  sort_order: 'Sort Order',
  description: 'Description',
};

export const UNIT_IMPORT_HEADERS: string[] =
  UNIT_IMPORT_COLUMNS.map((c) => UNIT_COLUMN_LABELS[c]);

/** The marker on the template's example rows. Shared with the generator. */
export const UNIT_EXAMPLE_ROW_NOTE = 'Example row — delete before uploading';

/**
 * Header spellings that do not survive `lib/csv.ts`.
 *
 * Two of the labels fail to round-trip: "Unit Name" becomes unit_name rather
 * than name, and "Parent Unit" becomes parent_unit rather than parent. The first
 * fails loudly because a name is required. The second would not — it would
 * import every unit as a root, silently flattening the hierarchy the file was
 * uploaded to describe.
 */
const HEADER_ALIASES: Record<string, UnitImportColumn> = {
  unit_name: 'name',
  business_unit: 'name',
  unit: 'name',
  parent_unit: 'parent',
  parent_name: 'parent',
  reports_to: 'parent',
  unit_code: 'code',
  order: 'sort_order',
  sort: 'sort_order',
};

export function canonicalizeUnitRow(row: Record<string, string>): Record<string, string> {
  const out = { ...row };
  for (const [alias, canonical] of Object.entries(HEADER_ALIASES)) {
    if (out[alias] !== undefined && out[canonical] === undefined) {
      out[canonical] = out[alias];
    }
  }
  return out;
}

export interface MappedUnit {
  name: string;
  code: string | null;
  /** The parent's name as written; resolved to an id in a second pass. */
  parentName: string | null;
  sortOrder: number;
  description: string | null;
}

export type UnitRowResult =
  | { ok: true; unit: MappedUnit }
  | { ok: false; error: string }
  | { ok: false; error: string; duplicate: true };

export function mapUnitRow(
  input: Record<string, string>,
  existingNames: Set<string>,
): UnitRowResult {
  const row = canonicalizeUnitRow(input);
  const text = (key: UnitImportColumn): string => (row[key] ?? '').trim();

  const name = text('name');
  if (!name) return { ok: false, error: `Missing ${UNIT_COLUMN_LABELS.name}.` };

  if (existingNames.has(name.toLowerCase())) {
    return { ok: false, duplicate: true, error: `${name} is already one of your business units.` };
  }

  const parentName = text('parent') || null;
  if (parentName && parentName.toLowerCase() === name.toLowerCase()) {
    return {
      ok: false,
      error: `${name} is listed as its own ${UNIT_COLUMN_LABELS.parent}.`,
    };
  }

  let sortOrder = 0;
  const orderRaw = text('sort_order');
  if (orderRaw) {
    const parsed = Number(orderRaw);
    if (!Number.isInteger(parsed)) {
      return {
        ok: false,
        error: `${UNIT_COLUMN_LABELS.sort_order} must be a whole number, got "${orderRaw}".`,
      };
    }
    sortOrder = parsed;
  }

  return {
    ok: true,
    unit: {
      name,
      code: text('code') || null,
      parentName,
      sortOrder,
      description: text('description') || null,
    },
  };
}

/**
 * Find cycles in the parent relationships the file describes.
 *
 * Runs over the file's own rows plus the parents of units already stored, so a
 * row pointing at an existing unit whose ancestry loops back into the file is
 * caught too. Names are compared lowercased, because that is how the parent
 * lookup resolves them.
 *
 * Returns one entry per member of each cycle found, so the caller can report the
 * offending rows rather than a single opaque failure. A row whose parent simply
 * does not exist is not a cycle and is not reported here — the importer treats
 * that as an unresolved parent and says so separately.
 */
export function findCycles(
  parentByName: Map<string, string>,
): Set<string> {
  const inCycle = new Set<string>();
  // 0 = unvisited, 1 = on the current path, 2 = finished and known acyclic.
  const state = new Map<string, number>();

  for (const start of parentByName.keys()) {
    if (state.get(start)) continue;

    const path: string[] = [];
    let node: string | undefined = start;

    while (node !== undefined && state.get(node) !== 2) {
      if (state.get(node) === 1) {
        // Found a loop: everything from where this name first appeared on the
        // current path onwards is part of it.
        const from = path.indexOf(node);
        for (const member of path.slice(from)) inCycle.add(member);
        break;
      }
      state.set(node, 1);
      path.push(node);
      node = parentByName.get(node);
    }

    // Everything on this path is resolved now, whether or not it looped.
    for (const member of path) {
      if (!inCycle.has(member)) state.set(member, 2);
    }
  }

  return inCycle;
}

export interface UnitImportSummary {
  imported: number;
  /** Already one of your units; not an error, and not re-added. */
  skipped: number;
  failed: number;
  /** Rows that landed but whose parent could not be linked. */
  unresolvedParents: number;
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}
