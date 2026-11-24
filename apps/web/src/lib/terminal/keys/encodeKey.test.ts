import { describe, it, expect } from 'vitest';
import { encodeChord, encodeKey, modifierParam } from './encodeKey';
import { CATALOG_KEY_IDS, KEY_CATALOG, type Chord, type KeyModifier } from './keyModel';

// The expected sequences are the ones xterm.js sends for a hardware key,
// transcribed from node_modules/@xterm/xterm/src/common/input/Keyboard.ts
// (`evaluateKeyboardEvent`, xterm 5.5.0).

const ESC = '\x1b';
const chord = (key: string, ...modifiers: KeyModifier[]): Chord => ({ modifiers, key });

/** Every subset of the modifiers, with its xterm parameter (1 + shift + alt*2 + ctrl*4 + meta*8). */
const COMBOS: { mods: KeyModifier[]; m: number }[] = [];
for (let bits = 0; bits < 16; bits += 1) {
  const mods: KeyModifier[] = [];
  if (bits & 1) mods.push('shift');
  if (bits & 2) mods.push('alt');
  if (bits & 4) mods.push('ctrl');
  if (bits & 8) mods.push('meta');
  COMBOS.push({ mods, m: 1 + bits });
}

describe('modifierParam', () => {
  it('is 1 + shift(1) + alt(2) + ctrl(4) + meta(8)', () => {
    expect(modifierParam({ shift: false, alt: false, ctrl: false, meta: false })).toBe(1);
    expect(modifierParam({ shift: true, alt: false, ctrl: false, meta: false })).toBe(2);
    expect(modifierParam({ shift: false, alt: true, ctrl: false, meta: false })).toBe(3);
    expect(modifierParam({ shift: false, alt: false, ctrl: true, meta: false })).toBe(5);
    expect(modifierParam({ shift: true, alt: true, ctrl: true, meta: false })).toBe(8);
    expect(modifierParam({ shift: true, alt: true, ctrl: true, meta: true })).toBe(16);
  });
});

describe('cursor keys and Home/End', () => {
  const KEYS: [string, string][] = [
    ['ArrowUp', 'A'], ['ArrowDown', 'B'], ['ArrowRight', 'C'], ['ArrowLeft', 'D'], ['Home', 'H'], ['End', 'F'],
  ];

  it.each(KEYS)('%s: normal mode ESC [ %s, application mode ESC O %s', (key, final) => {
    expect(encodeChord(chord(key))).toBe(`${ESC}[${final}`);
    expect(encodeChord(chord(key), { applicationCursor: false })).toBe(`${ESC}[${final}`);
    expect(encodeChord(chord(key), { applicationCursor: true })).toBe(`${ESC}O${final}`);
  });

  describe.each(KEYS)('%s with every modifier combination', (key, final) => {
    it.each(COMBOS.filter((c) => c.m > 1))('modifiers $mods → CSI 1;$m', ({ mods, m }) => {
      const expected = `${ESC}[1;${m}${final}`;
      // From the chord's own modifiers, from the armed ones, and from both.
      expect(encodeChord(chord(key, ...mods))).toBe(expected);
      expect(encodeChord(chord(key), { modifiers: Object.fromEntries(mods.map((x) => [x, true])) })).toBe(expected);
      expect(encodeChord(chord(key, ...mods), { modifiers: { ctrl: mods.includes('ctrl') } })).toBe(expected);
      // The application mode never changes a modified key.
      expect(encodeChord(chord(key, ...mods), { applicationCursor: true })).toBe(expected);
    });
  });

  it('matches xterm for Ctrl+arrows and Shift+arrows', () => {
    expect(encodeKey('right', { modifiers: { ctrl: true } })).toBe(`${ESC}[1;5C`);
    expect(encodeKey('up', { modifiers: { shift: true } })).toBe(`${ESC}[1;2A`);
    expect(encodeKey('left', { modifiers: { ctrl: true, shift: true } })).toBe(`${ESC}[1;6D`);
  });

  it('sends Alt+arrow as the modifier parameter, not an ESC prefix', () => {
    expect(encodeChord(chord('ArrowLeft', 'alt'))).toBe(`${ESC}[1;3D`);
  });
});

describe('PgUp, PgDn, Insert, Delete', () => {
  const KEYS: [string, number][] = [['PageUp', 5], ['PageDown', 6], ['Insert', 2], ['Delete', 3]];

  it.each(KEYS)('%s bare is CSI %i~ in both cursor modes', (key, code) => {
    expect(encodeChord(chord(key))).toBe(`${ESC}[${code}~`);
    expect(encodeChord(chord(key), { applicationCursor: true })).toBe(`${ESC}[${code}~`);
  });

  describe.each(KEYS)('%s with every modifier combination', (key, code) => {
    it.each(COMBOS.filter((c) => c.m > 1))('modifiers $mods → CSI n;$m~', ({ mods, m }) => {
      expect(encodeChord(chord(key, ...mods))).toBe(`${ESC}[${code};${m}~`);
    });
  });
});

describe('function keys', () => {
  const SS3 = ['P', 'Q', 'R', 'S'];
  const TILDE = [15, 17, 18, 19, 20, 21, 23, 24];

  it.each(SS3.map((f, i) => [`F${i + 1}`, f]))('%s bare is ESC O %s in both modes', (key, final) => {
    expect(encodeChord(chord(key))).toBe(`${ESC}O${final}`);
    expect(encodeChord(chord(key), { applicationCursor: true })).toBe(`${ESC}O${final}`);
  });

  it.each(TILDE.map((code, i) => [`F${i + 5}`, code] as [string, number]))('%s bare is CSI %i~', (key, code) => {
    expect(encodeChord(chord(key))).toBe(`${ESC}[${code}~`);
  });

  describe.each(COMBOS.filter((c) => c.m > 1))('modifiers $mods', ({ mods, m }) => {
    it.each(SS3.map((f, i) => [`F${i + 1}`, f]))('%s → CSI 1;m %s', (key, final) => {
      expect(encodeChord(chord(key, ...mods))).toBe(`${ESC}[1;${m}${final}`);
    });
    it.each(TILDE.map((code, i) => [`F${i + 5}`, code] as [string, number]))('%s → CSI %i;m~', (key, code) => {
      expect(encodeChord(chord(key, ...mods))).toBe(`${ESC}[${code};${m}~`);
    });
  });
});

describe('Ctrl and control characters', () => {
  it.each('abcdefghijklmnopqrstuvwxyz'.split(''))('Ctrl+%s is the control character', (letter) => {
    const expected = String.fromCharCode(letter.charCodeAt(0) - 96);
    expect(encodeChord(chord(letter, 'ctrl'))).toBe(expected);
    expect(encodeChord(chord(letter.toUpperCase(), 'ctrl'))).toBe(expected);
    expect(encodeChord(chord(letter, 'ctrl', 'shift'))).toBe(expected);
  });

  it.each([
    ['@', '\x00'], [' ', '\x00'], ['[', '\x1b'], ['\\', '\x1c'], [']', '\x1d'], ['^', '\x1e'], ['_', '\x1f'], ['?', '\x7f'],
    ['3', '\x1b'], ['4', '\x1c'], ['5', '\x1d'], ['6', '\x1e'], ['7', '\x1f'], ['8', '\x7f'],
  ])('Ctrl+%j is %j', (key, expected) => {
    expect(encodeChord(chord(key, 'ctrl'))).toBe(expected);
  });

  it('sends Ctrl+Space (the Space key) as NUL', () => {
    expect(encodeChord(chord('Space', 'ctrl'))).toBe('\x00');
  });

  it('leaves Ctrl on a character with no control form as the character', () => {
    expect(encodeChord(chord('1', 'ctrl'))).toBe('1');
  });

  it('matches the signals', () => {
    expect(encodeKey('ctrl+c')).toBe('\x03');
    expect(encodeKey('ctrl+d')).toBe('\x04');
    expect(encodeKey('ctrl+z')).toBe('\x1a');
    expect(encodeKey('ctrl+\\')).toBe('\x1c');
  });

  it('lets an armed Ctrl turn a plain letter key into a control character', () => {
    expect(encodeChord(chord('r'), { modifiers: { ctrl: true } })).toBe('\x12');
  });
});

describe('Alt (ESC prefix) and Shift', () => {
  it('prefixes ESC to a character', () => {
    expect(encodeChord(chord('b', 'alt'))).toBe(`${ESC}b`);
    expect(encodeChord(chord('.', 'alt'))).toBe(`${ESC}.`);
    expect(encodeChord(chord('f'), { modifiers: { alt: true } })).toBe(`${ESC}f`);
  });

  it('combines Ctrl+Alt as ESC and a control character', () => {
    expect(encodeChord(chord('h', 'ctrl', 'alt'))).toBe(`${ESC}\x08`);
  });

  it('prefixes ESC to Tab, Enter, Backspace, Escape and Space like xterm', () => {
    expect(encodeChord(chord('Tab', 'alt'))).toBe(`${ESC}\t`);
    expect(encodeChord(chord('Enter', 'alt'))).toBe(`${ESC}\r`);
    expect(encodeChord(chord('Backspace', 'alt'))).toBe(`${ESC}\x7f`);
    expect(encodeChord(chord('Escape', 'alt'))).toBe(`${ESC}${ESC}`);
    expect(encodeChord(chord('Space', 'alt'))).toBe(`${ESC} `);
  });

  it('sends Shift+Tab as CSI Z, also with Alt', () => {
    expect(encodeChord(chord('Tab', 'shift'))).toBe(`${ESC}[Z`);
    expect(encodeKey('shift+tab')).toBe(`${ESC}[Z`);
    expect(encodeKey('tab', { modifiers: { shift: true } })).toBe(`${ESC}[Z`);
    expect(encodeChord(chord('Tab', 'shift', 'alt'))).toBe(`${ESC}${ESC}[Z`);
  });

  it('uppercases a shifted letter', () => {
    expect(encodeChord(chord('a', 'shift'))).toBe('A');
    expect(encodeChord(chord('%', 'shift'))).toBe('%');
  });
});

describe('plain keys', () => {
  it.each([
    ['esc', ESC], ['tab', '\t'], ['enter', '\r'], ['backspace', '\x7f'],
    ['left', `${ESC}[D`], ['down', `${ESC}[B`], ['up', `${ESC}[A`], ['right', `${ESC}[C`],
    ['home', `${ESC}[H`], ['end', `${ESC}[F`], ['pgup', `${ESC}[5~`], ['pgdn', `${ESC}[6~`],
    ['insert', `${ESC}[2~`], ['delete', `${ESC}[3~`],
  ])('%s → %j', (id, expected) => {
    expect(encodeKey(id)).toBe(expected);
  });

  it('sends Ctrl+Backspace as BS', () => {
    expect(encodeKey('backspace', { modifiers: { ctrl: true } })).toBe('\b');
  });

  it('follows the cursor-key mode for the catalog arrows and Home/End', () => {
    const app = { applicationCursor: true };
    expect(encodeKey('up', app)).toBe(`${ESC}OA`);
    expect(encodeKey('down', app)).toBe(`${ESC}OB`);
    expect(encodeKey('right', app)).toBe(`${ESC}OC`);
    expect(encodeKey('left', app)).toBe(`${ESC}OD`);
    expect(encodeKey('home', app)).toBe(`${ESC}OH`);
    expect(encodeKey('end', app)).toBe(`${ESC}OF`);
    expect(encodeKey('pgup', app)).toBe(`${ESC}[5~`);
  });

  it('sends the F-keys by id', () => {
    expect(encodeKey('f1')).toBe(`${ESC}OP`);
    expect(encodeKey('f12')).toBe(`${ESC}[24~`);
    expect(encodeKey('f5', { modifiers: { ctrl: true } })).toBe(`${ESC}[15;5~`);
  });
});

describe('catalog ids', () => {
  it('encodes every catalog key without throwing; modifiers and actions send nothing', () => {
    for (const key of KEY_CATALOG) {
      const bytes = encodeKey(key.id);
      if (key.kind === 'key') expect(bytes.length).toBeGreaterThan(0);
      else expect(bytes).toBe('');
    }
  });

  it('sends distinct bytes for distinct keys', () => {
    const sent = KEY_CATALOG.filter((k) => k.kind === 'key').map((k) => encodeKey(k.id));
    expect(new Set(sent).size).toBe(sent.length);
  });

  it('throws for an unknown id', () => {
    expect(() => encodeKey('nope')).toThrow(/Unknown key id/);
    expect(CATALOG_KEY_IDS).not.toContain('nope');
  });

  it('throws for an unknown key name', () => {
    expect(() => encodeChord(chord('Nope'))).toThrow(/Unknown key/);
  });
});

describe('macros', () => {
  const macro = (chords: Chord[]) => ({ kind: 'macro' as const, id: 'id', label: 'm', chords });

  it('concatenates the chords', () => {
    expect(encodeKey(macro([chord('b', 'ctrl'), chord('o')]))).toBe('\x02o');
    expect(encodeKey(macro([chord('b', 'ctrl'), chord('%')]))).toBe('\x02%');
    expect(encodeKey(macro([chord('b', 'ctrl'), chord('"')]))).toBe('\x02"');
    expect(encodeKey(macro([chord('b', 'ctrl'), chord('ArrowUp')]))).toBe(`\x02${ESC}[A`);
  });

  it('follows the cursor-key mode and ignores armed modifiers', () => {
    const m = macro([chord('b', 'ctrl'), chord('ArrowLeft')]);
    expect(encodeKey(m, { applicationCursor: true })).toBe(`\x02${ESC}OD`);
    expect(encodeKey(m, { modifiers: { alt: true } })).toBe(`\x02${ESC}[D`);
  });
});

describe('custom keys', () => {
  const custom = (sequence: string) => ({ kind: 'custom' as const, id: 'id', label: 'c', sequence });

  it.each([
    ['\\x1b[1;5C', `${ESC}[1;5C`],
    ['\\e[A', `${ESC}[A`],
    ['ls -la\\r', 'ls -la\r'],
    ['a\\tb\\nc', 'a\tb\nc'],
    ['\\\\', '\\'],
    ['plain', 'plain'],
  ])('%j sends %j', (sequence, expected) => {
    expect(encodeKey(custom(sequence))).toBe(expected);
  });

  it.each(['', 'a\\', '\\q', '\\x1', '\\xGG'])('throws for the invalid sequence %j', (sequence) => {
    expect(() => encodeKey(custom(sequence))).toThrow();
  });

  it('ignores armed modifiers', () => {
    expect(encodeKey(custom('x'), { modifiers: { ctrl: true } })).toBe('x');
  });
});
