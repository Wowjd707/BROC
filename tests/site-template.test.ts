/**
 * The site template, built, read back and mapped.
 *
 * The round trip that has now caught a real fault in each of the three
 * templates. Here the one to watch is "Operated Or Controlled": it normalizes to
 * operated_or_controlled rather than is_controlled, and because the field is
 * optional a broken alias would not error — every site would import as
 * controlled, which under a control-based consolidation approach decides whether
 * a joint venture contributes everything or nothing.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('server-only', () => ({}));

import { buildSiteTemplate } from '../lib/site-template-xlsx';
import {
  mapSiteRow, canonicalizeSiteRow,
  SITE_IMPORT_HEADERS, SITE_EXAMPLE_ROW_NOTE,
} from '../lib/site-import-core';

const none = new Set<string>();
const units = [{ name: 'Industrial Products' }, { name: 'Consumer Goods' }];

let buffer: Buffer;
let wb: ExcelJS.Workbook;

beforeAll(async () => {
  buffer = await buildSiteTemplate(units);
  wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
}, 60_000);

/** Read the sheet the way lib/csv.ts and parseWorkbook normalize headers. */
function readRows(book: ExcelJS.Workbook): Record<string, string>[] {
  const sheet = book.getWorksheet('Sites')!;
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

describe('site template', () => {
  it('has the three sheets', () => {
    expect(wb.getWorksheet('Sites')).toBeDefined();
    expect(wb.getWorksheet('Lists')).toBeDefined();
    expect(wb.getWorksheet('How to use')).toBeDefined();
  });

  it('writes spaced, capitalized headers with no underscores', () => {
    const header = wb.getWorksheet('Sites')!.getRow(1);
    expect(SITE_IMPORT_HEADERS.map((_, i) => header.getCell(i + 1).value))
      .toEqual(SITE_IMPORT_HEADERS);
    for (const h of SITE_IMPORT_HEADERS) expect(h).not.toMatch(/_/);
  });

  it('offers this organization’s own business units', () => {
    const lists = wb.getWorksheet('Lists')!;
    const values: string[] = [];
    lists.getColumn(4).eachCell((c) => { if (typeof c.value === 'string') values.push(c.value); });
    expect(values).toContain('Industrial Products');
    expect(values).toContain('Consumer Goods');
  });

  it('constrains Site Type strictly, because the column has a CHECK', () => {
    const sheet = wb.getWorksheet('Sites')!;
    const col = SITE_IMPORT_HEADERS.indexOf('Site Type') + 1;
    const dv = sheet.getRow(5).getCell(col).dataValidation;
    expect(dv?.type).toBe('list');
    expect(dv?.showErrorMessage).toBe(true);
  });

  it('leaves Country and Business Unit open to a typed value', () => {
    // A country the list forgot must still be enterable, and a unit that does
    // not match is recoverable — the site imports unassigned and says so.
    const sheet = wb.getWorksheet('Sites')!;
    for (const label of ['Country', 'Business Unit']) {
      const col = SITE_IMPORT_HEADERS.indexOf(label) + 1;
      expect(sheet.getRow(5).getCell(col).dataValidation?.showErrorMessage).toBeFalsy();
    }
  });

  it('bounds Ownership Percent to 0 through 100', () => {
    const sheet = wb.getWorksheet('Sites')!;
    const col = SITE_IMPORT_HEADERS.indexOf('Ownership Percent') + 1;
    const dv = sheet.getRow(5).getCell(col).dataValidation;
    expect(dv?.type).toBe('decimal');
    expect(dv?.operator).toBe('between');
    expect(dv?.formulae).toEqual([0, 100]);
  });

  it('formats Zip Code as text so a leading zero survives', () => {
    // 01234 stored as a number becomes 1234, and a zip is an identifier rather
    // than a quantity. A wrong zip silently selects a different grid factor.
    const sheet = wb.getWorksheet('Sites')!;
    const col = SITE_IMPORT_HEADERS.indexOf('Zip Code') + 1;
    expect(sheet.getRow(5).getCell(col).numFmt).toBe('@');
  });

  it('explains the two columns that change the numbers', () => {
    const guide = wb.getWorksheet('How to use')!;
    const text: string[] = [];
    guide.getColumn(1).eachCell((c) => { if (typeof c.value === 'string') text.push(c.value); });
    const all = text.join(' ');
    expect(all).toMatch(/national average/i);
    expect(all).toMatch(/consolidation approach/i);
  });

  it('tells a unit-less organization to assign sites later', async () => {
    const empty = new ExcelJS.Workbook();
    await empty.xlsx.load((await buildSiteTemplate([])) as unknown as ArrayBuffer);
    const guide = empty.getWorksheet('How to use')!;
    const text: string[] = [];
    guide.getColumn(1).eachCell((c) => { if (typeof c.value === 'string') text.push(c.value); });
    expect(text.join(' ')).toMatch(/no business units defined/i);
  });
});

describe('the example row', () => {
  it('names itself so the importer can skip it', () => {
    const rows = readRows(wb);
    expect(rows[0].site_name).toContain(SITE_EXAMPLE_ROW_NOTE);
  });

  it('uses a zip the seeded factor set covers', () => {
    // The example should demonstrate the case that calculates properly rather
    // than the fallback.
    const rows = readRows(wb);
    expect(rows[0].zip_code).toBe('29601');
  });
});

describe('a filled template maps cleanly', () => {
  it('reads every column back onto the key the mapper reads', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = book.getWorksheet('Sites')!;

    const values: Record<string, string | number> = {
      'Site Name': 'Northgate Assembly',
      'Site Type': 'Manufacturing',
      Address: '22 Dock Street',
      City: 'Toledo',
      State: 'OH',
      'Zip Code': '43604',
      Country: 'USA',
      'Floor Area Sqft': 140000,
      'Business Unit': 'Industrial Products',
      'Ownership Percent': 50,
      'Operated Or Controlled': 'No',
    };

    const row = sheet.getRow(3);
    SITE_IMPORT_HEADERS.forEach((label, i) => {
      const v = values[label];
      if (v !== undefined) row.getCell(i + 1).value = v;
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load((await book.xlsx.writeBuffer()) as unknown as ArrayBuffer);
    const filled = readRows(out).find(r => r.site_name === 'Northgate Assembly');
    expect(filled).toBeDefined();

    const mapped = mapSiteRow(canonicalizeSiteRow(filled!), none);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.site).toMatchObject({
        name: 'Northgate Assembly',
        siteType: 'manufacturing',
        zipCode: '43604',
        floorAreaSqft: 140000,
        businessUnitName: 'Industrial Products',
        ownershipPercent: 50,
        isControlled: false,
      });
    }
  });

  it('carries Operated Or Controlled through the alias, not by luck', async () => {
    // The assertion that earns its place. "Operated Or Controlled" normalizes to
    // operated_or_controlled; without the alias, isControlled would default to
    // true and a 50% uncontrolled joint venture would consolidate at 100%.
    const normalized = SITE_IMPORT_HEADERS.map(
      h => h.trim().toLowerCase().replace(/\s+/g, '_'),
    );
    expect(normalized).toContain('operated_or_controlled');
    expect(normalized).not.toContain('is_controlled');

    const raw = { site_name: 'JV Plant', operated_or_controlled: 'No', ownership_percent: '50' };
    const mapped = mapSiteRow(canonicalizeSiteRow(raw), none);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) expect(mapped.site.isControlled).toBe(false);
  });
});
