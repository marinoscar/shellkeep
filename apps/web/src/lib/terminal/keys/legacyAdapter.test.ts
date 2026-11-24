import { describe, it, expect } from 'vitest';
import { fromLegacyShortcuts, toLegacyBarKeys } from './legacyAdapter';
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
