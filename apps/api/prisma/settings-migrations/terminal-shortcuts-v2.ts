// =============================================================================
// One-shot data migration: `shortcuts.keyShortcuts` -> `shortcuts.layout`
// (issue #165, touch keys 1; default layout for migrated users, issue #166)
// =============================================================================
//
// The v2 `shortcuts` namespace adds an optional `layout` (ordered groups of up
// to four keys) beside the v1 `keyShortcuts` (`src/terminal/settings/
// shortcuts.user-settings.ts`). Epic #171 decided every user gets the default
// first page (`DEFAULT_KEY_LAYOUT`: actions, Ctrl/Alt toggles, arrows, tmux
// macros, navigation, F-keys). This step therefore writes, for every stored row
// that has a v1 list and no layout:
//
//   forward (`addKeyLayout`, run by the seed through `seed-app.ts`):
//     the default layout, then the user's v1 shortcuts that the default does
//     not already send (the same chords, or an unchanged v1 default), as inline
//     macro keys (id, label and chords kept) in appended rows of at most four
//     cells (a multi-keystroke macro takes two), within the caps (40 groups,
//     50 inline keys). A list equal to the v1 defaults gives exactly the
//     default layout. The row's `options` gets `layoutVersion: 2` (the other
//     two options are filled with their defaults when absent).
//   upgrade: a row the earlier version of this step wrote (a layout of inline
//     macro keys only, no catalog key at all, and no `layoutVersion`) is
//     rebuilt the same way from its `keyShortcuts` (or, with none, from its
//     macros). `layoutVersion: 2` makes it run once: a row that has it is never
//     touched again, so the step is idempotent and cannot loop.
//   `keyShortcuts` is NOT removed: it is the rollback (since #169 no client
//   writes it).
//   inverse (`removeKeyLayout`, the rollback): drops `layout` and `options`.
//
// A written row's `version` is incremented (clients refetch instead of saving
// over it, `If-Match`). Shortcut sequences are user data: logs carry counts
// only. Nest-free and `src/`-free (the seed image has no `src/`): the default
// layout and the packing below copy `DEFAULT_KEY_LAYOUT` and
// `legacyShortcutsToDefaultLayout` of `src/terminal/settings/keys/key-model.ts`,
// and a test keeps the two equal.
//
// Rollback (before reverting #165), from apps/api with DATABASE_URL set:
//   npx ts-node --transpile-only -P prisma/tsconfig.json prisma/settings-migrations/terminal-shortcuts-v2.ts --revert
// =============================================================================

import type { PrismaClient } from '@prisma/client';

import { rewriteRows } from './terminal-shortcuts';

type Json = Record<string, unknown>;

const GRID_COLUMNS = 4;
const MAX_KEYS_PER_GROUP = 4;
const MAX_KEY_GROUPS = 40;
const MAX_INLINE_KEYS = 50;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Chord {
  modifiers: string[];
  key: string;
}

interface Shortcut {
  id: string;
  label: string;
  chords: Chord[];
}

function toChord(value: unknown): Chord | null {
  if (!isObject(value) || typeof value.key !== 'string' || !Array.isArray(value.modifiers)) return null;
  if (!value.modifiers.every((m) => typeof m === 'string')) return null;
  return { modifiers: [...(value.modifiers as string[])], key: value.key };
}

function signature(chords: readonly Chord[]): string {
  return chords.map((c) => `${[...c.modifiers].sort().join('+')}:${c.key}`).join(' ');
}

// --- copy of DEFAULT_KEY_LAYOUT (key-model.ts); a test keeps it equal --------

const ref = (id: string): Json => ({ id });
const tmux = (n: number, label: string, key: string): Json => ({
  key: {
    kind: 'macro',
    id: `33333333-3333-4333-8333-3333333333${String(n).padStart(2, '0')}`,
    label,
    chords: [{ modifiers: ['ctrl'], key: 'b' }, { modifiers: [], key }],
  },
});

export const DEFAULT_LAYOUT_GROUPS: { keys: Json[] }[] = [
  { keys: [ref('ai'), ref('arrow-drag'), ref('attach-file'), ref('snippets')] },
  { keys: [ref('shift+tab'), ref('esc'), ref('ctrl')] },
  { keys: [ref('left'), ref('up'), ref('down'), ref('right')] },
  { keys: [tmux(1, 'Ctrl+B O', 'o'), tmux(2, 'Ctrl+B X', 'x')] },
  { keys: [tmux(3, 'Ctrl+B %', '%'), tmux(4, 'Ctrl+B "', '"')] },
  { keys: [ref('alt'), ref('tab'), ref('insert'), ref('delete')] },
  { keys: [ref('home'), ref('pgup'), ref('pgdn'), ref('end')] },
  { keys: [ref('f1'), ref('f2'), ref('f3'), ref('f4')] },
  { keys: [ref('f5'), ref('f6'), ref('f7'), ref('f8')] },
  { keys: [ref('f9'), ref('f10'), ref('f11'), ref('f12')] },
];

// The chord sequences the default layout sends (the catalog keys it references
// and its tmux macros), and the v1 default shortcuts (id -> chords), which the
// default layout replaces even where it has no such key (Ctrl+C, Ctrl+D).
const P = (key: string): Chord[] => [{ modifiers: [], key }];
const DEFAULT_SIGNATURES = new Set<string>([
  ...['Escape', 'Tab', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete']
    .map((k) => signature(P(k))),
  ...Array.from({ length: 12 }, (_, i) => signature(P(`F${i + 1}`))),
  signature([{ modifiers: ['shift'], key: 'Tab' }]),
  ...[['o'], ['x'], ['%'], ['"']].map(([k]) =>
    signature([{ modifiers: ['ctrl'], key: 'b' }, { modifiers: [], key: k }]),
  ),
]);
const V1_DEFAULT_SIGNATURES: Record<string, string> = {
  '11111111-1111-4111-8111-111111111101': signature(P('Escape')),
  '11111111-1111-4111-8111-111111111102': signature(P('Tab')),
  '11111111-1111-4111-8111-111111111103': signature([{ modifiers: ['shift'], key: 'Tab' }]),
  '11111111-1111-4111-8111-111111111104': signature([{ modifiers: ['ctrl'], key: 'c' }]),
  '11111111-1111-4111-8111-111111111105': signature([{ modifiers: ['ctrl'], key: 'd' }]),
  '11111111-1111-4111-8111-111111111106': signature(P('ArrowUp')),
  '11111111-1111-4111-8111-111111111107': signature(P('ArrowDown')),
  '11111111-1111-4111-8111-111111111108': signature(P('ArrowLeft')),
  '11111111-1111-4111-8111-111111111109': signature(P('ArrowRight')),
};

/** The usable shortcuts of a stored v1 list (malformed entries are skipped). */
function toShortcuts(list: unknown[]): Shortcut[] {
  const out: Shortcut[] = [];
  for (const item of list) {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.label !== 'string') continue;
    if (!Array.isArray(item.keystrokes)) continue;
    const chords = item.keystrokes.map(toChord);
    if (chords.length === 0 || chords.some((c) => c === null)) continue;
    out.push({ id: item.id, label: item.label, chords: chords as Chord[] });
  }
  return out;
}

/** The layout of a user migrated from a stored v1 list: the defaults, then the keys they lack. */
export function layoutFromKeyShortcuts(keyShortcuts: unknown[]): Json {
  const groups: { keys: Json[] }[] = JSON.parse(JSON.stringify(DEFAULT_LAYOUT_GROUPS));
  const ids = new Set<string>();
  let inline = 0;
  for (const group of groups) {
    for (const entry of group.keys) {
      if (isObject(entry.key)) {
        ids.add((entry.key as Json).id as string);
        inline += 1;
      }
    }
  }
  const appended: { keys: Json[] }[] = [];
  let cells = 0;
  for (const shortcut of toShortcuts(keyShortcuts)) {
    const sig = signature(shortcut.chords);
    if (DEFAULT_SIGNATURES.has(sig) || V1_DEFAULT_SIGNATURES[shortcut.id] === sig) continue;
    if (ids.has(shortcut.id) || inline >= MAX_INLINE_KEYS) continue;
    ids.add(shortcut.id);
    inline += 1;
    const entry: Json = {
      key: { kind: 'macro', id: shortcut.id, label: shortcut.label, chords: shortcut.chords },
    };
    const span = shortcut.chords.length > 1 ? 2 : 1;
    const last = appended[appended.length - 1];
    if (last && last.keys.length < MAX_KEYS_PER_GROUP && cells + span <= GRID_COLUMNS) {
      last.keys.push(entry);
      cells += span;
    } else {
      appended.push({ keys: [entry] });
      cells = span;
    }
  }
  return { groups: [...groups, ...appended].slice(0, MAX_KEY_GROUPS) };
}

/**
 * Whether a stored layout is what the earlier version of this step wrote: only
 * inline macro keys (no catalog key, so no Ctrl/Alt toggle). A layout the user
 * saved from an editor has catalog keys; an empty one is the old output for an
 * empty list.
 */
function isOldMigrationLayout(layout: unknown): layout is { groups: { keys: Json[] }[] } {
  if (!isObject(layout) || !Array.isArray(layout.groups)) return false;
  return layout.groups.every(
    (group) =>
      isObject(group) &&
      Array.isArray(group.keys) &&
      group.keys.every((entry) => isObject(entry) && isObject(entry.key) && entry.key.kind === 'macro'),
  );
}

/** The v1 list an old-migration layout stands for, when the row has no `keyShortcuts`. */
function listFromLayout(layout: { groups: { keys: Json[] }[] }): unknown[] {
  const list: unknown[] = [];
  for (const group of layout.groups) {
    for (const entry of group.keys) {
      const key = entry.key as Json;
      list.push({ id: key.id, label: key.label, keystrokes: key.chords });
    }
  }
  return list;
}

/** The forward mapping of one stored `user_settings.value`, or `null` when nothing changes. */
export function addKeyLayout(value: unknown): Json | null {
  if (!isObject(value) || !isObject(value.shortcuts)) return null;
  const { shortcuts } = value;
  const options = isObject(shortcuts.options) ? shortcuts.options : undefined;
  if (options?.layoutVersion === 2) return null;
  let source: unknown[];
  if (!('layout' in shortcuts)) {
    if (!Array.isArray(shortcuts.keyShortcuts)) return null;
    source = shortcuts.keyShortcuts;
  } else if (isOldMigrationLayout(shortcuts.layout)) {
    source = Array.isArray(shortcuts.keyShortcuts) ? shortcuts.keyShortcuts : listFromLayout(shortcuts.layout);
  } else {
    return null;
  }
  return {
    ...value,
    shortcuts: {
      ...shortcuts,
      layout: layoutFromKeyShortcuts(source),
      options: { autoHideWithHardwareKeyboard: true, haptics: true, ...options, layoutVersion: 2 },
    },
  };
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
