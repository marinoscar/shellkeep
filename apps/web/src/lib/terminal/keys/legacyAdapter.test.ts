import { describe, it, expect } from 'vitest';
import { fromLegacyShortcuts, layoutFromLegacyShortcuts, toBarModifierKeys, toLegacyBarKeys } from './legacyAdapter';
import { DEFAULT_KEY_LAYOUT, type KeyLayout } from './keyModel';
import { encodeShortcut } from '../encodeKeystroke';
import { DEFAULT_KEY_SHORTCUTS } from '../settings';
import type { KeyShortcut } from '../../../types/terminal';

describe('toLegacyBarKeys', () => {
  it('turns a v1 list into a layout and back, unchanged', () => {
    const list = [
      ...DEFAULT_KEY_SHORTCUTS,
      {
        id: '22222222-2222-4222-8222-222222222201',
        label: 'tmux next',
        keystrokes: [{ modifiers: ['ctrl'], key: 'b' }, { modifiers: [], key: 'o' }],
      },
    ] as KeyShortcut[];
    expect(toLegacyBarKeys(fromLegacyShortcuts(list))).toEqual(list);
  });

  it('sends the same bytes as the v1 shortcut did', () => {
    const list = DEFAULT_KEY_SHORTCUTS as KeyShortcut[];
    const back = toLegacyBarKeys(fromLegacyShortcuts(list));
    expect(back.map(encodeShortcut)).toEqual(list.map(encodeShortcut));
  });

  it('maps catalog keys to their chord and drops modifiers, actions and custom keys', () => {
    const layout: KeyLayout = {
      groups: [
        { keys: [{ id: 'ai' }, { id: 'ctrl' }, { id: 'esc' }, { id: 'shift+tab' }] },
        {
          keys: [
            { key: { kind: 'custom', id: 'c', label: 'C', sequence: 'x' } },
            { id: 'left' },
          ],
        },
      ],
    };
    const keys = toLegacyBarKeys(layout);
    expect(keys.map((k) => k.label)).toEqual(['Esc', 'Shift+Tab', '←']);
    expect(keys.map(encodeShortcut)).toEqual(['\x1b', '\x1b[Z', '\x1b[D']);
  });

  it('turns the default layout into the keys the new bar will draw, tmux macros included', () => {
    const keys = toLegacyBarKeys(DEFAULT_KEY_LAYOUT as KeyLayout);
    expect(keys).toHaveLength(29);
    const macro = keys.find((k) => k.label === 'Ctrl+B "');
    expect(macro && encodeShortcut(macro)).toBe('\x02"');
  });

  it('is empty for an empty layout', () => {
    expect(toLegacyBarKeys({ groups: [] })).toEqual([]);
  });
});

describe('toBarModifierKeys (#166)', () => {
  it('lists the default layout modifiers in layout order', () => {
    expect(toBarModifierKeys(DEFAULT_KEY_LAYOUT as KeyLayout)).toEqual(['ctrl', 'alt']);
  });

  it('keeps each modifier once and skips other keys', () => {
    const layout: KeyLayout = {
      groups: [
        { keys: [{ id: 'shift' }, { id: 'esc' }, { id: 'ai' }] },
        { keys: [{ id: 'ctrl' }, { id: 'shift' }] },
      ],
    };
    expect(toBarModifierKeys(layout)).toEqual(['shift', 'ctrl']);
  });

  it('is empty for a layout converted from v1 shortcuts', () => {
    expect(toBarModifierKeys(fromLegacyShortcuts(DEFAULT_KEY_SHORTCUTS as KeyShortcut[]))).toEqual([]);
  });

  it('lists Ctrl and Alt for a layout migrated from the v1 defaults or custom shortcuts', () => {
    const custom: KeyShortcut = {
      id: '22222222-2222-4222-8222-222222222201',
      label: 'Ctrl+L',
      keystrokes: [{ modifiers: ['ctrl'], key: 'l' }],
    };
    expect(toBarModifierKeys(layoutFromLegacyShortcuts(DEFAULT_KEY_SHORTCUTS as KeyShortcut[]))).toEqual(['ctrl', 'alt']);
    expect(toBarModifierKeys(layoutFromLegacyShortcuts([custom]))).toEqual(['ctrl', 'alt']);
  });
});

describe('layoutFromLegacyShortcuts (default layout for v1 users)', () => {
  const shortcut = (n: number, keystrokes: KeyShortcut['keystrokes']): KeyShortcut => ({
    id: `22222222-2222-4222-8222-2222222222${String(n).padStart(2, '0')}`,
    label: `K${n}`,
    keystrokes,
  });

  it('gives exactly the default layout for the v1 defaults', () => {
    expect(layoutFromLegacyShortcuts(DEFAULT_KEY_SHORTCUTS as KeyShortcut[])).toEqual(DEFAULT_KEY_LAYOUT);
  });

  it('appends only the shortcuts the default does not send, four per row, after the default', () => {
    const esc = shortcut(1, [{ modifiers: [], key: 'Escape' }]);
    const customs = [2, 3, 4, 5, 6].map((n) => shortcut(n, [{ modifiers: ['ctrl'], key: 'l' }]));
    const layout = layoutFromLegacyShortcuts([esc, ...customs]);
    const base = DEFAULT_KEY_LAYOUT.groups.length;
    expect(layout.groups.slice(0, base)).toEqual(DEFAULT_KEY_LAYOUT.groups);
    expect(layout.groups.slice(base).map((g) => g.keys.length)).toEqual([4, 1]);
    expect(layout.groups[base].keys[0]).toEqual({
      key: { kind: 'macro', id: customs[0].id, label: 'K2', chords: customs[0].keystrokes },
    });
  });

  it('respects the 40 group and 50 inline key caps', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      shortcut(i, [{ modifiers: ['ctrl'], key: 'b' }, { modifiers: [], key: 'o' }, { modifiers: ['alt'], key: String(i % 10) }]),
    );
    const layout = layoutFromLegacyShortcuts(many);
    expect(layout.groups.length).toBeLessThanOrEqual(40);
    const inline = layout.groups.flatMap((g) => g.keys).filter((e) => 'key' in e).length;
    expect(inline).toBeLessThanOrEqual(50);
  });
});
