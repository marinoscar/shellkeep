// =============================================================================
// Settings Type Definitions
// =============================================================================

import { KEY_SHORTCUT_BASE_KEYS } from '../schemas/settings.schema';

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

/**
 * User settings schema - stored in user_settings.value JSONB
 */
export interface UserSettingsValue {
  theme: 'light' | 'dark' | 'system';
  profile: {
    displayName?: string;
    useProviderImage: boolean;
    customImageUrl?: string | null;
  };
  terminal?: {
    showScrollButtons: boolean;
    keyShortcuts?: KeyShortcut[];
  };
}

/**
 * System settings schema - stored in system_settings.value JSONB
 */
export interface SystemSettingsValue {
  ui: {
    allowUserThemeOverride: boolean;
  };
  features: {
    [key: string]: boolean;
  };
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

/**
 * Default user settings
 */
export const DEFAULT_USER_SETTINGS: UserSettingsValue = {
  theme: 'system',
  profile: {
    useProviderImage: true,
  },
  terminal: {
    showScrollButtons: true,
    keyShortcuts: DEFAULT_KEY_SHORTCUTS,
  },
};

/**
 * Default system settings
 */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettingsValue = {
  ui: {
    allowUserThemeOverride: true,
  },
  features: {},
};
