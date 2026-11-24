// =============================================================================
// Helpers a feature module uses to apply the sharing slice (issue #71)
// =============================================================================
//
// Generic on purpose: nothing here names a ShellKeep table, so the file stays base code
// (`platform/`). A feature passes its own resource type id, Prisma field names and table.
//
//   actingPrincipal         the `Principal` AccessPolicy needs, for a caller that holds only the
//                           ids and permissions of its own authentication (a WebSocket)
//   accessibleListWhere     the Prisma `where` of "the records I may see" (owned, my groups', shared
//                           with me), in ONE org-scoped transaction
//   capabilitiesOf          what a given effective role may do, from the registered type's own rules
//
// The decision itself is always `AccessPolicy`: these helpers only shape a list and a response.
// =============================================================================

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Principal } from '@marinoscar/platform-api/core';
import {
  accessibleWhere,
  groupRoleAtLeast,
  resourceTypeRegistry,
  type AccessibleWhere,
  type PrincipalGroupsProvider,
} from '@marinoscar/platform-api/sharing';

/** A list filter: everything I can see, only what I own, only what is shared with me. */
export type AccessFilter = 'all' | 'mine' | 'shared';

/**
 * A `Principal` for a caller that authenticated without the HTTP guard (a WebSocket
 * resolves the token itself). `AccessPolicy` reads the user, the active organization and the
 * permissions; it looks the caller's groups up itself.
 */
export function actingPrincipal(input: {
  userId: string;
  orgId: string;
  permissions: readonly string[];
  roles: readonly string[];
}): Principal {
  return {
    kind: 'user',
    userId: input.userId,
    email: '',
    credential: 'session',
    roles: input.roles,
    permissions: input.permissions,
    activeOrgId: input.orgId,
  };
}

export interface AccessListOptions {
  /** The transaction of `runInOrg`, scoped to the caller's organization. */
  tx: unknown;
  /** The caller, enriched with its groups (`PrincipalGroupsProvider.enrich`). */
  principal: Principal;
  /** The registered resource type id. */
  type: string;
  /** The SQL table, for the rare EXISTS form (more than 1,000 shared records). A plain identifier. */
  table: string;
  /** The Prisma field of the owning user (`userId`, `ownerUserId`). */
  ownerUserField: string;
  /** The Prisma field of the owning group. */
  ownerGroupField: string;
  filter: AccessFilter;
}

/** The ids behind an EXISTS-form fragment (above the inline limit the slice hands back SQL, not a `where`). */
async function resolveForm(
  tx: Prisma.TransactionClient,
  access: AccessibleWhere<Prisma.Sql>,
  table: string,
): Promise<Record<string, unknown>> {
  if (access.form === 'where') return access.where;
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Not a table name: ${table}`);
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT r.id FROM ${Prisma.raw(`"${table}"`)} r WHERE ${access.sql}`,
  );
  return { id: { in: rows.map((row) => row.id) } };
}

/**
 * The records the caller may see, as a Prisma `where` for the table named by `options`.
 *
 * - `mine`: owned by the caller as a USER (a record owned by a group is not "mine" even when the
 *   caller created it: its owner is the group, as `AccessPolicy` decides).
 * - `shared`: owned by one of the caller's groups, or shared with them (or with a group of theirs)
 *   through a grant, never the caller's own records.
 * - `all`: both.
 */
export async function accessibleListWhere(options: AccessListOptions): Promise<Record<string, unknown>> {
  const { principal, type, table, ownerUserField, ownerGroupField, filter } = options;
  const tx = options.tx as Prisma.TransactionClient;
  const mine = { [ownerUserField]: principal.userId, [ownerGroupField]: null };
  if (filter === 'mine') return mine;

  const base = { tx: options.tx, sqlKit: Prisma, ownerUserField, ownerGroupField, orgField: 'orgId' } as const;
  const [viaGroups, viaGrants] = await Promise.all([
    accessibleWhere<Prisma.Sql>(principal, type, { ...base, scope: 'groups' }),
    accessibleWhere<Prisma.Sql>(principal, type, { ...base, scope: 'shared' }),
  ]);
  const sharedWhere = {
    OR: [await resolveForm(tx, viaGroups, table), await resolveForm(tx, viaGrants, table)],
  };
  if (filter === 'shared') return { AND: [sharedWhere, { NOT: mine }] };
  return { OR: [{ AND: [{ orgId: principal.activeOrgId }, mine] }, sharedWhere] };
}

/** Whether `role` (an effective role, `'owner'` included) reaches the minimum role of `action`, and the RBAC permission it needs. */
export function roleCan(
  type: string,
  role: string | null,
  action: string,
  permissions: readonly string[],
): boolean {
  if (role === null) return false;
  const def = resourceTypeRegistry.require(type);
  const required = def.actions[action];
  if (required === undefined) return false;
  const needed = def.actionPermissions?.[action];
  if (needed !== undefined && !permissions.includes(needed)) return false;
  const rank = (value: string): number => (value === 'owner' ? def.roles.length + 1 : def.roles.indexOf(value) + 1);
  return rank(role) >= rank(required) && rank(role) > 0;
}

/** `roleCan` for each action in `actions`: `{ connect: true, write: false, ... }`. */
export function capabilitiesOf<A extends string>(
  type: string,
  role: string | null,
  actions: readonly A[],
  permissions: readonly string[],
): Record<A, boolean> {
  return Object.fromEntries(actions.map((action) => [action, roleCan(type, role, action, permissions)])) as Record<A, boolean>;
}

/**
 * The caller may make `groupId` own a record only as an admin or editor of it. A group the caller is
 * not in answers 404 (it is not theirs to know), a viewer 403 `GROUP_ROLE_INSUFFICIENT`.
 */
export async function requireGroupOwnership(
  principalGroups: PrincipalGroupsProvider,
  principal: Principal,
  groupId: string,
  what: string,
): Promise<void> {
  const role = await principalGroups.groupRoleFor(principal, groupId);
  if (role === null) throw new NotFoundException('Group not found');
  if (!groupRoleAtLeast(role, 'editor')) {
    throw new ForbiddenException({
      code: 'GROUP_ROLE_INSUFFICIENT',
      message: `Only a group admin or editor can create ${what} for the group`,
    });
  }
}
