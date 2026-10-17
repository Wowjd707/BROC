import 'server-only';
import ExcelJS from 'exceljs';
import {
  SITE_IMPORT_COLUMNS, SITE_COLUMN_LABELS, SITE_TYPE_LABELS,
  SITE_EXAMPLE_ROW_NOTE,
} from './site-import-core';

/**
 * The bulk site template.
 *
 * Generated per organization, unlike the supplier one, because the Business Unit
 * column has something real to offer: the units you have already defined. A
 * free-typed unit name that does not match one of them leaves the site
 * unassigned, and the import says so — so putting the actual list in the
 * dropdown is the difference between a column that works and a column that
 * quietly does nothing.
 *
 * The instructions sheet carries two warnings that are not housekeeping. Zip
 * code selects the electricity factor, and ownership and control decide whether
 * a site counts at all. Both are explained where somebody filling the file in
 * will see them, rather than only in the code.
 */

const INPUT_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' },
};
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' },
};
const FONT = 'Arial';
const LAST_ROW = 500;

const COUNTRIES = [
  'USA', 'Canada', 'Mexico', 'Brazil', 'United Kingdom', 'Ireland', 'Germany',
  'France', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Poland', 'Czechia',
  'Turkey', 'India', 'China', 'Japan', 'South Korea', 'Taiwan', 'Vietnam',
  'Thailand', 'Malaysia', 'Singapore', 'Australia', 'South Africa',
];

export async function buildSiteTemplate(
  businessUnits: { name: string }[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BROC';
  wb.created = new Date();

  const lists = wb.addWorksheet('Lists');
  const data = wb.addWorksheet('Sites');
  const guide = wb.addWorksheet('How to use');

  const typeRange = writeList(lists, 1, 'Site Type', Object.values(SITE_TYPE_LABELS));
  const countryRange = writeList(lists, 2, 'Country', COUNTRIES);
  const yesNoRange = writeList(lists, 3, 'Yes / No', ['Yes', 'No']);
  const unitNames = businessUnits.map((u) => u.name);
  const unitRange = unitNames.length > 0
    ? writeList(lists, 4, 'Business Unit', unitNames)
    : null;

  data.columns = SITE_IMPORT_COLUMNS.map((c) => ({
    header: SITE_COLUMN_LABELS[c],
    key: c,
    width: c === 'address' ? 32 : Math.max(16, SITE_COLUMN_LABELS[c].length + 4),
  }));

  const header = data.getRow(1);
  header.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.fill = HEADER_FILL;
  header.height = 22;
  header.alignment = { vertical: 'middle' };
  data.views = [{ state: 'frozen', ySplit: 1 }];
  data.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: SITE_IMPORT_COLUMNS.length },
  };

  // A realistic example, with a zip that the seeded factor set actually covers
  // so the row demonstrates the case that calculates properly.
  const example = data.addRow({
    name: `Riverside Plant (${SITE_EXAMPLE_ROW_NOTE})`,
    site_type: 'Manufacturing',
    address: '1400 Mill Road',
    city: 'Greenville',
    state: 'SC',
    zip_code: '29601',
    country: 'USA',
    floor_area_sqft: 220000,
    business_unit: unitNames[0] ?? '',
    ownership_percent: 100,
    is_controlled: 'Yes',
  });
  example.font = { name: FONT, italic: true, color: { argb: 'FF9CA3AF' } };

  for (let r = 3; r <= LAST_ROW; r++) {
    const row = data.getRow(r);
    row.font = { name: FONT };

    SITE_IMPORT_COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.fill = INPUT_FILL;

      if (c === 'site_type') {
        // Strict: the column has a CHECK, so an unknown type would otherwise
        // surface as a database error naming a constraint rather than a row.
        cell.dataValidation = listRule(typeRange, 'Choose one of the five site types.');
      }
      if (c === 'country') {
        cell.dataValidation = {
          ...listRule(countryRange, 'Pick one, or type your own.'),
          showErrorMessage: false,
        };
      }
      if (c === 'is_controlled') {
        cell.dataValidation = listRule(yesNoRange,
          'Yes if you operate or control this site. See the instructions sheet.');
      }
      if (c === 'business_unit' && unitRange) {
        // Not strict: a unit that does not match leaves the site unassigned and
        // is reported, which is recoverable — whereas refusing the row is not.
        cell.dataValidation = {
          ...listRule(unitRange, 'Pick one of your business units, or leave blank.'),
          showErrorMessage: false,
        };
      }
      if (c === 'zip_code') {
        // Text, not number: 01234 must not become 1234, and a zip is an
        // identifier rather than a quantity.
        cell.numFmt = '@';
      }
      if (c === 'floor_area_sqft') {
        cell.numFmt = '#,##0';
        cell.dataValidation = {
          type: 'decimal', operator: 'greaterThan', allowBlank: true,
          showErrorMessage: true, formulae: [0],
          errorTitle: 'Enter a number',
          error: 'Floor area must be a positive number.',
        };
      }
      if (c === 'ownership_percent') {
        cell.numFmt = '0';
        cell.dataValidation = {
          type: 'decimal', operator: 'between', allowBlank: true,
          showErrorMessage: true, formulae: [0, 100],
          errorTitle: 'Enter a percentage',
          error: 'Ownership must be between 0 and 100. Leave blank for 100%.',
        };
      }
    });
  }

  writeGuide(guide, unitNames);

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
  return `Lists!$${letter}$2:$${letter}$${Math.max(values.length + 1, 2)}`;
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

function writeGuide(sheet: ExcelJS.Worksheet, unitNames: string[]): void {
  sheet.getColumn(1).width = 96;

  const lines: [string, 'h' | 'p'][] = [
    ['Bulk site upload', 'h'],
    ['', 'p'],
    ['Fill in the Sites sheet. Shaded cells are yours to edit.', 'p'],
    ['Delete the grey example row before uploading.', 'p'],
    ['', 'p'],
    ['Only Site Name is required — but two optional columns change your numbers', 'h'],
    ['', 'p'],
    ['Zip Code selects the electricity emission factor', 'h'],
    ['Scope 2 electricity resolves by zip code first, then by eGRID subregion, then', 'p'],
    ['falls back to the US national average. A site with no zip still calculates —', 'p'],
    ['it just calculates against the national average, which for a plant on a', 'p'],
    ['coal-heavy or a hydro-heavy grid is wrong by a wide margin and wrong quietly.', 'p'],
    ['The import warns you which sites this applies to.', 'p'],
    ['', 'p'],
    ['Ownership Percent and Operated Or Controlled decide whether a site counts', 'h'],
    ['Which of the two is used depends on your consolidation approach in Settings:', 'p'],
    ['  equity share reads Ownership Percent — a 50% joint venture contributes 50%', 'p'],
    ['  financial or operational control reads Operated Or Controlled — a site', 'p'],
    ['  contributes everything or nothing', 'p'],
    ['Leave both blank and a site is treated as wholly owned and controlled, which', 'p'],
    ['is right for most sites and wrong for a joint venture.', 'p'],
    ['', 'p'],
    ['Business Unit', 'h'],
    unitNames.length > 0
      ? [`Pick from your existing units: ${unitNames.slice(0, 8).join(', ')}`
          + (unitNames.length > 8 ? `, and ${unitNames.length - 8} more` : ''), 'p']
      : ['You have no business units defined yet, so leave this blank and assign', 'p'],
    unitNames.length > 0
      ? ['A name that does not match one of them leaves the site unassigned, and the', 'p']
      : ['sites to units later in Settings.', 'p'],
    unitNames.length > 0
      ? ['import tells you which. It does not create new units.', 'p']
      : ['', 'p'],
    ['', 'p'],
    ['Uploading the same list twice is safe', 'h'],
    ['A row whose Site Name already exists is skipped rather than added again, and', 'p'],
    ['reported as skipped. Two sites with the same name would split that site’s', 'p'],
    ['emissions history across two records.', 'p'],
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
