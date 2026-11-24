import { describe, it, expect } from 'vitest';
import {
  applyModifiersToInput,
  createModifierInputInterceptor,
  encodeBarShortcut,
  inputAsChord,
} from './modifiedInput';
import { createModifierStore } from './modifierState';
import { encodeShortcut } from '../encodeKeystroke';
import { CTRL_POPUP, ALT_POPUP, ARROW_POPUP } from './popupKeys';
import { encodeChord } from './encodeKey';
import type { KeyShortcut } from '../../../types';

const ESC = '\x1b';

describe('applyModifiersToInput (#166)', () => {
  it.each([
    ['r', { ctrl: true }, '\x12'],
    ['R', { ctrl: true }, '\x12'],
    ['a', { ctrl: true }, '\x01'],
    ['b', { alt: true }, `${ESC}b`],
    ['.', { alt: true }, `${ESC}.`],
    ['r', { ctrl: true, alt: true }, `${ESC}\x12`],
    ['a', { shift: true }, 'A'],
    [' ', { ctrl: true }, '\x00'],
    ['\t', { shift: true }, `${ESC}[Z`],
    ['\x7f', { ctrl: true }, '\b'],
    ['\r', { alt: true }, `${ESC}\r`],
  ])('%j with %j is %j', (data, mods, expected) => {
    expect(applyModifiersToInput(data, mods)).toBe(expected);
  });

  it('re-encodes an arrow sequence from either cursor mode', () => {
    expect(applyModifiersToInput(`${ESC}[C`, { ctrl: true })).toBe(`${ESC}[1;5C`);
    expect(applyModifiersToInput(`${ESC}OC`, { ctrl: true }, true)).toBe(`${ESC}[1;5C`);
    expect(applyModifiersToInput(`${ESC}[A`, { shift: true })).toBe(`${ESC}[1;2A`);
    expect(applyModifiersToInput(`${ESC}[5~`, { ctrl: true })).toBe(`${ESC}[5;5~`);
    expect(applyModifiersToInput(`${ESC}OP`, { shift: true })).toBe(`${ESC}[1;2P`);
  });

  it('is null for multi-character input and unknown sequences', () => {
    expect(applyModifiersToInput('hello', { ctrl: true })).toBeNull();
    expect(applyModifiersToInput(`${ESC}[200~x${ESC}[201~`, { ctrl: true })).toBeNull();
    expect(applyModifiersToInput(`${ESC}[I`, { ctrl: true })).toBeNull();
    expect(inputAsChord(`${ESC}[<0;10;5M`)).toBeNull();
  });

  it('treats one astral character as one key', () => {
    expect(inputAsChord('😀')).toEqual({ modifiers: [], key: '😀' });
  });
});

describe('createModifierInputInterceptor (#166)', () => {
  it('passes input through untouched with nothing active', () => {
    const store = createModifierStore();
    const input = createModifierInputInterceptor(store);
    expect(input.transform('r', false)).toBe('r');
  });

  it('applies an armed modifier to one char and releases it', () => {
    const store = createModifierStore();
    const input = createModifierInputInterceptor(store);
    store.tap('ctrl');
    expect(input.transform('r', false)).toBe('\x12');
    expect(store.getSnapshot().ctrl).toBe('off');
    expect(input.transform('r', false)).toBe('r');
  });

  it('keeps a locked modifier across chars', () => {
    let t = 0;
    const store = createModifierStore({ now: () => t });
    const input = createModifierInputInterceptor(store);
    store.tap('ctrl');
    t += 100;
    store.tap('ctrl');
    expect(input.transform('a', false)).toBe('\x01');
    expect(input.transform('e', false)).toBe('\x05');
    expect(store.getSnapshot().ctrl).toBe('locked');
  });

  it('leaves pastes and reports unchanged and keeps the one-shot armed', () => {
    const store = createModifierStore();
    const input = createModifierInputInterceptor(store);
    store.tap('ctrl');
    expect(input.transform('ls -la', false)).toBe('ls -la');
    expect(input.transform(`${ESC}[I`, false)).toBe(`${ESC}[I`);
    expect(store.getSnapshot().ctrl).toBe('armed');
  });

  it('a hardware chord drops the armed one-shots but keeps locks', () => {
    let t = 0;
    const store = createModifierStore({ now: () => t });
    const input = createModifierInputInterceptor(store);
    store.tap('alt');
    t += 100;
    store.tap('alt');
    store.tap('ctrl');
    input.onHardwareChord();
    expect(store.getSnapshot()).toMatchObject({ ctrl: 'off', alt: 'locked' });
  });
});

describe('encodeBarShortcut (#166)', () => {
  const right: KeyShortcut = { id: 'r', label: '→', keystrokes: [{ modifiers: [], key: 'ArrowRight' }] };
  const ctrlC: KeyShortcut = { id: 'c', label: 'Ctrl+C', keystrokes: [{ modifiers: ['ctrl'], key: 'c' }] };
  const macro: KeyShortcut = {
    id: 'm',
    label: 'Ctrl+B O',
    keystrokes: [{ modifiers: ['ctrl'], key: 'b' }, { modifiers: [], key: 'o' }],
  };

  it('keeps today sequences without modifiers in normal mode', () => {
    for (const shortcut of [right, ctrlC, macro]) {
      expect(encodeBarShortcut(shortcut)).toBe(encodeShortcut(shortcut));
    }
  });

  it('Ctrl+→ is CSI 1;5C in both cursor modes', () => {
    expect(encodeBarShortcut(right, { modifiers: { ctrl: true } })).toBe(`${ESC}[1;5C`);
    expect(encodeBarShortcut(right, { modifiers: { ctrl: true }, applicationCursor: true })).toBe(`${ESC}[1;5C`);
  });

  it('a bare arrow follows application cursor mode', () => {
    expect(encodeBarShortcut(right, { applicationCursor: true })).toBe(`${ESC}OC`);
  });

  it('Ctrl+Alt combine on a bar key', () => {
    expect(encodeBarShortcut(right, { modifiers: { ctrl: true, alt: true } })).toBe(`${ESC}[1;7C`);
  });

  it('adds armed modifiers to a single chord shortcut but not to a macro', () => {
    expect(encodeBarShortcut(ctrlC, { modifiers: { alt: true } })).toBe(`${ESC}\x03`);
    expect(encodeBarShortcut(macro, { modifiers: { alt: true } })).toBe('\x02o');
  });
});

describe('pop-up entries (#166)', () => {
  it('Ctrl pop-up has the ten combos', () => {
    expect(CTRL_POPUP.map((e) => e.label)).toEqual([
      'Ctrl+C', 'Ctrl+D', 'Ctrl+Z', 'Ctrl+R', 'Ctrl+L', 'Ctrl+A', 'Ctrl+E', 'Ctrl+W', 'Ctrl+U', 'Ctrl+K',
    ]);
    expect(CTRL_POPUP.map((e) => encodeChord(e.chord))).toEqual([
      '\x03', '\x04', '\x1a', '\x12', '\x0c', '\x01', '\x05', '\x17', '\x15', '\x0b',
    ]);
  });

  it('Alt pop-up is Alt+B, Alt+F, Alt+.', () => {
    expect(ALT_POPUP.map((e) => encodeChord(e.chord))).toEqual([`${ESC}b`, `${ESC}f`, `${ESC}.`]);
  });

  it('arrow pop-up is Home, End, PgUp, PgDn', () => {
    expect(ARROW_POPUP.map((e) => encodeChord(e.chord))).toEqual([`${ESC}[H`, `${ESC}[F`, `${ESC}[5~`, `${ESC}[6~`]);
  });
});
