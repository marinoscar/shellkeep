// =============================================================================
// Terminal user-settings namespace
// =============================================================================
//
// The `terminal` key of `user_settings.value`: scroll-button visibility and the
// on-screen key shortcuts bar. Declared here, in the terminal domain, and
// registered with the platform settings slice's user namespace registry by
// `platform/settings/registry.ts`. Stored key names are unchanged (#48).
//
// The platform returns a namespace only when it is stored: a user who never
// saved terminal preferences reads a body WITHOUT `terminal`, and the client
// applies `DEFAULT_TERMINAL_SETTINGS` (mirrored in the web app). A PATCH that
// names the namespace stores the defaults merged with the patch, exactly as
// before, so the stored shape is unchanged.
// =============================================================================

import { z } from 'zod';
import type { UserSettingsNamespace } from '@marinoscar/platform-api/settings';

// -----------------------------------------------------------------------------
// Key shortcut schemas
// -----------------------------------------------------------------------------

// Allowlist of base key identifiers users can pick from.
// Keep this in one place; the frontend will mirror it.
export const KEY_SHORTCUT_BASE_KEYS = [
  'Escape', 'Tab', 'Enter', 'Backspace', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  '`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/',
] as const;

export const keystrokeSchema = z.object({
  // Required: the platform refuses `.default()` in a user namespace (an absent value is
  // never materialised). Stored keystrokes have always carried the array.
  modifiers: z.array(z.enum(['ctrl', 'shift', 'alt', 'meta'])).max(4),
  key: z.enum(KEY_SHORTCUT_BASE_KEYS),
});

export const keyShortcutSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(40),
  keystrokes: z.array(keystrokeSchema).min(1).max(3),
});

export type KeyShortcutModifier = 'ctrl' | 'shift' | 'alt' | 'meta';

export type KeyShortcutBaseKey = (typeof KEY_SHORTCUT_BASE_KEYS)[number];

export interface Keystroke {
  modifiers: KeyShortcutModifier[];
  key: KeyShortcutBaseKey;
}

export interface KeyShortcut {
  id: string;
  label: string;
  keystrokes: Keystroke[];
}

export interface TerminalUserSettings {
  showScrollButtons: boolean;
  keyShortcuts?: KeyShortcut[];
}

export interface TerminalUserSettingsPatch {
  showScrollButtons?: boolean;
  keyShortcuts?: KeyShortcut[];
}

/**
 * Default key shortcuts shipped to every new user.
 * UUIDs are stable and hard-coded so defaults are deterministic across users.
 */
export const DEFAULT_KEY_SHORTCUTS: KeyShortcut[] = [
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

// -----------------------------------------------------------------------------
// Namespace declaration
// -----------------------------------------------------------------------------

declare module '@marinoscar/platform-api/settings' {
  interface UserSettingsNamespaces {
    terminal: TerminalUserSettings;
  }
}

export const terminalSettingsSchema = z.object({
  showScrollButtons: z.boolean(),
  keyShortcuts: z.array(keyShortcutSchema).max(50).optional(),
});

export const terminalSettingsPatchSchema = z.object({
  showScrollButtons: z.boolean().optional(),
  keyShortcuts: z.array(keyShortcutSchema).max(50).optional(),
});

export const DEFAULT_TERMINAL_SETTINGS: TerminalUserSettings = {
  showScrollButtons: true,
  keyShortcuts: DEFAULT_KEY_SHORTCUTS,
};

export const TERMINAL_USER_SETTINGS: UserSettingsNamespace<
  'terminal',
  TerminalUserSettings,
  TerminalUserSettingsPatch
> = {
  key: 'terminal',
  description:
    'Terminal preferences: scroll-button visibility and the on-screen key shortcuts bar.',
  schema: terminalSettingsSchema,
  patchSchema: terminalSettingsPatchSchema,
  merge(current, patch) {
    if (patch === undefined) return current;
    // JSON Merge Patch: `null` removes the namespace (the client falls back to defaults).
    if (patch === null) return undefined;
    const base = current ?? DEFAULT_TERMINAL_SETTINGS;
    return {
      showScrollButtons:
        patch.showScrollButtons !== undefined
          ? patch.showScrollButtons
          : base.showScrollButtons,
      keyShortcuts:
        patch.keyShortcuts !== undefined ? patch.keyShortcuts : base.keyShortcuts,
    };
  },
};
