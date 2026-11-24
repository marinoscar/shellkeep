import { describe, it, expect } from 'vitest';
import {
  DEFAULT_KEY_SHORTCUTS,
  DEFAULT_TERMINAL_SETTINGS,
  isKeyBarVisible,
  resolveKeyLayout,
  resolveKeyOptions,
  resolveTerminalSettings,
  terminalPatch,
} from './settings';
import type { KeyShortcut } from '../../types/terminal';
import { DEFAULT_KEY_LAYOUT, DEFAULT_KEY_OPTIONS } from './keys/keyModel';
import { fromLegacyShortcuts, layoutFromLegacyShortcuts } from './keys/legacyAdapter';

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

});

describe('the v2 key layout (#165)', () => {
  it('resolves the defaults when nothing is stored', () => {
    expect(resolveKeyLayout(null)).toEqual(DEFAULT_KEY_LAYOUT);
    expect(resolveKeyLayout({})).toEqual(DEFAULT_KEY_LAYOUT);
    expect(resolveKeyOptions(null)).toEqual(DEFAULT_KEY_OPTIONS);
  });

  it('converts a stored v1 list (also the legacy terminal one)', () => {
    const doc = { shortcuts: { keyShortcuts: [custom] } };
    expect(resolveKeyLayout(doc)).toEqual(layoutFromLegacyShortcuts([custom]));
    expect(resolveKeyLayout({ terminal: { showScrollButtons: true, keyShortcuts: [custom] } })).toEqual(
      layoutFromLegacyShortcuts([custom]),
    );
  });

  it('prefers the shortcuts namespace over a legacy terminal copy', () => {
    expect(
      resolveKeyLayout({
        terminal: { showScrollButtons: true, keyShortcuts: [custom] },
        shortcuts: { keyShortcuts: [] },
      }),
    ).toEqual(DEFAULT_KEY_LAYOUT);
  });

  it('uses a stored layout as it is, whatever the v1 list holds', () => {
    const doc = { shortcuts: { keyShortcuts: [custom], layout: fromLegacyShortcuts([]) } };
    expect(resolveKeyLayout(doc)).toBe(doc.shortcuts.layout);
  });

  it('fills the options a stored object lacks', () => {
    const options = { autoHideWithHardwareKeyboard: false, haptics: true };
    expect(resolveKeyOptions({ shortcuts: { keyShortcuts: [], options } })).toEqual(options);
  });
});
