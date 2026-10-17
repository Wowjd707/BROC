import { describe, it, expect } from 'vitest';
import {
  mapUnitRow, canonicalizeUnitRow, findCycles,
  UNIT_IMPORT_HEADERS, UNIT_COLUMN_LABELS,
} from './business-unit-import-core';

const none = new Set<string>();

const row = (over: Record<string, string> = {}): Record<string, string> => ({
  name: 'Industrial Products', ...over,
});

describe('headers', () => {
  it('are spaced and capitalized, with no underscores', () => {
    expect(UNIT_IMPORT_HEADERS[0]).toBe('Unit Name');
    for (const h of UNIT_IMPORT_HEADERS) expect(h).not.toMatch(/_/);
  });
});

describe('canonicalizeUnitRow', () => {
  it('maps the two labels that do not round-trip', () => {
    // "Parent Unit" is the dangerous one: it is optional, so a missing alias
    // would import every unit as a root and silently flatten the hierarchy the
    // file was uploaded to describe.
    expect(canonicalizeUnitRow({ unit_name: 'A' }).name).toBe('A');
    expect(canonicalizeUnitRow({ parent_unit: 'Group' }).parent).toBe('Group');
  });

  it('accepts the shorthand people type', () => {
    expect(canonicalizeUnitRow({ reports_to: 'Group' }).parent).toBe('Group');
    expect(canonicalizeUnitRow({ order: '3' }).sort_order).toBe('3');
  });

  it('never lets an alias overwrite an explicit column', () => {
    expect(canonicalizeUnitRow({ unit_name: 'Wrong', name: 'Right' }).name).toBe('Right');
  });
});

describe('mapUnitRow', () => {
  it('needs only a name', () => {
    const r = mapUnitRow(row(), none);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.unit.parentName).toBeNull();
      expect(r.unit.sortOrder).toBe(0);
    }
  });

  it('rejects a row with no name', () => {
    const r = mapUnitRow({ code: 'IP' }, none);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(UNIT_COLUMN_LABELS.name);
  });

  it('flags a unit already on the list, case-insensitively', () => {
    const r = mapUnitRow(row({ name: 'industrial products' }), new Set(['industrial products']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect('duplicate' in r && r.duplicate).toBe(true);
  });

  it('refuses a unit that is its own parent', () => {
    // The shortest possible cycle, and the one a spreadsheet produces most
    // easily by copying a row and forgetting to change the parent.
    const r = mapUnitRow(row({ parent: 'Industrial Products' }), none);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/its own/i);
  });

  it('refuses a self-parent regardless of case', () => {
    expect(mapUnitRow(row({ parent: 'INDUSTRIAL products' }), none).ok).toBe(false);
  });

  it('rejects a non-integer sort order', () => {
    expect(mapUnitRow(row({ sort_order: '1.5' }), none).ok).toBe(false);
    expect(mapUnitRow(row({ sort_order: 'first' }), none).ok).toBe(false);
  });

  it('accepts a negative sort order', () => {
    // The column is a plain INTEGER with no constraint, and negative values are
    // a legitimate way to pin something to the top.
    const r = mapUnitRow(row({ sort_order: '-10' }), none);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unit.sortOrder).toBe(-10);
  });

  it('carries the parent as a name for the second pass to resolve', () => {
    const r = mapUnitRow(row({ parent: 'Group' }), none);
    if (r.ok) expect(r.unit.parentName).toBe('Group');
  });
});

describe('findCycles', () => {
  const graph = (pairs: [string, string][]) => new Map(pairs);

  it('finds nothing in a plain tree', () => {
    // group ← industrial ← castings
    expect(findCycles(graph([
      ['castings', 'industrial'],
      ['industrial', 'group'],
    ])).size).toBe(0);
  });

  it('finds a two-unit loop and names both members', () => {
    const found = findCycles(graph([['a', 'b'], ['b', 'a']]));
    expect([...found].sort()).toEqual(['a', 'b']);
  });

  it('finds a longer loop and names every member', () => {
    const found = findCycles(graph([['a', 'b'], ['b', 'c'], ['c', 'a']]));
    expect([...found].sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not accuse a unit that merely points into a loop', () => {
    // d → a → b → c → a. The loop is a, b, c. d hangs off it and is fine; the
    // whole point of naming members is to tell somebody which rows to fix.
    const found = findCycles(graph([['d', 'a'], ['a', 'b'], ['b', 'c'], ['c', 'a']]));
    expect([...found].sort()).toEqual(['a', 'b', 'c']);
    expect(found.has('d')).toBe(false);
  });

  it('treats a missing parent as not a cycle', () => {
    // An unresolved parent is reported separately: the unit is real, the link
    // just could not be made.
    expect(findCycles(graph([['a', 'nobody']])).size).toBe(0);
  });

  it('handles two independent loops in one file', () => {
    const found = findCycles(graph([
      ['a', 'b'], ['b', 'a'],
      ['x', 'y'], ['y', 'z'], ['z', 'x'],
    ]));
    expect([...found].sort()).toEqual(['a', 'b', 'x', 'y', 'z']);
  });

  it('finds a self-loop', () => {
    expect([...findCycles(graph([['a', 'a']]))]).toEqual(['a']);
  });

  it('does not walk forever on a long chain', () => {
    // The database refuses a hierarchy deeper than 50; this must terminate on a
    // legitimate deep tree rather than looking like a cycle.
    const pairs: [string, string][] = [];
    for (let i = 0; i < 200; i++) pairs.push([`n${i}`, `n${i + 1}`]);
    expect(findCycles(graph(pairs)).size).toBe(0);
  });
});
