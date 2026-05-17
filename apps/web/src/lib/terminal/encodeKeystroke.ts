import type { Keystroke, KeyShortcut } from '../../types';

// =============================================================================
// Modifier code table (ECMA-48 / VT220 convention)
// modifier_code = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0) + (meta ? 8 : 0)
// When modifier_code == 1 (no modifier), the ";1" part is omitted.
// =============================================================================

function modCode(ks: Keystroke): number {
  let code = 1;
  if (ks.modifiers.includes('shift')) code += 1;
  if (ks.modifiers.includes('alt'))   code += 2;
  if (ks.modifiers.includes('ctrl'))  code += 4;
  if (ks.modifiers.includes('meta'))  code += 8;
  return code;
}

/** Returns ";{mod}" suffix when a modifier is present, or "" when not. */
function modSuffix(ks: Keystroke): string {
  const code = modCode(ks);
  return code === 1 ? '' : `;${code}`;
}

// =============================================================================
// Special-key base sequences (no modifiers)
// =============================================================================

const BARE_SEQUENCES: Record<string, string> = {
  Escape:    '\x1b',
  Tab:       '\x09',
  Enter:     '\r',
  Backspace: '\x7f',
  Space:     ' ',
  ArrowUp:    '\x1b[A',
  ArrowDown:  '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft:  '\x1b[D',
  Home:       '\x1b[H',
  End:        '\x1b[F',
  PageUp:     '\x1b[5~',
  PageDown:   '\x1b[6~',
  Insert:     '\x1b[2~',
  Delete:     '\x1b[3~',
  F1:  '\x1bOP',
  F2:  '\x1bOQ',
  F3:  '\x1bOR',
  F4:  '\x1bOS',
  F5:  '\x1b[15~',
  F6:  '\x1b[17~',
  F7:  '\x1b[18~',
  F8:  '\x1b[19~',
  F9:  '\x1b[20~',
  F10: '\x1b[21~',
  F11: '\x1b[23~',
  F12: '\x1b[24~',
};

// CSI-cursor final chars for Arrow keys and Home/End.
const CSI_CURSOR_FINAL: Record<string, string> = {
  ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D',
  Home: 'H', End: 'F',
};

// Tilde numeric codes for Page/Insert/Delete.
const CSI_TILDE_CODE: Record<string, number> = {
  PageUp: 5, PageDown: 6, Insert: 2, Delete: 3,
};

// F-key VT sequences: F1-F4 use SS3 O-sequences; F5-F12 use CSI numeric~.
const F_SS3_FINAL: Record<string, string> = {
  F1: 'P', F2: 'Q', F3: 'R', F4: 'S',
};
const F_CSI_CODE: Record<string, number> = {
  F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24,
};

// =============================================================================
// Core encode function
// =============================================================================

/**
 * Encodes a single Keystroke into the byte string a PTY/xterm expects.
 *
 * Encoding priority (first matching rule wins):
 *  1. Shift+Tab → \x1b[Z  (special-cased before general modifier logic)
 *  2. Ctrl+Space → \x00
 *  3. Ctrl + letter (a-z) → control char \x01..\x1a
 *  4. Alt + any key → ESC prefix + bare encoding of the key (no Alt)
 *  5. Modified cursor keys / Home / End → CSI 1;{mod}{final}
 *  6. Modified tilde-style keys (PageUp/Down, Insert, Delete) → CSI {code};{mod}~
 *  7. Modified F-keys → CSI 1;{mod}{P|Q|R|S}  or  CSI {code};{mod}~
 *  8. Bare special keys (Escape, Tab, Enter, …, arrows, F-keys) → table above
 *  9. Printable letters with Shift → uppercase
 * 10. All other printable characters → the character itself
 */
export function encodeKeystroke(ks: Keystroke): string {
  const { key, modifiers } = ks;
  const hasCtrl  = modifiers.includes('ctrl');
  const hasShift = modifiers.includes('shift');
  const hasAlt   = modifiers.includes('alt');
  const hasMod   = hasCtrl || hasShift || hasAlt || modifiers.includes('meta');

  // --- Rule 1: Shift+Tab ---
  if (key === 'Tab' && hasShift && !hasCtrl && !hasAlt) {
    return '\x1b[Z';
  }

  // --- Rule 2: Ctrl+Space → NUL ---
  if (key === 'Space' && hasCtrl) {
    return '\x00';
  }

  // --- Rule 3: Ctrl + letter ---
  if (hasCtrl && !hasAlt && key.length === 1 && key >= 'a' && key <= 'z') {
    return String.fromCharCode(key.charCodeAt(0) - 96);
  }

  // --- Rule 4: Alt prefix (escape-prefix) for any key, when no Ctrl ---
  if (hasAlt && !hasCtrl) {
    const inner = encodeKeystroke({ modifiers: modifiers.filter(m => m !== 'alt'), key });
    return '\x1b' + inner;
  }

  // From here we may have Ctrl (possibly with Shift), but not Alt.

  // --- Rule 5: Modified cursor keys and Home/End ---
  if (key in CSI_CURSOR_FINAL) {
    if (!hasMod) {
      // bare — use the simple table
      return BARE_SEQUENCES[key];
    }
    return `\x1b[1${modSuffix(ks)}${CSI_CURSOR_FINAL[key]}`;
  }

  // --- Rule 6: Modified tilde-style keys (PageUp/Down, Insert, Delete) ---
  if (key in CSI_TILDE_CODE) {
    if (!hasMod) {
      return BARE_SEQUENCES[key];
    }
    return `\x1b[${CSI_TILDE_CODE[key]}${modSuffix(ks)}~`;
  }

  // --- Rule 7: Modified F-keys ---
  if (key in F_SS3_FINAL) {
    if (!hasMod) {
      return BARE_SEQUENCES[key];
    }
    return `\x1b[1${modSuffix(ks)}${F_SS3_FINAL[key]}`;
  }
  if (key in F_CSI_CODE) {
    if (!hasMod) {
      return BARE_SEQUENCES[key];
    }
    return `\x1b[${F_CSI_CODE[key]}${modSuffix(ks)}~`;
  }

  // --- Rule 8: Remaining bare special keys (Escape, Tab, Enter, Backspace, Space) ---
  if (key in BARE_SEQUENCES) {
    return BARE_SEQUENCES[key];
  }

  // --- Rule 9 & 10: Printable characters ---
  // key is a single character (letter, digit, punctuation)
  if (key.length === 1) {
    if (hasShift && key >= 'a' && key <= 'z') {
      return key.toUpperCase();
    }
    return key;
  }

  // Fallback: return the key name as-is (shouldn't reach here with valid inputs)
  return key;
}

/**
 * Encodes a full KeyShortcut (sequence of keystrokes) into the concatenated
 * byte string that should be written to the PTY.
 */
export function encodeShortcut(shortcut: KeyShortcut): string {
  return shortcut.keystrokes.map(encodeKeystroke).join('');
}
