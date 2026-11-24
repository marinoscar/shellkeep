import { useMediaQuery, useTheme } from '@mui/material';

/** How the terminal workspace lays out its own controls. */
export interface TerminalLayout {
  /**
   * Below `sm` (a phone): one pane, the tabs as a chip row, the toolbar's
   * secondary actions in an overflow menu, the key shortcuts bar open by
   * default and the AI panel as a bottom sheet.
   */
  isPhone: boolean;
  /** `md` and up: the AI panel docks to the right of the panes instead of a sheet. */
  isWide: boolean;
}

/**
 * The terminal workspace's own compact/wide decision. It is page content, not
 * navigation chrome: it moves none of the five shell gates (it reads the same
 * `sm` boundary the shell does, so a phone that has the bottom bar also has the
 * single-pane workspace), and it is listed with its reason in
 * `__tests__/config/breakpointGates.test.ts`. `noSsr` makes the first render
 * already correct, so the phone does not flash the desktop layout.
 */
export function useTerminalLayout(): TerminalLayout {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const isWide = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
  return { isPhone, isWide };
}
