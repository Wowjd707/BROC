/**
 * Minimal, dependency-free CSV parsing for bulk imports.
 *
 * Handles the parts of RFC 4180 that matter for spreadsheet exports: quoted
 * fields, escaped quotes (""), commas and newlines inside quotes, and both
 * CRLF and LF line endings. Kept pure so it is unit-testable and runs on either
 * side of the network boundary.
 */

/** Parse CSV text into a matrix of string cells. Blank trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Strip a leading UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // handled by the \n branch; ignore lone CR
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }

  // Flush the final field/row if the file did not end with a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-empty rows (e.g. a trailing blank line yielding ['']).
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export interface CsvTable {
  headers: string[];
  /** One object per data row, keyed by normalized (lowercased, trimmed) header. */
  rows: Record<string, string>[];
}

/**
 * Parse CSV into header-keyed objects. Header keys are lowercased and trimmed
 * so "Entry Date", "entry_date", and " ENTRY_DATE " all map to the same key
 * after callers normalize spaces to underscores.
 */
export function parseCsvToObjects(text: string): CsvTable {
  const matrix = parseCsv(text);
  if (matrix.length === 0) return { headers: [], rows: [] };

  const headers = matrix[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows = matrix.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] ?? '').trim(); });
    return obj;
  });
  return { headers, rows };
}
