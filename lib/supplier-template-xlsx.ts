import 'server-only';
import ExcelJS from 'exceljs';
import {
  SUPPLIER_IMPORT_COLUMNS, SUPPLIER_COLUMN_LABELS, SUPPLIER_IMPORT_HEADERS,
  SUPPLIER_EXAMPLE_ROW_NOTE,
} from './supplier-import-core';

/**
 * The bulk supplier template.
 *
 * Same shape as the metrics templates in lib/import-template-xlsx.ts: spaced
 * headers, shaded input cells, a Lists sheet for the dropdowns, one realistic
 * example row marked for deletion, and an instructions sheet.
 *
 * Deliberately not generated per organization. The metrics template has to be,
 * because its dropdowns hold your sites and your metric catalog — but a
 * supplier list has nothing to pre-populate from, since the whole point is that
 * these suppliers are not on file yet. Countries and industries are offered as
 * suggestions rather than a closed list, because a supplier in a country this
 * list forgot must still be enterable.
 */

const INPUT_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' },
};
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' },
};
const FONT = 'Arial';
const LAST_ROW = 500;

/** Common enough to be worth offering; not a constraint. */
const COUNTRIES = [
  'USA', 'Canada', 'Mexico', 'Brazil', 'United Kingdom', 'Germany', 'France',
  'Italy', 'Spain', 'Netherlands', 'Poland', 'Turkey', 'India', 'China',
  'Japan', 'South Korea', 'Taiwan', 'Vietnam', 'Thailand', 'Malaysia',
  'Indonesia', 'Australia', 'South Africa',
];

const INDUSTRIES = [
  'Metals', 'Chemicals', 'Plastics and polymers', 'Electronics',
  'Packaging', 'Textiles', 'Agriculture and food', 'Pulp and paper',
  'Machinery and equipment', 'Automotive', 'Construction materials',
  'Logistics and freight', 'Energy and utilities', 'Professional services',
  'Waste and recycling', 'Other',
];

export async function buildSupplierTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BROC';
  wb.created = new Date();

  const lists = wb.addWorksheet('Lists');
  const data = wb.addWorksheet('Suppliers');
  const guide = wb.addWorksheet('How to use');

  const tierRange = writeList(lists, 1, 'Tier', ['1', '2', '3']);
  const countryRange = writeList(lists, 2, 'Country', COUNTRIES);
  const industryRange = writeList(lists, 3, 'Industry', INDUSTRIES);

  data.columns = SUPPLIER_IMPORT_COLUMNS.map((c) => ({
    header: SUPPLIER_COLUMN_LABELS[c],
    key: c,
    width: c === 'notes' ? 36 : c === 'contact_email' ? 30 : Math.max(16, SUPPLIER_COLUMN_LABELS[c].length + 4),
  }));

  const header = data.getRow(1);
  header.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.fill = HEADER_FILL;
  header.height = 22;
  header.alignment = { vertical: 'middle' };
  data.views = [{ state: 'frozen', ySplit: 1 }];
  data.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: SUPPLIER_IMPORT_COLUMNS.length },
  };

  const example = data.addRow({
    name: 'Midwest Steel',
    contact_name: 'Dana Whitfield',
    contact_email: 'dana@midweststeel.example',
    country: 'USA',
    industry: 'Metals',
    tier: '1',
    spend_usd: 1250000,
    notes: SUPPLIER_EXAMPLE_ROW_NOTE,
  });
  example.font = { name: FONT, italic: true, color: { argb: 'FF9CA3AF' } };

  for (let r = 3; r <= LAST_ROW; r++) {
    const row = data.getRow(r);
    row.font = { name: FONT };

    SUPPLIER_IMPORT_COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.fill = INPUT_FILL;

      if (c === 'tier') {
        cell.dataValidation = listRule(tierRange,
          'Tier 1 is a direct supplier. Leave blank if you do not track tiers.');
      }
      if (c === 'country') {
        // allowBlank AND a non-strict list: the suggestions must not stop
        // somebody entering a country this file forgot.
        cell.dataValidation = { ...listRule(countryRange, 'Pick one, or type your own.'), showErrorMessage: false };
      }
      if (c === 'industry') {
        cell.dataValidation = { ...listRule(industryRange, 'Pick one, or type your own.'), showErrorMessage: false };
      }
      if (c === 'spend_usd') {
        cell.numFmt = '#,##0';
        cell.dataValidation = {
          type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true,
          showErrorMessage: true, formulae: [0],
          errorTitle: 'Enter a number',
          error: 'Annual spend must be a number and cannot be negative.',
        };
      }
    });
  }

  writeGuide(guide);

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
  sheet.getColumn(column).width = Math.max(18, title.length + 4);
  return `Lists!$${letter}$2:$${letter}$${values.length + 1}`;
}

function listRule(range: string, prompt: string): ExcelJS.DataValidation {
  return {
    type: 'list', allowBlank: true, showErrorMessage: true,
    formulae: [`=${range}`],
    errorTitle: 'Choose from the list', error: prompt,
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

function writeGuide(sheet: ExcelJS.Worksheet): void {
  sheet.getColumn(1).width = 96;
  const lines: [string, 'h' | 'p'][] = [
    ['Bulk supplier upload', 'h'],
    ['', 'p'],
    ['Fill in the Suppliers sheet. Shaded cells are yours to edit.', 'p'],
    ['Delete the grey example row before uploading — it shows the expected format.', 'p'],
    ['', 'p'],
    ['Only Supplier Name is required', 'h'],
    ['Everything else can be filled in later. A supplier with no contact email is', 'p'],
    ['stored fine, but cannot be sent a survey invitation until one is added.', 'p'],
    ['', 'p'],
    ['Uploading the same list twice is safe', 'h'],
    ['A row matching a supplier already on your list — by name, or by contact', 'p'],
    ['email — is skipped rather than added again, and reported as skipped. Adding', 'p'],
    ['the same supplier twice would split their survey history across two records.', 'p'],
    ['', 'p'],
    ['Columns', 'h'],
    ['Supplier Name — required; how you refer to them', 'p'],
    ['Contact Name — the person who receives survey invitations', 'p'],
    ['Contact Email — required before they can be invited to a survey', 'p'],
    ['Country — pick from the list or type your own', 'p'],
    ['Industry — pick from the list or type your own', 'p'],
    ['Tier — 1, 2 or 3. Leave blank if you do not track tiers', 'p'],
    ['Annual Spend USD — optional; used for spend-weighted views', 'p'],
    ['Notes — anything worth recording', 'p'],
  ];

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

export { SUPPLIER_IMPORT_HEADERS };
