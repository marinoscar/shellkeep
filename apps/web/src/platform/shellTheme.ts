/**
 * The app's two themes (issue #76): the platform shell's `createShellTheme`
 * with the ShellKeep brand palette, which used to live in `theme/light.ts` and
 * `theme/dark.ts`. Typography, shape and the component overrides are the
 * shell's. `App.tsx` hands `SHELLKEEP_THEMES` to `ShellRoot`, which keeps the
 * viewer's choice under `localStorage['theme_mode']`, the key the old theme
 * context used, so a stored choice survives the move in both directions.
 *
 * The palette is the Option A token set (#148), `BRAND` of `@shellkeep/shared`:
 * never write a hex literal here, change the token instead. Every text pair
 * keeps WCAG AA (pinned by `shared-identity.test.ts` in apps/cli and by
 * `__tests__/platform/shellTheme.test.ts`).
 *
 * Module constants: each theme is built once.
 */
import type { PaletteOptions, Theme } from '@mui/material/styles';
import { createShellTheme } from '@marinoscar/platform-web/shell/headless';
import type { ShellThemes } from '@marinoscar/platform-web/shell/ui';
import { BRAND, type BrandTokens } from '@shellkeep/shared';

/**
 * The tints the shell merges one level deep into `primary`: without them its
 * template-blue `light` and `dark` would survive the override.
 */
const PRIMARY_TINTS = {
  light: { light: BRAND.dark.accent, dark: '#115E59' },
  dark: { light: BRAND.dark.accentText, dark: '#14B8A6' },
} as const;

/** The MUI palette of one mode, built from its tokens. */
function brandPalette(mode: 'light' | 'dark', t: BrandTokens): PaletteOptions {
  return {
    primary: { main: t.accent, ...PRIMARY_TINTS[mode], contrastText: t.accentInk },
    // No secondary brand hue in Option A: the informational tone stands in.
    secondary: { main: t.info, light: t.info, dark: t.info },
    success: { main: t.ok },
    warning: { main: t.warn },
    error: { main: t.err },
    info: { main: t.info },
    background: { default: t.bg, paper: t.surface },
    text: { primary: t.text, secondary: t.muted },
    divider: t.line,
  };
}

/** The light brand palette (`BRAND.light`). */
export const SHELLKEEP_LIGHT_PALETTE: PaletteOptions = brandPalette('light', BRAND.light);

/** The dark brand palette (`BRAND.dark`). */
export const SHELLKEEP_DARK_PALETTE: PaletteOptions = brandPalette('dark', BRAND.dark);

/** The shell draws the AppBar hairline in a fixed grey; draw it in the `line` token. */
function withBrandChrome(t: BrandTokens) {
  return (theme: Theme): Theme => {
    theme.components = {
      ...theme.components,
      MuiAppBar: {
        ...theme.components?.MuiAppBar,
        styleOverrides: {
          ...theme.components?.MuiAppBar?.styleOverrides,
          root: { boxShadow: 'none', borderBottom: `1px solid ${t.line}` },
        },
      },
    };
    return theme;
  };
}

export const lightTheme = createShellTheme('light', {
  palette: SHELLKEEP_LIGHT_PALETTE,
  extend: withBrandChrome(BRAND.light),
});
export const darkTheme = createShellTheme('dark', {
  palette: SHELLKEEP_DARK_PALETTE,
  extend: withBrandChrome(BRAND.dark),
});

/** What `ShellRoot` resolves the viewer's `light`, `dark` or `system` choice to. */
export const SHELLKEEP_THEMES: ShellThemes = { light: lightTheme, dark: darkTheme };
