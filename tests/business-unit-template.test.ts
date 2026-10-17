/**
 * The business-unit template, built, read back and mapped.
 *
 * The hierarchy is what this file is for, so the assertions worth having are
 * about the hierarchy: that "Parent Unit" survives the header round trip, that
 * the example rows demonstrate a child listed before its parent, and that the
 * Parent dropdown is not strict — a strict list would refuse the commonest use
 * of the file, which is uploading a whole org chart whose parents are other rows
 * in the same upload.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('server-only', () => ({}));

import { buildBusinessUnitTemplate } from '../lib/business-unit-template-xlsx';
import {
  mapUnitRow, canonicalizeUnitRow, findCycles,
  UNIT_IMPORT_HEADERS, UNIT_EXAMPLE_ROW_NOTE,
} from '../lib/business-unit-import-core';

const none = new Set<string>();
const existing = [{ name: 'Group' }, { name: 'Shared Services' }];

let buffer: Buffer;
let wb: ExcelJS.Workbook;

beforeAll(async () => {
  buffer = await buildBusinessUnitTemplate(existing);
  wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
}, 60_000);

function readRows(book: ExcelJS.Workbook): Record<string, string>[] {
  const sheet = book.getWorksheet('Business Units')!;
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  });

  const out: Record<string, string>[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const rec: Record<string, string> = {};
    let any = false;
    headers.forEach((k, i) => {
      if (!k) return;
      const v = row.getCell(i + 1).value;
      const text = v === null || v === undefined ? '' : String(v).trim();
      rec[k] = text;
      if (text) any = true;
    });
    if (any) out.push(rec);
  }
  return out;
}

describe('business unit template', () => {
  it('has the three sheets', () => {
    expect(wb.getWorksheet('Business Units')).toBeDefined();
    expect(wb.getWorksheet('Lists')).toBeDefined();
    expect(wb.getWorksheet('How to use')).toBeDefined();
  });

  it('writes spaced, capitalized headers with no underscores', () => {
    const header = wb.getWorksheet('Business Units')!.getRow(1);
    expect(UNIT_IMPORT_HEADERS.map((_, i) => header.getCell(i + 1).value))
      .toEqual(UNIT_IMPORT_HEADERS);
    for (const h of UNIT_IMPORT_HEADERS) expect(h).not.toMatch(/_/);
  });

  it('offers the units this organization already has', () => {
    const lists = wb.getWorksheet('Lists')!;
    const values: string[] = [];
    lists.getColumn(1).eachCell((c) => { if (typeof c.value === 'string') values.push(c.value); });
    expect(values).toContain('Group');
    expect(values).toContain('Shared Services');
  });

  it('leaves Parent Unit open to a typed value', () => {
    // The assertion that matters most. A strict list would refuse a parent
    // defined elsewhere in the same file, which is the whole point of a bulk
    // upload of an org chart.
    const sheet = wb.getWorksheet('Business Units')!;
    const col = UNIT_IMPORT_HEADERS.indexOf('Parent Unit') + 1;
    const dv = sheet.getRow(8).getCell(col).dataValidation;
    expect(dv?.type).toBe('list');
    expect(dv?.showErrorMessage).toBeFalsy();
  });

  it('bounds Sort Order to whole numbers', () => {
    const sheet = wb.getWorksheet('Business Units')!;
    const col = UNIT_IMPORT_HEADERS.indexOf('Sort Order') + 1;
    expect(sheet.getRow(8).getCell(col).dataValidation?.type).toBe('whole');
  });

  it('says the row order does not matter, and that loops are refused', () => {
    const guide = wb.getWorksheet('How to use')!;
    const text: string[] = [];
    guide.getColumn(1).eachCell((c) => { if (typeof c.value === 'string') text.push(c.value); });
    const all = text.join(' ');
    expect(all).toMatch(/order of rows does not matter/i);
    expect(all).toMatch(/loops are refused/i);
  });

  it('tells an organization with no units that parents must come from the file', async () => {
    const empty = new ExcelJS.Workbook();
    await empty.xlsx.load((await buildBusinessUnitTemplate([])) as unknown as ArrayBuffer);
    const guide = empty.getWorksheet('How to use')!;
    const text: string[] = [];
    guide.getColumn(1).eachCell((c) => { if (typeof c.value === 'string') text.push(c.value); });
    expect(text.join(' ')).toMatch(/no business units yet/i);
  });
});

describe('the example rows', () => {
  it('are all marked for deletion', () => {
    const rows = readRows(wb);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows.slice(0, 3)) {
      expect(r.unit_name).toContain(UNIT_EXAMPLE_ROW_NOTE);
    }
  });

  it('list a child before its parent, which is the point of them', () => {
    // Castings → Industrial Products → Group, in that order down the sheet. A
    // single example row could not show that the ordering is free.
    const rows = readRows(wb);
    expect(rows[0].unit_name).toMatch(/^Castings/);
    expect(rows[0].parent_unit).toBe('Industrial Products');
    expect(rows[1].unit_name).toMatch(/^Industrial Products/);
    expect(rows[2].parent_unit).toBe('');
  });

  it('describe a hierarchy with no loop in it', () => {
    // The examples must not themselves trip the cycle check.
    const rows = readRows(wb);
    const parents = new Map<string, string>();
    for (const r of rows.slice(0, 3)) {
      // Strip the example marker to recover the bare names.
      const name = r.unit_name.replace(/\s*\(.*\)$/, '').toLowerCase();
      if (r.parent_unit) parents.set(name, r.parent_unit.toLowerCase());
    }
    expect(findCycles(parents).size).toBe(0);
  });
});

describe('a filled template maps cleanly', () => {
  it('carries Parent Unit through the alias, not by luck', async () => {
    // "Parent Unit" normalizes to parent_unit, not parent. It is optional, so a
    // missing alias would import every unit as a root and silently flatten the
    // hierarchy the file exists to describe.
    const normalized = UNIT_IMPORT_HEADERS.map(
      h => h.trim().toLowerCase().replace(/\s+/g, '_'),
    );
    expect(normalized).toContain('parent_unit');
    expect(normalized).not.toContain('parent');

    const mapped = mapUnitRow(
      canonicalizeUnitRow({ unit_name: 'Castings', parent_unit: 'Industrial Products' }),
      none,
    );
    expect(mapped.ok).toBe(true);
    if (mapped.ok) expect(mapped.unit.parentName).toBe('Industrial Products');
  });

  it('reads a filled row back onto the keys the mapper reads', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = book.getWorksheet('Business Units')!;

    const values: Record<string, string | number> = {
      'Unit Name': 'Coatings',
      Code: 'IP-COAT',
      'Parent Unit': 'Group',
      'Sort Order': 3,
      Description: 'Surface treatment',
    };

    const row = sheet.getRow(8);
    UNIT_IMPORT_HEADERS.forEach((label, i) => {
      const v = values[label];
      if (v !== undefined) row.getCell(i + 1).value = v;
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load((await book.xlsx.writeBuffer()) as unknown as ArrayBuffer);
    const filled = readRows(out).find(r => r.unit_name === 'Coatings');
    expect(filled).toBeDefined();

    const mapped = mapUnitRow(canonicalizeUnitRow(filled!), none);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.unit).toEqual({
        name: 'Coatings',
        code: 'IP-COAT',
        parentName: 'Group',
        sortOrder: 3,
        description: 'Surface treatment',
      });
    }
  });
});
