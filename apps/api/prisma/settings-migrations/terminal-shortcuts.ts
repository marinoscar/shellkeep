// =============================================================================
// One-shot data migration: `terminal.keyShortcuts` -> `shortcuts.keyShortcuts`
// (issue #80)
// =============================================================================
//
// Before #80 a user's key bar shortcuts were stored inside the `terminal`
// user-settings namespace. They now have their own `shortcuts` namespace
// (`src/terminal/settings/shortcuts.user-settings.ts`). This step rewrites every
// stored `user_settings` row that still carries the old key:
//
//   forward (`moveTerminalShortcuts`, run by the seed through `seed-app.ts`):
//     `terminal.keyShortcuts` becomes `shortcuts.keyShortcuts` (unless the row
//     already has a `shortcuts` namespace, which wins) and leaves `terminal`.
//   inverse (`restoreTerminalShortcuts`, the rollback):
//     `shortcuts.keyShortcuts` goes back to `terminal.keyShortcuts`, `terminal`
//     keeps only the two pre-#80 fields, and `shortcuts` leaves the row.
//
// Idempotent both ways; a row the mapping does not change is not written. A
// written row's `version` is incremented, so a client holding the old version
// refetches instead of saving over the move (`If-Match`).
//
// Rollback: run the inverse BEFORE reverting the #80 PR (the revert deletes this
// file), from apps/api with DATABASE_URL set:
//   npx ts-node --transpile-only -P prisma/tsconfig.json prisma/settings-migrations/terminal-shortcuts.ts --revert
// Without the inverse nothing is lost either: the web client's shim reads
// `terminal.keyShortcuts` when `shortcuts` is absent, and a reverted build reads
// `terminal.keyShortcuts` only (a moved list then shows the defaults until the
// inverse runs).
//
// Shortcut sequences are user data: this step logs counts, never values.
// Nest-free and `src/`-free: the seed runs in an image without `src/`.
// =============================================================================

import type { PrismaClient } from '@prisma/client';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The forward mapping of one stored `user_settings.value`, or `null` when the
 * row has nothing to move.
 */
export function moveTerminalShortcuts(value: unknown): Json | null {
  if (!isObject(value) || !isObject(value.terminal) || !('keyShortcuts' in value.terminal)) {
    return null;
  }
  const { keyShortcuts, ...terminal } = value.terminal;
  const next: Json = { ...value, terminal };
  // A row that already has the new namespace keeps it: it was written later.
  if (!isObject(value.shortcuts) && Array.isArray(keyShortcuts)) {
    next.shortcuts = { keyShortcuts };
  }
  return next;
}

/**
 * The inverse mapping of one stored `user_settings.value`, or `null` when the
 * row has no `shortcuts` namespace.
 */
export function restoreTerminalShortcuts(value: unknown): Json | null {
  if (!isObject(value) || !('shortcuts' in value)) return null;
  const { shortcuts, ...rest } = value;
  const next: Json = { ...rest };
  const keyShortcuts = isObject(shortcuts) ? shortcuts.keyShortcuts : undefined;
  const terminal = isObject(value.terminal) ? value.terminal : undefined;
  if (terminal !== undefined || Array.isArray(keyShortcuts)) {
    // The pre-#80 stored shape: `showScrollButtons` (required) and the list.
    next.terminal = {
      showScrollButtons:
        typeof terminal?.showScrollButtons === 'boolean' ? terminal.showScrollButtons : true,
      ...(Array.isArray(keyShortcuts) ? { keyShortcuts } : {}),
    };
  }
  return next;
}

type SettingsRows = Pick<PrismaClient, 'userSettings'>;

const PAGE_SIZE = 500;

async function rewriteRows(
  prisma: SettingsRows,
  map: (value: unknown) => Json | null,
): Promise<number> {
  let changed = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.userSettings.findMany({
      select: { id: true, value: true },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) return changed;
    for (const row of rows) {
      const next = map(row.value);
      if (next === null) continue;
      await prisma.userSettings.update({
        where: { id: row.id },
        data: { value: next as object, version: { increment: 1 } },
      });
      changed += 1;
    }
    cursor = rows[rows.length - 1].id;
  }
}

/** Forward: moves every stored `terminal.keyShortcuts`. Returns the rows written. */
export function migrateTerminalShortcuts(prisma: SettingsRows): Promise<number> {
  return rewriteRows(prisma, moveTerminalShortcuts);
}

/** Inverse (rollback): moves every stored `shortcuts` list back. Returns the rows written. */
export function revertTerminalShortcuts(prisma: SettingsRows): Promise<number> {
  return rewriteRows(prisma, restoreTerminalShortcuts);
}

// Run directly for the rollback (see the header).
if (require.main === module) {
  void (async () => {
    const { PrismaClient } = await import('@prisma/client');
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set.');
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    try {
      const revert = process.argv.includes('--revert');
      const rows = revert
        ? await revertTerminalShortcuts(prisma)
        : await migrateTerminalShortcuts(prisma);
      console.log(`${revert ? 'Restored' : 'Moved'} key shortcuts on ${rows} user settings row(s).`);
    } finally {
      await prisma.$disconnect();
    }
  })().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
