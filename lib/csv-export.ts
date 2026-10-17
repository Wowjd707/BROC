/**
 * Writing CSV that is safe to open in a spreadsheet.
 *
 * Some exported cells hold text that people outside the organization wrote —
 * a supplier's name, a supplier's survey answers — and every export is opened
 * in Excel, which treats a cell beginning with `=`, `+`, `-`, `@`, tab or
 * carriage return as a formula. A supplier answering `=HYPERLINK("http://…")`
 * would otherwise plant a working link (or worse) in the file an assurance
 * provider opens. This is the OWASP "CSV injection" mitigation: such a cell is
 * prefixed with a single quote, which Excel displays as plain text.
 *
 * Numbers are left alone. A negative quantity is data, not an attack, and
 * quoting it would turn every adjustment row into text.
 *
 * Pure and dependency-free so it is unit-testable.
 */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** Escape one value for a CSV cell. */
export function csvCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);

  let s = String(value);
  // A numeric-looking string ("-12.5") is a number written as text, not a
  // formula; Excel parses it as a number either way.
  if (FORMULA_TRIGGER.test(s) && !/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Headers plus rows, CRLF-free, every cell through `csvCell`. */
export function rowsToCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}
