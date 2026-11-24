// =============================================================================
// The `server-profiles` export source (issue #68)
// =============================================================================
//
// A user's own server profiles (and, on request, the ones shared with them), WITHOUT any secret.
//
//   - The columns are an ALLOWLIST and the query's `select` lists exactly them: the credential
//     columns (`encryptedPassword`, `encryptedPrivateKey`, `encryptedPassphrase`) and every
//     credential-store name (`profile.<id>.<field>`) are never read, so a redacted value never
//     leaves the database. `fingerprint` stays: it is public host-key material.
//   - The export never decrypts anything and never reads `UserCredentialsService`.
//   - Own profiles are the rows whose owner is the requester (a group-owned profile they created
//     is still theirs to export). `includeShared` adds the profiles other people shared with
//     them, decided by the sharing slice's `accessibleWhere` (`scope: 'shared'`), in each
//     organization the requester belongs to; a shared profile is metadata only, as the viewer role.
// =============================================================================

import { Prisma } from '@prisma/client';
import { accessibleWhere } from '@marinoscar/platform-api/sharing';
import type { ExportContext, ExportSource, ExportTable } from '@marinoscar/platform-api/exports';
import { z } from 'zod';

import { columnsOf, pagedRows } from '../../platform/exports/export-paging';
import { actingPrincipal } from '../../platform/sharing/sharing-access';
import { SERVER_PROFILE_RESOURCE } from '../../app-registrations/sharing';
import { APP_PERMISSION_IDS } from '../../app-registrations/permissions';

export const SERVER_PROFILES_EXPORT_SOURCE_ID = 'server-profiles';

/** The only columns that leave the server. Never add a credential column. */
export const SERVER_PROFILE_EXPORT_COLUMNS = columnsOf([
  ['id', 'Id', 'string'],
  ['name', 'Name', 'string'],
  ['hostname', 'Hostname', 'string'],
  ['port', 'Port', 'number'],
  ['username', 'Username', 'string'],
  ['authMethod', 'Auth method', 'string'],
  ['tags', 'Tags', 'string'],
  ['color', 'Color', 'string'],
  ['fingerprint', 'Host key fingerprint', 'string'],
  ['access', 'Access', 'string'],
  ['createdAt', 'Created at', 'datetime'],
  ['updatedAt', 'Updated at', 'datetime'],
]);

export const serverProfilesExportRequestSchema = z.object({ includeShared: z.boolean().optional() }).strict();
export type ServerProfilesExportRequest = z.infer<typeof serverProfilesExportRequestSchema>;

/** The shared profiles are decided per organization; this many ids at most are inlined (the slice's limit is 1,000). */
const SHARED_INLINE_LIMIT = 100_000;

/** The `where` of the profiles shared with the user (not owned by them), across their organizations. */
async function sharedProfilesWhere(ctx: ExportContext): Promise<Record<string, unknown> | null> {
  const db = ctx.db;
  const [memberships, groupRows] = await Promise.all([
    db.membership.findMany({ where: { userId: ctx.subjectId, status: 'active' }, select: { orgId: true } }),
    db.groupMember.findMany({ where: { userId: ctx.subjectId }, select: { groupId: true, orgId: true, role: true } }),
  ]);
  const groups = (groupRows as Array<{ groupId: string; orgId: string; role: string }>).map((g) => ({
    groupId: g.groupId,
    orgId: g.orgId,
    role: g.role,
  }));
  const orgIds = [...new Set([...(memberships as Array<{ orgId: string }>).map((m) => m.orgId), ...groups.map((g) => g.orgId)])];

  const perOrg: Array<Record<string, unknown>> = [];
  for (const orgId of orgIds) {
    const principal = {
      ...actingPrincipal({ userId: ctx.subjectId, orgId, permissions: [], roles: [] }),
      groups,
    };
    // As the list route decides it: what the requester's groups own, and what is granted to them or their groups.
    for (const scope of ['groups', 'shared'] as const) {
      const access = await accessibleWhere<Prisma.Sql>(principal, SERVER_PROFILE_RESOURCE, {
        tx: db,
        sqlKit: Prisma,
        ownerUserField: 'userId',
        ownerGroupField: 'ownerGroupId',
        orgField: 'orgId',
        scope,
        inlineLimit: SHARED_INLINE_LIMIT,
      });
      if (access.form !== 'where') throw new Error('The shared server profiles are too many to export in one request');
      perOrg.push(access.where);
    }
  }
  if (perOrg.length === 0) return null;
  return { AND: [{ OR: perOrg }, { NOT: { userId: ctx.subjectId } }] };
}

async function* collect(ctx: ExportContext, req: ServerProfilesExportRequest): AsyncGenerator<ExportTable> {
  const own = { userId: ctx.subjectId };
  const shared = req.includeShared === true ? await sharedProfilesWhere(ctx) : null;
  const where = shared ? { OR: [own, shared] } : own;
  yield {
    dataset: 'server_profiles',
    title: 'Server profiles',
    columns: SERVER_PROFILE_EXPORT_COLUMNS,
    rows: pagedRows(ctx, ctx.db.serverProfile, where, SERVER_PROFILE_EXPORT_COLUMNS, {
      keys: ['access'],
      select: ['userId'],
      compute: (record) => ({ access: record['userId'] === ctx.subjectId ? 'owner' : 'shared' }),
    }),
  };
}

export const SERVER_PROFILES_EXPORT_SOURCE: ExportSource<ServerProfilesExportRequest> = {
  id: SERVER_PROFILES_EXPORT_SOURCE_ID,
  scope: 'user',
  label: 'Server profiles',
  description:
    'Your SSH server profiles (name, host, port, user, authentication method, tags, color, host key fingerprint). Passwords, private keys and passphrases are never exported.',
  permission: APP_PERMISSION_IDS.SERVERS_READ,
  requestSchema: serverProfilesExportRequestSchema,
  formats: ['json', 'csv', 'xlsx'],
  columnTypes: ['string', 'number', 'datetime'],
  collect,
};
