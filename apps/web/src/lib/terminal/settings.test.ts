import { describe, it, expect } from 'vitest';
import {
  DEFAULT_KEY_SHORTCUTS,
  DEFAULT_TERMINAL_SETTINGS,
  normalizeKeyShortcuts,
  resolveTerminalSettings,
  terminalPatch,
} from './settings';
import type { KeyShortcut } from '../../types/terminal';

const custom: KeyShortcut = {
  id: '22222222-2222-4222-8222-222222222201',
  label: 'Ctrl+R',
  keystrokes: [{ modifiers: ['ctrl'], key: 'r' }],
};

describe('terminal settings defaults', () => {
  it('ships the nine default shortcuts of the API, in order', () => {
    expect(DEFAULT_KEY_SHORTCUTS.map((s) => s.label)).toEqual([
      'ESC', 'Tab', 'Shift+Tab', 'Ctrl+C', 'Ctrl+D', '↑', '↓', '←', '→',
    ]);
    expect(DEFAULT_KEY_SHORTCUTS.map((s) => s.id)).toEqual(
      Array.from({ length: 9 }, (_, i) => `11111111-1111-4111-8111-11111111110${i + 1}`),
    );
    expect(DEFAULT_TERMINAL_SETTINGS.showScrollButtons).toBe(true);
  });
});

describe('resolveTerminalSettings', () => {
  it('applies the defaults when the namespace is absent', () => {
    expect(resolveTerminalSettings(undefined)).toEqual({
      showScrollButtons: true,
      keyShortcuts: DEFAULT_KEY_SHORTCUTS,
    });
    expect(resolveTerminalSettings(null).keyShortcuts).toHaveLength(9);
  });

  it('applies the default shortcuts when only the list is absent', () => {
    expect(resolveTerminalSettings({ showScrollButtons: false })).toEqual({
      showScrollButtons: false,
      keyShortcuts: DEFAULT_KEY_SHORTCUTS,
    });
  });

  it('keeps stored values, an empty list included', () => {
    expect(resolveTerminalSettings({ showScrollButtons: false, keyShortcuts: [custom] })).toEqual({
      showScrollButtons: false,
      keyShortcuts: [custom],
    });
    expect(resolveTerminalSettings({ showScrollButtons: true, keyShortcuts: [] }).keyShortcuts).toEqual([]);
  });
});

describe('terminalPatch', () => {
  it('sends the whole namespace with the change on top', () => {
    expect(terminalPatch(DEFAULT_TERMINAL_SETTINGS, { showScrollButtons: false })).toEqual({
      showScrollButtons: false,
      keyShortcuts: DEFAULT_KEY_SHORTCUTS,
    });
    expect(terminalPatch(DEFAULT_TERMINAL_SETTINGS, { keyShortcuts: [custom] })).toEqual({
      showScrollButtons: true,
      keyShortcuts: [custom],
    });
  });

  it('always sends modifiers on every keystroke and drops unknown fields', () => {
    const legacy = {
      id: custom.id,
      label: 'Esc',
      extra: 'x',
      keystrokes: [{ key: 'Escape' }],
    } as unknown as KeyShortcut;
    expect(normalizeKeyShortcuts([legacy])).toEqual([
      { id: custom.id, label: 'Esc', keystrokes: [{ modifiers: [], key: 'Escape' }] },
    ]);
  });
});
