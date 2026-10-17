import 'server-only';
import ExcelJS from 'exceljs';

/**
 * Read a filled-in template back into the rows the staging pipeline expects.
 *
 * Deliberately produces the same shape `parseCsvToObjects` does — snake_case
 * keys, string values — so a workbook and a hand-written CSV converge on one
 * code path. The importer should not have two notions of what a row is.
 */

/**
 * The marker on the template's example row.
 *
 * The example carries realistic values on purpose: a person filling in a
 * spreadsheet needs to see the expected format, not a row of placeholders. But
 * realistic values are exactly what makes it dangerous — a forgotten example
 * row is a plausible 1,200 therms against a real site, and it would import
 * silently. So the row is marked, and the parser drops it.
 *
 * Kept in sync with `exampleRow()` in lib/import-template-xlsx.ts by a test.
 */
export const EXAMPLE_MARKER = 'Example — delete this row';

export interface ParsedWorkbook {
  rows: Record<string, string>[];
  /** True when the untouched example row was found and skipped. */
  exampleRowSkipped: boolean;
}

export async function parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  // The template names it "Data"; a sheet from elsewhere may not, so fall back
  // to the first one rather than refusing a file that is otherwise fine.
  const sheet = wb.getWorksheet('Data') ?? wb.worksheets[0];
  if (!sheet) return { rows: [], exampleRowSkipped: false };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = normalizeHeader(cellText(cell));
  });

  const rows: Record<string, string>[] = [];
  let exampleRowSkipped = false;

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const record: Record<string, string> = {};
    let hasValue = false;

    headers.forEach((key, i) => {
      if (!key) return;
      const text = cellText(row.getCell(i + 1));
      record[key] = text;
      if (text !== '') hasValue = true;
    });

    if (!hasValue) continue;
    if ((record.notes ?? '').trim() === EXAMPLE_MARKER) {
      exampleRowSkipped = true;
      continue;
    }
    rows.push(record);
  }

  return { rows, exampleRowSkipped };
}

/** Matches lib/csv.ts so "Entry Date" and "entry_date" land on the same key. */
function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * A cell as the text the importer should see.
 *
 * Three cases need care. A date arrives as a Date and must become YYYY-MM-DD,
 * because a locale-formatted string is the classic way a day and a month swap
 * places. A formula cell — the template computes Unit from Metric — carries its
 * cached result, which is what we want, though it is empty if the file was
 * never opened in a spreadsheet application; staging fills the unit from the
 * catalog in that case, so an empty string is safe. A rich-text cell arrives as
 * runs that have to be joined.
 */
function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';

  if (v instanceof Date) return toIsoDate(v);

  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined && v.result !== null) {
      return v.result instanceof Date ? toIsoDate(v.result) : String(v.result).trim();
    }
    if ('formula' in v) return '';            // no cached result
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('text' in v) return String(v.text).trim();
    if ('error' in v) return '';
  }

  return String(v).trim();
}

/** Local date parts, not toISOString: that shifts across a timezone boundary. */
function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
