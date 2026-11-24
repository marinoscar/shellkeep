// =============================================================================
// Role and permission constants (issue #47)
// =============================================================================
//
// DERIVED, NOT DECLARED. The roles and permissions the platform's slices
// enforce are declared by `@marinoscar/platform-api` (`PLATFORM_ROLES` and the
// permission sets of the adopted slices); ShellKeep's own are declared in
// `app-registrations/permissions.ts`. This file only turns those declaration
// maps into the `ROLES` / `PERMISSIONS` constants the rest of the codebase
// imports, so a permission string can never drift from what the seed writes and
// what the guards check. It has no side effects: it registers nothing (that is
// `app-registrations/registrations.ts`).
//
// ROLE SEMANTICS CHANGED WITH THE PLATFORM. `admin` is the one SYSTEM role (held
// in `user_roles`); `org_admin`, `contributor` and `viewer` are ORG roles (held
// on a membership). `@Auth({ roles: ['admin'] })` therefore means "a deployment
// operator"; an org role never satisfies it.
// =============================================================================

import { permissionIds, roleIds } from '@marinoscar/platform-api/core';
import { ALLOWLIST_PERMISSIONS, USERS_PERMISSIONS } from '@marinoscar/platform-api/identity';
import { ORG_SETTINGS_PERMISSIONS, SETTINGS_PERMISSIONS } from '@marinoscar/platform-api/settings';
import { STORAGE_PERMISSIONS } from '@marinoscar/platform-api/storage';
import { PLATFORM_ROLES } from '@marinoscar/platform-api/manifest';

import { APP_PERMISSIONS, RUNBOOK_PERMISSIONS } from '../../app-registrations/permissions';

export const ROLES = roleIds(PLATFORM_ROLES);

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

// The adopted platform slices (`app-registrations/platform-slices.ts`): identity,
// settings and storage. Append the permission maps of a slice when it is adopted.
export const PERMISSIONS = {
  ...permissionIds(SETTINGS_PERMISSIONS),
  ...permissionIds(ORG_SETTINGS_PERMISSIONS),
  ...permissionIds(USERS_PERMISSIONS),
  ...permissionIds(ALLOWLIST_PERMISSIONS),
  ...permissionIds(STORAGE_PERMISSIONS),
  ...permissionIds(APP_PERMISSIONS),
  ...permissionIds(RUNBOOK_PERMISSIONS),
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** The org role a new membership gets (the platform's `defaultOrgRole`). */
export const DEFAULT_ROLE = ROLES.VIEWER;

// Type the platform's `@Auth({ roles, permissions })` with these ids, so a typo
// in a permission string fails the typecheck instead of failing closed at run time.
declare module '@marinoscar/platform-api/identity' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- module augmentation: widens the platform's id interface
  interface IdentityPermissionIds extends Record<PermissionName, true> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- module augmentation: widens the platform's id interface
  interface IdentityRoleIds extends Record<RoleName, true> {}
}
