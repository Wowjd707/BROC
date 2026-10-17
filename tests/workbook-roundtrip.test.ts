/**
 * A template, filled in, read back, and staged.
 *
 * The generator and the parser are two halves of one contract and nothing else
 * checks that they agree. A header renamed on one side, a date written in a
 * locale format, an example row nobody skipped — each produces a file that
 * opens perfectly and imports wrongly.
 */
import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('server-only', () => ({}));

import { buildImportTemplate } from '../lib/import-template-xlsx';
import { parseWorkbook, EXAMPLE_MARKER } from '../lib/workbook-parse';
import { stageRow, type StagingContext } from '../lib/staged-import-core';
import type { MetricCatalogEntry } from '../lib/import-cascade-core';

const sites = [{ name: 'Riverside Plant' }];

const catalog: MetricCatalogEntry[] = [
  { metricType: 'water',  sourceType: 'municipal_consumption', label: 'Municipal Water', canonicalUnit: 'gal',   aggregation: 'sum' },
  { metricType: 'safety', sourceType: 'hours_worked',          label: 'Hours worked',    canonicalUnit: 'hours', aggregation: 'sum' },
];

const ctx = (family: StagingContext['family']): StagingContext => ({
  family,
  siteIdByName: new Map([['riverside plant', 'site-1']]),
  catalog,
});

/** Fill a row of the generated template the way a person would. */
async function fillAndParse(
  family: Parameters<typeof buildImportTemplate>[0],
  values: Record<string, string | number | Date>,
) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    (await buildImportTemplate(family, sites, catalog)) as unknown as ArrayBuffer,
  );
  const sheet = wb.getWorksheet('Data')!;
  // "Scope 1 Category" normalizes to scope_1_category, not scope1_category —
  // the same spelling trap the parser handles through HEADER_ALIASES. Mirror it
  // here so the helper addresses columns by the key staging actually reads.
  const headers: Record<string, number> = {};
  sheet.getRow(1).eachCell((cell, col) => {
    const key = String(cell.value).trim().toLowerCase().replace(/\s+/g, '_');
    headers[key] = col;
    if (key === 'scope_1_category') headers.scope1_category = col;
  });

  const row = sheet.getRow(3);
  for (const [key, value] of Object.entries(values)) {
    row.getCell(headers[key]).value = value;
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return parseWorkbook(buf);
}

describe('template round trip', () => {
  it('reads a filled emissions row back under the keys staging expects', async () => {
    const { rows } = await fillAndParse('emissions', {
      site: 'Riverside Plant',
      entry_date: new Date(Date.UTC(2026, 0, 31)),
      scope: 'scope1',
      source_type: 'Natural Gas',
      scope1_category: 'stationary_combustion',
      quantity: 1200,
      unit: 'therms',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      site: 'Riverside Plant',
      entry_date: '2026-01-31',
      scope: 'scope1',
      source_type: 'Natural Gas',
      quantity: '1200',
    });
  });

  it('skips the untouched example row instead of importing it', async () => {
    // The example carries realistic values on purpose, which is exactly what
    // makes a forgotten one dangerous: it would land as a plausible 1,200
    // therms against a real site.
    const { rows, exampleRowSkipped } = await fillAndParse('emissions', {
      site: 'Riverside Plant',
      entry_date: new Date(Date.UTC(2026, 1, 28)),
      scope: 'scope2',
      source_type: 'Electricity',
      quantity: 45000,
      unit: 'kWh',
    });
    expect(exampleRowSkipped).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_date).toBe('2026-02-28');
  });

  it('keeps the example marker in step with the generator', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await buildImportTemplate('emissions', sites, catalog)) as unknown as ArrayBuffer,
    );
    const notes = wb.getWorksheet('Data')!.getRow(2).getCell(12).value;
    expect(String(notes)).toBe(EXAMPLE_MARKER);
  });

  it('writes a date as YYYY-MM-DD, not a locale string', async () => {
    // 03/04 is the 3rd of April or the 4th of March depending on where the
    // person filling it in lives. The importer must never have to guess.
    const { rows } = await fillAndParse('water', {
      site: 'Riverside Plant',
      entry_date: new Date(Date.UTC(2026, 2, 4)),
      metric: 'Municipal Water',
      quantity: 120000,
    });
    expect(rows[0].entry_date).toBe('2026-03-04');
  });
});

describe('a filled template stages cleanly', () => {
  it('resolves a label-valued source type to its key', async () => {
    // The dropdown offers "Natural Gas"; the database stores natural_gas.
    const { rows } = await fillAndParse('emissions', {
      site: 'Riverside Plant',
      entry_date: new Date(Date.UTC(2026, 0, 31)),
      scope: 'scope1',
      source_type: 'Natural Gas',
      scope1_category: 'stationary_combustion',
      quantity: 1200,
      unit: 'therms',
    });

    const staged = stageRow(1, rows[0], ctx('emissions'));
    expect(staged.status).toBe('valid');
    expect(staged.resolved.source_type).toBe('natural_gas');
    expect(staged.resolved.site_id).toBe('site-1');
  });

  it('resolves a label-valued metric and fills its unit', async () => {
    const { rows } = await fillAndParse('water', {
      site: 'Riverside Plant',
      entry_date: new Date(Date.UTC(2026, 0, 31)),
      metric: 'Municipal Water',
      quantity: 120000,
    });

    const staged = stageRow(1, rows[0], ctx('water'));
    expect(staged.resolved.metric).toBe('municipal_consumption');
    expect(staged.resolved.metric_type).toBe('water');
    // Unit is a formula in the template with no cached result until a
    // spreadsheet application opens it, so staging fills it from the catalog.
    expect(staged.adjustments.find((a) => a.field === 'unit')?.to).toBe('gal');
  });

  it('still holds a fuel row for scope confirmation', async () => {
    // The workbook narrows the choices; it does not remove the judgement.
    const { rows } = await fillAndParse('emissions', {
      site: 'Riverside Plant',
      entry_date: new Date(Date.UTC(2026, 0, 31)),
      source_type: 'Diesel',
      quantity: 500,
      unit: 'gal',
    });

    const staged = stageRow(1, rows[0], ctx('emissions'));
    expect(staged.status).toBe('needs_review');
    expect(staged.adjustments.some((a) => /Scope 3/i.test(a.reason))).toBe(true);
  });

  it('survives the Scope 1 Category header spelling', async () => {
    // The header normalizes to scope_1_category while the validator reads
    // scope1_category. The column is optional, so a broken alias would not
    // error — every Scope 1 row would simply import with no category. Assert
    // the value arrives.
    const { rows } = await fillAndParse('emissions', {
      site: 'Riverside Plant',
      entry_date: new Date(Date.UTC(2026, 0, 31)),
      scope: 'scope1',
      source_type: 'Diesel',
      scope1_category: 'mobile_combustion',
      quantity: 500,
      unit: 'gal',
    });
    expect(rows[0].scope_1_category).toBe('mobile_combustion');

    const staged = stageRow(1, rows[0], ctx('emissions'));
    expect(staged.resolved.scope1_category).toBe('mobile_combustion');
  });
});
