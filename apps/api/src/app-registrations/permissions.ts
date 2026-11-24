// =============================================================================
// ShellKeep's own permissions (domain: server profiles and terminal sessions)
// =============================================================================
//
// APP-OWNED, and the only place the domain permissions are declared. They are
// registered with the platform's permission registry by `registrations.ts`
// (`registerPlatformPermissions`), so the seed catalog, the guards and
// `PERMISSIONS` all derive from this one list (base code never spells
// `servers:*` or `sessions:*`: `test/architecture/base-domain-boundary.spec.ts`).
//
// EVERY ONE IS ORG-SCOPED: a user holds it through the role on their membership
// of the current organization (`org_admin`, `contributor`, `viewer`), never
// through `user_roles`. The system `admin` role does not carry them; an
// administrator reaches them through the `org_admin` membership platform
// migration `0024_split_system_org_roles` gave them.
//
// The default grants are the ones the seed always had: server profiles and
// sessions are read, written and deleted by `org_admin` and `contributor`
// (the pre-split `admin` and `contributor`), and only read by `viewer`.
//
// Dependency-free of Nest on purpose: this file only declares.
// =============================================================================

import type { PermissionDeclaration } from '@marinoscar/platform-api/core';

const ORG_WRITERS = ['org_admin', 'contributor'] as const;
const ALL_ORG_ROLES = ['org_admin', 'contributor', 'viewer'] as const;

/** Constant-name to permission-id map, for `@Auth({ permissions: [...] })`. */
export const APP_PERMISSION_IDS = {
  // Server profiles
  SERVERS_READ: 'servers:read',
  SERVERS_WRITE: 'servers:write',
  SERVERS_DELETE: 'servers:delete',

  // Terminal sessions
  SESSIONS_READ: 'sessions:read',
  SESSIONS_WRITE: 'sessions:write',
  SESSIONS_DELETE: 'sessions:delete',
} as const;

/** ShellKeep's permissions, registered after the platform's. */
export const APP_PERMISSIONS = {
  SERVERS_READ: {
    id: APP_PERMISSION_IDS.SERVERS_READ,
    description: 'View server profiles',
    scope: 'org',
    defaultGrants: ALL_ORG_ROLES,
  },
  SERVERS_WRITE: {
    id: APP_PERMISSION_IDS.SERVERS_WRITE,
    description: 'Create and update server profiles',
    scope: 'org',
    defaultGrants: ORG_WRITERS,
  },
  SERVERS_DELETE: {
    id: APP_PERMISSION_IDS.SERVERS_DELETE,
    description: 'Delete server profiles',
    scope: 'org',
    defaultGrants: ORG_WRITERS,
  },
  SESSIONS_READ: {
    id: APP_PERMISSION_IDS.SESSIONS_READ,
    description: 'View terminal sessions',
    scope: 'org',
    defaultGrants: ALL_ORG_ROLES,
  },
  SESSIONS_WRITE: {
    id: APP_PERMISSION_IDS.SESSIONS_WRITE,
    description: 'Create and manage terminal sessions',
    scope: 'org',
    defaultGrants: ORG_WRITERS,
  },
  SESSIONS_DELETE: {
    id: APP_PERMISSION_IDS.SESSIONS_DELETE,
    description: 'Terminate terminal sessions',
    scope: 'org',
    defaultGrants: ORG_WRITERS,
  },
} as const satisfies Readonly<Record<string, PermissionDeclaration>>;

// -----------------------------------------------------------------------------
// Runbooks (issue #61)
// -----------------------------------------------------------------------------
//
// Reusable, versioned multi-step procedures run against fleets of servers.
// `runbooks:read` lets a member see definitions (which can contain sensitive commands)
// and preview targets; `runbooks:write` creates and versions them and manages their
// secret parameters; `runbooks:run` and `runbooks:approve` are enforced from the run
// engine (#62) and the approvals inbox. Only `org_admin` approves.
//
// Grouped apart from `APP_PERMISSIONS` so the registration reads as a feature set.
// -----------------------------------------------------------------------------

export const RUNBOOK_PERMISSIONS = {
  RUNBOOKS_READ: {
    id: 'runbooks:read',
    description: 'View runbooks, their versions, runs and logs',
    scope: 'org',
    defaultGrants: ALL_ORG_ROLES,
  },
  RUNBOOKS_WRITE: {
    id: 'runbooks:write',
    description: 'Create and version runbooks and manage their secret parameters',
    scope: 'org',
    defaultGrants: ORG_WRITERS,
  },
  RUNBOOKS_RUN: {
    id: 'runbooks:run',
    description: 'Start, cancel and retry runbook runs',
    scope: 'org',
    defaultGrants: ORG_WRITERS,
  },
  RUNBOOKS_APPROVE: {
    id: 'runbooks:approve',
    description: 'Decide runbook approval requests',
    scope: 'org',
    defaultGrants: ['org_admin'],
  },
} as const satisfies Readonly<Record<string, PermissionDeclaration>>;

/**
 * PLATFORM-ADOPTION-SHIM(#55): `ai:use`, mirrored from the platform's `AI_PERMISSIONS.AI_USE`.
 *
 * The telemetry assistant's routes name `ai:use` (the telemetry slice's host permission), so the
 * identity conformance rule "every permission a route names is registered" needs it declared even
 * though ShellKeep has not adopted the AI slice (the assistant itself is reported as disabled,
 * `platform/telemetry/telemetry-ai.adapter.ts`). It is registered on its own, not as the `ai`
 * slice, so no other AI permission is seeded. #55 adopts the slice (`ADOPTED_PLATFORM_SLICES`
 * gains `ai`) and deletes this declaration, which would otherwise be a `DUPLICATE_ID`.
 *
 * Same grants as the platform's: `org_admin` and `contributor`, never `viewer`.
 */
export const AI_USE_SHIM_PERMISSIONS = {
  AI_USE: {
    id: 'ai:use',
    description: 'Call AI models using a saved key',
    scope: 'org',
    defaultGrants: ORG_WRITERS,
  },
} as const satisfies Readonly<Record<string, PermissionDeclaration>>;
