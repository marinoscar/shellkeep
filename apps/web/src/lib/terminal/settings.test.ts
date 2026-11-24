import { describe, it, expect } from 'vitest';
import {
  DEFAULT_KEY_SHORTCUTS,
  DEFAULT_TERMINAL_SETTINGS,
  isKeyBarVisible,
  normalizeKeyShortcuts,
  resolveKeyShortcuts,
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
  });

  it('mirrors the API defaults of the terminal namespace', () => {
    expect(DEFAULT_TERMINAL_SETTINGS).toEqual({
      showScrollButtons: true,
      showKeyBar: 'auto',
      fontFamily: 'system',
      fontSize: 14,
      lineHeight: 1,
      cursorStyle: 'block',
      cursorBlink: true,
      scrollback: 10000,
      theme: 'dark',
      bell: 'none',
      copyOnSelect: false,
    });
  });
});

describe('resolveTerminalSettings', () => {
  it('applies the defaults when the namespace is absent', () => {
    expect(resolveTerminalSettings(undefined)).toEqual(DEFAULT_TERMINAL_SETTINGS);
    expect(resolveTerminalSettings(null)).toEqual(DEFAULT_TERMINAL_SETTINGS);
  });

  it('fills the fields a pre-#80 row lacks and leaves its legacy shortcuts out', () => {
    expect(resolveTerminalSettings({ showScrollButtons: false, keyShortcuts: [custom] })).toEqual({
      ...DEFAULT_TERMINAL_SETTINGS,
      showScrollButtons: false,
    });
  });

  it('keeps stored values', () => {
    expect(
      resolveTerminalSettings({ showScrollButtons: true, fontSize: 20, theme: 'solarized-dark', copyOnSelect: true }),
    ).toEqual({ ...DEFAULT_TERMINAL_SETTINGS, fontSize: 20, theme: 'solarized-dark', copyOnSelect: true });
  });
});

describe('resolveKeyShortcuts', () => {
  it('reads the shortcuts namespace, an empty list included', () => {
    expect(resolveKeyShortcuts({ shortcuts: { keyShortcuts: [custom] } })).toEqual([custom]);
    expect(resolveKeyShortcuts({ shortcuts: { keyShortcuts: [] } })).toEqual([]);
  });

  it('reads a legacy terminal.keyShortcuts through the shim when shortcuts is absent', () => {
    expect(resolveKeyShortcuts({ terminal: { showScrollButtons: true, keyShortcuts: [custom] } })).toEqual([custom]);
  });

  it('prefers the shortcuts namespace over a legacy copy', () => {
    expect(
      resolveKeyShortcuts({
        terminal: { showScrollButtons: true, keyShortcuts: [custom] },
        shortcuts: { keyShortcuts: [] },
      }),
    ).toEqual([]);
  });

  it('applies the defaults when neither is stored', () => {
    expect(resolveKeyShortcuts({})).toEqual(DEFAULT_KEY_SHORTCUTS);
    expect(resolveKeyShortcuts(null)).toEqual(DEFAULT_KEY_SHORTCUTS);
  });
});

describe('isKeyBarVisible', () => {
  it('shows the bar on touch devices in auto, and as the user chose otherwise', () => {
    expect(isKeyBarVisible('auto', true)).toBe(true);
    expect(isKeyBarVisible('auto', false)).toBe(false);
    expect(isKeyBarVisible('always', false)).toBe(true);
    expect(isKeyBarVisible('never', true)).toBe(false);
  });
});

describe('terminalPatch', () => {
  it('sends the whole namespace with the change on top, never the shortcuts', () => {
    expect(terminalPatch(DEFAULT_TERMINAL_SETTINGS, { showScrollButtons: false })).toEqual({
      ...DEFAULT_TERMINAL_SETTINGS,
      showScrollButtons: false,
    });
    expect(terminalPatch(DEFAULT_TERMINAL_SETTINGS, { fontSize: 18 })).not.toHaveProperty('keyShortcuts');
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
