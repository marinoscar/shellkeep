// Small output helpers shared by the commands (issue #72). Everything is plain
// text or JSON on stdout; diagnostics go to stderr.

/** Where a command writes. */
export interface Writer {
  write(text: string): unknown;
}

/** Writes a value as indented JSON with a trailing newline. */
export function writeJson(out: Writer, value: unknown): void {
  out.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Renders rows as an aligned plain-text table.
 *
 * @param headers - column titles.
 * @param rows - one array of cells per row; `undefined` and `null` print as `-`.
 */
export function renderTable(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const cells = rows.map((row) => headers.map((_, index) => String(row[index] ?? '-')));
  const widths = headers.map((header, index) => Math.max(header.length, ...cells.map((row) => (row[index] ?? '').length)));
  const line = (row: readonly string[]): string =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(headers), ...cells.map(line)].join('\n');
}
