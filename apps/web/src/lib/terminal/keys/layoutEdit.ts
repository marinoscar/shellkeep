// =============================================================================
// Editing a v2 key layout (issue #169, epic #171)
// =============================================================================
//
// The pure operations behind the Keyboard shortcuts editor
// (`/settings/shortcuts`): move, add and delete groups and keys, toggle a
// key's span, and validate a whole layout against the same caps as the API's
// `keyLayoutSchema` (`apps/api/src/terminal/settings/key-layout.schema.ts`).
// Every operation returns a NEW layout (or an error message when it would
// break a cap) and never mutates its input. A group is never left empty: the
// API refuses an empty group, so removing a group's last key removes the group.
// No React, no DOM.
// =============================================================================

import {
  CHORD_NAMED_KEYS,
  GRID_COLUMNS,
  MAX_INLINE_KEYS,
  MAX_KEY_GROUPS,
  MAX_KEY_LABEL_LENGTH,
  MAX_KEYS_PER_GROUP,
  MAX_MACRO_CHORDS,
  entrySpan,
  getCatalogKey,
  isChordKey,
  isInlineEntry,
  parseSequenceEscapes,
  type CatalogKey,
  type Chord,
  type KeyGroup,
  type KeyLayout,
  type KeySpan,
  type LayoutEntry,
  KEY_CATALOG,
} from './keyModel';

/** Where a key sits: its group and its index in the group. */
export interface KeyPosition {
  group: number;
  index: number;
}

/** An edit that worked (the new layout, and where the touched key now is) or why it did not. */
export type EditResult =
  | { ok: true; layout: KeyLayout; position?: KeyPosition }
  | { ok: false; error: string };

const fail = (error: string): EditResult => ({ ok: false, error });

function clone(layout: KeyLayout): KeyLayout {
  return JSON.parse(JSON.stringify(layout)) as KeyLayout;
}

/** The cells a group's keys take in the 4-column grid. */
export function groupCells(group: KeyGroup): number {
  return group.keys.reduce((n, entry) => n + entrySpan(entry), 0);
}

/** How many inline (macro and custom) keys a layout holds. */
export function inlineKeyCount(layout: KeyLayout): number {
  return layout.groups.reduce((n, g) => n + g.keys.filter(isInlineEntry).length, 0);
}

/** Why `entry` cannot join `group`, or `null` when it fits. */
export function groupFitError(group: KeyGroup, entry: LayoutEntry, groupNumber: number): string | null {
  if (group.keys.length >= MAX_KEYS_PER_GROUP) {
    return `Group ${groupNumber} is full: at most ${MAX_KEYS_PER_GROUP} keys.`;
  }
  const free = GRID_COLUMNS - groupCells(group);
  if (entrySpan(entry) > free) {
    return `Group ${groupNumber} has ${free} free ${free === 1 ? 'cell' : 'cells'}; this key needs ${entrySpan(entry)}.`;
  }
  return null;
}

/** Why a new inline key cannot be added, or `null`. */
export function inlineCapError(layout: KeyLayout): string | null {
  return inlineKeyCount(layout) >= MAX_INLINE_KEYS
    ? `At most ${MAX_INLINE_KEYS} custom and macro keys per layout.`
    : null;
}

/** Why a new group cannot be added, or `null`. */
export function groupCapError(layout: KeyLayout): string | null {
  return layout.groups.length >= MAX_KEY_GROUPS ? `At most ${MAX_KEY_GROUPS} groups.` : null;
}

/** Swaps group `index` with its neighbour above (`-1`) or below (`+1`). */
export function moveGroup(layout: KeyLayout, index: number, delta: -1 | 1): EditResult {
  const target = index + delta;
  if (target < 0 || target >= layout.groups.length) return fail('The group cannot move further.');
  const next = clone(layout);
  [next.groups[index], next.groups[target]] = [next.groups[target], next.groups[index]];
  return { ok: true, layout: next };
}

export function deleteGroup(layout: KeyLayout, index: number): EditResult {
  const next = clone(layout);
  next.groups.splice(index, 1);
  return { ok: true, layout: next };
}

/**
 * Adds `entry` at the end of group `group`, or in a new group at the end when
 * `group` is `'new'`. Refuses what would break a cap.
 */
export function addEntry(layout: KeyLayout, group: number | 'new', entry: LayoutEntry): EditResult {
  if (isInlineEntry(entry)) {
    const capError = inlineCapError(layout);
    if (capError) return fail(capError);
  }
  const next = clone(layout);
  const copy = JSON.parse(JSON.stringify(entry)) as LayoutEntry;
  if (group === 'new') {
    const capError = groupCapError(layout);
    if (capError) return fail(capError);
    next.groups.push({ keys: [copy] });
    return { ok: true, layout: next, position: { group: next.groups.length - 1, index: 0 } };
  }
  const target = next.groups[group];
  if (!target) return fail('No such group.');
  const fitError = groupFitError(target, copy, group + 1);
  if (fitError) return fail(fitError);
  target.keys.push(copy);
  return { ok: true, layout: next, position: { group, index: target.keys.length - 1 } };
}

/** Deletes a key; a group left empty is deleted too. */
export function removeEntry(layout: KeyLayout, at: KeyPosition): EditResult {
  const next = clone(layout);
  const group = next.groups[at.group];
  if (!group?.keys[at.index]) return fail('No such key.');
  group.keys.splice(at.index, 1);
  if (group.keys.length === 0) next.groups.splice(at.group, 1);
  return { ok: true, layout: next };
}

/** Moves a key one place left (`-1`) or right (`+1`) in its group. */
export function moveEntryWithin(layout: KeyLayout, at: KeyPosition, delta: -1 | 1): EditResult {
  const group = layout.groups[at.group];
  const target = at.index + delta;
  if (!group || target < 0 || target >= group.keys.length) return fail('The key cannot move further.');
  const next = clone(layout);
  const keys = next.groups[at.group].keys;
  [keys[at.index], keys[target]] = [keys[target], keys[at.index]];
  return { ok: true, layout: next, position: { group: at.group, index: target } };
}

/**
 * Moves a key into another group, before `beforeIndex` (default: at its end).
 * Moving down from the last group puts the key in a new group of its own
 * (`toGroup === groups.length`). The source group is deleted when left empty.
 */
export function moveEntryToGroup(
  layout: KeyLayout,
  at: KeyPosition,
  toGroup: number,
  beforeIndex?: number,
): EditResult {
  const source = layout.groups[at.group];
  const entry = source?.keys[at.index];
  if (!entry) return fail('No such key.');
  if (toGroup === at.group) {
    // A drop inside the same group: reorder.
    const next = clone(layout);
    const keys = next.groups[at.group].keys;
    const [moved] = keys.splice(at.index, 1);
    let insertAt = beforeIndex ?? keys.length;
    if (beforeIndex !== undefined && beforeIndex > at.index) insertAt -= 1;
    insertAt = Math.max(0, Math.min(insertAt, keys.length));
    keys.splice(insertAt, 0, moved);
    return { ok: true, layout: next, position: { group: at.group, index: insertAt } };
  }
  if (toGroup < 0 || toGroup > layout.groups.length) return fail('The key cannot move further.');
  const next = clone(layout);
  let targetIndex = toGroup;
  if (toGroup === layout.groups.length) {
    if (source.keys.length === 1) return fail('The key is already alone in the last group.');
    const capError = groupCapError(layout);
    if (capError) return fail(capError);
    next.groups.push({ keys: [] });
  } else {
    const fitError = groupFitError(layout.groups[toGroup], entry, toGroup + 1);
    if (fitError) return fail(fitError);
  }
  const [moved] = next.groups[at.group].keys.splice(at.index, 1);
  const keys = next.groups[targetIndex].keys;
  const insertAt = Math.max(0, Math.min(beforeIndex ?? keys.length, keys.length));
  keys.splice(insertAt, 0, moved);
  if (next.groups[at.group].keys.length === 0) {
    next.groups.splice(at.group, 1);
    if (at.group < targetIndex) targetIndex -= 1;
  }
  return { ok: true, layout: next, position: { group: targetIndex, index: insertAt } };
}

/** The span a key takes by default (its catalog span, or 2 for a multi-chord macro). */
export function defaultSpan(entry: LayoutEntry): KeySpan {
  const bare = { ...entry } as LayoutEntry & { span?: KeySpan };
  delete bare.span;
  return entrySpan(bare);
}

/**
 * Toggles a key between one and two cells. The span is stored only when it
 * differs from the key's default. Refuses a widening the group has no room for.
 */
export function toggleSpan(layout: KeyLayout, at: KeyPosition): EditResult {
  const group = layout.groups[at.group];
  const entry = group?.keys[at.index];
  if (!entry) return fail('No such key.');
  const span: KeySpan = entrySpan(entry) === 1 ? 2 : 1;
  if (span === 2 && groupCells(group) + 1 > GRID_COLUMNS) {
    return fail(`Group ${at.group + 1} has no free cell to widen this key.`);
  }
  const next = clone(layout);
  const target = next.groups[at.group].keys[at.index] as LayoutEntry & { span?: KeySpan };
  if (span === defaultSpan(target)) delete target.span;
  else target.span = span;
  return { ok: true, layout: next, position: at };
}

// -----------------------------------------------------------------------------
// Labels and the picker's sections
// -----------------------------------------------------------------------------

/** The label a key shows. */
export function entryLabel(entry: LayoutEntry): string {
  if (isInlineEntry(entry)) return entry.key.label;
  return getCatalogKey(entry.id)?.label ?? entry.id;
}

const CATALOG_KEY_NAMES: Record<string, string> = {
  left: 'Left arrow',
  right: 'Right arrow',
  up: 'Up arrow',
  down: 'Down arrow',
  pgup: 'Page Up',
  pgdn: 'Page Down',
  insert: 'Insert',
  delete: 'Delete',
  ai: 'AI assistant',
  'arrow-drag': 'Arrow drag',
  'attach-file': 'Attach a file',
};

/** A key's name for screen readers: `Left arrow` where the label is `←`. */
export function entryName(entry: LayoutEntry): string {
  if (isInlineEntry(entry)) return entry.key.label;
  return CATALOG_KEY_NAMES[entry.id] ?? entryLabel(entry);
}

/** What a key is, in words, for its accessible description. */
export function entryKindLabel(entry: LayoutEntry): string {
  if (isInlineEntry(entry)) return entry.key.kind === 'macro' ? 'Macro' : 'Custom key';
  const catalog = getCatalogKey(entry.id);
  if (!catalog) return 'Unknown key';
  return CATALOG_SECTION_LABELS[catalogSection(catalog)].replace(/s$/, '');
}

export type CatalogSection = 'modifiers' | 'keys' | 'navigation' | 'function' | 'signals' | 'actions';

export const CATALOG_SECTIONS: readonly CatalogSection[] = [
  'modifiers',
  'keys',
  'navigation',
  'function',
  'signals',
  'actions',
];

export const CATALOG_SECTION_LABELS: Record<CatalogSection, string> = {
  modifiers: 'Modifiers',
  keys: 'Keys',
  navigation: 'Navigation',
  function: 'Function keys',
  signals: 'Signals',
  actions: 'Actions',
};

const NAVIGATION_IDS = new Set(['left', 'down', 'up', 'right', 'home', 'end', 'pgup', 'pgdn', 'insert', 'delete']);

/** The picker section a catalog key is listed under. */
export function catalogSection(key: CatalogKey): CatalogSection {
  if (key.kind === 'modifier') return 'modifiers';
  if (key.kind === 'action') return 'actions';
  if (/^f\d+$/.test(key.id)) return 'function';
  if (NAVIGATION_IDS.has(key.id)) return 'navigation';
  if (key.chord?.modifiers.includes('ctrl')) return 'signals';
  return 'keys';
}

/** The catalog grouped by picker section, in catalog order. */
export function catalogBySection(): { section: CatalogSection; keys: CatalogKey[] }[] {
  return CATALOG_SECTIONS.map((section) => ({
    section,
    keys: KEY_CATALOG.filter((key) => catalogSection(key) === section),
  }));
}

const NAMED_KEY_LABELS: Record<string, string> = {
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Insert: 'Ins',
  Delete: 'Del',
};

const MODIFIER_LABELS: Record<string, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta' };

/** A chord as people write it: `Ctrl+B`, `%`, `Alt+←`. */
export function chordLabel(chord: Chord): string {
  const key = NAMED_KEY_LABELS[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  const mods = (['ctrl', 'alt', 'shift', 'meta'] as const).filter((m) => chord.modifiers.includes(m));
  return [...mods.map((m) => MODIFIER_LABELS[m]), key].join('+');
}

/** A macro's chords as a label: `Ctrl+B %`, cut to the label cap. */
export function macroLabel(chords: readonly Chord[]): string {
  return chords.map(chordLabel).join(' ').slice(0, MAX_KEY_LABEL_LENGTH);
}

/** Bytes as space-separated hex pairs: `1b 5b 41`. */
export function formatHexBytes(data: string): string {
  return Array.from(data, (char) => (char.codePointAt(0) ?? 0).toString(16).padStart(2, '0')).join(' ');
}

/** A random RFC 4122 version 4 UUID (the API's `z.string().uuid()` accepts it). */
export function newKeyId(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Why a label is not acceptable, or `null`. */
export function labelError(label: string): string | null {
  if (label.trim().length === 0) return 'Enter a label.';
  if (label.length > MAX_KEY_LABEL_LENGTH) return `A label is at most ${MAX_KEY_LABEL_LENGTH} characters.`;
  return null;
}

// -----------------------------------------------------------------------------
// Whole-layout validation (the API's caps)
// -----------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Every reason the API would refuse `layout`, in words (empty when it is
 * valid): the group, key, cell, inline-key, chord, label and sequence caps,
 * unknown catalog ids, and inline ids that are not UUIDs or are used twice.
 */
export function validateKeyLayout(layout: KeyLayout): string[] {
  const errors: string[] = [];
  if (layout.groups.length > MAX_KEY_GROUPS) errors.push(`At most ${MAX_KEY_GROUPS} groups.`);
  const ids = new Set<string>();
  let inline = 0;
  layout.groups.forEach((group, g) => {
    const n = g + 1;
    if (group.keys.length === 0) errors.push(`Group ${n} is empty.`);
    if (group.keys.length > MAX_KEYS_PER_GROUP) errors.push(`Group ${n} has more than ${MAX_KEYS_PER_GROUP} keys.`);
    if (groupCells(group) > GRID_COLUMNS) errors.push(`Group ${n} takes more than ${GRID_COLUMNS} cells.`);
    for (const entry of group.keys) {
      if (!isInlineEntry(entry)) {
        if (!getCatalogKey(entry.id)) errors.push(`Group ${n}: unknown key "${entry.id}".`);
        continue;
      }
      inline += 1;
      const { key } = entry;
      if (!UUID.test(key.id)) errors.push(`Group ${n}: "${key.label}" has an invalid id.`);
      else if (ids.has(key.id)) errors.push(`Group ${n}: "${key.label}" has the id of another key.`);
      ids.add(key.id);
      const badLabel = labelError(key.label);
      if (badLabel) errors.push(`Group ${n}: ${badLabel}`);
      if (key.kind === 'macro') {
        if (key.chords.length < 1 || key.chords.length > MAX_MACRO_CHORDS) {
          errors.push(`Group ${n}: "${key.label}" needs 1 to ${MAX_MACRO_CHORDS} chords.`);
        }
        if (key.chords.some((chord) => !isChordKey(chord.key))) {
          errors.push(`Group ${n}: "${key.label}" has a chord key that is not one of ${CHORD_NAMED_KEYS.length} named keys or one printable character.`);
        }
      } else {
        const parsed = parseSequenceEscapes(key.sequence);
        if (!parsed.ok) errors.push(`Group ${n}: "${key.label}": ${parsed.error}`);
      }
    }
  });
  if (inline > MAX_INLINE_KEYS) errors.push(`At most ${MAX_INLINE_KEYS} custom and macro keys per layout.`);
  return errors;
}
