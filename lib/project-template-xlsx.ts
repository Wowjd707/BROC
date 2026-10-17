import 'server-only';
import ExcelJS from 'exceljs';
import {
  PROJECT_IMPORT_COLUMNS, PROJECT_COLUMN_LABELS, PROJECT_EXAMPLE_ROW_NOTE,
  PROJECT_CATEGORY_LABELS, PROJECT_STATUS_LABELS, PIPELINE_STATUS_LABELS,
} from './project-import-core';
import {
  TEMPLATE_FONT, INPUT_FILL, EXAMPLE_FONT, writeList, listRule, styleHeader,
  writeGuide, numberRule, dateRule, type GuideLine,
} from './xlsx-template-kit';

/**
 * The bulk project template.
 *
 * Generated per organization so Site and Goal can be dropdowns of what you
 * already have — a project's whole value is being attached to a site and a goal,
 * and a free-typed name that matches neither leaves it attached to nothing.
 *
 * Pipeline Inclusion carries the warning the schema cannot. Its default is
 * `excluded`, so savings entered against a project with that column blank are
 * stored correctly and count toward nothing. The instructions say so, and the
 * import repeats it per row.
 */

const LAST_ROW = 300;

export async function buildProjectTemplate(
  sites: { name: string }[],
  goals: { name: string }[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BROC';
  wb.created = new Date();

  const lists = wb.addWorksheet('Lists');
  const data = wb.addWorksheet('Projects');
  const guide = wb.addWorksheet('How to use');

  const categoryRange = writeList(lists, 1, 'Category', Object.values(PROJECT_CATEGORY_LABELS));
  const statusRange = writeList(lists, 2, 'Status', Object.values(PROJECT_STATUS_LABELS));
  const pipelineRange = writeList(lists, 3, 'Pipeline Inclusion',
    Object.values(PIPELINE_STATUS_LABELS));
  const siteNames = sites.map((s) => s.name);
  const goalNames = goals.map((g) => g.name);
  const siteRange = siteNames.length > 0 ? writeList(lists, 4, 'Sites', siteNames) : null;
  const goalRange = goalNames.length > 0 ? writeList(lists, 5, 'Goals', goalNames) : null;

  data.columns = PROJECT_IMPORT_COLUMNS.map((c) => ({
    header: PROJECT_COLUMN_LABELS[c],
    key: c,
    width: c === 'description' ? 36 : Math.max(16, Math.min(34, PROJECT_COLUMN_LABELS[c].length + 3)),
  }));
  styleHeader(data, PROJECT_IMPORT_COLUMNS.length);

  const example = data.addRow({
    name: `LED retrofit, Riverside (${PROJECT_EXAMPLE_ROW_NOTE})`,
    category: PROJECT_CATEGORY_LABELS.energy_efficiency,
    status: PROJECT_STATUS_LABELS.in_progress,
    site: siteNames[0] ?? '',
    goal: goalNames[0] ?? '',
    estimated_co2e_kg: 48000,
    actual_co2e_kg: '',
    estimated_water_gal: '',
    estimated_waste_kg: '',
    estimated_cost_usd: 120000,
    start_date: '2026-03-01',
    target_completion_date: '2026-09-30',
    pipeline_status: PIPELINE_STATUS_LABELS.forecasted,
    description: 'Savings only count if Pipeline Inclusion is set',
  });
  example.font = EXAMPLE_FONT;

  for (let r = 3; r <= LAST_ROW; r++) {
    const row = data.getRow(r);
    row.font = { name: TEMPLATE_FONT };

    PROJECT_IMPORT_COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.fill = INPUT_FILL;

      // Strict where the column has a CHECK behind it.
      if (c === 'category') {
        cell.dataValidation = listRule(categoryRange, 'Choose a category; it is required.');
      }
      if (c === 'status') {
        cell.dataValidation = listRule(statusRange, 'Choose a status, or leave blank for Idea.');
      }
      if (c === 'pipeline_status') {
        cell.dataValidation = listRule(pipelineRange,
          'Excluded, forecasted or realized. Blank means excluded.');
      }
      // Not strict: a project can belong to a site or goal added since this file
      // was downloaded, and refusing the row would be worse than leaving it
      // unlinked and saying so.
      if (c === 'site' && siteRange) {
        cell.dataValidation = listRule(siteRange, 'Pick one of your sites, or leave blank.', false);
      }
      if (c === 'goal' && goalRange) {
        cell.dataValidation = listRule(goalRange, 'Pick one of your goals, or leave blank.', false);
      }
      if (c === 'estimated_co2e_kg' || c === 'actual_co2e_kg'
          || c === 'estimated_water_gal' || c === 'estimated_waste_kg') {
        cell.numFmt = '#,##0';
        cell.dataValidation = numberRule('A saving cannot be negative.');
      }
      if (c === 'estimated_cost_usd') {
        cell.numFmt = '#,##0';
        cell.dataValidation = numberRule('A cost cannot be negative.');
      }
      if (c === 'start_date' || c === 'target_completion_date') {
        cell.numFmt = 'yyyy-mm-dd';
        cell.dataValidation = dateRule();
      }
    });
  }

  const lines: GuideLine[] = [
    ['Bulk project upload', 'h'],
    ['', 'p'],
    ['Fill in the Projects sheet. Shaded cells are yours to edit.', 'p'],
    ['Delete the grey example row before uploading.', 'p'],
    ['', 'p'],
    ['Savings only count if Pipeline Inclusion is set', 'h'],
    ['This is the one thing on this sheet that is easy to get wrong and hard to', 'p'],
    ['notice. Pipeline Inclusion defaults to Excluded, so a project imported with', 'p'],
    ['savings figures and that column left blank is stored exactly as you wrote it', 'p'],
    ['and contributes nothing to the reduction pipeline.', 'p'],
    ['', 'p'],
    ['  Excluded    an idea; its numbers stay out of every forecast', 'p'],
    ['  Forecasted  counts as an expected saving', 'p'],
    ['  Realized    counts as an achieved saving', 'p'],
    ['', 'p'],
    ['The default is deliberate — an optimistic estimate against an idea should not', 'p'],
    ['move a reported figure — but the import lists every row it applies to so the', 'p'],
    ['choice is yours rather than an accident.', 'p'],
    ['', 'p'],
    ['Savings are per year, in canonical units', 'h'],
    ['Carbon in kg CO2e, water in US gallons, waste in kg, each per year. The same', 'p'],
    ['units the entry tables use, so a project’s savings are directly comparable to', 'p'],
    ['measured totals.', 'p'],
    ['', 'p'],
    ['Site and Goal are matched on the name', 'h'],
    ['The dropdowns hold what you already have. A name that matches nothing leaves', 'p'],
    ['the project unlinked, and the import says which — it does not create sites or', 'p'],
    ['goals for you.', 'p'],
    ['', 'p'],
    ['Columns', 'h'],
    ['Project Name — required; must be unique among your projects', 'p'],
    ['Category — required', 'p'],
    ['Status — defaults to Idea', 'p'],
    ['Site, Goal — optional; matched by name', 'p'],
    ['Estimated / Actual savings — optional, per year', 'p'],
    ['Estimated Cost USD — optional', 'p'],
    ['Start Date, Target Completion Date — optional; stored as YYYY-MM-DD', 'p'],
    ['Pipeline Inclusion — defaults to Excluded. See above', 'p'],
    ['Description — optional', 'p'],
  ];
  writeGuide(guide, lines);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
