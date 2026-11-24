// =============================================================================
// Armed modifiers applied to typed input and to key bar keys (issue #166)
// =============================================================================
//
// The phone keyboard has no Ctrl or Alt: the key bar arms them, and what the
// user then types reaches xterm's `onData` as plain text. `useTerminal` hands
// every `onData` chunk to a `TerminalInputModifiers` before sending it, which
// re-encodes it through `encodeChord` with the active modifiers.
//
// What counts as ONE key (modified, and consumes the one-shots):
//   - one character (one code point): `r` -> Ctrl `\x12`, Alt `ESC r`;
//     `\r` `\t` `\x7f` `ESC` and space are Enter, Tab, Backspace, Escape, Space;
//   - one of xterm's own key sequences (arrows, Home/End, PgUp/PgDn, Ins/Del,
//     F1-F12, in either cursor mode): a hardware or soft-keyboard arrow with
//     Ctrl armed becomes `CSI 1;5 C`.
// Anything else passes through unchanged and leaves the modifiers as they are:
//   - several characters at once (a paste, bracketed or not, or an IME commit
//     of a whole word): applying Ctrl to a paste is never what the user meant;
//   - any other escape sequence (focus reports, mouse reports), which the
//     terminal sends on its own while the user is still about to type.
//
// Hardware keyboards win: a keydown carrying a real Ctrl, Alt or Meta releases
// the armed one-shots (`onHardwareChord`) and the data that key produces is
// sent as xterm encoded it, never modified twice.
//
// Locks are for soft keys (#170): a plain hardware key (no real modifier; source
// `'hardware'`) gets the ARMED one-shots only, which it releases. A locked soft
// Ctrl stays locked and does not touch it, so a tablet user who locked Ctrl on
// the row and then types on the keyboard types letters, not control codes.
// =============================================================================

import type { KeyShortcut } from '../../../types';
import { encodeShortcut } from '../encodeKeystroke';
import { encodeChord, encodeKey, type ActiveModifiers } from './encodeKey';
import type { Chord } from './keyModel';
import type { ModifierStore } from './modifierState';

const CONTROL_KEY_NAMES: Record<string, string> = {
  '\r': 'Enter',
  '\t': 'Tab',
  '\x7f': 'Backspace',
  '\x1b': 'Escape',
  ' ': 'Space',
};

/** xterm's unmodified key sequences, both cursor modes, back to the key name. */
const SEQUENCE_KEY_NAMES: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const cursor: Record<string, string> = {
    A: 'ArrowUp', B: 'ArrowDown', C: 'ArrowRight', D: 'ArrowLeft', H: 'Home', F: 'End',
  };
  for (const [final, name] of Object.entries(cursor)) {
    map[`\x1b[${final}`] = name;
    map[`\x1bO${final}`] = name;
  }
  const tilde: Record<string, string> = {
    '1': 'Home', '4': 'End', '2': 'Insert', '3': 'Delete', '5': 'PageUp', '6': 'PageDown',
    '15': 'F5', '17': 'F6', '18': 'F7', '19': 'F8', '20': 'F9', '21': 'F10', '23': 'F11', '24': 'F12',
  };
  for (const [code, name] of Object.entries(tilde)) map[`\x1b[${code}~`] = name;
  const ss3: Record<string, string> = { P: 'F1', Q: 'F2', R: 'F3', S: 'F4' };
  for (const [final, name] of Object.entries(ss3)) map[`\x1bO${final}`] = name;
  return map;
})();

function hasAny(modifiers: ActiveModifiers): boolean {
  return Object.values(modifiers).some(Boolean);
}

/**
 * The key `data` is, as a chord without modifiers, or `null` when it is not
 * exactly one key (several characters, or an unknown escape sequence).
 */
export function inputAsChord(data: string): Chord | null {
  if (data in SEQUENCE_KEY_NAMES) return { modifiers: [], key: SEQUENCE_KEY_NAMES[data] };
  const chars = Array.from(data);
  if (chars.length !== 1) return null;
  const char = chars[0];
  return { modifiers: [], key: CONTROL_KEY_NAMES[char] ?? char };
}

/**
 * `data` re-encoded with `modifiers`, or `null` when it is not one key (it is
 * then sent unchanged; see the file header).
 */
export function applyModifiersToInput(
  data: string,
  modifiers: ActiveModifiers,
  applicationCursor = false,
): string | null {
  const chord = inputAsChord(data);
  if (!chord) return null;
  try {
    return encodeChord(chord, { modifiers, applicationCursor });
  } catch {
    return null;
  }
}

/** Where one `onData` chunk came from: a soft key (the phone keyboard, a paste) or a hardware key (#170). */
export type TerminalInputSource = 'soft' | 'hardware';

/** What `useTerminal` asks before it sends typed input (#166). */
export interface TerminalInputModifiers {
  /**
   * The bytes to send for one `onData` chunk; `data` itself when nothing applies.
   * `source` `'hardware'` (a plain physical key, #170) applies the armed one-shots only.
   */
  transform(data: string, applicationCursor: boolean, source?: TerminalInputSource): string;
  /** A hardware keydown carried a real Ctrl, Alt or Meta: drop the armed one-shots. */
  onHardwareChord(): void;
}

/** The input interceptor over a modifier store: modifies single keys and consumes the one-shots. */
export function createModifierInputInterceptor(store: ModifierStore): TerminalInputModifiers {
  return {
    transform(data, applicationCursor, source = 'soft') {
      if (source === 'hardware') {
        if (!store.hasArmed() || !inputAsChord(data)) return data;
        const encoded = applyModifiersToInput(data, store.consumeArmed(), applicationCursor);
        return encoded ?? data;
      }
      if (!store.hasActive() || !inputAsChord(data)) return data;
      const encoded = applyModifiersToInput(data, store.consume(), applicationCursor);
      return encoded ?? data;
    },
    onHardwareChord() {
      store.releaseArmed();
    },
  };
}

/**
 * The bytes a key bar shortcut sends with the active modifiers (#166).
 *
 * - no modifiers and normal cursor mode: exactly today's `encodeShortcut`;
 * - one keystroke: its chord with the modifiers added and the terminal's cursor
 *   mode (Ctrl armed + → is `CSI 1;5 C`; → in application mode is `ESC O C`);
 * - several keystrokes (a macro): each by its own modifiers, as `encodeKey`
 *   sends macros; the armed modifiers do not apply.
 */
export function encodeBarShortcut(
  shortcut: KeyShortcut,
  options: { modifiers?: ActiveModifiers; applicationCursor?: boolean } = {},
): string {
  const modifiers = options.modifiers ?? {};
  const applicationCursor = options.applicationCursor ?? false;
  if (!hasAny(modifiers) && !applicationCursor) return encodeShortcut(shortcut);
  const chords: Chord[] = shortcut.keystrokes.map((k) => ({ modifiers: [...k.modifiers], key: k.key }));
  try {
    if (chords.length === 1) return encodeChord(chords[0], { modifiers, applicationCursor });
    return encodeKey({ kind: 'macro', id: shortcut.id, label: shortcut.label, chords }, { applicationCursor });
  } catch {
    return encodeShortcut(shortcut);
  }
}
