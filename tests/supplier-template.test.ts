/**
 * The supplier template, built, read back and mapped.
 *
 * The same round trip that caught two real faults in the metrics template — a
 * date written in a locale format, and a header whose normalized spelling did
 * not match the key the validator read. Both produced files that opened
 * perfectly and imported wrongly.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('server-only', () => ({}));

import { buildSupplierTemplate } from '../lib/supplier-template-xlsx';
import {
  mapSupplierRow, canonicalizeSupplierRow,
  SUPPLIER_IMPORT_HEADERS, SUPPLIER_EXAMPLE_ROW_NOTE,
} from '../lib/supplier-import-core';

const none = new Set<string>();

let wb: ExcelJS.Workbook;
let buffer: Buffer;

beforeAll(async () => {
  buffer = await buildSupplierTemplate();
  wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
}, 60_000);

/** Read the sheet back the way lib/csv.ts and parseWorkbook normalize headers. */
function readRows(book: ExcelJS.Workbook): Record<string, string>[] {
  const sheet = book.getWorksheet('Suppliers')!;
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

describe('supplier template', () => {
  it('has the three sheets', () => {
    expect(wb.getWorksheet('Suppliers')).toBeDefined();
    expect(wb.getWorksheet('Lists')).toBeDefined();
    expect(wb.getWorksheet('How to use')).toBeDefined();
  });

  it('writes spaced, capitalized headers with no underscores', () => {
    const header = wb.getWorksheet('Suppliers')!.getRow(1);
    expect(SUPPLIER_IMPORT_HEADERS.map((_, i) => header.getCell(i + 1).value))
      .toEqual(SUPPLIER_IMPORT_HEADERS);
    for (const h of SUPPLIER_IMPORT_HEADERS) expect(h).not.toMatch(/_/);
  });

  it('constrains Tier to a list', () => {
    const sheet = wb.getWorksheet('Suppliers')!;
    const tierCol = SUPPLIER_IMPORT_HEADERS.indexOf('Tier') + 1;
    expect(sheet.getRow(5).getCell(tierCol).dataValidation?.type).toBe('list');
  });

  it('lets Country and Industry take a value outside the list', () => {
    // The suggestions must not stop somebody entering a country this file
    // forgot — a supplier in an unlisted country still has to be enterable.
    const sheet = wb.getWorksheet('Suppliers')!;
    for (const label of ['Country', 'Industry']) {
      const col = SUPPLIER_IMPORT_HEADERS.indexOf(label) + 1;
      const dv = sheet.getRow(5).getCell(col).dataValidation;
      expect(dv?.type).toBe('list');
      // exceljs omits showErrorMessage when false, so it reads back undefined.
      // Falsy is the point: Excel only refuses a typed value when the error
      // alert is switched on.
      expect(dv?.showErrorMessage).toBeFalsy();
    }
  });

  it('constrains spend to a non-negative number', () => {
    const sheet = wb.getWorksheet('Suppliers')!;
    const col = SUPPLIER_IMPORT_HEADERS.indexOf('Annual Spend USD') + 1;
    const dv = sheet.getRow(5).getCell(col).dataValidation;
    expect(dv?.type).toBe('decimal');
    expect(dv?.operator).toBe('greaterThanOrEqual');
  });
});

describe('the example row', () => {
  it('is marked with the note the importer skips on', () => {
    // Kept in step by this test: the marker lives in the core so both the
    // generator and the importer read the same constant, but a reworded example
    // row would still break the skip silently.
    const rows = readRows(wb);
    expect(rows[0].notes).toBe(SUPPLIER_EXAMPLE_ROW_NOTE);
  });

  it('would otherwise map to a real supplier, which is why it is skipped', () => {
    // The example carries realistic values on purpose so the format is obvious.
    // That is exactly what makes a forgotten one dangerous — it maps cleanly.
    const rows = readRows(wb);
    const mapped = mapSupplierRow(rows[0], none, none);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.supplier.name).toBe('Midwest Steel');
      expect(mapped.supplier.tier).toBe(1);
      expect(mapped.supplier.spendUsd).toBe(1250000);
    }
  });
});

describe('a filled template maps cleanly', () => {
  it('reads values back under the keys the mapper expects', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = book.getWorksheet('Suppliers')!;

    const values: Record<string, string | number> = {
      'Supplier Name': 'Northgate Plastics',
      'Contact Name': 'Rowan Iyer',
      'Contact Email': 'rowan@northgate.example',
      Country: 'Germany',
      Industry: 'Plastics and polymers',
      Tier: '2',
      'Annual Spend USD': 480000,
    };

    const row = sheet.getRow(3);
    SUPPLIER_IMPORT_HEADERS.forEach((label, i) => {
      const value = values[label];
      if (value !== undefined) row.getCell(i + 1).value = value;
    });

    const out = new ExcelJS.Workbook();
    await out.xlsx.load((await book.xlsx.writeBuffer()) as unknown as ArrayBuffer);
    const rows = readRows(out);

    // Row 1 is the example; the filled row follows it.
    // Under supplier_name, not name: "Supplier Name" normalizes to
    // supplier_name, which is why HEADER_ALIASES carries it. Reading r.name
    // here returns undefined even though the importer resolves it correctly.
    const filled = rows.find(r => r.supplier_name === 'Northgate Plastics');
    expect(filled).toBeDefined();
    expect(filled!.name).toBeUndefined();

    const mapped = mapSupplierRow(filled!, none, none);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.supplier).toMatchObject({
        name: 'Northgate Plastics',
        contactEmail: 'rowan@northgate.example',
        country: 'Germany',
        tier: 2,
        spendUsd: 480000,
      });
    }
  });
});

describe('the headers the template writes all resolve', () => {
  it('maps every normalized header onto a column the mapper reads', () => {
    // Two of them do not round-trip: "Supplier Name" becomes supplier_name and
    // "Annual Spend USD" becomes annual_spend_usd. Both are optional-looking to
    // the mapper — spend genuinely is — so a missing alias would not error, it
    // would silently drop the column from every row.
    const normalized = SUPPLIER_IMPORT_HEADERS.map(
      h => h.trim().toLowerCase().replace(/\s+/g, '_'),
    );
    const row = Object.fromEntries(normalized.map(k => [k, 'x']));
    row.supplier_name = 'Acme';
    row.annual_spend_usd = '1000';
    row.contact_email = 'a@b.com';
    row.tier = '1';

    const mapped = mapSupplierRow(canonicalizeSupplierRow(row), none, none);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.supplier.name).toBe('Acme');
      expect(mapped.supplier.spendUsd).toBe(1000);
    }
  });
});
