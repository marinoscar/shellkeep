// =============================================================================
// The `terminal` and `shortcuts` user-settings namespaces, client side
// (issues #48, #80)
// =============================================================================
//
// The platform settings slice returns a namespace only when it is stored: a
// user who never saved terminal preferences reads `GET /api/user-settings`
// WITHOUT `terminal` (or `shortcuts`). Every consumer reads the namespaces
// through `resolveTerminalSettings` and `resolveKeyShortcuts`, which apply the
// defaults below, so the terminal, the key bar and the scroll buttons look the
// same whether or not a row exists.
//
// The defaults mirror `DEFAULT_TERMINAL_SETTINGS` (terminal.user-settings.ts)
// and `DEFAULT_KEY_SHORTCUTS` (shortcuts.user-settings.ts) of
// apps/api/src/terminal/settings/: keep them in sync (same ids, labels and
// keystrokes, same bounds).
// =============================================================================

import type {
  KeyShortcut,
  Keystroke,
  TerminalBellMode,
  TerminalCursorStyle,
  TerminalFontFamily,
  TerminalKeyBarMode,
  TerminalThemeName,
  TerminalUserSettings,
  TerminalUserSettingsDocument,
} from '../../types/terminal';
import { DEFAULT_KEY_LAYOUT, DEFAULT_KEY_OPTIONS, type KeyLayout, type KeyOptions } from './keys/keyModel';
import { layoutFromLegacyShortcuts, toLegacyBarKeys } from './keys/legacyAdapter';

/** The terminal preferences with every field resolved. */
export interface ResolvedTerminalSettings {
  showScrollButtons: boolean;
  showKeyBar: TerminalKeyBarMode;
  fontFamily: TerminalFontFamily;
  fontSize: number;
  lineHeight: number;
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
  scrollback: number;
  theme: TerminalThemeName;
  bell: TerminalBellMode;
  copyOnSelect: boolean;
}

/** Bounds of the numeric preferences (the API enforces the same). */
export const TERMINAL_FONT_SIZE = { min: 10, max: 24 } as const;
export const TERMINAL_LINE_HEIGHT = { min: 1, max: 1.6, step: 0.1 } as const;
export const TERMINAL_SCROLLBACK = { min: 1000, max: 50000, step: 1000 } as const;
/** The most key shortcuts a user may keep (the API's cap). */
export const MAX_KEY_SHORTCUTS = 50;

/** The key shortcuts a user without stored shortcuts gets. */
export const DEFAULT_KEY_SHORTCUTS: readonly KeyShortcut[] = [
  {
    id: '11111111-1111-4111-8111-111111111101',
    label: 'ESC',
    keystrokes: [{ modifiers: [], key: 'Escape' }],
  },
  {
    id: '11111111-1111-4111-8111-111111111102',
    label: 'Tab',
    keystrokes: [{ modifiers: [], key: 'Tab' }],
  },
  {
    id: '11111111-1111-4111-8111-111111111103',
    label: 'Shift+Tab',
    keystrokes: [{ modifiers: ['shift'], key: 'Tab' }],
  },
  {
    id: '11111111-1111-4111-8111-111111111104',
    label: 'Ctrl+C',
    keystrokes: [{ modifiers: ['ctrl'], key: 'c' }],
  },
  {
    id: '11111111-1111-4111-8111-111111111105',
    label: 'Ctrl+D',
    keystrokes: [{ modifiers: ['ctrl'], key: 'd' }],
  },
  {
    id: '11111111-1111-4111-8111-111111111106',
    label: '↑',
    keystrokes: [{ modifiers: [], key: 'ArrowUp' }],
  },
  {
    id: '11111111-1111-4111-8111-111111111107',
    label: '↓',
    keystrokes: [{ modifiers: [], key: 'ArrowDown' }],
  },
  {
    id: '11111111-1111-4111-8111-111111111108',
    label: '←',
    keystrokes: [{ modifiers: [], key: 'ArrowLeft' }],
  },
  {
    id: '11111111-1111-4111-8111-111111111109',
    label: '→',
    keystrokes: [{ modifiers: [], key: 'ArrowRight' }],
  },
];

/** What a user without stored terminal preferences gets. */
export const DEFAULT_TERMINAL_SETTINGS: Readonly<ResolvedTerminalSettings> = {
  showScrollButtons: true,
  showKeyBar: 'auto',
  fontFamily: 'system',
  fontSize: 14,
  lineHeight: 1,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  // The look every terminal had before #80; `follow-app` tracks the app theme.
  theme: 'dark',
  bell: 'none',
  copyOnSelect: false,
};

/**
 * The stored namespace with the defaults applied: an absent namespace is the
 * defaults, an absent field takes its default. A legacy `keyShortcuts` is not
 * part of the result (read it through `resolveKeyShortcuts`).
 */
export function resolveTerminalSettings(
  stored: Partial<TerminalUserSettings> | null | undefined,
): ResolvedTerminalSettings {
  const resolved = { ...DEFAULT_TERMINAL_SETTINGS };
  for (const field of Object.keys(DEFAULT_TERMINAL_SETTINGS) as (keyof ResolvedTerminalSettings)[]) {
    const value = stored?.[field];
    if (value !== undefined && value !== null) {
      (resolved as Record<string, unknown>)[field] = value;
    }
  }
  return resolved;
}

/**
 * The shortcuts the key bar shows: the v2 layout through the compatibility
 * adapter (`toLegacyBarKeys`) when one is stored, else `shortcuts.keyShortcuts`,
 * else the defaults. An empty list stays empty (the user deleted every
 * shortcut). The bar does not change until #167 replaces it.
 */
export function resolveKeyShortcuts(
  document: Pick<TerminalUserSettingsDocument, 'terminal' | 'shortcuts'> | null | undefined,
): KeyShortcut[] {
  if (document?.shortcuts?.layout) return toLegacyBarKeys(document.shortcuts.layout);
  return (
    document?.shortcuts?.keyShortcuts ??
    // PLATFORM-ADOPTION-SHIM(#83): a row written before #80 keeps its list at
    // `terminal.keyShortcuts` until the seed step moves it
    // (apps/api/prisma/settings-migrations/terminal-shortcuts.ts).
    document?.terminal?.keyShortcuts ??
    (DEFAULT_KEY_SHORTCUTS as KeyShortcut[])
  );
}

/**
 * The user's v2 key layout (#165): the stored one, else the stored v1 list
 * converted, else `DEFAULT_KEY_LAYOUT`.
 */
export function resolveKeyLayout(
  document: Pick<TerminalUserSettingsDocument, 'terminal' | 'shortcuts'> | null | undefined,
): KeyLayout {
  if (document?.shortcuts?.layout) return document.shortcuts.layout;
  const legacy = document?.shortcuts?.keyShortcuts ?? document?.terminal?.keyShortcuts;
  return legacy ? layoutFromLegacyShortcuts(legacy) : (DEFAULT_KEY_LAYOUT as KeyLayout);
}

/** The key bar options: the stored ones, else `DEFAULT_KEY_OPTIONS`. */
export function resolveKeyOptions(
  document: Pick<TerminalUserSettingsDocument, 'shortcuts'> | null | undefined,
): KeyOptions {
  return { ...DEFAULT_KEY_OPTIONS, ...document?.shortcuts?.options };
}

/** Whether the key bar shows, for a `showKeyBar` mode on this device. */
export function isKeyBarVisible(mode: TerminalKeyBarMode, isTouchDevice: boolean): boolean {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return isTouchDevice;
}

function normalizeKeystroke(keystroke: Keystroke): Keystroke {
  return { modifiers: keystroke.modifiers ?? [], key: keystroke.key };
}

/**
 * A shortcut list in the shape the API requires: every keystroke carries its
 * `modifiers` array (`[]` when none), nothing else.
 */
export function normalizeKeyShortcuts(shortcuts: readonly KeyShortcut[]): KeyShortcut[] {
  return shortcuts.map((shortcut) => ({
    id: shortcut.id,
    label: shortcut.label,
    keystrokes: shortcut.keystrokes.map(normalizeKeystroke),
  }));
}

/**
 * The `terminal` value of a `PATCH /api/user-settings`: the resolved current
 * preferences with `changes` on top. Sending the whole namespace keeps the
 * stored row self-contained (it never relies on server defaults). Never
 * carries `keyShortcuts` (the API refuses it there since #80).
 */
export function terminalPatch(
  current: ResolvedTerminalSettings,
  changes: Partial<ResolvedTerminalSettings>,
): ResolvedTerminalSettings {
  return resolveTerminalSettings({ ...current, ...changes });
}
