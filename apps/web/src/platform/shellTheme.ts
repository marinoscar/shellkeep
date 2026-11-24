/**
 * The app's two themes (issue #76): the platform shell's `createShellTheme`
 * with the ShellKeep brand palette, which used to live in `theme/light.ts` and
 * `theme/dark.ts`. Typography, shape and the component overrides are the
 * shell's. `App.tsx` hands `SHELLKEEP_THEMES` to `ShellRoot`, which keeps the
 * viewer's choice under `localStorage['theme_mode']`, the key the old theme
 * context used, so a stored choice survives the move in both directions.
 *
 * Module constants: each theme is built once.
 */
import type { PaletteOptions } from '@mui/material/styles';
import { createShellTheme } from '@marinoscar/platform-web/shell/headless';
import type { ShellThemes } from '@marinoscar/platform-web/shell/ui';

/**
 * The light brand palette. `primary.main` is the product colour of
 * `packages/shared/identity.json` (`themeColor`); keep the two in step.
 */
export const SHELLKEEP_LIGHT_PALETTE: PaletteOptions = {
  primary: { main: '#1976d2', light: '#42a5f5', dark: '#1565c0' },
  secondary: { main: '#9c27b0', light: '#ba68c8', dark: '#7b1fa2' },
  background: { default: '#f5f5f5', paper: '#ffffff' },
  text: { primary: 'rgba(0, 0, 0, 0.87)', secondary: 'rgba(0, 0, 0, 0.6)' },
};

/** The dark brand palette. */
export const SHELLKEEP_DARK_PALETTE: PaletteOptions = {
  primary: { main: '#90caf9', light: '#e3f2fd', dark: '#42a5f5' },
  secondary: { main: '#ce93d8', light: '#f3e5f5', dark: '#ab47bc' },
  background: { default: '#121212', paper: '#1e1e1e' },
  text: { primary: '#ffffff', secondary: 'rgba(255, 255, 255, 0.7)' },
};

export const lightTheme = createShellTheme('light', { palette: SHELLKEEP_LIGHT_PALETTE });
export const darkTheme = createShellTheme('dark', { palette: SHELLKEEP_DARK_PALETTE });

/** What `ShellRoot` resolves the viewer's `light`, `dark` or `system` choice to. */
export const SHELLKEEP_THEMES: ShellThemes = { light: lightTheme, dark: darkTheme };
