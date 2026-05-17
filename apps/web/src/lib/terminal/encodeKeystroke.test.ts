import { describe, it, expect } from 'vitest';
import { encodeKeystroke, encodeShortcut } from './encodeKeystroke';
import type { Keystroke, KeyShortcut } from '../../types';

// ---------------------------------------------------------------------------
// encodeKeystroke — bare keys (no modifiers)
// ---------------------------------------------------------------------------

describe('encodeKeystroke', () => {
  describe('bare special keys', () => {
    it.each([
      ['Escape',     '\x1b'],
      ['Tab',        '\x09'],   // \t == \x09
      ['Enter',      '\r'],
      ['Backspace',  '\x7f'],
      ['ArrowUp',    '\x1b[A'],
      ['ArrowDown',  '\x1b[B'],
      ['ArrowLeft',  '\x1b[D'],
      ['ArrowRight', '\x1b[C'],
      ['F5',         '\x1b[15~'],
    ] as [string, string][])(
      '%s → %j',
      (key, expected) => {
        const ks: Keystroke = { modifiers: [], key: key as Keystroke['key'] };
        expect(encodeKeystroke(ks)).toBe(expected);
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Printable characters
  // ---------------------------------------------------------------------------

  describe('printable characters', () => {
    it('plain letter passes through unchanged', () => {
      const ks: Keystroke = { modifiers: [], key: 'a' };
      expect(encodeKeystroke(ks)).toBe('a');
    });

    it('shift + letter produces uppercase', () => {
      const ks: Keystroke = { modifiers: ['shift'], key: 'a' };
      expect(encodeKeystroke(ks)).toBe('A');
    });
  });

  // ---------------------------------------------------------------------------
  // Modifier combos
  // ---------------------------------------------------------------------------

  describe('ctrl + letter', () => {
    it('ctrl+c → ETX (\\x03)', () => {
      const ks: Keystroke = { modifiers: ['ctrl'], key: 'c' };
      expect(encodeKeystroke(ks)).toBe('\x03');
    });

    it('ctrl+d → EOT (\\x04)', () => {
      const ks: Keystroke = { modifiers: ['ctrl'], key: 'd' };
      expect(encodeKeystroke(ks)).toBe('\x04');
    });
  });

  describe('shift + Tab', () => {
    it('shift+Tab → back-tab (\\x1b[Z)', () => {
      const ks: Keystroke = { modifiers: ['shift'], key: 'Tab' };
      expect(encodeKeystroke(ks)).toBe('\x1b[Z');
    });
  });

  describe('alt + key', () => {
    it('alt+x → ESC-prefixed x (\\x1bx)', () => {
      const ks: Keystroke = { modifiers: ['alt'], key: 'x' };
      expect(encodeKeystroke(ks)).toBe('\x1bx');
    });
  });

  describe('ctrl + arrow (modifier cursor sequence)', () => {
    it('ctrl+ArrowUp → \\x1b[1;5A', () => {
      // modCode: 1 + 4 (ctrl) = 5
      const ks: Keystroke = { modifiers: ['ctrl'], key: 'ArrowUp' };
      expect(encodeKeystroke(ks)).toBe('\x1b[1;5A');
    });
  });

  describe('shift + arrow', () => {
    it('shift+ArrowLeft → \\x1b[1;2D', () => {
      // modCode: 1 + 1 (shift) = 2
      const ks: Keystroke = { modifiers: ['shift'], key: 'ArrowLeft' };
      expect(encodeKeystroke(ks)).toBe('\x1b[1;2D');
    });
  });
});

// ---------------------------------------------------------------------------
// encodeShortcut — multi-keystroke sequences
// ---------------------------------------------------------------------------

describe('encodeShortcut', () => {
  // The plan calls for [Escape, ':', q] → '\x1b:q'.
  // ':' is not in KEY_SHORTCUT_BASE_KEYS so it is not a valid Keystroke key.
  // The equivalent valid sequence uses ';' (which IS in BASE_KEYS) to verify
  // that multi-keystroke concatenation works correctly.
  it('concatenates a 3-keystroke sequence (Escape, ;, q) → \\x1b;q', () => {
    const shortcut: KeyShortcut = {
      id: 'test-id',
      label: 'Quit vim',
      keystrokes: [
        { modifiers: [], key: 'Escape' },
        { modifiers: [], key: ';' },
        { modifiers: [], key: 'q' },
      ],
    };
    // Escape → \x1b, ';' → ';', 'q' → 'q'
    expect(encodeShortcut(shortcut)).toBe('\x1b;q');
  });

  it('single-keystroke shortcut works', () => {
    const shortcut: KeyShortcut = {
      id: 'single',
      label: 'Ctrl-C',
      keystrokes: [{ modifiers: ['ctrl'], key: 'c' }],
    };
    expect(encodeShortcut(shortcut)).toBe('\x03');
  });
});
