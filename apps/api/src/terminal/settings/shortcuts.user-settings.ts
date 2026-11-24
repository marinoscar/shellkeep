// =============================================================================
// Shortcuts user-settings namespace (issue #80)
// =============================================================================
//
// The `shortcuts` key of `user_settings.value`: the on-screen key bar's
// shortcuts, at most 50. Before #80 the list lived at `terminal.keyShortcuts`;
// the seed step `prisma/settings-migrations/terminal-shortcuts.ts` moves a
// stored row's list here (and carries the inverse mapping), and the web client
// reads the old key through a shim until #83 removes it.
//
// #165 extends it backwards-compatibly (never a new namespace: those are
// append-only): optional `layout` (the v2 key groups) and `options`. A row
// without them is a v1 row; `keyShortcuts` is kept beside them.
//
// Registered after `terminal` by `app-registrations/settings.ts`: the stored
// key order is append-only. The platform returns the namespace only when it is
// stored; the client applies `DEFAULT_KEY_SHORTCUTS` (mirrored in the web app)
// to an absent one.
// =============================================================================

import { z } from 'zod';
import type { UserSettingsNamespace } from '@marinoscar/platform-api/settings';
import { keyLayoutSchema, keyOptionsSchema } from './key-layout.schema';
import type { KeyLayout, KeyOptions } from './keys/key-model';

export { DEFAULT_KEY_LAYOUT, DEFAULT_KEY_OPTIONS } from './keys/key-model';

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

/** The most shortcuts a user may keep. */
export const MAX_KEY_SHORTCUTS = 50;

/** A shortcut list: what `shortcuts.keyShortcuts` (and the legacy `terminal.keyShortcuts`) holds. */
export const keyShortcutListSchema = z.array(keyShortcutSchema).max(MAX_KEY_SHORTCUTS);

/**
 * The keyboard shortcuts of app actions (issue #57), by action id. Only ids listed here exist;
 * an absent id means the built-in binding (`terminal.aiAssist`: Mod+Shift+A, Ctrl on Linux and
 * Windows, Cmd on macOS; `terminal.aiExplain` (#58): Mod+Shift+E).
 */
export const ACTION_SHORTCUT_IDS = ['terminal.aiAssist', 'terminal.aiExplain'] as const;

export const actionShortcutsSchema = z
  .object({ 'terminal.aiAssist': keystrokeSchema.optional(), 'terminal.aiExplain': keystrokeSchema.optional() })
  .strict();

export type ActionShortcuts = z.infer<typeof actionShortcutsSchema>;

export interface ShortcutsUserSettings {
  keyShortcuts: KeyShortcut[];
  /** Appended by #57; absent until the user rebinds an action. */
  actions?: ActionShortcuts;
  /**
   * The v2 key layout (#165): ordered groups of up to four keys. Absent until the
   * migration `settings-migrations/terminal-shortcuts-v2.ts` or a save writes it;
   * `keyShortcuts` stays for rollback and the legacy editor (until #169).
   */
  layout?: KeyLayout;
  /** Key bar options (#165); absent means `DEFAULT_KEY_OPTIONS` (both on). */
  options?: KeyOptions;
}

export interface ShortcutsUserSettingsPatch {
  keyShortcuts?: KeyShortcut[];
  actions?: ActionShortcuts;
  layout?: KeyLayout;
  options?: KeyOptions;
}

declare module '@marinoscar/platform-api/settings' {
  interface UserSettingsNamespaces {
    shortcuts: ShortcutsUserSettings;
  }
}

export const shortcutsSettingsSchema = z
  .object({
    keyShortcuts: keyShortcutListSchema,
    actions: actionShortcutsSchema.optional(),
    layout: keyLayoutSchema.optional(),
    options: keyOptionsSchema.optional(),
  })
  .strict();

export const shortcutsSettingsPatchSchema = z
  .object({
    keyShortcuts: keyShortcutListSchema.optional(),
    actions: actionShortcutsSchema.optional(),
    layout: keyLayoutSchema.optional(),
    options: keyOptionsSchema.optional(),
  })
  .strict();

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

export const DEFAULT_SHORTCUTS_SETTINGS: ShortcutsUserSettings = {
  keyShortcuts: DEFAULT_KEY_SHORTCUTS,
};

export const SHORTCUTS_USER_SETTINGS: UserSettingsNamespace<
  'shortcuts',
  ShortcutsUserSettings,
  ShortcutsUserSettingsPatch
> = {
  key: 'shortcuts',
  description:
    'The on-screen key bar: shortcuts (at most 50, up to three keystrokes), and the v2 key layout (groups of up to four keys) with its options.',
  schema: shortcutsSettingsSchema,
  patchSchema: shortcutsSettingsPatchSchema,
  merge(current, patch) {
    if (patch === undefined) return current;
    // JSON Merge Patch: `null` removes the namespace (the client falls back to defaults).
    if (patch === null) return undefined;
    const base = current ?? DEFAULT_SHORTCUTS_SETTINGS;
    const actions = patch.actions !== undefined ? patch.actions : base.actions;
    const layout = patch.layout !== undefined ? patch.layout : base.layout;
    const options = patch.options !== undefined ? patch.options : base.options;
    return {
      keyShortcuts: patch.keyShortcuts !== undefined ? patch.keyShortcuts : base.keyShortcuts,
      ...(actions !== undefined ? { actions } : {}),
      ...(layout !== undefined ? { layout } : {}),
      ...(options !== undefined ? { options } : {}),
    };
  },
};
