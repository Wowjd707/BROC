/**
 * The goal and project templates, built, read back and mapped.
 *
 * Two things here are worth asserting beyond the usual round trip. The goal
 * template's Goal Type dropdown depends on the Metric, so that SBTi is not
 * offered against water — the same INDIRECT-and-helper-column arrangement the
 * emissions template uses to narrow Scope 1 Category by fuel. And the project
 * template's savings labels almost none of them round-trip, so the aliases are
 * load-bearing in a way a passing import would not reveal.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('server-only', () => ({}));

import { buildGoalTemplate } from '../lib/goal-template-xlsx';
import { buildProjectTemplate } from '../lib/project-template-xlsx';
import {
  mapGoalRow, canonicalizeGoalRow, GOAL_IMPORT_HEADERS, GOAL_EXAMPLE_ROW_NOTE,
} from '../lib/goal-import-core';
import {
  mapProjectRow, canonicalizeProjectRow,
  PROJECT_IMPORT_HEADERS, PROJECT_EXAMPLE_ROW_NOTE,
} from '../lib/project-import-core';
import { calculateSBTiTarget } from '../lib/calculations';

const none = new Set<string>();
const goalCtx = {
  existingNames: none,
  sbtiReductionPct: (b: number, by: number, ty: number) =>
    calculateSBTiTarget(b, by, ty).reductionPct,
};

function readRows(book: ExcelJS.Workbook, sheetName: string): Record<string, string>[] {
  const sheet = book.getWorksheet(sheetName)!;
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

describe('goal template', () => {
  let wb: ExcelJS.Workbook;
  let buffer: Buffer;

  beforeAll(async () => {
    buffer = await buildGoalTemplate();
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  }, 60_000);

  it('has the three sheets and readable headers', () => {
    expect(wb.getWorksheet('Goals')).toBeDefined();
    expect(wb.getWorksheet('Lists')).toBeDefined();
    expect(wb.getWorksheet('How to use')).toBeDefined();
    for (const h of GOAL_IMPORT_HEADERS) expect(h).not.toMatch(/_/);
  });

  it('names a goal-type range per metric', () => {
    // One per metric is what lets the dropdown depend on the Metric cell rather
    // than offering SBTi against a water volume.
    const names = wb.definedNames.model.map((m) => m.name);
    expect(names).toContain('goaltypes_ghg');
    expect(names).toContain('goaltypes_water');
    expect(names).toContain('goaltypes_waste');
  });

  it('offers SBTi and Net Zero for greenhouse gas only', () => {
    const lists = wb.getWorksheet('Lists')!;
    const column = (n: number) => {
      const out: string[] = [];
      lists.getColumn(n).eachCell((c) => { if (typeof c.value === 'string') out.push(c.value); });
      return out.join(' | ');
    };
    // Columns 4, 5, 6 are the per-metric type lists in ghg, water, waste order.
    expect(column(4)).toMatch(/SBTi/);
    expect(column(5)).not.toMatch(/SBTi/);
    expect(column(6)).not.toMatch(/SBTi/);
  });

  it('points Goal Type at the helper column via INDIRECT', () => {
    const sheet = wb.getWorksheet('Goals')!;
    const col = GOAL_IMPORT_HEADERS.indexOf('Goal Type') + 1;
    const dv = sheet.getRow(5).getCell(col).dataValidation;
    expect(dv?.type).toBe('list');
    expect(dv?.formulae?.[0]).toMatch(/INDIRECT/);
  });

  it('hides the helper column', () => {
    const sheet = wb.getWorksheet('Goals')!;
    expect(sheet.getColumn(GOAL_IMPORT_HEADERS.length + 2).hidden).toBe(true);
  });

  it('says that Reduction Percent is ignored for an SBTi target', () => {
    const guide = wb.getWorksheet('How to use')!;
    const text: string[] = [];
    guide.getColumn(1).eachCell((c) => { if (typeof c.value === 'string') text.push(c.value); });
    const all = text.join(' ');
    expect(all).toMatch(/ignored for an SBTi target/i);
    expect(all).toMatch(/kg CO2e/);
  });

  it('carries an example row that maps to a valid goal', () => {
    const rows = readRows(wb, 'Goals');
    expect(rows[0].goal_name).toContain(GOAL_EXAMPLE_ROW_NOTE);
    const mapped = mapGoalRow(canonicalizeGoalRow(rows[0]), goalCtx);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.goal.metric).toBe('ghg');
      expect(mapped.goal.targetValue).toBe(50);
      expect(mapped.goal.scope).toBe('scope1_2');
    }
  });

  it('round-trips Scope 2 Method through its alias', async () => {
    // "Scope 2 Method" normalizes to scope_2_method, not scope2_method. Optional,
    // so a missing alias would silently default every goal to market-based.
    const normalized = GOAL_IMPORT_HEADERS.map(
      (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
    );
    expect(normalized).toContain('scope_2_method');
    expect(normalized).not.toContain('scope2_method');

    const mapped = mapGoalRow(canonicalizeGoalRow({
      goal_name: 'G', base_year: '2024', target_year: '2030',
      reduction_percent: '40', scope_2_method: 'Location-based',
    }), goalCtx);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) expect(mapped.goal.scope2Method).toBe('location_based');
  });
});

describe('project template', () => {
  let wb: ExcelJS.Workbook;
  const sites = [{ name: 'Riverside Plant' }];
  const goals = [{ name: 'Halve Scope 1 and 2 by 2032' }];

  beforeAll(async () => {
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildProjectTemplate(sites, goals)) as unknown as ArrayBuffer);
  }, 60_000);

  it('has the three sheets and readable headers', () => {
    expect(wb.getWorksheet('Projects')).toBeDefined();
    for (const h of PROJECT_IMPORT_HEADERS) expect(h).not.toMatch(/_/);
  });

  it('offers this organization’s sites and goals', () => {
    const lists = wb.getWorksheet('Lists')!;
    const values: string[] = [];
    for (const n of [4, 5]) {
      lists.getColumn(n).eachCell((c) => { if (typeof c.value === 'string') values.push(c.value); });
    }
    expect(values).toContain('Riverside Plant');
    expect(values).toContain('Halve Scope 1 and 2 by 2032');
  });

  it('constrains Category and Pipeline Inclusion strictly', () => {
    const sheet = wb.getWorksheet('Projects')!;
    for (const label of ['Category', 'Pipeline Inclusion']) {
      const col = PROJECT_IMPORT_HEADERS.indexOf(label) + 1;
      const dv = sheet.getRow(5).getCell(col).dataValidation;
      expect(dv?.type).toBe('list');
      expect(dv?.showErrorMessage).toBe(true);
    }
  });

  it('leaves Site and Goal open, since either may be added later', () => {
    const sheet = wb.getWorksheet('Projects')!;
    for (const label of ['Site', 'Goal']) {
      const col = PROJECT_IMPORT_HEADERS.indexOf(label) + 1;
      expect(sheet.getRow(5).getCell(col).dataValidation?.showErrorMessage).toBeFalsy();
    }
  });

  it('leads its instructions with the pipeline default', () => {
    const guide = wb.getWorksheet('How to use')!;
    const text: string[] = [];
    guide.getColumn(1).eachCell((c) => { if (typeof c.value === 'string') text.push(c.value); });
    const all = text.join(' ');
    expect(all).toMatch(/Savings only count if Pipeline Inclusion is set/i);
    expect(all).toMatch(/kg CO2e/);
  });

  it('maps its example row, which is deliberately in the pipeline', () => {
    const rows = readRows(wb, 'Projects');
    expect(rows[0].project_name).toContain(PROJECT_EXAMPLE_ROW_NOTE);
    const mapped = mapProjectRow(canonicalizeProjectRow(rows[0]), none);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.project.pipelineStatus).toBe('forecasted');
      expect(mapped.project.estimatedCo2eKg).toBe(48000);
      // Set deliberately, so it must not trip the excluded-savings warning.
      expect(mapped.project.warnings.some((w) => /will not count/i.test(w))).toBe(false);
    }
  });

  it('round-trips every savings label through its alias', () => {
    // None of these round-trips, and all are optional — a missing alias would
    // import the project with no savings and leave the pipeline reading zero.
    const normalized = PROJECT_IMPORT_HEADERS.map(
      (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
    );
    const row = Object.fromEntries(normalized.map((k) => [k, '']));
    row.project_name = 'P';
    row.category = 'Waste';
    row.estimated_co2e_saving_kg_per_year = '100';
    row.actual_co2e_saving_kg_per_year = '90';
    row.estimated_water_saving_gal_per_year = '200';
    row.estimated_waste_saving_kg_per_year = '300';
    row.pipeline_inclusion = 'realized';

    const mapped = mapProjectRow(canonicalizeProjectRow(row), none);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.project.estimatedCo2eKg).toBe(100);
      expect(mapped.project.actualCo2eKg).toBe(90);
      expect(mapped.project.estimatedWaterGal).toBe(200);
      expect(mapped.project.estimatedWasteKg).toBe(300);
      expect(mapped.project.pipelineStatus).toBe('realized');
    }
  });
});
