// =============================================================================
// ShellKeep's shareable resource types (issue #71)
// =============================================================================
//
// `server_profile` and `runbook` become shareable through the platform sharing slice
// (`@marinoscar/platform-api/sharing`): the slice's `AccessPolicy` is the ONE decision point, so
// no service compares `userId` with an owner by hand. Terminal sessions are NOT a resource type:
// they stay personal, and each person who may connect opens their own tmux session.
//
// Registered at import time by `registrations.ts`, before the registries freeze. The type ids are
// PERMANENT once a grant exists (a grant row stores the string).
//
// HOW AN ACTION IS DECIDED (the slice's order): owner or owning-group role, then grants, then the
// minimum role of the action, with the RBAC permission of `actionPermissions` required ON TOP, even of
// the owner (so a Viewer member who holds a share still cannot open a session: they lack
// `sessions:write`). A denial answers 404, never 403, so a stranger learns nothing about existence.
//
// SERVER PROFILE roles, weakest first (`owner` is implicit):
//   viewer    sees the profile (name, host, tags, color); never a credential
//   operator  also tests the connection, opens sessions and runs runbooks on it
//   editor    also changes the profile and its host-key trust
// A member of the OWNING group holds `groupRoleMap[groupRole]`: admin -> editor, editor -> operator,
// viewer -> viewer. Nobody but the creating user is `owner` of a group-owned profile, and `owner` is the
// role `share` and `delete` need.
//
// CREDENTIALS NEVER MOVE. A grant carries a role, never a secret: the SSH secrets stay in the credential
// store under the user who saved them (`server_profiles.user_id`, purpose `ssh`) and are read server-side
// at connect time only (`ServerProfilesService.getDecryptedProfile`), never returned to anyone else.
//
// LINKS ARE OFF: `grantable.link: []` for both types, so `POST /api/grants/links` answers
// 422 ROLE_NOT_GRANTABLE. A server or a runbook is never reachable by a public URL.
//
// A `runbook` has no `connect` action: running one also needs `connect` on EACH target server, decided
// per target at enqueue time (`runbooks/target-resolver.service.ts`).
// =============================================================================

import type { Prisma } from '@prisma/client';
import {
  registerGroupOwnedResource,
  registerResourceType,
  type ResourceDescription,
  type ResourceOwnerInfo,
} from '@marinoscar/platform-api/sharing';

/** The resource type ids. Permanent. */
export const SERVER_PROFILE_RESOURCE = 'server_profile';
export const RUNBOOK_RESOURCE = 'runbook';

/** Roles of a shared server profile, weakest first. */
export const SERVER_PROFILE_ROLES = ['viewer', 'operator', 'editor'] as const;
export type ServerProfileRole = (typeof SERVER_PROFILE_ROLES)[number];

/** Roles of a shared runbook, weakest first. */
export const RUNBOOK_ROLES = ['viewer', 'runner', 'editor'] as const;
export type RunbookRole = (typeof RUNBOOK_ROLES)[number];

/** Stands in for the owner of a record nobody owns (an author deleted from a runbook): matches no principal. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

type Tx = Prisma.TransactionClient;

const asTx = (tx: unknown): Tx => tx as Tx;

let registered = false;

/** Registers both resource types and their group-ownership guards. Idempotent per process. */
export function registerShellkeepSharing(): void {
  if (registered) return;
  registered = true;

  // The group-deletion guard first (409 GROUP_OWNS_RESOURCES): `registerResourceType` would register
  // the same guard for a type whose ownership includes `group`, unless the app already did.
  const countServerProfiles = (groupId: string, tx: unknown) =>
    asTx(tx).serverProfile.count({ where: { ownerGroupId: groupId } });
  const countRunbooks = (groupId: string, tx: unknown) => asTx(tx).runbook.count({ where: { ownerGroupId: groupId } });
  registerGroupOwnedResource({ type: SERVER_PROFILE_RESOURCE, countOwnedByGroup: countServerProfiles });
  registerGroupOwnedResource({ type: RUNBOOK_RESOURCE, countOwnedByGroup: countRunbooks });

  registerResourceType<ServerProfileRole>({
    type: SERVER_PROFILE_RESOURCE,
    roles: SERVER_PROFILE_ROLES,
    actions: {
      read: 'viewer',
      // `test` opens a connection and reads the host key, sending the credential the owner stored.
      test: 'operator',
      connect: 'operator',
      run: 'operator',
      write: 'editor',
      share: 'owner',
      delete: 'owner',
    },
    actionPermissions: {
      connect: 'sessions:write',
      run: 'runbooks:run',
      write: 'servers:write',
      delete: 'servers:delete',
    },
    ownership: 'user_or_group',
    groupRoleMap: { admin: 'editor', editor: 'operator', viewer: 'viewer' },
    grantable: { link: [] },
    countOwnedByGroup: countServerProfiles,
    async loadOwners(ids, tx) {
      const rows = await asTx(tx).serverProfile.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, orgId: true, userId: true, ownerGroupId: true },
      });
      return new Map<string, ResourceOwnerInfo>(
        rows.map((row) => [
          row.id,
          {
            orgId: row.orgId,
            owner: row.ownerGroupId
              ? { kind: 'group', groupId: row.ownerGroupId }
              : { kind: 'user', userId: row.userId },
          },
        ]),
      );
    },
    async describe(ids, tx) {
      const rows = await asTx(tx).serverProfile.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, name: true },
      });
      return new Map<string, ResourceDescription>(rows.map((row) => [row.id, { title: row.name, path: '/servers' }]));
    },
  });

  registerResourceType<RunbookRole>({
    type: RUNBOOK_RESOURCE,
    roles: RUNBOOK_ROLES,
    actions: {
      read: 'viewer',
      run: 'runner',
      write: 'editor',
      share: 'owner',
    },
    actionPermissions: {
      run: 'runbooks:run',
      write: 'runbooks:write',
    },
    ownership: 'user_or_group',
    groupRoleMap: { admin: 'editor', editor: 'runner', viewer: 'viewer' },
    grantable: { link: [] },
    countOwnedByGroup: countRunbooks,
    async loadOwners(ids, tx) {
      const rows = await asTx(tx).runbook.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, orgId: true, ownerUserId: true, ownerGroupId: true },
      });
      return new Map<string, ResourceOwnerInfo>(
        rows.map((row) => [
          row.id,
          {
            orgId: row.orgId,
            owner: row.ownerGroupId
              ? { kind: 'group', groupId: row.ownerGroupId }
              : { kind: 'user', userId: row.ownerUserId ?? NOBODY },
          },
        ]),
      );
    },
    async describe(ids, tx) {
      const rows = await asTx(tx).runbook.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, name: true },
      });
      return new Map<string, ResourceDescription>(rows.map((row) => [row.id, { title: row.name, path: '/runbooks' }]));
    },
  });
}
