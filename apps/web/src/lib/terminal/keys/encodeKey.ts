// =============================================================================
// The key encoder (issue #165)
// =============================================================================
//
// `encodeKey` turns a catalog id, a chord or an inline key into the bytes
// written to the terminal. Pure: no DOM, no xterm instance. The sequences are
// the ones xterm.js sends for a hardware key
// (node_modules/@xterm/xterm/src/common/input/Keyboard.ts, `evaluateKeyboardEvent`):
//
//   cursor keys   normal `ESC [ A`, application cursor mode (DECCKM) `ESC O A`;
//                 Home/End likewise (`ESC [ H` / `ESC O H`, `F`)
//   modified      `CSI 1 ; m X` for arrows, Home and End, m = 1 + shift(1) +
//                 alt(2) + ctrl(4) + meta(8); the application mode never applies
//   tilde keys    PgUp `5~`, PgDn `6~`, Insert `2~`, Delete `3~`; modified `CSI 5 ; m ~`
//   F1-F4         `ESC O P/Q/R/S`; modified `CSI 1 ; m P/Q/R/S`
//   F5-F12        `CSI 15~ 17~ 18~ 19~ 20~ 21~ 23~ 24~`; modified `CSI 15 ; m ~`
//   Ctrl + char   the control character (letters, `@ [ \ ] ^ _`, space, `?` DEL, 3-8)
//   Alt + char    an ESC prefix (also on Tab, Enter, Backspace, Escape, Space)
//   Shift+Tab     `CSI Z`
//
// Deliberate differences from xterm.js: Alt+arrow is `CSI 1;3 X` (xterm
// rewrites it to Ctrl+arrow on Linux), and Shift+PgUp/PgDn and a modified Insert
// are sent (xterm scrolls its own buffer, or sends nothing).
// =============================================================================

import {
  getCatalogKey,
  parseSequenceEscapes,
  type Chord,
  type InlineKey,
  type KeyModifier,
} from './keyModel';

/** The modifiers armed on the key bar (#166) when the key is pressed. */
export type ActiveModifiers = Partial<Record<KeyModifier, boolean>>;

export interface EncodeOptions {
  /** Armed modifiers, added to the chord's own. Ignored by macro and custom keys. */
  modifiers?: ActiveModifiers;
  /** The terminal is in application cursor keys mode (DECCKM). */
  applicationCursor?: boolean;
}

/** What `encodeKey` accepts: a catalog id, one chord, or a macro or custom key. */
export type EncodableKey = string | Chord | InlineKey;

const ESC = '\x1b';

const CURSOR_FINAL: Record<string, string> = {
  ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F',
};
const TILDE_CODE: Record<string, number> = { Insert: 2, Delete: 3, PageUp: 5, PageDown: 6 };
const SS3_FINAL: Record<string, string> = { F1: 'P', F2: 'Q', F3: 'R', F4: 'S' };
const F_TILDE_CODE: Record<string, number> = {
  F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24,
};

/** Control characters of the punctuation xterm maps (`^@` NUL ... `^_` US, `^?` DEL). */
const CTRL_PUNCTUATION: Record<string, number> = {
  '@': 0x00, ' ': 0x00, '[': 0x1b, '\\': 0x1c, ']': 0x1d, '^': 0x1e, '_': 0x1f, '?': 0x7f,
  '3': 0x1b, '4': 0x1c, '5': 0x1d, '6': 0x1e, '7': 0x1f, '8': 0x7f,
};

/** The xterm modifier parameter: 1 + shift(1) + alt(2) + ctrl(4) + meta(8). */
export function modifierParam(mods: { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }): number {
  return 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0) + (mods.meta ? 8 : 0);
}

/** The bytes of one chord, with the armed modifiers added to the chord's own. */
export function encodeChord(chord: Chord, options: EncodeOptions = {}): string {
  const armed = options.modifiers ?? {};
  const has = (m: KeyModifier) => chord.modifiers.includes(m) || armed[m] === true;
  const mods = { ctrl: has('ctrl'), alt: has('alt'), shift: has('shift'), meta: has('meta') };
  const m = modifierParam(mods);
  const name = chord.key;

  if (name in CURSOR_FINAL) {
    const final = CURSOR_FINAL[name];
    if (m > 1) return `${ESC}[1;${m}${final}`;
    return options.applicationCursor ? `${ESC}O${final}` : `${ESC}[${final}`;
  }
  if (name in TILDE_CODE) {
    return m > 1 ? `${ESC}[${TILDE_CODE[name]};${m}~` : `${ESC}[${TILDE_CODE[name]}~`;
  }
  if (name in SS3_FINAL) {
    return m > 1 ? `${ESC}[1;${m}${SS3_FINAL[name]}` : `${ESC}O${SS3_FINAL[name]}`;
  }
  if (name in F_TILDE_CODE) {
    return m > 1 ? `${ESC}[${F_TILDE_CODE[name]};${m}~` : `${ESC}[${F_TILDE_CODE[name]}~`;
  }

  // Keys with a base byte string; Alt prefixes ESC.
  let base: string;
  switch (name) {
    case 'Escape':
      base = ESC;
      break;
    case 'Tab':
      base = mods.shift && !mods.ctrl ? `${ESC}[Z` : '\t';
      break;
    case 'Enter':
      base = '\r';
      break;
    case 'Backspace':
      base = mods.ctrl ? '\b' : '\x7f';
      break;
    case 'Space':
      base = mods.ctrl ? '\x00' : ' ';
      break;
    default: {
      if (name.length !== 1) throw new Error(`Unknown key "${name}".`);
      base = encodeCharacter(name, mods);
    }
  }
  return mods.alt ? ESC + base : base;
}

function encodeCharacter(char: string, mods: { ctrl: boolean; shift: boolean }): string {
  if (mods.ctrl) {
    const lower = char.toLowerCase();
    if (lower >= 'a' && lower <= 'z') return String.fromCharCode(lower.charCodeAt(0) - 96);
    if (char in CTRL_PUNCTUATION) return String.fromCharCode(CTRL_PUNCTUATION[char]);
    return char;
  }
  if (mods.shift && char >= 'a' && char <= 'z') return char.toUpperCase();
  return char;
}

function isInline(key: EncodableKey): key is InlineKey {
  return typeof key === 'object' && 'kind' in key;
}

/**
 * The bytes a key sends.
 *
 * - a catalog id (`'left'`, `'ctrl+c'`, `'f5'`): its chord with the armed
 *   modifiers; a modifier or an action key sends nothing (`''`);
 * - a chord: as `encodeChord`;
 * - a macro: its chords in order, each by its own modifiers (armed modifiers do not apply);
 * - a custom key: its parsed sequence.
 *
 * Throws for an unknown catalog id, an unknown key name or an invalid custom
 * sequence (the API refuses those at save time).
 */
export function encodeKey(key: EncodableKey, options: EncodeOptions = {}): string {
  if (typeof key === 'string') {
    const entry = getCatalogKey(key);
    if (!entry) throw new Error(`Unknown key id "${key}".`);
    return entry.chord ? encodeChord(entry.chord, options) : '';
  }
  if (isInline(key)) {
    if (key.kind === 'macro') {
      return key.chords.map((chord) => encodeChord(chord, { applicationCursor: options.applicationCursor })).join('');
    }
    const parsed = parseSequenceEscapes(key.sequence);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }
  return encodeChord(key, options);
}
