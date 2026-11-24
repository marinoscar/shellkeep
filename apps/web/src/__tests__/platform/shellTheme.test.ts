import { describe, expect, it } from 'vitest';
import { getContrastRatio } from '@mui/material/styles';
import { BRAND } from '@shellkeep/shared';
import { darkTheme, lightTheme, SHELLKEEP_THEMES } from '../../platform/shellTheme';

// #148: both themes are built from the Option A tokens of @shellkeep/shared,
// never from hex literals, and keep WCAG AA for text.

const cases = [
  ['light', lightTheme, BRAND.light],
  ['dark', darkTheme, BRAND.dark],
] as const;

describe('shell themes (#148)', () => {
  it('hands ShellRoot the light and dark themes', () => {
    expect(SHELLKEEP_THEMES).toEqual({ light: lightTheme, dark: darkTheme });
  });

  it.each(cases)('maps the %s tokens onto the MUI palette', (mode, theme, t) => {
    const { palette } = theme;
    expect(palette.mode).toBe(mode);
    expect(palette.primary.main).toBe(t.accent);
    expect(palette.primary.contrastText).toBe(t.accentInk);
    expect(palette.background).toEqual(expect.objectContaining({ default: t.bg, paper: t.surface }));
    expect(palette.text.primary).toBe(t.text);
    expect(palette.text.secondary).toBe(t.muted);
    expect(palette.divider).toBe(t.line);
    expect(palette.success.main).toBe(t.ok);
    expect(palette.warning.main).toBe(t.warn);
    expect(palette.error.main).toBe(t.err);
    expect(palette.info.main).toBe(t.info);
  });

  it.each(cases)('keeps no template blue in the %s primary tints', (_mode, theme) => {
    const tints = [theme.palette.primary.light, theme.palette.primary.dark].map((c) => c.toLowerCase());
    for (const blue of ['#1976d2', '#42a5f5', '#1565c0', '#90caf9', '#e3f2fd']) expect(tints).not.toContain(blue);
  });

  it.each(cases)('keeps WCAG AA for %s text and the primary button', (_mode, theme) => {
    const { palette } = theme;
    expect(getContrastRatio(palette.primary.contrastText, palette.primary.main)).toBeGreaterThanOrEqual(4.5);
    for (const bg of [palette.background.default, palette.background.paper]) {
      expect(getContrastRatio(palette.text.primary, bg)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(palette.text.secondary, bg)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(palette.primary.main, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(cases)('draws the %s AppBar hairline in the line token', (_mode, theme, t) => {
    const root = theme.components?.MuiAppBar?.styleOverrides?.root as { borderBottom?: string };
    expect(root.borderBottom).toBe(`1px solid ${t.line}`);
  });
});
