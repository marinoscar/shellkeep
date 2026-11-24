// =============================================================================
// Settings registry entry point (issue #48)
// =============================================================================
//
// IMPORTING THIS FILE REGISTERS EVERY SETTINGS NAMESPACE. The platform's request
// and response DTOs, the composed schemas and the OpenAPI document are composed
// FROM THE REGISTRIES when `SettingsModule.forRoot()` runs, so every entry point
// (`main.ts`, `app.module.ts`, `test/setup.ts`, `scripts/*`) reaches this file
// first, through `shellkeep.manifest.ts`.
//
// Registration is once per process (a second import is a no-op).
// =============================================================================

import { DATABASE_BACKUP_SYSTEM_SETTINGS } from '@marinoscar/platform-api/db-backup';
import { MAINTENANCE_SYSTEM_SETTINGS } from '@marinoscar/platform-api/host';
import {
  JOBS_SYSTEM_SETTINGS,
  RETENTION_SYSTEM_SETTINGS,
  registerRetentionPolicy,
} from '@marinoscar/platform-api/jobs';
import { NODES_SYSTEM_SETTINGS } from '@marinoscar/platform-api/nodes';
import {
  NOTIFICATIONS_SYSTEM_SETTINGS,
  NOTIFICATIONS_USER_SETTINGS,
} from '@marinoscar/platform-api/notifications';
import { STORAGE_SYSTEM_SETTINGS } from '@marinoscar/platform-api/storage';
import {
  assembleSystemSettingsNamespaces,
  assembleUserSettingsNamespaces,
  registerSystemSettingsNamespaces,
  registerUserSettingsNamespaces,
  type SystemSettingsNamespace,
  type UserSettingsNamespace,
} from '@marinoscar/platform-api/settings';

import {
  APP_SYSTEM_SETTINGS_DEFAULTS,
  APP_SYSTEM_SETTINGS_EXTENSIONS,
  APP_SYSTEM_SETTINGS_NAMESPACES,
  APP_USER_SETTINGS_EXTENSIONS,
  APP_USER_SETTINGS_NAMESPACES,
} from '../../app-registrations/settings';
import { APP_RETENTION_POLICIES } from '../../app-registrations/jobs';

// The app's retention policies BEFORE anything reads RETENTION_SYSTEM_SETTINGS: the
// namespace is composed once, from the policies registered by then. None yet.
for (const policy of APP_RETENTION_POLICIES) registerRetentionPolicy(policy);

/** The platform's system namespaces this app registers ahead of its own. None yet. */
export const PLATFORM_SYSTEM_SETTINGS_NAMESPACES: readonly SystemSettingsNamespace[] = [];

/**
 * The platform's system namespaces appended AFTER the app's own, so the stored key order
 * of the `global` row stays the app's own namespaces first, then the platform's additions:
 * `maintenance` (the host slice, #46), `jobs`, `nodes` and `retention` (#49), `storage` (#50) `notifications` (#51) and `databaseBackup` (#52). Registered here, before `SettingsModule.forRoot()`
 * composes the request bodies, so the host core does not have to (its `forRoot()` registers
 * the namespace only when nothing did).
 */
export const APPENDED_PLATFORM_SYSTEM_SETTINGS_NAMESPACES: readonly SystemSettingsNamespace[] = [
  MAINTENANCE_SYSTEM_SETTINGS as SystemSettingsNamespace,
  // The jobs slice's `jobs` and `retention` and the nodes slice's `nodes` (#49), appended for the
  // same reason: `JobsModule.forRoot()` and `NodesModule.forRoot()` register them only when
  // nothing did, and the stored key order of the `global` row must stay append-only.
  JOBS_SYSTEM_SETTINGS as SystemSettingsNamespace,
  NODES_SYSTEM_SETTINGS as SystemSettingsNamespace,
  RETENTION_SYSTEM_SETTINGS as SystemSettingsNamespace,
  STORAGE_SYSTEM_SETTINGS as SystemSettingsNamespace,
  // The notifications slice's deployment policy (#51): browser toggle, per-event and per-channel switches.
  NOTIFICATIONS_SYSTEM_SETTINGS as SystemSettingsNamespace,
  // The db-backup slice's schedule, retention and restore policy (#52): `databaseBackup`.
  DATABASE_BACKUP_SYSTEM_SETTINGS as SystemSettingsNamespace,
];

/** The platform's optional user namespaces this app registers: the notification preferences (#51). */
export const PLATFORM_USER_SETTINGS_NAMESPACES: readonly UserSettingsNamespace[] = [
  NOTIFICATIONS_USER_SETTINGS as UserSettingsNamespace,
];

/** The final, ordered system list. */
export function assembleShellkeepSystemSettingsNamespaces(): SystemSettingsNamespace[] {
  return assembleSystemSettingsNamespaces({
    platform: PLATFORM_SYSTEM_SETTINGS_NAMESPACES,
    app: APP_SYSTEM_SETTINGS_NAMESPACES,
    appExtensions: APP_SYSTEM_SETTINGS_EXTENSIONS,
    appDefaults: APP_SYSTEM_SETTINGS_DEFAULTS,
  });
}

/** The final, ordered user list. */
export function assembleShellkeepUserSettingsNamespaces(): UserSettingsNamespace[] {
  return assembleUserSettingsNamespaces({
    platform: PLATFORM_USER_SETTINGS_NAMESPACES,
    app: APP_USER_SETTINGS_NAMESPACES,
    appExtensions: APP_USER_SETTINGS_EXTENSIONS,
  });
}

let registered = false;

/** Registers the namespaces. Idempotent per process (registering twice is `DUPLICATE_ID`). */
export function registerShellkeepSettings(): void {
  if (registered) return;
  registered = true;
  registerSystemSettingsNamespaces(assembleShellkeepSystemSettingsNamespaces());
  registerSystemSettingsNamespaces([...APPENDED_PLATFORM_SYSTEM_SETTINGS_NAMESPACES]);
  registerUserSettingsNamespaces(assembleShellkeepUserSettingsNamespaces());
}

registerShellkeepSettings();
