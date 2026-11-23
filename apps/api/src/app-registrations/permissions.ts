// =============================================================================
// ShellKeep's own permissions (domain: server profiles and terminal sessions)
// =============================================================================
//
// APP-OWNED, and the only place the domain permissions are declared. The base
// `common/constants/roles.constants.ts` and `prisma/seed.ts` derive from it, so
// base code never spells `servers:*` or `sessions:*`
// (`test/architecture/base-domain-boundary.spec.ts`).
//
// Dependency-free on purpose: `prisma/seed.ts` runs under ts-node with no Nest
// container. The declaration shape is the platform's (`PermissionDeclaration`
// of `@marinoscar/platform-api/core`); #47 swaps the local type for the
// package's and registers these in the platform manifest.
// =============================================================================

export type PermissionScope = 'system' | 'org';

export interface PermissionDeclaration<Id extends string = string> {
  /** `'<resource>:<action>'`: the exact string `@Auth({ permissions })` enforces. */
  readonly id: Id;
  /** Seeded into `permissions.description`. */
  readonly description: string;
  readonly scope: PermissionScope;
  /** Role names seeded into `role_permissions` for this permission. */
  readonly defaultGrants: readonly string[];
}

const ADMIN_CONTRIBUTOR = ['admin', 'contributor'] as const;
const ALL_ROLES = ['admin', 'contributor', 'viewer'] as const;

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

/** ShellKeep's permissions, seeded after the base ones. */
export const APP_PERMISSIONS: readonly PermissionDeclaration[] = [
  {
    id: APP_PERMISSION_IDS.SERVERS_READ,
    description: 'View server profiles',
    scope: 'org',
    defaultGrants: ALL_ROLES,
  },
  {
    id: APP_PERMISSION_IDS.SERVERS_WRITE,
    description: 'Create and update server profiles',
    scope: 'org',
    defaultGrants: ADMIN_CONTRIBUTOR,
  },
  {
    id: APP_PERMISSION_IDS.SERVERS_DELETE,
    description: 'Delete server profiles',
    scope: 'org',
    defaultGrants: ADMIN_CONTRIBUTOR,
  },
  {
    id: APP_PERMISSION_IDS.SESSIONS_READ,
    description: 'View terminal sessions',
    scope: 'org',
    defaultGrants: ALL_ROLES,
  },
  {
    id: APP_PERMISSION_IDS.SESSIONS_WRITE,
    description: 'Create and manage terminal sessions',
    scope: 'org',
    defaultGrants: ADMIN_CONTRIBUTOR,
  },
  {
    id: APP_PERMISSION_IDS.SESSIONS_DELETE,
    description: 'Terminate terminal sessions',
    scope: 'org',
    defaultGrants: ADMIN_CONTRIBUTOR,
  },
];
