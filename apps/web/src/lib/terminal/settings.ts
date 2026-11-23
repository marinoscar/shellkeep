// =============================================================================
// The `terminal` user-settings namespace, client side (issue #48)
// =============================================================================
//
// The platform settings slice returns a namespace only when it is stored: a
// user who never saved terminal preferences reads `GET /api/user-settings`
// WITHOUT `terminal`. Every consumer reads the namespace through
// `resolveTerminalSettings`, which applies the defaults below, so the key bar
// and the scroll buttons look the same whether or not a row exists.
//
// The defaults mirror `DEFAULT_TERMINAL_SETTINGS` and `DEFAULT_KEY_SHORTCUTS` of
// apps/api/src/terminal/settings/terminal.user-settings.ts: keep the two in sync
// (same ids, labels and keystrokes).
// =============================================================================

import type { KeyShortcut, Keystroke, TerminalUserSettings } from '../../types/terminal';

/** The terminal preferences with every field resolved. */
export interface ResolvedTerminalSettings {
  showScrollButtons: boolean;
  keyShortcuts: KeyShortcut[];
}

/** The key shortcuts a user without stored terminal preferences gets. */
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
  keyShortcuts: DEFAULT_KEY_SHORTCUTS as KeyShortcut[],
};

/**
 * The stored namespace with the defaults applied: an absent namespace is the
 * defaults, an absent field takes its default. An empty `keyShortcuts` list
 * stays empty (the user deleted every shortcut).
 */
export function resolveTerminalSettings(
  stored: Partial<TerminalUserSettings> | null | undefined,
): ResolvedTerminalSettings {
  return {
    showScrollButtons: stored?.showScrollButtons ?? DEFAULT_TERMINAL_SETTINGS.showScrollButtons,
    keyShortcuts: stored?.keyShortcuts ?? DEFAULT_TERMINAL_SETTINGS.keyShortcuts,
  };
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
 * preferences with `changes` on top, normalised. Sending the whole namespace
 * keeps the stored row self-contained (it never relies on server defaults).
 */
export function terminalPatch(
  current: ResolvedTerminalSettings,
  changes: Partial<TerminalUserSettings>,
): ResolvedTerminalSettings {
  const next = { ...current, ...changes };
  return {
    showScrollButtons: next.showScrollButtons,
    keyShortcuts: normalizeKeyShortcuts(next.keyShortcuts ?? []),
  };
}
