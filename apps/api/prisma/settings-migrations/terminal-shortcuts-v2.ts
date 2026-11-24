// =============================================================================
// One-shot data migration: `shortcuts.keyShortcuts` -> `shortcuts.layout`
// (issue #165, touch keys 1)
// =============================================================================
//
// The v2 `shortcuts` namespace adds an optional `layout` (ordered groups of up
// to four keys) beside the v1 `keyShortcuts` (`src/terminal/settings/
// shortcuts.user-settings.ts`). This step gives every stored row that has a v1
// list and no layout one holding exactly that list:
//
//   forward (`addKeyLayout`, run by the seed through `seed-app.ts`):
//     each v1 shortcut (label + up to three keystrokes) becomes an inline macro
//     key (its keystrokes are the chords; id and label are kept), packed in
//     rows of at most four cells (a multi-keystroke macro takes two). Rows with
//     a `layout` already, or without a list, are left alone, so it is
//     idempotent. `keyShortcuts` is NOT removed: it is the rollback and the
//     source of the legacy editor until #169.
//   inverse (`removeKeyLayout`, the rollback): drops `layout` and `options`.
//
// A written row's `version` is incremented (clients refetch instead of saving
// over it, `If-Match`). Shortcut sequences are user data: logs carry counts
// only. Nest-free and `src/`-free (the seed image has no `src/`): the packing
// below copies `legacyShortcutsToLayout` of `src/terminal/settings/keys/
// key-model.ts`, and a test keeps the two equal.
//
// Rollback (before reverting #165), from apps/api with DATABASE_URL set:
//   npx ts-node --transpile-only -P prisma/tsconfig.json prisma/settings-migrations/terminal-shortcuts-v2.ts --revert
// =============================================================================

import type { PrismaClient } from '@prisma/client';

import { rewriteRows } from './terminal-shortcuts';

type Json = Record<string, unknown>;

const GRID_COLUMNS = 4;
const MAX_KEYS_PER_GROUP = 4;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Chord {
  modifiers: string[];
  key: string;
}

function toChord(value: unknown): Chord | null {
  if (!isObject(value) || typeof value.key !== 'string' || !Array.isArray(value.modifiers)) return null;
  if (!value.modifiers.every((m) => typeof m === 'string')) return null;
  return { modifiers: [...(value.modifiers as string[])], key: value.key };
}

/** The layout for a stored v1 list, or `null` when it has nothing usable. */
export function layoutFromKeyShortcuts(keyShortcuts: unknown[]): Json | null {
  const groups: { keys: Json[] }[] = [];
  let cells = 0;
  for (const item of keyShortcuts) {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.label !== 'string') continue;
    if (!Array.isArray(item.keystrokes)) continue;
    const chords = item.keystrokes.map(toChord);
    if (chords.length === 0 || chords.some((c) => c === null)) continue;
    const entry: Json = { key: { kind: 'macro', id: item.id, label: item.label, chords } };
    const span = chords.length > 1 ? 2 : 1;
    const last = groups[groups.length - 1];
    if (last && last.keys.length < MAX_KEYS_PER_GROUP && cells + span <= GRID_COLUMNS) {
      last.keys.push(entry);
      cells += span;
    } else {
      groups.push({ keys: [entry] });
      cells = span;
    }
  }
  return { groups };
}

/** The forward mapping of one stored `user_settings.value`, or `null` when nothing changes. */
export function addKeyLayout(value: unknown): Json | null {
  if (!isObject(value) || !isObject(value.shortcuts)) return null;
  const { shortcuts } = value;
  if ('layout' in shortcuts || !Array.isArray(shortcuts.keyShortcuts)) return null;
  const layout = layoutFromKeyShortcuts(shortcuts.keyShortcuts);
  if (layout === null) return null;
  return { ...value, shortcuts: { ...shortcuts, layout } };
}

/** The inverse mapping, or `null` when the row has neither `layout` nor `options`. */
export function removeKeyLayout(value: unknown): Json | null {
  if (!isObject(value) || !isObject(value.shortcuts)) return null;
  const { layout, options, ...rest } = value.shortcuts;
  if (layout === undefined && options === undefined) return null;
  return { ...value, shortcuts: rest };
}

type SettingsRows = Pick<PrismaClient, 'userSettings'>;

/** Forward: adds the layout to every stored v1 row. Returns the rows written. */
export function migrateKeyLayout(prisma: SettingsRows): Promise<number> {
  return rewriteRows(prisma, addKeyLayout);
}

/** Inverse (rollback). Returns the rows written. */
export function revertKeyLayout(prisma: SettingsRows): Promise<number> {
  return rewriteRows(prisma, removeKeyLayout);
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
      const rows = revert ? await revertKeyLayout(prisma) : await migrateKeyLayout(prisma);
      console.log(`${revert ? 'Removed' : 'Added'} the key layout on ${rows} user settings row(s).`);
    } finally {
      await prisma.$disconnect();
    }
  })().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
