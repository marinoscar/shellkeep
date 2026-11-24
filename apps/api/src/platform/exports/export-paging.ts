// =============================================================================
// Paging and selecting helpers for the app's export sources (issue #68)
// =============================================================================
//
// A source lists its columns EXPLICITLY (an allowlist) and `select`s exactly those, so a column
// added to a model later never leaves the server by accident, and a credential column is never
// even read. Rows are paged by id and yielded lazily; a whole table is never loaded.
// =============================================================================

import type { ExportCell, ExportColumn, ExportContext, ExportRow } from '@marinoscar/platform-api/exports';
import { toExportCell } from '@marinoscar/platform-api/exports';

/** The `ExportColumn`s of an allowlist of `[key, label, type]` entries. */
export function columnsOf(
  entries: ReadonlyArray<readonly [key: string, label: string, type: ExportColumn['type']]>,
): ExportColumn[] {
  return entries.map(([key, label, type]) => ({ key, label, type }));
}

/** A column computed from the selected fields instead of read from the model. */
export interface DerivedColumns {
  /** The keys of the computed columns (they are not selected). */
  readonly keys: readonly string[];
  /** The fields the computation needs, selected in addition to the allowlist. */
  readonly select: readonly string[];
  compute(record: Record<string, unknown>): Record<string, ExportCell>;
}

/**
 * The rows of one model, `where`-filtered, paged by id, with only the listed columns selected.
 *
 * @param ctx - the export context (page size).
 * @param delegate - the Prisma delegate of the model on the export client (`ctx.db.serverProfile`).
 * @param where - the owner (or organization) filter; always present.
 * @param columns - the allowlist; the query's `select` is exactly these keys (minus derived ones) plus `id`.
 * @param derived - computed columns, optional.
 */
export async function* pagedRows(
  ctx: ExportContext,
  delegate: { findMany(args: unknown): Promise<Array<Record<string, unknown>>> },
  where: Record<string, unknown>,
  columns: readonly ExportColumn[],
  derived?: DerivedColumns,
): AsyncGenerator<ExportRow> {
  const computed = new Set(derived?.keys ?? []);
  const stored = columns.filter((column) => !computed.has(column.key));
  const select: Record<string, true> = { id: true };
  for (const column of stored) select[column.key] = true;
  for (const key of derived?.select ?? []) select[key] = true;
  let after: string | undefined;
  for (;;) {
    const page = await delegate.findMany({
      where: after === undefined ? where : { AND: [where, { id: { gt: after } }] },
      select,
      orderBy: { id: 'asc' },
      take: ctx.pageSize,
    });
    for (const record of page) {
      const row: Record<string, ExportCell> = {};
      for (const column of stored) row[column.key] = toExportCell(record[column.key], column);
      if (derived) Object.assign(row, derived.compute(record));
      yield row;
    }
    if (page.length < ctx.pageSize) return;
    after = page[page.length - 1]!['id'] as string;
  }
}
