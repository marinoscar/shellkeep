// =============================================================================
// Settings Type Definitions
// =============================================================================
//
// Base settings only. Optional namespaces are
// declared by their domain module and registered through
// `settings/registry/user-settings-namespaces.ts`.

import type { UserSettingsNamespaces } from '../../settings/registry/user-settings-namespaces';

/**
 * User settings schema - stored in user_settings.value JSONB
 */
export type UserSettingsValue = {
  theme: 'light' | 'dark' | 'system';
  profile: {
    displayName?: string;
    useProviderImage: boolean;
    customImageUrl?: string | null;
  };
} & {
  [K in keyof UserSettingsNamespaces]?: UserSettingsNamespaces[K];
};

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
 * Default user settings: the core fields, extended with each namespace's
 * `defaults` as `registerUserSettingsNamespaces` registers it, so the
 * document a new user is created with matches the registry.
 */
export const DEFAULT_USER_SETTINGS: UserSettingsValue = {
  theme: 'system',
  profile: {
    useProviderImage: true,
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
