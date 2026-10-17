import 'server-only';
import ExcelJS from 'exceljs';
import {
  UNIT_IMPORT_COLUMNS, UNIT_COLUMN_LABELS, UNIT_EXAMPLE_ROW_NOTE,
} from './business-unit-import-core';

/**
 * The bulk business-unit template.
 *
 * The Parent Unit dropdown is the one thing here that cannot be strict, and the
 * reason is worth stating. It can only offer units that already exist — but the
 * commonest use of this file is uploading a whole org chart at once, where most
 * parents are other rows in the same file. A strict list would refuse exactly
 * the case the template is for. So the list is a convenience for attaching to
 * what you already have, and typing a name from elsewhere in the file works
 * because parents are resolved after every row has been created.
 *
 * Three example rows rather than one, because a single row cannot show a
 * hierarchy, and the hierarchy is the only thing about this file that is not
 * obvious.
 */

const INPUT_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' },
};
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' },
};
const FONT = 'Arial';
const LAST_ROW = 500;

export async function buildBusinessUnitTemplate(
  existingUnits: { name: string }[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BROC';
  wb.created = new Date();

  const lists = wb.addWorksheet('Lists');
  const data = wb.addWorksheet('Business Units');
  const guide = wb.addWorksheet('How to use');

  const names = existingUnits.map((u) => u.name);
  const parentRange = names.length > 0
    ? writeList(lists, 1, 'Existing Units', names)
    : null;

  data.columns = UNIT_IMPORT_COLUMNS.map((c) => ({
    header: UNIT_COLUMN_LABELS[c],
    key: c,
    width: c === 'description' ? 40 : Math.max(18, UNIT_COLUMN_LABELS[c].length + 4),
  }));

  const header = data.getRow(1);
  header.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.fill = HEADER_FILL;
  header.height = 22;
  header.alignment = { vertical: 'middle' };
  data.views = [{ state: 'frozen', ySplit: 1 }];

  // A parent, a child, and a grandchild — deliberately listed child-first to
  // demonstrate that the order in the file does not matter.
  const examples = [
    {
      name: `Castings (${UNIT_EXAMPLE_ROW_NOTE})`,
      code: 'IP-CAST', parent: 'Industrial Products', sort_order: 1,
      description: 'A child listed before its parent, which is fine',
    },
    {
      name: `Industrial Products (${UNIT_EXAMPLE_ROW_NOTE})`,
      code: 'IP', parent: 'Group', sort_order: 1,
      description: 'A division',
    },
    {
      name: `Group (${UNIT_EXAMPLE_ROW_NOTE})`,
      code: 'GRP', parent: '', sort_order: 0,
      description: 'A top-level unit has no parent',
    },
  ];
  for (const e of examples) {
    data.addRow(e).font = { name: FONT, italic: true, color: { argb: 'FF9CA3AF' } };
  }

  const firstBlank = 2 + examples.length;
  for (let r = firstBlank; r <= LAST_ROW; r++) {
    const row = data.getRow(r);
    row.font = { name: FONT };

    UNIT_IMPORT_COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.fill = INPUT_FILL;

      if (c === 'parent' && parentRange) {
        // Not strict, on purpose. See the module comment: a parent may be
        // another row in this same file, which no dropdown can know about.
        cell.dataValidation = {
          type: 'list', allowBlank: true, showErrorMessage: false,
          formulae: [`=${parentRange}`],
          errorTitle: 'Parent unit',
          error: 'Pick an existing unit, or type the name of one in this file.',
        };
      }
      if (c === 'sort_order') {
        cell.numFmt = '0';
        cell.dataValidation = {
          type: 'whole', operator: 'between', allowBlank: true,
          showErrorMessage: true, formulae: [-9999, 9999],
          errorTitle: 'Enter a whole number',
          error: 'Sort order is a whole number. Leave blank for 0.',
        };
      }
    });
  }

  writeGuide(guide, names);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function writeList(
  sheet: ExcelJS.Worksheet, column: number, title: string, values: string[],
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
  sheet.getColumn(column).width = Math.max(24, title.length + 4);
  return `Lists!$${letter}$2:$${letter}$${Math.max(values.length + 1, 2)}`;
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

function writeGuide(sheet: ExcelJS.Worksheet, existing: string[]): void {
  sheet.getColumn(1).width = 96;

  const lines: [string, 'h' | 'p'][] = [
    ['Bulk business unit upload', 'h'],
    ['', 'p'],
    ['Fill in the Business Units sheet. Shaded cells are yours to edit.', 'p'],
    ['Delete the three grey example rows before uploading.', 'p'],
    ['', 'p'],
    ['The order of rows does not matter', 'h'],
    ['Parents are matched by name after every row has been created, so you can', 'p'],
    ['list a child before its parent. The example rows do exactly that.', 'p'],
    ['', 'p'],
    ['Parent Unit is matched on the name, exactly', 'h'],
    ['It can be a unit you already have, or another row in this file. The dropdown', 'p'],
    ['offers only your existing units, because nothing can know in advance what', 'p'],
    ['you are about to add — typing a name from this file is expected and works.', 'p'],
    ['', 'p'],
    ['A name that matches nothing leaves the unit at the top level, and the import', 'p'],
    ['tells you which. Nothing is created for you: a parent has to be a row in the', 'p'],
    ['file or a unit you already have.', 'p'],
    ['', 'p'],
    ['Loops are refused', 'h'],
    ['If A reports to B and B reports to A, nothing in that group is imported and', 'p'],
    ['the import names the rows involved. A roll-up over a loop would never finish,', 'p'],
    ['which is why the database refuses one as well.', 'p'],
    ['', 'p'],
    ['Columns', 'h'],
    ['Unit Name — required; must be unique among your units', 'p'],
    ['Code — optional; your own short identifier', 'p'],
    ['Parent Unit — optional; blank means a top-level unit', 'p'],
    ['Sort Order — optional; controls display order within a parent, 0 by default', 'p'],
    ['Description — optional', 'p'],
    ['', 'p'],
    ['Uploading the same list twice is safe', 'h'],
    ['A row whose Unit Name already exists is skipped rather than added again. It', 'p'],
    ['does not update the existing unit, so re-uploading will not re-parent', 'p'],
    ['anything you have since rearranged by hand.', 'p'],
  ];

  if (existing.length > 0) {
    lines.splice(13, 0,
      [`Your existing units: ${existing.slice(0, 10).join(', ')}`
        + (existing.length > 10 ? `, and ${existing.length - 10} more` : ''), 'p'],
      ['', 'p'],
    );
  } else {
    lines.splice(13, 0,
      ['You have no business units yet, so every parent must be another row in', 'p'],
      ['this file.', 'p'],
      ['', 'p'],
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

  const legend = lines.length + 2;
  sheet.getCell(`A${legend}`).value = 'Cells shaded like this are yours to fill in.';
  sheet.getCell(`A${legend}`).fill = INPUT_FILL;
  sheet.getCell(`A${legend}`).font = { name: FONT, size: 11 };
}
