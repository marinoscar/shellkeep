// =============================================================================
// Terminal appearance: colour themes, bundled fonts and xterm options (#80)
// =============================================================================
//
// One place turns the resolved `terminal` preferences into xterm.js options,
// so the session terminals (`useTerminal`) and the settings page's live
// preview (`TerminalPreview`) render the same way. `applyTerminalAppearance`
// changes an open terminal in place (`terminal.options.*`); the caller then
// fits it, so the session never reconnects.
// =============================================================================

import type { ITerminalOptions, ITheme, Terminal } from '@xterm/xterm';
import type { TerminalFontFamily, TerminalThemeName } from '../../types/terminal';
import type { ResolvedTerminalSettings } from './settings';

/** The app's colour mode, which `follow-app` follows. */
export type AppColorMode = 'light' | 'dark';

/** The xterm colour themes, by preference id (`follow-app` resolves to one of them). */
export const TERMINAL_COLOR_THEMES: Record<Exclude<TerminalThemeName, 'follow-app'>, ITheme> = {
  // The look every terminal had before #80.
  dark: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    cursorAccent: '#1e1e1e',
    selectionBackground: '#264f78',
  },
  light: {
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#1f2328',
    cursorAccent: '#ffffff',
    selectionBackground: '#add6ff',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#4d2d00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f',
  },
  'solarized-dark': {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    cursorAccent: '#002b36',
    selectionBackground: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  'solarized-light': {
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#586e75',
    cursorAccent: '#fdf6e3',
    selectionBackground: '#eee8d5',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
};

/** Labels for the settings page. */
export const TERMINAL_THEME_LABELS: Record<TerminalThemeName, string> = {
  'follow-app': 'Follow the app theme',
  dark: 'Dark',
  light: 'Light',
  'solarized-dark': 'Solarized dark',
  'solarized-light': 'Solarized light',
};

/** The xterm theme of a preference, `follow-app` resolved against the app mode. */
export function resolveTerminalTheme(name: TerminalThemeName, appMode: AppColorMode): ITheme {
  if (name === 'follow-app') return TERMINAL_COLOR_THEMES[appMode];
  return TERMINAL_COLOR_THEMES[name];
}

interface TerminalFont {
  label: string;
  /** The CSS font-family stack xterm draws with. */
  stack: string;
  /** Loads the bundled font files (Vite splits each into its own chunk). */
  load?: () => Promise<unknown>;
  /** The family name `document.fonts.load` waits for. */
  family?: string;
}

const FALLBACK_STACK = 'Menlo, Monaco, "Courier New", monospace';

/** The bundled monospace fonts (`@fontsource/*`), loaded only when chosen. */
export const TERMINAL_FONTS: Record<TerminalFontFamily, TerminalFont> = {
  system: { label: 'System monospace', stack: FALLBACK_STACK },
  'jetbrains-mono': {
    label: 'JetBrains Mono',
    family: 'JetBrains Mono',
    stack: `"JetBrains Mono", ${FALLBACK_STACK}`,
    load: () => import('@fontsource/jetbrains-mono/400.css'),
  },
  'fira-code': {
    label: 'Fira Code',
    family: 'Fira Code',
    stack: `"Fira Code", ${FALLBACK_STACK}`,
    load: () => import('@fontsource/fira-code/400.css'),
  },
  'source-code-pro': {
    label: 'Source Code Pro',
    family: 'Source Code Pro',
    stack: `"Source Code Pro", ${FALLBACK_STACK}`,
    load: () => import('@fontsource/source-code-pro/400.css'),
  },
};

const loadedFonts = new Map<TerminalFontFamily, Promise<void>>();
const readyFonts = new Set<TerminalFontFamily>(['system']);

/** Whether the font's files are loaded (the system stack always is). */
export function isTerminalFontReady(id: TerminalFontFamily): boolean {
  return readyFonts.has(id);
}

/**
 * Resolves once the font's files are loaded, so xterm measures the real glyphs
 * (a terminal measured against the fallback font draws misaligned cells).
 * Never rejects: a font that fails to load leaves the fallback stack in use.
 */
export function ensureTerminalFont(id: TerminalFontFamily): Promise<void> {
  const font = TERMINAL_FONTS[id];
  if (!font?.load) return Promise.resolve();
  let pending = loadedFonts.get(id);
  if (!pending) {
    pending = font
      .load()
      .then(() => document.fonts?.load?.(`14px "${font.family}"`))
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        readyFonts.add(id);
      });
    loadedFonts.set(id, pending);
  }
  return pending;
}

/**
 * The xterm options the preferences set. A bundled font that is not loaded
 * yet is left out (the fallback stack draws until `ensureTerminalFont`
 * resolves and `applyTerminalAppearance` switches to it, which re-measures).
 */
export function terminalAppearanceOptions(
  prefs: ResolvedTerminalSettings,
  appMode: AppColorMode,
): Pick<
  ITerminalOptions,
  'fontFamily' | 'fontSize' | 'lineHeight' | 'cursorStyle' | 'cursorBlink' | 'scrollback' | 'theme'
> {
  return {
    fontFamily: (isTerminalFontReady(prefs.fontFamily)
      ? (TERMINAL_FONTS[prefs.fontFamily] ?? TERMINAL_FONTS.system)
      : TERMINAL_FONTS.system
    ).stack,
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    cursorStyle: prefs.cursorStyle,
    cursorBlink: prefs.cursorBlink,
    scrollback: prefs.scrollback,
    theme: resolveTerminalTheme(prefs.theme, appMode),
  };
}

/**
 * Applies the preferences to an open terminal, setting only the options that
 * changed (xterm re-renders on each assignment). Returns whether anything did.
 */
export function applyTerminalAppearance(
  terminal: Pick<Terminal, 'options'>,
  prefs: ResolvedTerminalSettings,
  appMode: AppColorMode,
): boolean {
  if (!terminal.options) return false;
  const next = terminalAppearanceOptions(prefs, appMode);
  let changed = false;
  const options = terminal.options as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    const same =
      key === 'theme'
        ? JSON.stringify(options[key] ?? null) === JSON.stringify(value)
        : options[key] === value;
    if (!same) {
      options[key] = value;
      changed = true;
    }
  }
  return changed;
}

let audioContext: AudioContext | null = null;

/** A short, quiet beep for `bell: 'sound'` (no audio file is shipped). */
export function playTerminalBell(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.08);
  } catch {
    // No audio: the bell stays silent.
  }
}
