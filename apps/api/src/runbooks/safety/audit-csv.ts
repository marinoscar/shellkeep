// =============================================================================
// CSV for the runbook audit export (issue #67)
// =============================================================================
//
// RFC 4180: CRLF line ends; a field with a comma, a double quote, CR or LF is quoted and its quotes are
// doubled. FORMULA INJECTION: a text cell that a spreadsheet would evaluate (it starts with `=`, `+`, `-`,
// `@`, a tab or a carriage return) is prefixed with `'`, so an operator opening the export never runs a
// command somebody typed into a runbook. Numbers and booleans are never prefixed (a negative exit code
// stays a number). PURE.
// =============================================================================

const FORMULA_START = /^[=+\-@\t\r]/;

export type CsvCell = string | number | boolean | Date | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  let text = value instanceof Date ? value.toISOString() : value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: readonly CsvCell[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}
