/**
 * The template is only worth shipping if the dropdowns are really in the file.
 *
 * A workbook that opens cleanly but carries no data validation looks exactly
 * like one that works, right up until somebody types "Diesel Fuel" into a cell
 * that was supposed to offer them a list. So these tests build each family's
 * template, read the bytes back with a fresh workbook, and assert the
 * validations, named ranges and formats survived the round trip.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';

// The module is server-only so exceljs never reaches a client bundle; that
// import is a build-time guard with no runtime behaviour to preserve here.
vi.mock('server-only', () => ({}));

import { buildImportTemplate } from '../lib/import-template-xlsx';
import { FAMILY_COLUMNS, COLUMN_LABELS, type EntryFamily } from '../lib/staged-import-core';
import type { MetricCatalogEntry } from '../lib/import-cascade-core';

const sites = [{ name: 'Riverside Plant' }, { name: 'Northgate Assembly' }];

const catalog: MetricCatalogEntry[] = [
  { metricType: 'water',      sourceType: 'municipal_consumption',    label: 'Municipal Water', canonicalUnit: 'gal',       aggregation: 'sum' },
  { metricType: 'waste',      sourceType: 'non_hazardous_landfilled', label: 'Landfilled',      canonicalUnit: 'kg',        aggregation: 'sum' },
  { metricType: 'safety',     sourceType: 'hours_worked',             label: 'Hours worked',    canonicalUnit: 'hours',     aggregation: 'sum' },
  { metricType: 'safety',     sourceType: 'recordable_incidents',     label: 'Recordables',     canonicalUnit: 'incidents', aggregation: 'sum' },
  { metricType: 'governance', sourceType: 'board_seats',              label: 'Board seats',     canonicalUnit: 'seats',     aggregation: 'point_in_time' },
];

const FAMILIES = Object.keys(FAMILY_COLUMNS) as EntryFamily[];

async function build(family: EntryFamily): Promise<ExcelJS.Workbook> {
  const buf = await buildImportTemplate(family, sites, catalog);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe.each(FAMILIES)('%s template', (family) => {
  let wb: ExcelJS.Workbook;
  beforeAll(async () => { wb = await build(family); });

  it('has the three sheets a person needs', () => {
    expect(wb.getWorksheet('Data')).toBeDefined();
    expect(wb.getWorksheet('Lists')).toBeDefined();
    expect(wb.getWorksheet('How to use')).toBeDefined();
  });

  it('writes the spaced, capitalized headers', () => {
    const header = wb.getWorksheet('Data')!.getRow(1);
    const expected = FAMILY_COLUMNS[family].map((c) => COLUMN_LABELS[c]);
    expect(expected.map((_, i) => header.getCell(i + 1).value)).toEqual(expected);
    for (const label of expected) expect(label).not.toMatch(/_/);
  });

  it('carries one example row, marked as an example', () => {
    const row = wb.getWorksheet('Data')!.getRow(2);
    const notesIndex = FAMILY_COLUMNS[family].indexOf('notes') + 1;
    expect(String(row.getCell(notesIndex).value)).toMatch(/delete this row/i);
  });

  it('offers the organization’s own sites, not a generic list', () => {
    const lists = wb.getWorksheet('Lists')!;
    expect(lists.getCell('A2').value).toBe('Riverside Plant');
    expect(lists.getCell('A3').value).toBe('Northgate Assembly');
  });

  it('attaches a site dropdown to a blank row', () => {
    const data = wb.getWorksheet('Data')!;
    const siteCell = data.getRow(5).getCell(FAMILY_COLUMNS[family].indexOf('site') + 1);
    expect(siteCell.dataValidation?.type).toBe('list');
  });

  it('constrains quantity to a non-negative number', () => {
    const data = wb.getWorksheet('Data')!;
    const cell = data.getRow(5).getCell(FAMILY_COLUMNS[family].indexOf('quantity') + 1);
    expect(cell.dataValidation?.type).toBe('decimal');
    expect(cell.dataValidation?.operator).toBe('greaterThanOrEqual');
  });

  it('formats the date column so a real date is unambiguous', () => {
    const data = wb.getWorksheet('Data')!;
    const cell = data.getRow(5).getCell(FAMILY_COLUMNS[family].indexOf('entry_date') + 1);
    expect(cell.numFmt).toBe('yyyy-mm-dd');
  });
});

describe('emissions template — the cascade', () => {
  let wb: ExcelJS.Workbook;
  beforeAll(async () => { wb = await build('emissions'); });

  it('names a category range per source type', () => {
    // One defined name per fuel is what lets the category list depend on the
    // source instead of offering all four every time.
    const names = wb.definedNames.model.map((m) => m.name);
    expect(names).toContain('cat_diesel');
    expect(names).toContain('cat_refrigerants');
    expect(names).toContain('cat__none');
  });

  it('points the Scope 1 Category dropdown at the helper column via INDIRECT', () => {
    const data = wb.getWorksheet('Data')!;
    const idx = FAMILY_COLUMNS.emissions.indexOf('scope1_category') + 1;
    const dv = data.getRow(5).getCell(idx).dataValidation;
    expect(dv?.type).toBe('list');
    expect(dv?.formulae?.[0]).toMatch(/INDIRECT/);
  });

  it('offers readable source labels rather than database keys', () => {
    const lists = wb.getWorksheet('Lists')!;
    const column = lists.getColumn(3);
    const values: string[] = [];
    column.eachCell((c) => { if (typeof c.value === 'string') values.push(c.value); });
    expect(values).toContain('Natural Gas');
    expect(values).not.toContain('natural_gas');
  });

  it('hides the helper column so nobody edits it', () => {
    const data = wb.getWorksheet('Data')!;
    expect(data.getColumn(FAMILY_COLUMNS.emissions.length + 2).hidden).toBe(true);
  });

  it('says on the instructions sheet why scope is not filled in', () => {
    const guide = wb.getWorksheet('How to use')!;
    const text: string[] = [];
    guide.getColumn(1).eachCell((c) => { if (typeof c.value === 'string') text.push(c.value); });
    expect(text.join(' ')).toMatch(/Scope 3/);
  });
});

describe('metric templates — the unit follows the metric', () => {
  it('fills Unit with a formula rather than leaving it to be typed', async () => {
    const wb = await build('water');
    const data = wb.getWorksheet('Data')!;
    const cell = data.getRow(5).getCell(FAMILY_COLUMNS.water.indexOf('unit') + 1);
    expect(cell.formula).toMatch(/INDEX/);
  });

  it('lists only the chosen family’s metrics', async () => {
    const wb = await build('governance');
    const lists = wb.getWorksheet('Lists')!;
    const values: string[] = [];
    lists.getColumn(2).eachCell((c) => { if (typeof c.value === 'string') values.push(c.value); });
    expect(values).toContain('Board seats');
    expect(values).not.toContain('Hours worked');
  });
});
