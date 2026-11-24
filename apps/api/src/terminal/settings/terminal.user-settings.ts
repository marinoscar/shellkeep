// =============================================================================
// Terminal user-settings namespace
// =============================================================================
//
// The `terminal` key of `user_settings.value`: how the terminal looks and
// behaves (scroll buttons, the key bar, font, cursor, scrollback, colour theme,
// bell, copy-on-select). Declared here, in the terminal domain, and registered
// with the platform settings slice's user namespace registry by
// `platform/settings/registry.ts`. Stored key names are unchanged (#48).
//
// The key shortcuts moved to their own `shortcuts` namespace (#80,
// `shortcuts.user-settings.ts`). A row written before #80 still carries
// `terminal.keyShortcuts`: the stored schema keeps accepting it (and the merge
// keeps it) until the seed step `prisma/settings-migrations/` has moved it, and
// the web client reads it through a shim. Neither writes it.
//
// The platform returns a namespace only when it is stored: a user who never
// saved terminal preferences reads a body WITHOUT `terminal`, and the client
// applies `DEFAULT_TERMINAL_SETTINGS` (mirrored in the web app). A PATCH that
// names the namespace stores the defaults merged with what is stored and the
// patch, so a written row is self-contained.
// =============================================================================

import { z } from 'zod';
import type { UserSettingsNamespace } from '@marinoscar/platform-api/settings';
import { keyShortcutListSchema, type KeyShortcut } from './shortcuts.user-settings';

// -----------------------------------------------------------------------------
// Preference vocabularies (mirrored in apps/web/src/lib/terminal/settings.ts)
// -----------------------------------------------------------------------------

/** When the on-screen key bar shows: `auto` on touch devices only. */
export const TERMINAL_KEY_BAR_MODES = ['auto', 'always', 'never'] as const;
/** The monospace fonts the web app bundles (`system` is the platform's own stack). */
export const TERMINAL_FONT_FAMILIES = ['system', 'jetbrains-mono', 'fira-code', 'source-code-pro'] as const;
export const TERMINAL_CURSOR_STYLES = ['block', 'bar', 'underline'] as const;
export const TERMINAL_THEMES = ['follow-app', 'dark', 'light', 'solarized-dark', 'solarized-light'] as const;
export const TERMINAL_BELL_MODES = ['none', 'visual', 'sound'] as const;

/** Bounds of the numeric preferences. */
export const TERMINAL_FONT_SIZE = { min: 10, max: 24 } as const;
export const TERMINAL_LINE_HEIGHT = { min: 1, max: 1.6 } as const;
export const TERMINAL_SCROLLBACK = { min: 1000, max: 50000 } as const;

export interface TerminalUserSettings {
  showScrollButtons: boolean;
  showKeyBar?: (typeof TERMINAL_KEY_BAR_MODES)[number];
  fontFamily?: (typeof TERMINAL_FONT_FAMILIES)[number];
  fontSize?: number;
  lineHeight?: number;
  cursorStyle?: (typeof TERMINAL_CURSOR_STYLES)[number];
  cursorBlink?: boolean;
  scrollback?: number;
  theme?: (typeof TERMINAL_THEMES)[number];
  bell?: (typeof TERMINAL_BELL_MODES)[number];
  copyOnSelect?: boolean;
  /**
   * LEGACY (before #80): the key shortcuts, now `shortcuts.keyShortcuts`. Kept
   * on a stored row until the seed step moves it; never written.
   */
  keyShortcuts?: KeyShortcut[];
}

export type TerminalUserSettingsPatch = Partial<Omit<TerminalUserSettings, 'keyShortcuts'>>;

// -----------------------------------------------------------------------------
// Namespace declaration
// -----------------------------------------------------------------------------

declare module '@marinoscar/platform-api/settings' {
  interface UserSettingsNamespaces {
    terminal: TerminalUserSettings;
  }
}

/**
 * The fields every write accepts. Optional in the stored shape too: a row
 * written before #80 holds only `showScrollButtons` (and the legacy shortcuts),
 * and the client applies the defaults to an absent field. No `.default()`:
 * the platform refuses one in a user namespace.
 */
const terminalPreferenceFields = {
  showKeyBar: z.enum(TERMINAL_KEY_BAR_MODES).optional(),
  fontFamily: z.enum(TERMINAL_FONT_FAMILIES).optional(),
  fontSize: z.number().int().min(TERMINAL_FONT_SIZE.min).max(TERMINAL_FONT_SIZE.max).optional(),
  lineHeight: z.number().min(TERMINAL_LINE_HEIGHT.min).max(TERMINAL_LINE_HEIGHT.max).optional(),
  cursorStyle: z.enum(TERMINAL_CURSOR_STYLES).optional(),
  cursorBlink: z.boolean().optional(),
  scrollback: z.number().int().min(TERMINAL_SCROLLBACK.min).max(TERMINAL_SCROLLBACK.max).optional(),
  theme: z.enum(TERMINAL_THEMES).optional(),
  bell: z.enum(TERMINAL_BELL_MODES).optional(),
  copyOnSelect: z.boolean().optional(),
};

export const terminalSettingsSchema = z
  .object({
    showScrollButtons: z.boolean(),
    ...terminalPreferenceFields,
    // PLATFORM-ADOPTION-SHIM(#83): the pre-#80 location of the key shortcuts,
    // accepted on a stored row until `prisma/settings-migrations/` moved it.
    keyShortcuts: keyShortcutListSchema.optional(),
  })
  .strict();

/** A write names only the preferences: the shortcuts are `shortcuts.keyShortcuts` now. */
export const terminalSettingsPatchSchema = z
  .object({
    showScrollButtons: z.boolean().optional(),
    ...terminalPreferenceFields,
  })
  .strict();

/** What a user without stored terminal preferences gets (mirrored by the web client). */
export const DEFAULT_TERMINAL_SETTINGS: Required<Omit<TerminalUserSettings, 'keyShortcuts'>> = {
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

export const TERMINAL_USER_SETTINGS: UserSettingsNamespace<
  'terminal',
  TerminalUserSettings,
  TerminalUserSettingsPatch
> = {
  key: 'terminal',
  description:
    'Terminal preferences: scroll buttons, the on-screen key bar, font, cursor, scrollback, colour theme, bell and copy-on-select.',
  schema: terminalSettingsSchema,
  patchSchema: terminalSettingsPatchSchema,
  merge(current, patch) {
    if (patch === undefined) return current;
    // JSON Merge Patch: `null` removes the namespace (the client falls back to defaults).
    if (patch === null) return undefined;
    // The defaults, then what is stored (a legacy `keyShortcuts` stays where it
    // is until the seed step moves it), then the fields the patch names.
    const merged: TerminalUserSettings = { ...DEFAULT_TERMINAL_SETTINGS, ...current };
    for (const [field, value] of Object.entries(patch)) {
      if (value !== undefined) (merged as unknown as Record<string, unknown>)[field] = value;
    }
    return merged;
  },
};
