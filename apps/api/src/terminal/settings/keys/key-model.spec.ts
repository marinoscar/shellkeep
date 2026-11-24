import {
  CATALOG_KEY_IDS,
  DEFAULT_KEY_LAYOUT,
  DEFAULT_KEY_OPTIONS,
  KEY_CATALOG,
  MAX_CUSTOM_SEQUENCE_LENGTH,
  entrySpan,
  getCatalogKey,
  isChordKey,
  legacyShortcutsToDefaultLayout,
  legacyShortcutsToLayout,
  parseSequenceEscapes,
} from './key-model';

describe('key catalog integrity', () => {
  it('has unique ids and a label, a span of 1 or 2 and a boolean repeatable on every key', () => {
    expect(new Set(CATALOG_KEY_IDS).size).toBe(KEY_CATALOG.length);
    for (const key of KEY_CATALOG) {
      expect(key.label.length).toBeGreaterThan(0);
      expect([1, 2]).toContain(key.span);
      expect(typeof key.repeatable).toBe('boolean');
    }
  });

  it('holds every key the epic lists, with its kind', () => {
    const ids = (kind: string) => KEY_CATALOG.filter((k) => k.kind === kind).map((k) => k.id);
    expect(ids('modifier')).toEqual(['ctrl', 'alt', 'shift']);
    expect(ids('action')).toEqual(['ai', 'arrow-drag', 'attach-file', 'snippets']);
    const keys = ids('key');
    for (const id of [
      'esc', 'tab', 'shift+tab', 'enter', 'backspace', 'left', 'down', 'up', 'right',
      'home', 'end', 'pgup', 'pgdn', 'insert', 'delete', 'ctrl+c', 'ctrl+d', 'ctrl+z', 'ctrl+\\',
      ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
    ]) {
      expect(keys).toContain(id);
    }
  });

  it('gives every sending key a chord and no modifier or action one', () => {
    for (const key of KEY_CATALOG) {
      if (key.kind === 'key') {
        expect(key.chord).toBeDefined();
        expect(isChordKey(key.chord!.key)).toBe(true);
      } else {
        expect(key.chord).toBeUndefined();
      }
    }
  });

  it('marks the arrows and navigation keys repeatable and the rest not', () => {
    const repeatable = KEY_CATALOG.filter((k) => k.repeatable).map((k) => k.id);
    expect(repeatable).toEqual(
      expect.arrayContaining(['left', 'down', 'up', 'right', 'home', 'end', 'pgup', 'pgdn', 'delete']),
    );
    expect(getCatalogKey('esc')?.repeatable).toBe(false);
    expect(getCatalogKey('f1')?.repeatable).toBe(false);
  });

  it('makes shift+tab wide', () => {
    expect(getCatalogKey('shift+tab')?.span).toBe(2);
  });
});

describe('default layout', () => {
  it('only references catalog ids and fits every group in four cells', () => {
    for (const group of DEFAULT_KEY_LAYOUT.groups) {
      expect(group.keys.length).toBeLessThanOrEqual(4);
      expect(group.keys.reduce((n, e) => n + entrySpan(e), 0)).toBeLessThanOrEqual(4);
      for (const entry of group.keys) {
        if ('id' in entry) expect(CATALOG_KEY_IDS).toContain(entry.id);
      }
    }
  });

  it('follows the epic order', () => {
    const ids = DEFAULT_KEY_LAYOUT.groups.map((g) =>
      g.keys.map((e) => ('id' in e ? e.id : e.key.label)).join(' '),
    );
    expect(ids).toEqual([
      'ai arrow-drag attach-file snippets',
      'shift+tab esc ctrl',
      'left up down right',
      'Ctrl+B O Ctrl+B X',
      'Ctrl+B % Ctrl+B "',
      'alt tab insert delete',
      'home pgup pgdn end',
      'f1 f2 f3 f4',
      'f5 f6 f7 f8',
      'f9 f10 f11 f12',
    ]);
  });

  it('has the tmux macros as ctrl+b then a key, with unique ids', () => {
    const macros = DEFAULT_KEY_LAYOUT.groups.flatMap((g) => g.keys).flatMap((e) => ('key' in e ? [e.key] : []));
    expect(macros).toHaveLength(4);
    expect(new Set(macros.map((m) => m.id)).size).toBe(4);
    for (const macro of macros) {
      expect(macro.kind).toBe('macro');
      if (macro.kind === 'macro') {
        expect(macro.chords[0]).toEqual({ modifiers: ['ctrl'], key: 'b' });
        expect(macro.chords).toHaveLength(2);
      }
    }
  });

  it('turns both options on', () => {
    expect(DEFAULT_KEY_OPTIONS).toEqual({ autoHideWithHardwareKeyboard: true, haptics: true });
  });
});

describe('parseSequenceEscapes', () => {
  it.each([
    ['abc', 'abc'],
    ['\\x1b[A', '\x1b[A'],
    ['\\x1B', '\x1b'],
    ['\\e[1;5C', '\x1b[1;5C'],
    ['a\\rb\\nc\\td', 'a\rb\nc\td'],
    ['\\\\', '\\'],
    ['\\x00\\x7f', '\x00\x7f'],
  ])('%j parses to %j', (source, value) => {
    expect(parseSequenceEscapes(source)).toEqual({ ok: true, value });
  });

  it.each([
    ['', 'empty'],
    ['abc\\', 'lone backslash'],
    ['\\q', 'Unknown escape'],
    ['\\x1', 'two hex digits'],
    ['\\xzz', 'two hex digits'],
    ['a'.repeat(MAX_CUSTOM_SEQUENCE_LENGTH + 1), 'longer than'],
  ])('rejects %j', (source, fragment) => {
    const result = parseSequenceEscapes(source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(fragment);
  });
});

describe('legacyShortcutsToLayout', () => {
  const shortcut = (n: number, keystrokes = 1) => ({
    id: `22222222-2222-4222-8222-2222222222${String(n).padStart(2, '0')}`,
    label: `K${n}`,
    keystrokes: Array.from({ length: keystrokes }, () => ({ modifiers: ['ctrl'] as ('ctrl')[], key: 'b' })),
  });

  it('turns each shortcut into a macro keeping id, label and chords, four per row', () => {
    const layout = legacyShortcutsToLayout([1, 2, 3, 4, 5].map((n) => shortcut(n)));
    expect(layout.groups.map((g) => g.keys.length)).toEqual([4, 1]);
    expect(layout.groups[0].keys[0]).toEqual({
      key: { kind: 'macro', id: shortcut(1).id, label: 'K1', chords: [{ modifiers: ['ctrl'], key: 'b' }] },
    });
  });

  it('gives a multi-keystroke shortcut two cells', () => {
    const layout = legacyShortcutsToLayout([shortcut(1, 2), shortcut(2, 2), shortcut(3)]);
    expect(layout.groups.map((g) => g.keys.length)).toEqual([2, 1]);
  });

  it('is empty for an empty list', () => {
    expect(legacyShortcutsToLayout([])).toEqual({ groups: [] });
  });
});

describe('legacyShortcutsToDefaultLayout', () => {
  const one = (n: number, mod: 'ctrl' | 'alt', key: string) => ({
    id: `22222222-2222-4222-8222-2222222222${String(n).padStart(2, '0')}`,
    label: `K${n}`,
    keystrokes: [{ modifiers: [mod], key }],
  });

  it('is the default layout for no shortcuts', () => {
    expect(legacyShortcutsToDefaultLayout([])).toEqual(DEFAULT_KEY_LAYOUT);
  });

  it('appends the shortcuts the default does not send, after it, four per row', () => {
    const list = [1, 2, 3, 4, 5].map((n) => one(n, 'alt', 'q'));
    const layout = legacyShortcutsToDefaultLayout([{ ...one(9, 'ctrl', 'x'), keystrokes: [{ modifiers: [], key: 'Escape' }] }, ...list]);
    const base = DEFAULT_KEY_LAYOUT.groups.length;
    expect(layout.groups.slice(0, base)).toEqual(DEFAULT_KEY_LAYOUT.groups);
    expect(layout.groups.slice(base).map((g) => g.keys.length)).toEqual([4, 1]);
  });

  it('stays within 40 groups and 50 inline keys', () => {
    const list = Array.from({ length: 50 }, (_, i) => ({ ...one(i, 'alt', 'q'), id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, keystrokes: [{ modifiers: ['alt' as const], key: 'q' }, { modifiers: ['alt' as const], key: 'w' }] }));
    const layout = legacyShortcutsToDefaultLayout(list);
    expect(layout.groups.length).toBeLessThanOrEqual(40);
    expect(layout.groups.flatMap((g) => g.keys).filter((e) => 'key' in e).length).toBeLessThanOrEqual(50);
  });
});
