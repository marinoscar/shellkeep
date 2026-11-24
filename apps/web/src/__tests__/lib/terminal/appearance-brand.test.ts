import { describe, expect, it } from 'vitest';
import { BRAND } from '@shellkeep/shared';
import {
  resolveTerminalTheme,
  TERMINAL_APP_THEMES,
  TERMINAL_COLOR_THEMES,
} from '../../../lib/terminal/appearance';

// #148: a terminal that follows the app theme draws with the Option A
// terminal tokens; the named presets are unchanged.

describe('follow-app terminal theme (#148)', () => {
  it.each(['light', 'dark'] as const)('uses the %s term tokens', (mode) => {
    const t = BRAND[mode];
    expect(resolveTerminalTheme('follow-app', mode)).toEqual(
      expect.objectContaining({
        background: t.term,
        foreground: t.termText,
        cursor: t.accentText,
        cursorAccent: t.term,
        selectionBackground: `${t.accent}4D`,
      }),
    );
  });

  it('keeps the light ANSI colours readable on the light term background', () => {
    expect(TERMINAL_APP_THEMES.light.red).toBe(TERMINAL_COLOR_THEMES.light.red);
    expect(TERMINAL_APP_THEMES.light.yellow).toBe(TERMINAL_COLOR_THEMES.light.yellow);
  });

  it('leaves the named dark and light presets as they were', () => {
    expect(resolveTerminalTheme('dark', 'light').background).toBe('#1e1e1e');
    expect(resolveTerminalTheme('light', 'dark').background).toBe('#ffffff');
  });
});
