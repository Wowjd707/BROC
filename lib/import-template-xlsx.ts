import 'server-only';
import ExcelJS from 'exceljs';
import { FAMILY_COLUMNS, COLUMN_LABELS, type EntryFamily } from './staged-import-core';
import { scope1CategoriesFor, metricsForFamily, type MetricCatalogEntry } from './import-cascade-core';
import { SOURCE_LABELS, sourceLabel } from './source-labels';

/**
 * The bulk-import template, as a real workbook rather than a CSV.
 *
 * A CSV cannot carry a dropdown, so every vocabulary value had to be typed from
 * memory and the first a person heard about a mistake was the review screen.
 * This builds the same columns with the choices attached to the cells.
 *
 * It is generated per organization, not shipped as a static file, and that is
 * the main reason it is worth the code: the Site list holds *your* sites and
 * the Metric list holds *your* catalog including anything you added. A template
 * in the repository could only offer a generic list, which is the thing people
 * paste over and get wrong.
 *
 * Labels, not keys, go in the cells. A dropdown offering `non_hazardous_
 * landfilled` defeats the point of shipping a formatted workbook, so the sheet
 * shows "Landfilled" and `staged-import-core` accepts either on the way back in.
 */

/** Cells the person fills in. Matches the legend on the instructions sheet. */
const INPUT_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' },
};
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' },
};
const FONT = 'Arial';

/**
 * Excel defined names cannot contain spaces, punctuation or parentheses, and
 * several source labels do — "Fuel Oil #2", "Coal (Anthracite)". So the
 * dependent dropdown keys off a sanitised name derived from the KEY, not the
 * label, and a hidden helper column resolves label → that name.
 */
function definedName(sourceKey: string): string {
  return `cat_${sourceKey.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

export async function buildImportTemplate(
  family: EntryFamily,
  sites: { name: string }[],
  catalog: MetricCatalogEntry[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BROC';
  wb.created = new Date();

  const lists = wb.addWorksheet('Lists');
  const data = wb.addWorksheet('Data');
  const guide = wb.addWorksheet('How to use');

  const columns = FAMILY_COLUMNS[family];

  // ─── Lists sheet ───────────────────────────────────────────────────────────
  // Written first so the Data sheet's validations can point at real ranges.
  // Visible rather than hidden: a reviewer who wants to know what the accepted
  // values are should be able to look, and a hidden sheet mostly teaches people
  // to unhide it.

  const siteNames = sites.map((s) => s.name);
  writeList(lists, 1, 'Sites', siteNames);

  let col = 2;
  const ranges: Record<string, string> = {};

  if (family === 'emissions') {
    ranges.scope = writeList(lists, col++, 'Scope', ['scope1', 'scope2']);
    const sourceKeys = Object.keys(SOURCE_LABELS);
    ranges.source_type = writeList(lists, col++, 'Source Type', sourceKeys.map(sourceLabel));
    ranges.accounting_method = writeList(lists, col++, 'Accounting Method',
      ['location_based', 'market_based']);

    // One named range per source type, holding the categories that source can
    // legitimately produce. This is what makes the Scope 1 Category dropdown
    // depend on the fuel rather than offering all four every time.
    for (const key of sourceKeys) {
      const cats = scope1CategoriesFor(key);
      if (cats.length === 0) continue;
      const ref = writeList(lists, col++, `Cat: ${sourceLabel(key)}`, cats);
      wb.definedNames.add(ref, definedName(key));
    }

    // Fallback for a Scope 2 row, where no category applies.
    const noneRef = writeList(lists, col++, 'Cat: none', ['(not applicable)']);
    wb.definedNames.add(noneRef, 'cat__none');

    // label → defined-name lookup, read by the helper column on Data.
    writeList(lists, col++, 'Lookup Label', sourceKeys.map(sourceLabel));
    writeList(lists, col++, 'Lookup Name', sourceKeys.map(definedName));
  } else {
    const metrics = metricsForFamily(family as Exclude<EntryFamily, 'emissions'>, catalog);
    ranges.metric = writeList(lists, col++, 'Metric', metrics.map((m) => m.label));
    writeList(lists, col++, 'Metric Unit', metrics.map((m) => m.canonicalUnit));
  }

  // ─── Data sheet ────────────────────────────────────────────────────────────

  data.columns = columns.map((c) => ({
    header: COLUMN_LABELS[c] ?? c,
    key: c,
    width: c === 'notes' ? 34 : Math.max(14, (COLUMN_LABELS[c] ?? c).length + 4),
  }));

  const header = data.getRow(1);
  header.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  data.views = [{ state: 'frozen', ySplit: 1 }];
  data.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  // One realistic example row, in grey italic and labelled as such, per the
  // convention for a workbook someone has to fill in. The instructions sheet
  // says to delete it; staging would reject it anyway, because "Example —
  // delete this row" is not a site.
  const example = exampleRow(family, siteNames[0] ?? 'Your site name', catalog);
  const exampleRowRef = data.addRow(example);
  exampleRowRef.font = { name: FONT, italic: true, color: { argb: 'FF9CA3AF' } };

  const FIRST = 3;          // first genuinely blank row
  const LAST = 500;         // validations applied this far down

  for (let r = FIRST; r <= LAST; r++) {
    const row = data.getRow(r);
    row.font = { name: FONT };

    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.fill = INPUT_FILL;

      if (c === 'site' && siteNames.length > 0) {
        cell.dataValidation = listRule(ranges_site(lists, siteNames.length),
          family === 'governance'
            ? 'Leave blank for an organization-level figure.'
            : 'Choose one of your sites.');
      }
      if (c === 'entry_date') {
        cell.numFmt = 'yyyy-mm-dd';
        cell.dataValidation = {
          type: 'date', operator: 'greaterThan', allowBlank: true, showErrorMessage: true,
          formulae: [new Date(2000, 0, 1)],
          errorTitle: 'Enter a date',
          error: 'Use a real date. The month-end the reading covers is the usual choice.',
        };
      }
      if (c === 'quantity') {
        cell.numFmt = '#,##0.####';
        cell.dataValidation = {
          type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true,
          showErrorMessage: true, formulae: [0],
          errorTitle: 'Enter a number',
          error: 'Quantity must be a number and cannot be negative.',
        };
      }
      if (ranges[c]) {
        cell.dataValidation = listRule(ranges[c], 'Choose from the list.');
      }
      if (c === 'scope1_category' && family === 'emissions') {
        // Depends on Source Type via the helper column, which holds the
        // defined name for whatever fuel this row names.
        const helper = `$${colLetter(columns.length + 2)}$${r}`;
        cell.dataValidation = {
          type: 'list', allowBlank: true, showErrorMessage: true,
          formulae: [`=INDIRECT(${helper})`],
          errorTitle: 'Not a category for that source',
          error: 'Pick the Source Type first. Only the categories that source can produce are offered.',
        };
      }
      if (c === 'unit' && family !== 'emissions') {
        // The unit follows the metric, so it is filled rather than chosen.
        const metricCol = colLetter(columns.indexOf('metric') + 1);
        cell.value = {
          formula: `IF($${metricCol}$${r}="","",IFERROR(INDEX(Lists!$${colLetter(col - 1)}$2:$${colLetter(col - 1)}$200,` +
            `MATCH($${metricCol}$${r},Lists!$${colLetter(col - 2)}$2:$${colLetter(col - 2)}$200,0)),""))`,
        };
        cell.font = { name: FONT, color: { argb: 'FF6B7280' } };
      }
    });
  }

  if (family === 'emissions') {
    // Hidden helper: label → defined name, so INDIRECT above has something to
    // resolve. Two columns past the data so it never collides with a header.
    const helperCol = columns.length + 2;
    const labelCol = colLetter(col - 2);
    const nameCol = colLetter(col - 1);
    data.getColumn(helperCol).hidden = true;
    for (let r = FIRST; r <= LAST; r++) {
      data.getRow(r).getCell(helperCol).value = {
        formula: `IFERROR(INDEX(Lists!$${nameCol}$2:$${nameCol}$200,` +
          `MATCH($${colLetter(columns.indexOf('source_type') + 1)}$${r},` +
          `Lists!$${labelCol}$2:$${labelCol}$200,0)),"cat__none")`,
      };
    }
  }

  // ─── Instructions ──────────────────────────────────────────────────────────
  writeGuide(guide, family, columns);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Write a titled column of values and return its absolute range. */
function writeList(
  sheet: ExcelJS.Worksheet,
  column: number,
  title: string,
  values: string[],
): string {
  const letter = colLetter(column);
  const head = sheet.getCell(`${letter}1`);
  head.value = title;
  head.font = { name: FONT, bold: true, size: 10 };
  values.forEach((v, i) => {
    const c = sheet.getCell(`${letter}${i + 2}`);
    c.value = v;
    c.font = { name: FONT, size: 10 };
  });
  sheet.getColumn(column).width = Math.max(16, title.length + 4);
  return `Lists!$${letter}$2:$${letter}$${Math.max(values.length + 1, 2)}`;
}

function ranges_site(sheet: ExcelJS.Worksheet, count: number): string {
  void sheet;
  return `Lists!$A$2:$A$${Math.max(count + 1, 2)}`;
}

function listRule(formula: string, prompt: string): ExcelJS.DataValidation {
  return {
    type: 'list',
    allowBlank: true,
    showErrorMessage: true,
    formulae: [`=${formula}`],
    errorTitle: 'Choose from the list',
    error: prompt,
  };
}

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function exampleRow(
  family: EntryFamily,
  site: string,
  catalog: MetricCatalogEntry[],
): Record<string, string | number> {
  const date = '2026-01-31';
  if (family === 'emissions') {
    return {
      site, entry_date: date, scope: 'scope1', source_type: 'Natural Gas',
      scope1_category: 'stationary_combustion', quantity: 1200, unit: 'therms',
      notes: 'Example — delete this row',
    };
  }
  const first = metricsForFamily(family as Exclude<EntryFamily, 'emissions'>, catalog)[0];
  return {
    site: family === 'governance' ? '' : site,
    entry_date: date,
    metric: first?.label ?? '',
    quantity: 100,
    unit: first?.canonicalUnit ?? '',
    notes: 'Example — delete this row',
  };
}

function writeGuide(sheet: ExcelJS.Worksheet, family: EntryFamily, columns: string[]): void {
  sheet.getColumn(1).width = 96;
  const lines: [string, 'h' | 'p' | 'legend'][] = [
    [`Bulk import — ${family}`, 'h'],
    ['', 'p'],
    ['Fill in the Data sheet. The shaded cells are the ones to edit; everything else is a list or a formula.', 'p'],
    ['Delete the grey example row before uploading — it is there to show the expected format.', 'p'],
    ['', 'p'],
    ['Nothing you enter here is saved when you upload it.', 'h'],
    ['The file is checked and held for review, and you confirm anything it could not work out', 'p'],
    ['before a single row is written. Rows it cannot resolve are not rejected — they wait for you.', 'p'],
    ['', 'p'],
    ['Columns', 'h'],
    ...columns.map((c) => [`${COLUMN_LABELS[c] ?? c} — ${columnHelp(c, family)}`, 'p'] as [string, 'p']),
    ['', 'p'],
  ];

  if (family === 'emissions') {
    lines.push(
      ['On Scope', 'h'],
      ['Scope is not filled in for you when the source is a fuel, and that is deliberate.', 'p'],
      ['Diesel is Scope 1 only when it burns in equipment you own or control. The same fuel in a', 'p'],
      ['contractor’s truck is Scope 3, which must not enter a Scope 1+2 total. Only you know which.', 'p'],
      ['', 'p'],
      ['Scope 1 Category offers only the categories the Source Type can actually produce, so pick', 'p'],
      ['the source first. Refrigerants only ever leak; diesel runs both generators and fleets.', 'p'],
    );
  } else {
    lines.push(
      ['On units', 'h'],
      ['Unit fills itself from the metric and is not editable — it is the unit that metric is stored in.', 'p'],
      ['Enter the figure in that unit, or convert it first. Some families hold more than one unit:', 'p'],
      ['safety holds both hours worked and a count of injuries, and they are not interchangeable.', 'p'],
    );
  }

  lines.forEach(([text, kind], i) => {
    const cell = sheet.getCell(`A${i + 1}`);
    cell.value = text;
    cell.font = kind === 'h'
      ? { name: FONT, bold: true, size: 12 }
      : { name: FONT, size: 11 };
    cell.alignment = { wrapText: true, vertical: 'top' };
  });

  const legendRow = lines.length + 2;
  sheet.getCell(`A${legendRow}`).value = 'Cells shaded like this are yours to fill in.';
  sheet.getCell(`A${legendRow}`).fill = INPUT_FILL;
  sheet.getCell(`A${legendRow}`).font = { name: FONT, size: 11 };
}

function columnHelp(column: string, family: EntryFamily): string {
  switch (column) {
    case 'site':
      return family === 'governance'
        ? 'one of your sites, or blank for an organization-level figure'
        : 'one of your sites, chosen from the list';
    case 'entry_date': return 'the date the reading covers, usually a month end';
    case 'scope': return 'Scope 1 for what you burn, Scope 2 for what you buy — see below';
    case 'source_type': return 'what was burned or purchased';
    case 'scope1_category': return 'how it was burned; the list narrows to fit the source';
    case 'refrigerant_code': return 'required only when the source is Refrigerants, e.g. R-134a';
    case 'metric': return 'which figure this row reports';
    case 'quantity': return 'the number, in the unit shown';
    case 'unit': return family === 'emissions' ? 'the unit the quantity is in' : 'filled from the metric';
    case 'accounting_method': return 'location-based or market-based, for purchased electricity';
    case 'instrument_type': return 'optional; for a market-based claim, e.g. REC or PPA';
    case 'supplier_factor': return 'optional; a supplier-specific emission factor if you have one';
    case 'notes': return 'optional; anything an auditor would want to know';
    default: return '';
  }
}
