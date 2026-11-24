/**
 * The Terminal settings page's live preview (issue #80): a read-only xterm
 * that renders sample output with the chosen font, size, line height, cursor
 * and colour theme, through the same `applyTerminalAppearance` the session
 * terminals use, so what the page shows is what a terminal looks like.
 *
 * It holds no socket and takes no input (`disableStdin`).
 */

import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ResolvedTerminalSettings } from '../../../lib/terminal/settings';
import {
  applyTerminalAppearance,
  ensureTerminalFont,
  resolveTerminalTheme,
  terminalAppearanceOptions,
  type AppColorMode,
} from '../../../lib/terminal/appearance';

/** Invented sample output (placeholders only), with a few ANSI colours. */
const SAMPLE_LINES = [
  '\x1b[32mperson-a@server-a\x1b[0m:\x1b[34m~/project\x1b[0m$ ls',
  '\x1b[34mdocs\x1b[0m  \x1b[34msrc\x1b[0m  README.md  \x1b[32mbuild.sh\x1b[0m',
  '\x1b[32mperson-a@server-a\x1b[0m:\x1b[34m~/project\x1b[0m$ git status --short',
  ' \x1b[31mM\x1b[0m src/main.ts',
  '\x1b[32m??\x1b[0m notes.txt',
  '\x1b[32mperson-a@server-a\x1b[0m:\x1b[34m~/project\x1b[0m$ ',
];

export interface TerminalPreviewProps {
  preferences: ResolvedTerminalSettings;
  appMode: AppColorMode;
}

export function TerminalPreview({ preferences, appMode }: TerminalPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const initial = useRef({ preferences, appMode });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      ...terminalAppearanceOptions(initial.current.preferences, initial.current.appMode),
      disableStdin: true,
      convertEol: true,
      rows: SAMPLE_LINES.length + 1,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    try {
      terminal.open(container);
      fit.fit();
    } catch {
      // Not laid out (a hidden tab, a test DOM): the preview stays blank.
    }
    terminal.write(SAMPLE_LINES.join('\n'));
    terminalRef.current = terminal;
    fitRef.current = fit;
    return () => {
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void ensureTerminalFont(preferences.fontFamily).then(() => {
      const terminal = terminalRef.current;
      if (cancelled || !terminal) return;
      if (applyTerminalAppearance(terminal, preferences, appMode)) {
        try {
          fitRef.current?.fit();
        } catch {
          // Not laid out yet.
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [preferences, appMode]);

  const background = resolveTerminalTheme(preferences.theme, appMode).background;

  return (
    <Box
      ref={containerRef}
      role="img"
      aria-label="Terminal preview"
      data-testid="terminal-preview"
      data-font-family={preferences.fontFamily}
      data-font-size={preferences.fontSize}
      data-line-height={preferences.lineHeight}
      data-cursor-style={preferences.cursorStyle}
      data-theme={preferences.theme}
      sx={{
        bgcolor: background,
        borderRadius: 1,
        p: 1,
        minHeight: 140,
        overflow: 'hidden',
        '& .xterm': { pointerEvents: 'none' },
      }}
    />
  );
}
