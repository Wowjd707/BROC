import 'server-only';
import ExcelJS from 'exceljs';
import {
  GOAL_IMPORT_COLUMNS, GOAL_COLUMN_LABELS, GOAL_EXAMPLE_ROW_NOTE,
  GOAL_METRIC_LABELS, GOAL_SCOPE_LABELS, SCOPE2_METHOD_LABELS,
} from './goal-import-core';
import { GOAL_TYPES_BY_METRIC } from './goal-metrics';
import {
  TEMPLATE_FONT, INPUT_FILL, EXAMPLE_FONT, writeList, listRule, styleHeader,
  writeGuide, numberRule, colLetter, type GuideLine,
} from './xlsx-template-kit';

/**
 * The bulk goal template.
 *
 * Goal Type is the interesting column, because which values are legal depends on
 * the Metric — SBTi 1.5°C and Net Zero apply to greenhouse gas only, since both
 * are defined on emissions. Excel can express that as a dependent dropdown, and
 * this one does: a hidden helper column resolves the chosen metric to a named
 * range, exactly as the emissions template narrows Scope 1 Category by fuel.
 *
 * The instructions sheet says the one thing a spreadsheet cannot: that the
 * Reduction Percent column is ignored for an SBTi target, because that figure is
 * derived from the baseline rather than chosen.
 */

const LAST_ROW = 300;

export async function buildGoalTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BROC';
  wb.created = new Date();

  const lists = wb.addWorksheet('Lists');
  const data = wb.addWorksheet('Goals');
  const guide = wb.addWorksheet('How to use');

  const metricRange = writeList(lists, 1, 'Metric', Object.values(GOAL_METRIC_LABELS));
  const scopeRange = writeList(lists, 2, 'Scope', Object.values(GOAL_SCOPE_LABELS));
  const methodRange = writeList(lists, 3, 'Scope 2 Method', Object.values(SCOPE2_METHOD_LABELS));

  // One named range of legal goal types per metric, so the Goal Type dropdown
  // can depend on the Metric cell instead of offering SBTi against water.
  let col = 4;
  const metricKeys = Object.keys(GOAL_TYPES_BY_METRIC) as (keyof typeof GOAL_TYPES_BY_METRIC)[];
  for (const metric of metricKeys) {
    const ref = writeList(
      lists, col++, `Types: ${metric}`,
      GOAL_TYPES_BY_METRIC[metric].map((t) => t.label),
    );
    wb.definedNames.add(ref, `goaltypes_${metric}`);
  }

  // label → defined-name lookup for the helper column.
  const labelCol = col;
  writeList(lists, col++, 'Lookup Metric', Object.values(GOAL_METRIC_LABELS));
  const nameCol = col;
  writeList(lists, col++, 'Lookup Types', metricKeys.map((m) => `goaltypes_${m}`));

  data.columns = GOAL_IMPORT_COLUMNS.map((c) => ({
    header: GOAL_COLUMN_LABELS[c],
    key: c,
    width: c === 'notes' ? 34 : Math.max(18, GOAL_COLUMN_LABELS[c].length + 4),
  }));
  styleHeader(data, GOAL_IMPORT_COLUMNS.length);

  const example = data.addRow({
    name: `Halve Scope 1 and 2 by 2032 (${GOAL_EXAMPLE_ROW_NOTE})`,
    metric: GOAL_METRIC_LABELS.ghg,
    goal_type: 'Absolute Reduction',
    scope: GOAL_SCOPE_LABELS.scope1_2,
    base_year: 2024,
    base_year_value: 1200000,
    target_year: 2032,
    reduction_percent: 50,
    scope2_method: SCOPE2_METHOD_LABELS.market_based,
    notes: 'Baseline is kg CO2e, matching the entry tables',
  });
  example.font = EXAMPLE_FONT;

  const helperCol = GOAL_IMPORT_COLUMNS.length + 2;
  data.getColumn(helperCol).hidden = true;

  for (let r = 3; r <= LAST_ROW; r++) {
    const row = data.getRow(r);
    row.font = { name: TEMPLATE_FONT };

    GOAL_IMPORT_COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.fill = INPUT_FILL;

      if (c === 'metric') {
        cell.dataValidation = listRule(metricRange, 'Choose greenhouse gas, water or waste.');
      }
      if (c === 'goal_type') {
        cell.dataValidation = {
          type: 'list', allowBlank: true, showErrorMessage: true,
          formulae: [`=INDIRECT($${colLetter(helperCol)}$${r})`],
          errorTitle: 'Not a goal type for that metric',
          error: 'Pick the Metric first. SBTi and Net Zero apply to greenhouse gas only.',
        };
      }
      if (c === 'scope') {
        cell.dataValidation = listRule(scopeRange,
          'Greenhouse gas goals only; leave blank for water and waste.', false);
      }
      if (c === 'scope2_method') {
        cell.dataValidation = listRule(methodRange, 'Market-based or location-based.');
      }
      if (c === 'base_year' || c === 'target_year') {
        cell.numFmt = '0';
        cell.dataValidation = numberRule('Enter a four-digit year.', 1900, 2200);
      }
      if (c === 'base_year_value') {
        cell.numFmt = '#,##0';
        cell.dataValidation = numberRule('The baseline cannot be negative.');
      }
      if (c === 'reduction_percent') {
        cell.numFmt = '0.0';
        cell.dataValidation = numberRule('A reduction is above 0 and at most 100.', 0, 100);
      }
    });

    // Resolves the chosen metric label to the name of its goal-type range.
    row.getCell(helperCol).value = {
      formula: `IFERROR(INDEX(Lists!$${colLetter(nameCol)}$2:$${colLetter(nameCol)}$20,`
        + `MATCH($${colLetter(GOAL_IMPORT_COLUMNS.indexOf('metric') + 1)}$${r},`
        + `Lists!$${colLetter(labelCol)}$2:$${colLetter(labelCol)}$20,0)),"goaltypes_ghg")`,
    };
  }

  const lines: GuideLine[] = [
    ['Bulk goal upload', 'h'],
    ['', 'p'],
    ['Fill in the Goals sheet. Shaded cells are yours to edit.', 'p'],
    ['Delete the grey example row before uploading.', 'p'],
    ['', 'p'],
    ['Goal Type depends on Metric', 'h'],
    ['Pick the Metric first and the Goal Type list narrows to what is valid for it.', 'p'],
    ['SBTi 1.5°C and Net Zero are offered for greenhouse gas only. Both are defined', 'p'],
    ['on emissions, so applying an SBTi pathway to a water volume would invent a', 'p'],
    ['methodology rather than state a target. The import refuses that combination.', 'p'],
    ['', 'p'],
    ['Reduction Percent is ignored for an SBTi target', 'h'],
    ['An SBTi 1.5°C reduction is computed from the baseline and the two years, using', 'p'],
    ['the same calculation the goal screen uses. A figure typed into that cell would', 'p'],
    ['be your own arithmetic carrying the name of a standard, and would differ from', 'p'],
    ['the same goal created in the app. The import tells you what it worked out.', 'p'],
    ['', 'p'],
    ['An absolute target does need Reduction Percent, and cannot be imported without', 'p'],
    ['it — a reduction goal with no reduction is not a goal.', 'p'],
    ['', 'p'],
    ['Base Year Value is in the metric’s own unit', 'h'],
    ['Greenhouse gas in kg CO2e, water in US gallons, waste in kg. These are the same', 'p'],
    ['units the entry tables use, so a goal and a summed total need no conversion', 'p'],
    ['between them and cannot drift apart.', 'p'],
    ['', 'p'],
    ['A goal with no baseline still imports, but progress against it cannot be', 'p'],
    ['measured until one is set. The import says which goals that applies to.', 'p'],
    ['', 'p'],
    ['Scope applies to greenhouse gas goals only', 'h'],
    ['It is ignored for water and waste, and the import says so rather than storing', 'p'],
    ['a value nothing reads for those metrics.', 'p'],
    ['', 'p'],
    ['Columns', 'h'],
    ['Goal Name — required; must be unique among your goals', 'p'],
    ['Metric — greenhouse gas, water or waste. Defaults to greenhouse gas', 'p'],
    ['Goal Type — defaults to Absolute Reduction', 'p'],
    ['Scope — greenhouse gas only; defaults to Scope 1 + 2', 'p'],
    ['Base Year — required', 'p'],
    ['Base Year Value — the baseline, in the unit above', 'p'],
    ['Target Year — required; must be after the base year', 'p'],
    ['Reduction Percent — required for an absolute target', 'p'],
    ['Scope 2 Method — market-based or location-based; defaults to market-based', 'p'],
    ['Notes — optional', 'p'],
  ];
  writeGuide(guide, lines);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
