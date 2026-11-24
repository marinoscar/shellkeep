// =============================================================================
// This app's settings namespaces (issue #48)
// =============================================================================
//
// What ShellKeep adds to the platform's settings registries. `platform/settings/
// registry.ts` folds these lists into the platform's and registers the result.
// ORDER IS THE STORED KEY ORDER: append, never insert.
//
//   system: ui, features (the keys the `global` row has always held), terminal
//   user:   terminal (the `terminal` key of `user_settings.value`), shortcuts (#80)
//
// The platform's own system namespaces (notifications, jobs, nodes,
// databaseBackup, maintenance, storage, ...) are registered by the issue that
// adopts the slice that owns them. A stored key the platform does not declare is
// preserved on write (the platform keeps unknown keys), never dropped.
//
// Pure data: no `register()` calls, no Nest, no Prisma (read by
// `scripts/generate-settings-catalog.ts`, outside any Nest container).
// =============================================================================

import type {
  SettingsDefaultsOverride,
  SystemSettingsNamespace,
  SystemSettingsNamespaceExtension,
  UserSettingsNamespace,
  UserSettingsNamespaceExtension,
} from '@marinoscar/platform-api/settings';

import { FEATURES_SYSTEM_SETTINGS, UI_SYSTEM_SETTINGS } from '../platform/settings/app-system-settings';
import { TERMINAL_SYSTEM_SETTINGS } from '../terminal/settings/terminal.system-settings';
import { DEFAULT_TERMINAL_SETTINGS, TERMINAL_USER_SETTINGS } from '../terminal/settings/terminal.user-settings';
import {
  DEFAULT_SHORTCUTS_SETTINGS,
  SHORTCUTS_USER_SETTINGS,
} from '../terminal/settings/shortcuts.user-settings';

/** The app's own system settings namespaces, in stored key order. */
export const APP_SYSTEM_SETTINGS_NAMESPACES: readonly SystemSettingsNamespace[] = [
  UI_SYSTEM_SETTINGS as SystemSettingsNamespace,
  FEATURES_SYSTEM_SETTINGS as SystemSettingsNamespace,
  TERMINAL_SYSTEM_SETTINGS as SystemSettingsNamespace,
];

/** The app's own optional user settings namespaces, in stored key order. */
export const APP_USER_SETTINGS_NAMESPACES: readonly UserSettingsNamespace[] = [
  TERMINAL_USER_SETTINGS as UserSettingsNamespace,
  // #80, appended: the key bar's shortcuts, moved out of `terminal`.
  SHORTCUTS_USER_SETTINGS as UserSettingsNamespace,
];

/** Fields the app adds inside platform system namespaces. None: every stored key has a home. */
export const APP_SYSTEM_SETTINGS_EXTENSIONS: readonly SystemSettingsNamespaceExtension[] = [];

/** Fields the app adds inside platform user namespaces. None. */
export const APP_USER_SETTINGS_EXTENSIONS: readonly UserSettingsNamespaceExtension[] = [];

/** Changes to the defaults of platform system namespaces. None. */
export const APP_SYSTEM_SETTINGS_DEFAULTS: readonly SettingsDefaultsOverride[] = [];

/**
 * Optional user namespaces a NEW user's `user_settings.value` starts with (the
 * identity slice's `USER_DEFAULTS`), so the stored document of a new user keeps
 * the shape ShellKeep has always created. The platform otherwise leaves an
 * optional namespace absent ("use the client's defaults").
 */
export const APP_USER_SETTINGS_INITIAL_VALUES: Readonly<Record<string, unknown>> = {
  terminal: DEFAULT_TERMINAL_SETTINGS,
  shortcuts: DEFAULT_SHORTCUTS_SETTINGS,
};
