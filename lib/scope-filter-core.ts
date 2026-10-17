/**
 * Resolving a reporting scope selection to a concrete set of sites.
 *
 * Every module filters the same way: the user picks "all sites", one site, a
 * business unit (which includes everything beneath it), or a custom group. That
 * selection travels in the URL so server components can read it and filter at
 * the query, rather than fetching everything and hiding rows client-side.
 *
 * Pure and dependency-free so it is unit-testable, and so the same resolution
 * runs identically on the server and in the browser.
 */

export type ScopeKind = 'all' | 'site' | 'business_unit' | 'group';

export interface ScopeSelection {
  kind: ScopeKind;
  /** Absent for 'all'. */
  id?: string;
}

export const ALL_SITES: ScopeSelection = { kind: 'all' };

// ─── URL encoding ────────────────────────────────────────────────────────────

/** Encode a selection for the `scope` query parameter. */
export function encodeScope(scope: ScopeSelection): string {
  if (scope.kind === 'all' || !scope.id) return 'all';
  return `${scope.kind}:${scope.id}`;
}

/**
 * Parse the `scope` query parameter. Anything unrecognised falls back to all
 * sites — a malformed URL should show the whole organization, never an
 * arbitrary subset that the user might mistake for the full picture.
 */
export function parseScope(raw: string | undefined | null): ScopeSelection {
  if (!raw || raw === 'all') return ALL_SITES;
  const sep = raw.indexOf(':');
  if (sep <= 0) return ALL_SITES;

  const kind = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!id) return ALL_SITES;
  if (kind !== 'site' && kind !== 'business_unit' && kind !== 'group') return ALL_SITES;

  return { kind, id };
}

// ─── Business unit tree ──────────────────────────────────────────────────────

export interface BusinessUnitLike {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order?: number;
}

export interface BusinessUnitNode extends BusinessUnitLike {
  depth: number;
  children: BusinessUnitNode[];
}

/**
 * Build the unit forest. Units whose parent is missing (deleted, or outside the
 * visible set) are treated as roots rather than dropped — losing a whole branch
 * from a roll-up because of one dangling reference would silently understate
 * every number beneath it.
 */
export function buildUnitTree(units: BusinessUnitLike[]): BusinessUnitNode[] {
  const byId = new Map<string, BusinessUnitNode>();
  for (const u of units) {
    byId.set(u.id, { ...u, depth: 0, children: [] });
  }

  const roots: BusinessUnitNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (nodes: BusinessUnitNode[], depth: number) => {
    nodes.sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name),
    );
    for (const n of nodes) {
      n.depth = depth;
      sortNodes(n.children, depth + 1);
    }
  };
  sortNodes(roots, 0);

  return roots;
}

/** Depth-first flatten, for rendering an indented picker. */
export function flattenUnitTree(roots: BusinessUnitNode[]): BusinessUnitNode[] {
  const out: BusinessUnitNode[] = [];
  const walk = (nodes: BusinessUnitNode[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/**
 * A unit and every unit beneath it. Guards against cycles defensively — the
 * database prevents them, but this also runs on data supplied by the client.
 */
export function unitAndDescendantIds(units: BusinessUnitLike[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const u of units) {
    if (!u.parent_id) continue;
    childrenOf.set(u.parent_id, [...(childrenOf.get(u.parent_id) ?? []), u.id]);
  }

  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const child of childrenOf.get(id) ?? []) {
      if (!seen.has(child)) queue.push(child);
    }
  }
  return Array.from(seen);
}

// ─── Resolution to site ids ──────────────────────────────────────────────────

export interface SiteLike {
  id: string;
  business_unit_id?: string | null;
}

export interface GroupMembership {
  group_id: string;
  site_id: string;
}

/**
 * The sites a selection covers.
 *
 * Returns `null` for "all sites" — meaningfully different from an empty array.
 * `null` means "apply no filter"; `[]` means "this selection genuinely matches
 * nothing", which must still produce zeros rather than silently showing
 * everything. Collapsing the two is how a filtered view ends up presenting
 * whole-organization totals under a unit's name.
 */
export function resolveScopeToSiteIds(
  scope: ScopeSelection,
  sites: SiteLike[],
  units: BusinessUnitLike[],
  memberships: GroupMembership[],
): string[] | null {
  switch (scope.kind) {
    case 'all':
      return null;

    case 'site':
      return sites.some((s) => s.id === scope.id) ? [scope.id!] : [];

    case 'business_unit': {
      const unitIds = new Set(unitAndDescendantIds(units, scope.id!));
      return sites
        .filter((s) => s.business_unit_id && unitIds.has(s.business_unit_id))
        .map((s) => s.id);
    }

    case 'group': {
      const siteIds = new Set(
        memberships.filter((m) => m.group_id === scope.id).map((m) => m.site_id),
      );
      return sites.filter((s) => siteIds.has(s.id)).map((s) => s.id);
    }
  }
}

/** Human-readable label for the current selection, for page headers. */
export function scopeLabel(
  scope: ScopeSelection,
  sites: { id: string; name: string }[],
  units: { id: string; name: string }[],
  groups: { id: string; name: string }[],
): string {
  switch (scope.kind) {
    case 'all': return 'All sites';
    case 'site': return sites.find((s) => s.id === scope.id)?.name ?? 'Unknown site';
    case 'business_unit': return units.find((u) => u.id === scope.id)?.name ?? 'Unknown business unit';
    case 'group': return groups.find((g) => g.id === scope.id)?.name ?? 'Unknown group';
  }
}
