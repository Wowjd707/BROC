import 'server-only';
import ExcelJS from 'exceljs';
import { PRODUCT_IMPORT_COLUMNS, PRODUCT_COLUMN_LABELS, PRODUCT_EXAMPLE_ROW_NOTE } from './product-import-core';
import { COMPLIANCE_FIELDS, REGULATIONS } from './compliance-catalog';

/**
 * The product template: the product columns, then one optional column per
 * compliance field, headed by its key so the importer can recognise it.
 */
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } };
const FIELD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
const FONT = 'Arial';

export async function buildProductTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BROC';
  wb.created = new Date();
  const data = wb.addWorksheet('Products');
  const guide = wb.addWorksheet('How to use');

  data.columns = [
    ...PRODUCT_IMPORT_COLUMNS.map((c) => ({ header: PRODUCT_COLUMN_LABELS[c], key: c, width: c === 'description' || c === 'notes' ? 32 : 18 })),
    ...COMPLIANCE_FIELDS.map((f) => ({ header: f.key, key: f.key, width: Math.max(18, f.key.length + 2) })),
  ];
  const header = data.getRow(1);
  header.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.eachCell((cell, col) => { cell.fill = col <= PRODUCT_IMPORT_COLUMNS.length ? HEADER_FILL : FIELD_FILL; });
  data.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];

  data.addRow({
    part_number: 'EX-1001', description: 'Hot-rolled steel coil', hs_code: '7208 51', cn_code: '7208 51 20', country_of_origin: 'Turkey',
    notes: PRODUCT_EXAMPLE_ROW_NOTE,
  });

  guide.getColumn(1).width = 110;
  const lines = [
    'How to use this template',
    '',
    'Only Part Number is required. Re-uploading a part number that is already on file updates it; blank cells leave stored values alone.',
    'HS Code (up to 6 digits), CN Code (EU, up to 8, or 10 with TARIC) and HTS Code (US, up to 10): digits, with or without spaces or dots. Fill whichever you hold.',
    'Which regulations apply is decided by your scope rules on the Products and Parts page. The first six digits are shared by all three systems, so a short rule matches any of them.',
    'Supplier, Business Unit and Site must match names already in BROC. Owner Email must be a BROC user.',
    '',
    'The teal columns are optional compliance fields. A value there is recorded for the part with source "import".',
    ...Object.entries(REGULATIONS).flatMap(([key, r]) => [
      '',
      `${r.label} — ${r.name}`,
      ...COMPLIANCE_FIELDS.filter((f) => f.regulation === key).map((f) =>
        `  ${f.key}: ${f.label}${f.unit ? ` (${f.unit})` : ''}${f.options ? ` — one of: ${f.options.map((o) => o.label).join(', ')}` : f.type === 'yes_no' ? ' — yes or no' : ''}`),
    ]),
    '',
    'Delete the example row before uploading (it is skipped if you forget).',
  ];
  lines.forEach((l, i) => {
    const c = guide.getCell(i + 1, 1);
    c.value = l;
    c.font = { name: FONT, size: i === 0 ? 14 : 10, bold: i === 0 || /^[A-Z]{3,5} —/.test(l) };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
