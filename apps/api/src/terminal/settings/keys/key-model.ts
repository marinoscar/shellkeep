// =============================================================================
// The touch key model: key catalog, layout types, defaults and the custom
// sequence parser (issue #165, epic #171)
// =============================================================================
//
// PURE and import-free, so the same file is used by the web app and the API.
// There are two byte-identical copies, which `keyModel.test.ts` (web, "parity with the API copy")
// keeps equal:
//
//   apps/web/src/lib/terminal/keys/keyModel.ts          (edit this one)
//   apps/api/src/terminal/settings/keys/key-model.ts    (copy it over)
//
// (`packages/shared` is hand-written CommonJS the web app does not consume, so
// a mirrored copy with a parity test is the repo's pattern for web/API shared
// code, like `KEY_SHORTCUT_BASE_KEYS`.) Catalog ids are stored in the user's
// `shortcuts.layout`: NEVER rename or remove one.
//
// The encoder (`encodeKey.ts`) is web-only: the API never produces key bytes.
// =============================================================================

// -----------------------------------------------------------------------------
// Chords
// -----------------------------------------------------------------------------

export type KeyModifier = 'ctrl' | 'shift' | 'alt' | 'meta';

export const KEY_MODIFIERS: readonly KeyModifier[] = ['ctrl', 'shift', 'alt', 'meta'];

/** The named (non-printable) keys a chord may use; the names of the v1 keystrokes. */
export const CHORD_NAMED_KEYS = [
  'Escape', 'Tab', 'Enter', 'Backspace', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
] as const;

/**
 * One key press with modifiers: `key` is a named key (`CHORD_NAMED_KEYS`) or a
 * single printable ASCII character (`o`, `%`, `"`). `ctrl+B` is
 * `{ modifiers: ['ctrl'], key: 'b' }`.
 */
export interface Chord {
  modifiers: KeyModifier[];
  key: string;
}

/** Whether `key` is a valid chord key: a named key or one printable ASCII character. */
export function isChordKey(key: string): boolean {
  return (CHORD_NAMED_KEYS as readonly string[]).includes(key) || /^[\x21-\x7e]$/.test(key);
}

// -----------------------------------------------------------------------------
// Catalog
// -----------------------------------------------------------------------------

/** `key` sends bytes, `modifier` arms Ctrl/Alt/Shift, `action` runs an app action. */
export type CatalogKeyKind = 'key' | 'modifier' | 'action';

/** Every kind of key a layout entry can be (`macro` and `custom` are inline, user-made). */
export type KeyKind = CatalogKeyKind | 'macro' | 'custom';

export type KeySpan = 1 | 2;

export interface CatalogKey {
  /** Stable, stored in layouts. */
  id: string;
  kind: CatalogKeyKind;
  label: string;
  /** Cells wide in the 4-column grid by default. */
  span: KeySpan;
  /** Holding the key repeats it (arrows and navigation). */
  repeatable: boolean;
  /** What a `key` sends (a modifier of its own, e.g. `shift+tab`); absent for modifiers and actions. */
  chord?: Chord;
}

function key(
  id: string,
  label: string,
  chord: Chord,
  extra: { span?: KeySpan; repeatable?: boolean } = {},
): CatalogKey {
  return { id, kind: 'key', label, span: extra.span ?? 1, repeatable: extra.repeatable ?? false, chord };
}

const plain = (name: string): Chord => ({ modifiers: [], key: name });
const ctrl = (name: string): Chord => ({ modifiers: ['ctrl'], key: name });

const F_KEYS: CatalogKey[] = Array.from({ length: 12 }, (_, i) =>
  key(`f${i + 1}`, `F${i + 1}`, plain(`F${i + 1}`)),
);

/** The key catalog, in picker order. */
export const KEY_CATALOG: readonly CatalogKey[] = [
  key('esc', 'Esc', plain('Escape')),
  key('tab', 'Tab', plain('Tab')),
  key('shift+tab', 'Shift+Tab', { modifiers: ['shift'], key: 'Tab' }, { span: 2 }),
  key('enter', 'Enter', plain('Enter')),
  key('backspace', 'Backspace', plain('Backspace'), { span: 2, repeatable: true }),
  { id: 'ctrl', kind: 'modifier', label: 'Ctrl', span: 1, repeatable: false },
  { id: 'alt', kind: 'modifier', label: 'Alt', span: 1, repeatable: false },
  { id: 'shift', kind: 'modifier', label: 'Shift', span: 1, repeatable: false },
  key('left', '←', plain('ArrowLeft'), { repeatable: true }),
  key('down', '↓', plain('ArrowDown'), { repeatable: true }),
  key('up', '↑', plain('ArrowUp'), { repeatable: true }),
  key('right', '→', plain('ArrowRight'), { repeatable: true }),
  key('home', 'Home', plain('Home'), { repeatable: true }),
  key('end', 'End', plain('End'), { repeatable: true }),
  key('pgup', 'PgUp', plain('PageUp'), { repeatable: true }),
  key('pgdn', 'PgDn', plain('PageDown'), { repeatable: true }),
  key('insert', 'Ins', plain('Insert')),
  key('delete', 'Del', plain('Delete'), { repeatable: true }),
  ...F_KEYS,
  key('ctrl+c', 'Ctrl+C', ctrl('c')),
  key('ctrl+d', 'Ctrl+D', ctrl('d')),
  key('ctrl+z', 'Ctrl+Z', ctrl('z')),
  key('ctrl+\\', 'Ctrl+\\', ctrl('\\')),
  { id: 'ai', kind: 'action', label: 'AI', span: 1, repeatable: false },
  { id: 'arrow-drag', kind: 'action', label: 'Drag', span: 1, repeatable: false },
  { id: 'attach-file', kind: 'action', label: 'Attach', span: 1, repeatable: false },
  { id: 'snippets', kind: 'action', label: 'Snippets', span: 1, repeatable: false },
];

/** Every catalog id, for validation. */
export const CATALOG_KEY_IDS: readonly string[] = KEY_CATALOG.map((k) => k.id);

const BY_ID = new Map(KEY_CATALOG.map((k) => [k.id, k]));

/** The catalog key with this id, or `undefined`. */
export function getCatalogKey(id: string): CatalogKey | undefined {
  return BY_ID.get(id);
}

export const KEY_MODIFIER_IDS = ['ctrl', 'alt', 'shift'] as const;
export const KEY_ACTION_IDS = ['ai', 'arrow-drag', 'attach-file', 'snippets'] as const;

// -----------------------------------------------------------------------------
// Custom sequences (`custom` keys)
// -----------------------------------------------------------------------------

/** The most characters a custom key's sequence may send once the escapes are parsed. */
export const MAX_CUSTOM_SEQUENCE_LENGTH = 64;

export type ParsedSequence = { ok: true; value: string } | { ok: false; error: string };

/**
 * Parses a custom key's literal sequence: `\x1b` (any `\xNN`), `\e` (ESC),
 * `\r`, `\n`, `\t` and `\\` are escapes, everything else is literal. Rejects an
 * empty result, a result longer than `MAX_CUSTOM_SEQUENCE_LENGTH`, a trailing
 * backslash, an unknown escape and a malformed `\x`.
 */
export function parseSequenceEscapes(source: string): ParsedSequence {
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = source[i + 1];
    if (next === undefined) return { ok: false, error: 'The sequence ends with a lone backslash.' };
    i += 1;
    switch (next) {
      case 'e': out += '\x1b'; break;
      case 'r': out += '\r'; break;
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case '\\': out += '\\'; break;
      case 'x': {
        const hex = source.slice(i + 1, i + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
          return { ok: false, error: 'An \\x escape needs two hex digits.' };
        }
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2;
        break;
      }
      default:
        return { ok: false, error: `Unknown escape \\${next}.` };
    }
  }
  if (out.length === 0) return { ok: false, error: 'The sequence is empty.' };
  if (out.length > MAX_CUSTOM_SEQUENCE_LENGTH) {
    return { ok: false, error: `The sequence is longer than ${MAX_CUSTOM_SEQUENCE_LENGTH} characters.` };
  }
  return { ok: true, value: out };
}

// -----------------------------------------------------------------------------
// Inline keys, layout, options
// -----------------------------------------------------------------------------

/** A sequence of chords sent in order, e.g. the tmux prefix and a key (`ctrl+b`, `o`). */
export interface MacroKey {
  kind: 'macro';
  id: string;
  label: string;
  chords: Chord[];
}

/** A label plus a literal sequence with escapes (`\x1b[1;5C`). */
export interface CustomKey {
  kind: 'custom';
  id: string;
  label: string;
  sequence: string;
}

export type InlineKey = MacroKey | CustomKey;

/** A group entry: a catalog key by id, or an inline key, with an optional span override. */
export type LayoutEntry =
  | { id: string; span?: KeySpan }
  | { key: InlineKey; span?: KeySpan };

/** A row of the grid: up to `MAX_KEYS_PER_GROUP` keys whose spans total at most `GRID_COLUMNS`. */
export interface KeyGroup {
  keys: LayoutEntry[];
}

export interface KeyLayout {
  groups: KeyGroup[];
}

export interface KeyOptions {
  /** Hide the key row while a hardware keyboard is in use. */
  autoHideWithHardwareKeyboard: boolean;
  /** A short vibration on each key press where the device supports it. */
  haptics: boolean;
}

export const GRID_COLUMNS = 4;
export const MAX_KEYS_PER_GROUP = 4;
export const MAX_KEY_GROUPS = 40;
/** The most inline (macro and custom) keys in a layout; the v1 cap on shortcuts. */
export const MAX_INLINE_KEYS = 50;
export const MAX_MACRO_CHORDS = 8;
export const MAX_KEY_LABEL_LENGTH = 40;

/** Whether an entry is an inline key (as opposed to a catalog reference). */
export function isInlineEntry(entry: LayoutEntry): entry is { key: InlineKey; span?: KeySpan } {
  return 'key' in entry;
}

/** The span an entry takes: its override, else its key's default. */
export function entrySpan(entry: LayoutEntry): KeySpan {
  if (entry.span !== undefined) return entry.span;
  if (isInlineEntry(entry)) {
    return entry.key.kind === 'macro' && entry.key.chords.length > 1 ? 2 : 1;
  }
  return getCatalogKey(entry.id)?.span ?? 1;
}

export const DEFAULT_KEY_OPTIONS: Readonly<KeyOptions> = {
  autoHideWithHardwareKeyboard: true,
  haptics: true,
};

const tmux = (n: number, label: string, last: Chord): LayoutEntry => ({
  key: {
    kind: 'macro',
    id: `33333333-3333-4333-8333-3333333333${String(n).padStart(2, '0')}`,
    label,
    chords: [{ modifiers: ['ctrl'], key: 'b' }, last],
  },
});

const ref = (id: string): LayoutEntry => ({ id });

/**
 * The layout a user without a stored one gets (epic #171): the actions, then
 * `shift+tab esc ctrl`, the arrows, the tmux macros (prefix `ctrl+b`), `alt tab
 * ins del`, `home pgUp pgDn end` and F1 to F12 in rows of four.
 */
export const DEFAULT_KEY_LAYOUT: Readonly<KeyLayout> = {
  groups: [
    { keys: [ref('ai'), ref('arrow-drag'), ref('attach-file'), ref('snippets')] },
    { keys: [ref('shift+tab'), ref('esc'), ref('ctrl')] },
    { keys: [ref('left'), ref('up'), ref('down'), ref('right')] },
    { keys: [tmux(1, 'Ctrl+B O', plainChord('o')), tmux(2, 'Ctrl+B X', plainChord('x'))] },
    { keys: [tmux(3, 'Ctrl+B %', plainChord('%')), tmux(4, 'Ctrl+B "', plainChord('"'))] },
    { keys: [ref('alt'), ref('tab'), ref('insert'), ref('delete')] },
    { keys: [ref('home'), ref('pgup'), ref('pgdn'), ref('end')] },
    { keys: [ref('f1'), ref('f2'), ref('f3'), ref('f4')] },
    { keys: [ref('f5'), ref('f6'), ref('f7'), ref('f8')] },
    { keys: [ref('f9'), ref('f10'), ref('f11'), ref('f12')] },
  ],
};

function plainChord(name: string): Chord {
  return { modifiers: [], key: name };
}

// -----------------------------------------------------------------------------
// Conversion from the v1 `keyShortcuts`
// -----------------------------------------------------------------------------

/** A v1 shortcut: a label and up to three keystrokes (a keystroke is a chord). */
export interface LegacyShortcut {
  id: string;
  label: string;
  keystrokes: Chord[];
}

/**
 * The v2 layout holding exactly a v1 shortcut list: each shortcut becomes an
 * inline macro key (its keystrokes are its chords; the id and label are kept)
 * and the keys are packed in rows of at most four cells. Pure and deterministic.
 */
export function legacyShortcutsToLayout(shortcuts: readonly LegacyShortcut[]): KeyLayout {
  const groups: KeyGroup[] = [];
  let cells = 0;
  for (const shortcut of shortcuts) {
    const entry: LayoutEntry = {
      key: {
        kind: 'macro',
        id: shortcut.id,
        label: shortcut.label,
        chords: shortcut.keystrokes.map((k) => ({ modifiers: [...k.modifiers], key: k.key })),
      },
    };
    const span = entrySpan(entry);
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
