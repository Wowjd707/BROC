import 'server-only';
import { createServerClient } from './supabase/server';
import {
  parseScope, resolveScopeToSiteIds, scopeLabel,
  type ScopeSelection,
} from './scope-filter-core';

export * from './scope-filter-core';

export interface ResolvedScope {
  selection: ScopeSelection;
  /** null = no filter (all sites). [] = matches nothing. */
  siteIds: string[] | null;
  label: string;
  /** Everything the picker needs to render. */
  sites: { id: string; name: string; business_unit_id: string | null }[];
  units: { id: string; parent_id: string | null; name: string; sort_order: number }[];
  groups: { id: string; name: string }[];
}

/**
 * Resolve the `scope` search param into a concrete site filter, plus the
 * options the picker needs. All reads are RLS-scoped to the caller's org.
 *
 * Pages apply the result with `applyScope(query, siteIds)` so filtering happens
 * in the database rather than by hiding rows after the fact.
 */
export async function resolveScope(rawScope: string | undefined): Promise<ResolvedScope> {
  const supabase = await createServerClient();
  const selection = parseScope(rawScope);

  const [{ data: sites }, { data: units }, { data: groups }, { data: memberships }] =
    await Promise.all([
      supabase.from('sites').select('id, name, business_unit_id').eq('is_active', true).order('name'),
      supabase.from('business_units').select('id, parent_id, name, sort_order')
        .eq('is_active', true).order('sort_order').order('name'),
      supabase.from('site_groups').select('id, name').order('name'),
      supabase.from('site_group_members').select('group_id, site_id'),
    ]);

  const siteList = sites ?? [];
  const unitList = units ?? [];
  const groupList = groups ?? [];

  return {
    selection,
    siteIds: resolveScopeToSiteIds(selection, siteList, unitList, memberships ?? []),
    label: scopeLabel(selection, siteList, unitList, groupList),
    sites: siteList,
    units: unitList,
    groups: groupList,
  };
}

/**
 * Apply a resolved site filter to a PostgREST query builder.
 *
 * `null` means all sites, so the query is returned untouched. An EMPTY array is
 * applied as `in ()`, which correctly matches nothing — returning the query
 * unfiltered there would show whole-organization totals under a filtered
 * heading, which is the worst possible failure for a reporting tool.
 */
export function applyScope<T extends { in: (col: string, values: readonly string[]) => T }>(
  query: T,
  siteIds: string[] | null,
  column = 'site_id',
): T {
  if (siteIds === null) return query;
  return query.in(column, siteIds);
}
