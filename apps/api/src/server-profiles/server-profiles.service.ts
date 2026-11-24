import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AUDIT_SINK,
  runInOrg,
  type AuditSink,
  type Principal,
  type RlsTransactionClient,
} from '@marinoscar/platform-api/core';
import { UserCredentialsService } from '@marinoscar/platform-api/credentials';
import {
  AccessPolicy,
  GrantsService,
  PrincipalGroupsProvider,
  type AccessDecision,
} from '@marinoscar/platform-api/sharing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { OwnerScope } from '../common/types/owner-scope';
import { SERVER_PROFILE_RESOURCE } from '../app-registrations/sharing';
import {
  accessibleListWhere,
  actingPrincipal,
  capabilitiesOf,
  requireGroupOwnership,
  type AccessFilter,
} from '../platform/sharing/sharing-access';
import { recordAudit } from '../common/audit/record-audit';
import { CreateServerProfileDto } from './dto/create-server-profile.dto';
import { UpdateServerProfileDto } from './dto/update-server-profile.dto';
import {
  ServerProfilesQueryDto,
  type ServerHealth,
  type ServerHostKeyState,
  type ServerProfileSort,
  type ServerProfilesQuery,
} from './dto/server-profiles-query.dto';
import type { BulkTagsInput, BulkTagsResult } from './dto/bulk-tags.dto';
import {
  SSH_CREDENTIAL_PURPOSE,
  SSH_SECRET_FIELDS,
  parseSshCredentialName,
  sshCredentialName,
  type SshSecretField,
} from './ssh-credentials';
import { HostKeyError, type PresentedHostKey } from '../ssh/host-key.error';
import { sameFingerprint } from '../ssh/host-key';
import { ServerFactsService, readStoredFacts } from '../ssh/server-facts.service';
import type { ServerFacts } from '../ssh/server-facts';
import { SshConnectionFactory } from '../ssh/ssh-connection.factory';
import type { DecryptedServerProfile } from '../ssh/ssh-profile';
import { TrustHostKeyDto } from './dto/trust-host-key.dto';
import { TerminalWebhooksService } from '../terminal/webhooks/terminal-webhooks.service';

/** What a forgotten or reset endpoint leaves: no trusted key. */
const HOST_KEY_RESET = {
  fingerprint: null,
  hostKeyAlgorithm: null,
  hostKeyTrustedAt: null,
  hostKeyTrustedBy: null,
} as const;

/** The connection-defining columns: only the user who holds the credentials may CHANGE them. */
const CONNECTION_FIELDS = ['hostname', 'port', 'username', 'authMethod'] as const;
/** The secrets: only the user who holds the credentials may set or clear them. */
const SECRET_FIELDS = ['password', 'privateKey', 'passphrase'] as const;

/** The owner shown on a row, and the relations that name it. */
const OWNER_INCLUDE = {
  user: { select: { id: true, displayName: true, email: true } },
  ownerGroup: { select: { id: true, name: true } },
} satisfies Prisma.ServerProfileInclude;

type ProfileRow = Prisma.ServerProfileGetPayload<{ include: typeof OWNER_INCLUDE }>;

/** The actions a response says the caller may take (the UI hides the rest; the API still decides). */
const RESPONSE_ACTIONS = ['connect', 'test', 'write', 'share', 'delete'] as const;

/** What a `getDecryptedProfile` call is for: it decides the action checked and is recorded in the audit event. */
export type ProfileCredentialUse = 'connect' | 'test' | 'history' | 'run';

/** Cached facts older than this are probed again when a consumer asks (`getFacts`). */
export const FACTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface TestConnectionResult {
  success: boolean;
  error?: string;
  code?: 'HOST_KEY_UNKNOWN' | 'HOST_KEY_MISMATCH';
  presented?: PresentedHostKey;
  expected?: string | null;
}

export interface HostKeyScanResponse {
  presented: PresentedHostKey;
  trusted: { fingerprint: string; algorithm: string | null; trustedAt: Date | null } | null;
  matches: boolean;
}

export interface FactsResponse {
  facts: ServerFacts;
  factsProbedAt: Date;
}

/** A profile with its secrets decrypted, plus the display fields the terminal module reads. */
export type DecryptedProfile = DecryptedServerProfile & {
  name: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
};

function trustedKey(profile: { fingerprint: string | null; hostKeyAlgorithm: string | null; hostKeyTrustedAt: Date | null }) {
  return profile.fingerprint
    ? { fingerprint: profile.fingerprint, algorithm: profile.hostKeyAlgorithm, trustedAt: profile.hostKeyTrustedAt }
    : null;
}

/** What a forgotten key, a trusted key or a changed endpoint leaves of the last test: nothing. */
const LAST_TEST_RESET = { lastTestAt: null, lastTestOk: null, lastTestCode: null } as const;

/** `sort=lastSession` orders in memory; past this many matching profiles the rest are not ranked. */
const LAST_SESSION_SORT_CAP = 5000;

/** The org-scoped transaction of `runInOrg`. */
type Tx = RlsTransactionClient<PrismaService>;

/** The health column: the outcome of the last connection test, or `unknown` before the first. */
export function healthOf(profile: { lastTestAt: Date | null; lastTestOk: boolean | null }): ServerHealth {
  if (!profile.lastTestAt || profile.lastTestOk === null) return 'unknown';
  return profile.lastTestOk ? 'reachable' : 'unreachable';
}

/** The host-key column: `mismatch` while the last test was refused for a changed key. */
export function hostKeyStateOf(profile: { fingerprint: string | null; lastTestCode: string | null }): ServerHostKeyState {
  if (!profile.fingerprint) return 'untrusted';
  return profile.lastTestCode === 'HOST_KEY_MISMATCH' ? 'mismatch' : 'trusted';
}

/** `owner` narrows `filter`: `me` is `mine`, `shared` is `shared`, `group:<id>` is that group's. */
function listScope(query: ServerProfilesQuery): { filter: AccessFilter; ownerGroupId: string | null } {
  if (query.owner === 'me') return { filter: 'mine', ownerGroupId: null };
  if (query.owner === 'shared') return { filter: 'shared', ownerGroupId: null };
  if (query.owner?.startsWith('group:')) return { filter: query.filter, ownerGroupId: query.owner.slice('group:'.length) };
  return { filter: query.filter, ownerGroupId: null };
}

/** The list's `where`: the visible profiles, then every filter of the query (AND). */
export function listWhere(
  visible: Prisma.ServerProfileWhereInput,
  query: Pick<ServerProfilesQuery, 'q' | 'search' | 'tag' | 'health' | 'hostKey'>,
  ownerGroupId: string | null,
): Prisma.ServerProfileWhereInput {
  const and: Prisma.ServerProfileWhereInput[] = [visible];
  const text = query.q || query.search;
  if (text) {
    and.push({
      OR: [
        { name: { contains: text, mode: 'insensitive' } },
        { hostname: { contains: text, mode: 'insensitive' } },
        { username: { contains: text, mode: 'insensitive' } },
      ],
    });
  }
  if (query.tag && query.tag.length > 0) and.push({ tags: { hasEvery: query.tag } });
  if (ownerGroupId) and.push({ ownerGroupId });
  if (query.health === 'reachable') and.push({ lastTestAt: { not: null }, lastTestOk: true });
  if (query.health === 'unreachable') and.push({ lastTestAt: { not: null }, lastTestOk: false });
  if (query.health === 'unknown') and.push({ OR: [{ lastTestAt: null }, { lastTestOk: null }] });
  if (query.hostKey === 'untrusted') and.push({ fingerprint: null });
  if (query.hostKey === 'mismatch') and.push({ fingerprint: { not: null }, lastTestCode: 'HOST_KEY_MISMATCH' });
  if (query.hostKey === 'trusted') {
    and.push({
      fingerprint: { not: null },
      OR: [{ lastTestCode: null }, { lastTestCode: { not: 'HOST_KEY_MISMATCH' } }],
    });
  }
  return { AND: and };
}

/** The `orderBy` of every sort but `lastSession` (which is ordered in memory), always ending on the id. */
export function listOrderBy(
  sort: ServerProfileSort,
  order: 'asc' | 'desc' | undefined,
): Prisma.ServerProfileOrderByWithRelationInput[] {
  switch (sort) {
    case 'name':
      return [{ name: order ?? 'asc' }, { id: 'asc' }];
    case 'hostname':
      return [{ hostname: order ?? 'asc' }, { port: 'asc' }, { id: 'asc' }];
    case 'health':
      // asc: unreachable, then reachable, then never tested; desc: reachable first.
      return [
        { lastTestOk: { sort: order ?? 'asc', nulls: 'last' } },
        { lastTestAt: { sort: 'desc', nulls: 'last' } },
        { name: 'asc' },
        { id: 'asc' },
      ];
    default:
      return [{ updatedAt: order ?? 'desc' }, { id: 'asc' }];
  }
}

/** Which secret fields of a profile are stored, for the `has*` flags of a response. */
type StoredSecrets = ReadonlySet<SshSecretField>;

@Injectable()
export class ServerProfilesService {
  private readonly logger = new Logger(ServerProfilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
    private readonly credentials: UserCredentialsService,
    private readonly ssh: SshConnectionFactory,
    private readonly factsService: ServerFactsService,
    private readonly webhooks: TerminalWebhooksService,
    private readonly access: AccessPolicy,
    private readonly principalGroups: PrincipalGroupsProvider,
    private readonly grants: GrantsService,
  ) {}

  /** The organization the request acts in. A principal with none cannot reach an org-stamped table. */
  private orgOf(principal: Principal): string {
    if (!principal.activeOrgId) throw new ForbiddenException('No active organization');
    return principal.activeOrgId;
  }

  private scopeOf(principal: Principal): OwnerScope {
    return { userId: principal.userId, orgId: this.orgOf(principal) };
  }

  /**
   * The secret fields stored for each of the owner's profiles, from ONE presentation
   * read of the credential store (no secret, hint or ciphertext is fetched).
   */
  private async storedSecretsByProfile(userId: string): Promise<Map<string, Set<SshSecretField>>> {
    const byProfile = new Map<string, Set<SshSecretField>>();
    for (const info of await this.credentials.list(userId, SSH_CREDENTIAL_PURPOSE)) {
      const parsed = parseSshCredentialName(info.name);
      if (!parsed) continue;
      const fields = byProfile.get(parsed.profileId) ?? new Set<SshSecretField>();
      fields.add(parsed.field);
      byProfile.set(parsed.profileId, fields);
    }
    return byProfile;
  }

  private async storedSecrets(userId: string, profileId: string): Promise<StoredSecrets> {
    return (await this.storedSecretsByProfile(userId)).get(profileId) ?? new Set();
  }

  /** Stores, replaces or (for a blank value) removes one secret field of a profile. */
  private async writeSecret(
    userId: string,
    profileId: string,
    field: SshSecretField,
    value: string | null | undefined,
  ): Promise<void> {
    const name = sshCredentialName(profileId, field);
    if (value) {
      await this.credentials.setSecret(userId, SSH_CREDENTIAL_PURPOSE, name, value);
    } else {
      await this.credentials.deleteSecret(userId, SSH_CREDENTIAL_PURPOSE, name);
    }
  }

  /** Audit row: the hostname only, never a credential. */
  private audit(
    action: string,
    scope: OwnerScope,
    profile: { id: string; hostname: string },
    extra: Record<string, string | number | boolean | null> = {},
  ): Promise<void> {
    return recordAudit(this.auditSink, this.logger, {
      action,
      actorUserId: scope.userId,
      targetType: 'server_profile',
      targetId: profile.id,
      meta: { hostname: profile.hostname, ...extra },
    });
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * The profiles the caller may see: their own, those owned by a group they belong to and those
   * shared with them or with one of their groups (`filter`/`owner`), narrowed by the text search,
   * the tags (every one), the health and the host-key state, sorted by `sort`/`order`, with the
   * owner, what the caller may do, the last test and the caller's own last session on each. A
   * profile the caller cannot see is not in the list.
   */
  async findAll(principal: Principal, query: ServerProfilesQueryDto) {
    const { page, pageSize } = query;
    const me = await this.principalGroups.enrich(principal);
    const scope = this.scopeOf(me);
    const skip = (page - 1) * pageSize;
    const { filter, ownerGroupId } = listScope(query);

    const { rows, total, decisions, lastSessions } = await runInOrg(this.prisma, scope, async (tx) => {
      const visible = await accessibleListWhere({
        tx,
        principal: me,
        type: SERVER_PROFILE_RESOURCE,
        table: 'server_profiles',
        ownerUserField: 'userId',
        ownerGroupField: 'ownerGroupId',
        filter,
      });
      const where = listWhere(visible as Prisma.ServerProfileWhereInput, query, ownerGroupId);
      const count = await tx.serverProfile.count({ where });

      let found: ProfileRow[];
      if (query.sort === 'lastSession') {
        // The last session is an aggregate of another table: order the matching ids in memory (a
        // caller sees hundreds of profiles, not millions), then read the one page.
        const ids = (
          await tx.serverProfile.findMany({ where, select: { id: true, name: true }, take: LAST_SESSION_SORT_CAP })
        );
        const latest = await this.lastSessionsOf(tx, scope, ids.map((row) => row.id));
        const direction = query.order === 'asc' ? 1 : -1;
        const ordered = [...ids].sort((a, b) => {
          const at = latest.get(a.id)?.getTime();
          const bt = latest.get(b.id)?.getTime();
          if (at === undefined && bt === undefined) return a.name.localeCompare(b.name);
          if (at === undefined) return 1; // never used: always last
          if (bt === undefined) return -1;
          return at === bt ? a.name.localeCompare(b.name) : (at - bt) * direction;
        });
        const pageIds = ordered.slice(skip, skip + pageSize).map((row) => row.id);
        const byId = new Map(
          (await tx.serverProfile.findMany({ where: { id: { in: pageIds } }, include: OWNER_INCLUDE })).map((row) => [
            row.id,
            row,
          ]),
        );
        found = pageIds.map((id) => byId.get(id)).filter((row): row is ProfileRow => !!row);
      } else {
        found = await tx.serverProfile.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: listOrderBy(query.sort ?? 'updatedAt', query.order),
          include: OWNER_INCLUDE,
        });
      }
      const map = await this.access.decideManyIn(
        tx,
        me,
        'read',
        found.map((row) => ({ type: SERVER_PROFILE_RESOURCE, id: row.id })),
      );
      const sessions = await this.lastSessionsOf(tx, scope, found.map((row) => row.id));
      return { rows: found, total: count, decisions: map, lastSessions: sessions };
    });

    // The credential flags are the holder's own business: read them only for rows the caller holds.
    const stored = await this.storedSecretsByProfile(me.userId);

    return {
      items: rows.map((row) =>
        this.toResponse(
          row,
          me,
          decisions.get(`${SERVER_PROFILE_RESOURCE}:${row.id}`) ?? null,
          stored.get(row.id),
          lastSessions.get(row.id) ?? null,
        ),
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * When the CALLER last used each profile (their own sessions only: another user's activity on a
   * shared server is not theirs to see). One grouped read.
   */
  private async lastSessionsOf(tx: Tx, scope: OwnerScope, ids: string[]): Promise<Map<string, Date>> {
    if (ids.length === 0) return new Map();
    const grouped = await tx.terminalSession.groupBy({
      by: ['serverProfileId'],
      where: { userId: scope.userId, orgId: scope.orgId, serverProfileId: { in: ids } },
      _max: { lastActivityAt: true },
    });
    const latest = new Map<string, Date>();
    for (const group of grouped) {
      if (group._max.lastActivityAt) latest.set(group.serverProfileId, group._max.lastActivityAt);
    }
    return latest;
  }

  /** The distinct tags on the profiles the caller may see, sorted (the tag filter and autocomplete). */
  async listTags(principal: Principal): Promise<{ tags: string[] }> {
    const me = await this.principalGroups.enrich(principal);
    const scope = this.scopeOf(me);
    const rows = await runInOrg(this.prisma, scope, async (tx) => {
      const visible = await accessibleListWhere({
        tx,
        principal: me,
        type: SERVER_PROFILE_RESOURCE,
        table: 'server_profiles',
        ownerUserField: 'userId',
        ownerGroupField: 'ownerGroupId',
        filter: 'all',
      });
      return tx.serverProfile.findMany({
        where: { AND: [visible as Prisma.ServerProfileWhereInput, { NOT: { tags: { isEmpty: true } } }] },
        select: { tags: true },
      });
    });
    const tags = new Set<string>();
    for (const row of rows) for (const tag of row.tags) tags.add(tag);
    return { tags: [...tags].sort((a, b) => a.localeCompare(b)) };
  }

  /**
   * Adds and removes tags on many profiles. Each id needs `write` (AccessPolicy, decided per id in
   * one transaction); an id the caller may not change, or that does not exist, is reported in
   * `denied` and the rest still change. Every changed profile is audited (`server_profile.update`,
   * `bulk: true`) after the transaction commits.
   */
  async bulkTags(principal: Principal, input: BulkTagsInput): Promise<BulkTagsResult> {
    const me = await this.principalGroups.enrich(principal);
    const scope = this.scopeOf(me);
    const ids = [...new Set(input.ids)];
    const add = [...new Set(input.add)];
    const remove = new Set(input.remove);

    const { result, changed } = await runInOrg(this.prisma, scope, async (tx) => {
      const decisions = await this.access.decideManyIn(
        tx,
        me,
        'write',
        ids.map((id) => ({ type: SERVER_PROFILE_RESOURCE, id })),
      );
      const writable = ids.filter((id) => decisions.get(`${SERVER_PROFILE_RESOURCE}:${id}`)?.allowed);
      const rows = await tx.serverProfile.findMany({
        where: { id: { in: writable }, orgId: scope.orgId },
        select: { id: true, hostname: true, tags: true },
      });
      const out: BulkTagsResult = { updated: [], unchanged: [], denied: [] };
      const touched: { id: string; hostname: string }[] = [];
      const found = new Set(rows.map((row) => row.id));
      for (const id of ids) if (!found.has(id)) out.denied.push(id);
      for (const row of rows) {
        const next = [...row.tags.filter((tag) => !remove.has(tag))];
        for (const tag of add) if (!next.includes(tag)) next.push(tag);
        if (next.length === row.tags.length && next.every((tag, i) => tag === row.tags[i])) {
          out.unchanged.push(row.id);
          continue;
        }
        await tx.serverProfile.update({ where: { id: row.id }, data: { tags: next } });
        out.updated.push(row.id);
        touched.push(row);
      }
      return { result: out, changed: touched };
    });

    for (const profile of changed) {
      await this.audit('server_profile.update', scope, profile, {
        bulk: true,
        tagsAdded: add.join(',') || null,
        tagsRemoved: [...remove].join(',') || null,
      });
    }
    this.logger.log(
      `Bulk tags by user ${scope.userId}: ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.denied.length} denied`,
    );
    return result;
  }

  /** One profile the caller may read; 404 for anyone else, whether or not it exists. */
  async findOne(id: string, principal: Principal) {
    const me = await this.principalGroups.enrich(principal);
    const scope = this.scopeOf(me);
    const { row, decision, lastSessionAt } = await runInOrg(this.prisma, scope, async (tx) => {
      const allowed = await this.access.requireIn(tx, me, 'read', { type: SERVER_PROFILE_RESOURCE, id });
      const found = await tx.serverProfile.findFirst({ where: { id, orgId: scope.orgId }, include: OWNER_INCLUDE });
      if (!found) throw new NotFoundException(`Server profile with ID ${id} not found`);
      const sessions = await this.lastSessionsOf(tx, scope, [id]);
      return { row: found, decision: allowed, lastSessionAt: sessions.get(id) ?? null };
    });
    const stored = row.userId === me.userId ? await this.storedSecrets(row.userId, row.id) : undefined;
    return this.toResponse(row, me, decision, stored, lastSessionAt);
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /**
   * Create a new server profile. `ownerGroupId` makes a group the owner (the creator must be an
   * admin or editor of that group); the creator still holds the SSH secrets in their own credential
   * store, which is where a connection reads them.
   */
  async create(principal: Principal, dto: CreateServerProfileDto) {
    const scope = this.scopeOf(principal);
    if (dto.ownerGroupId) {
      await requireGroupOwnership(this.principalGroups, principal, dto.ownerGroupId, 'a server profile');
    }

    const data: Prisma.ServerProfileUncheckedCreateInput = {
      userId: scope.userId,
      orgId: scope.orgId,
      ownerGroupId: dto.ownerGroupId ?? null,
      name: dto.name,
      hostname: dto.hostname,
      port: dto.port,
      username: dto.username,
      authMethod: dto.authMethod,
      tags: dto.tags || [],
      color: dto.color || 'default',
      aiOutputSharing: dto.aiOutputSharing ?? true,
    };

    const profile = await this.prisma.serverProfile.create({ data });

    // The secrets go to the credential store; a failure there must not leave a
    // profile that claims an auth method it has no secret for.
    try {
      await this.writeSecret(scope.userId, profile.id, 'password', dto.password);
      await this.writeSecret(scope.userId, profile.id, 'private_key', dto.privateKey);
      await this.writeSecret(scope.userId, profile.id, 'passphrase', dto.passphrase);
    } catch (error) {
      await this.removeSecrets(scope.userId, profile.id);
      await this.prisma.serverProfile.delete({ where: { id: profile.id } });
      throw error;
    }

    await this.audit('server_profile.create', scope, profile, dto.ownerGroupId ? { ownerGroupId: dto.ownerGroupId } : {});
    this.logger.log(`Server profile "${dto.name}" created by user ${scope.userId}`);

    return this.findOne(profile.id, principal);
  }

  /**
   * Update an existing server profile. A grantee with the `editor` role may change the name, tags,
   * color and the host-key trust; the connection (hostname, port, username, auth method) and the
   * secrets can be changed only by the user who holds the credentials, so a share can never
   * redirect a stored credential to another host.
   */
  async update(id: string, principal: Principal, dto: UpdateServerProfileDto) {
    const scope = this.scopeOf(principal);
    const existing = await this.loadFor(id, principal, 'write');

    if (existing.userId !== principal.userId) {
      // A form sends the whole connection back with every save: naming a field with its CURRENT value
      // is not a change.
      const touched: string[] = [
        ...CONNECTION_FIELDS.filter((field) => dto[field] !== undefined && dto[field] !== existing[field]),
        ...SECRET_FIELDS.filter((field) => dto[field] !== undefined),
      ];
      if (touched.length > 0) {
        throw new ForbiddenException({
          code: 'SERVER_PROFILE_CREDENTIAL_HOLDER_ONLY',
          message: 'Only the user who saved the credentials can change the connection or the secrets of this profile',
          details: { fields: touched },
        });
      }
    }

    const data: Prisma.ServerProfileUncheckedUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.hostname !== undefined) data.hostname = dto.hostname;
    if (dto.port !== undefined) data.port = dto.port;
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.authMethod !== undefined) data.authMethod = dto.authMethod;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.aiOutputSharing !== undefined) data.aiOutputSharing = dto.aiOutputSharing;

    // A different endpoint is a different server: what was trusted and probed for the old
    // one proves nothing about the new one, so it prompts again on the next connect.
    const endpointChanged =
      (dto.hostname !== undefined && dto.hostname !== existing.hostname) ||
      (dto.port !== undefined && dto.port !== existing.port);
    if (endpointChanged) {
      Object.assign(data, HOST_KEY_RESET, LAST_TEST_RESET, { facts: Prisma.DbNull, factsProbedAt: null });
    }

    // An omitted secret keeps the stored one; a blank value removes it.
    if (dto.password !== undefined) {
      await this.writeSecret(existing.userId, id, 'password', dto.password);
    }
    if (dto.privateKey !== undefined) {
      await this.writeSecret(existing.userId, id, 'private_key', dto.privateKey);
    }
    if (dto.passphrase !== undefined) {
      await this.writeSecret(existing.userId, id, 'passphrase', dto.passphrase);
    }

    const profile = await this.prisma.serverProfile.update({
      where: { id },
      data,
    });

    await this.audit('server_profile.update', scope, profile, {
      ...(endpointChanged ? { hostKeyReset: true } : {}),
      // The hard AI switch is a security setting: its change is on the record.
      ...(dto.aiOutputSharing !== undefined && dto.aiOutputSharing !== existing.aiOutputSharing
        ? { aiOutputSharing: dto.aiOutputSharing }
        : {}),
    });
    this.logger.log(`Server profile "${profile.name}" updated by user ${scope.userId}`);

    return this.findOne(id, principal);
  }

  /**
   * Delete a server profile (only its owner: `delete` needs the `owner` role). The grants on it go in
   * the same transaction, so no share outlives it; the stored secrets go afterwards.
   */
  async remove(id: string, principal: Principal) {
    const scope = this.scopeOf(principal);
    const me = await this.principalGroups.enrich(principal);
    const existing = await runInOrg(this.prisma, scope, async (tx) => {
      await this.access.requireIn(tx, me, 'delete', { type: SERVER_PROFILE_RESOURCE, id });
      const found = await tx.serverProfile.findFirst({ where: { id, orgId: scope.orgId } });
      if (!found) throw new NotFoundException(`Server profile with ID ${id} not found`);
      await this.grants.deleteForResources(tx, SERVER_PROFILE_RESOURCE, [id]);
      await tx.serverProfile.delete({ where: { id } });
      return found;
    });
    await this.removeSecrets(existing.userId, id);

    await this.audit('server_profile.delete', scope, existing);
    this.logger.log(`Server profile "${existing.name}" deleted by user ${scope.userId}`);
  }

  /** Removes every stored secret of a profile (idempotent). */
  private async removeSecrets(userId: string, profileId: string): Promise<void> {
    for (const field of SSH_SECRET_FIELDS) {
      await this.credentials.deleteSecret(
        userId,
        SSH_CREDENTIAL_PURPOSE,
        sshCredentialName(profileId, field),
      );
    }
  }

  /**
   * Test SSH connection using stored credentials. The host key is verified first: an
   * unknown or changed key answers `success: false` with its code and both fingerprints,
   * and no credential was sent. A successful test also probes the server's facts.
   */
  async testConnection(id: string, principal: Principal): Promise<TestConnectionResult> {
    const scope = this.scopeOf(principal);
    const profile = await this.getDecryptedProfile(id, principal, 'test');

    let result: TestConnectionResult;
    try {
      const client = await this.ssh.open(profile, { purpose: 'test' });
      try {
        await this.factsService.tryProbeClient(client, profile);
      } finally {
        client.end();
      }
      result = { success: true };
    } catch (error) {
      if (error instanceof HostKeyError) {
        result = {
          success: false,
          error: error.message,
          code: error.code,
          presented: error.presented,
          expected: error.expected ?? null,
        };
      } else {
        result = { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    // The outcome feeds the health column and the Home dashboard (#79). A host-key refusal stopped
    // the test before the login, so it proves neither way: `lastTestOk` stays null ("unknown") and
    // the code drives the host-key column. A trust or an edit of the endpoint clears it.
    await this.prisma.serverProfile.updateMany({
      where: { id, orgId: scope.orgId },
      data: {
        lastTestAt: new Date(),
        lastTestOk: result.code ? null : result.success,
        lastTestCode: result.code ?? null,
      },
    });
    // The profile id and the outcome only: no hostname, user or error text in the log.
    this.logger.log(`Connection test for profile ${id}: ${result.success ? 'ok' : (result.code ?? 'failed')}`);

    await this.audit('server_profile.test', scope, profile, {
      success: result.success,
      ...(result.code ? { code: result.code } : {}),
    });
    return result;
  }

  /**
   * Reads the key the server presents, sending no credential, and compares it with the
   * trusted one. Nothing is stored.
   */
  async scanHostKey(id: string, principal: Principal): Promise<HostKeyScanResponse> {
    const profile = await this.loadFor(id, principal, 'test');
    const presented = await this.scan(profile);
    return {
      presented,
      trusted: trustedKey(profile),
      matches: !!profile.fingerprint && sameFingerprint(profile.fingerprint, presented.fingerprint),
    };
  }

  /**
   * Trusts the key the server presents now, provided it is the fingerprint the user
   * confirmed (409 `HOST_KEY_CHANGED_DURING_TRUST` otherwise). Replacing a different
   * trusted key additionally needs `confirmHostname` equal to the profile hostname.
   */
  async trustHostKey(id: string, principal: Principal, dto: TrustHostKeyDto) {
    const scope = this.scopeOf(principal);
    const profile = await this.loadFor(id, principal, 'write');

    const replacing = !!profile.fingerprint && !sameFingerprint(profile.fingerprint, dto.fingerprint);
    if (replacing && dto.confirmHostname !== profile.hostname) {
      throw new BadRequestException({
        code: 'HOST_KEY_CONFIRMATION_REQUIRED',
        message: 'Replacing the trusted host key requires the profile hostname as confirmation',
        details: { field: 'confirmHostname' },
      });
    }

    const presented = await this.scan(profile);
    if (!sameFingerprint(presented.fingerprint, dto.fingerprint)) {
      throw new ConflictException({
        code: 'HOST_KEY_CHANGED_DURING_TRUST',
        message: 'The server now presents a different host key than the one you verified',
        details: { presented, confirmed: dto.fingerprint },
      });
    }

    await this.prisma.serverProfile.updateMany({
      where: { id, orgId: scope.orgId },
      data: {
        fingerprint: presented.fingerprint,
        hostKeyAlgorithm: presented.algorithm,
        hostKeyTrustedAt: new Date(),
        hostKeyTrustedBy: scope.userId,
        // The refusal the last test recorded is answered: the next test tells the health again.
        ...(profile.lastTestCode ? LAST_TEST_RESET : {}),
      },
    });

    if (replacing) {
      await this.audit('server_profile.host_key_replaced', scope, profile, {
        oldFingerprint: profile.fingerprint,
        newFingerprint: presented.fingerprint,
        algorithm: presented.algorithm,
      });
      // A different trusted key was replaced: tell the credential holder's webhook endpoints, after
      // the update committed and outside any transaction (#54). Fingerprints only; never throws.
      await this.webhooks.hostKeyChanged(
        { userId: profile.userId, orgId: scope.orgId },
        {
          serverProfileId: profile.id,
          previousFingerprint: profile.fingerprint as string,
          presentedFingerprint: presented.fingerprint,
        },
      );
    } else {
      await this.audit('server_profile.host_key_trusted', scope, profile, {
        fingerprint: presented.fingerprint,
        algorithm: presented.algorithm,
      });
    }
    this.logger.log(`Host key ${replacing ? 'replaced' : 'trusted'} for profile ${id} by user ${scope.userId}`);

    // The key is trusted now, so the probe can connect; best effort, never fails the trust.
    try {
      await this.factsService.probe(await this.getDecryptedProfile(id, principal, 'test'));
    } catch (error) {
      this.logger.warn(`Facts probe after trust failed for profile ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return this.findOne(id, principal);
  }

  /** Forgets the trusted key; the next connect prompts again. The facts describe the server, not the key, so they stay. */
  async forgetHostKey(id: string, principal: Principal) {
    const scope = this.scopeOf(principal);
    const profile = await this.loadFor(id, principal, 'write');
    await this.prisma.serverProfile.updateMany({
      where: { id, orgId: scope.orgId },
      data: { ...HOST_KEY_RESET, ...(profile.lastTestCode ? LAST_TEST_RESET : {}) },
    });
    await this.audit('server_profile.host_key_forgotten', scope, profile, {
      fingerprint: profile.fingerprint ?? null,
    });
    return this.findOne(id, principal);
  }

  /** Forces a facts probe. Rejects with the host-key refusal when the key is not trusted. */
  async refreshFacts(id: string, principal: Principal): Promise<FactsResponse> {
    const profile = await this.getDecryptedProfile(id, principal, 'test');
    const facts = await this.factsService.probe(profile);
    return { facts, factsProbedAt: new Date() };
  }

  /**
   * The server's facts: the cached ones while they are younger than `maxAgeMs`, else a fresh
   * probe. A failing probe falls back to the cached facts (or null); it never throws.
   */
  async getFacts(id: string, principal: Principal, options: { maxAgeMs?: number } = {}): Promise<ServerFacts | null> {
    const maxAgeMs = options.maxAgeMs ?? FACTS_MAX_AGE_MS;
    const row = await this.loadFor(id, principal, 'test');
    const cached = readStoredFacts(row.facts);
    if (cached && row.factsProbedAt && Date.now() - row.factsProbedAt.getTime() < maxAgeMs) return cached;
    try {
      return await this.factsService.probe(await this.getDecryptedProfile(id, principal, 'test'));
    } catch (error) {
      this.logger.warn(`Facts probe failed for profile ${id}: ${error instanceof Error ? error.message : String(error)}`);
      return cached;
    }
  }

  /**
   * The profile row, once the caller may take `action` on it. The decision is `AccessPolicy`'s: a
   * profile the caller may not even read is a 404 (the same as a missing one), one they may read but
   * not act on is a 404 too, and a missing RBAC permission is a 403 naming it.
   */
  private async loadFor(id: string, principal: Principal, action: 'connect' | 'test' | 'write') {
    const scope = this.scopeOf(principal);
    // The caller's groups are read fresh: the principal the guard built may be a few seconds old.
    await this.access.require(await this.principalGroups.enrich(principal), action, { type: SERVER_PROFILE_RESOURCE, id });
    const profile = await this.prisma.serverProfile.findFirst({ where: { id, orgId: scope.orgId } });
    if (!profile) {
      throw new NotFoundException(`Server profile with ID ${id} not found`);
    }
    return profile;
  }

  /** Throws unless the caller may open a connection to the profile (404 otherwise). No credential is read. */
  async assertCanConnect(id: string, principal: Principal): Promise<void> {
    await this.access.require(await this.principalGroups.enrich(principal), 'connect', { type: SERVER_PROFILE_RESOURCE, id });
  }

  /** Scans the server; an unreachable one is a 502, never a credential-bearing error. */
  private async scan(profile: { id: string; hostname: string; port: number; username: string }): Promise<PresentedHostKey> {
    try {
      return await this.ssh.scan(profile);
    } catch (error) {
      throw new BadGatewayException({
        code: 'SSH_HOST_UNREACHABLE',
        message: `Could not read the host key: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Get a profile with decrypted credentials (for internal use by the terminal module and the run
   * engine). The caller must be allowed `connect` (or `test` for a connection test): the secrets are
   * read from the credential store of the user who SAVED them (`profile.userId`), which is not the
   * caller's when the profile is shared. Using a credential the caller does not own is audited
   * (`server_profile.connect_as_grantee`: actor, profile, holder, purpose; never a secret).
   */
  async getDecryptedProfile(
    id: string,
    principal: Principal,
    use: ProfileCredentialUse = 'connect',
  ): Promise<DecryptedProfile> {
    const scope = this.scopeOf(principal);
    const profile = await this.loadFor(id, principal, use === 'test' ? 'test' : 'connect');

    // Server-side only, at the moment of connect: the plaintext reaches the SSH
    // client and nothing else (no log, response, span or job payload).
    const secret = (field: SshSecretField) =>
      this.credentials.getSecret(
        profile.userId,
        SSH_CREDENTIAL_PURPOSE,
        sshCredentialName(profile.id, field),
      );

    const decrypted: DecryptedProfile = {
      id: profile.id,
      userId: profile.userId,
      orgId: profile.orgId,
      name: profile.name,
      hostname: profile.hostname,
      port: profile.port,
      username: profile.username,
      authMethod: profile.authMethod,
      tags: profile.tags,
      fingerprint: profile.fingerprint,
      hostKeyAlgorithm: profile.hostKeyAlgorithm,
      password: await secret('password'),
      privateKey: await secret('private_key'),
      passphrase: await secret('passphrase'),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };

    if (profile.userId !== principal.userId) {
      await recordAudit(this.auditSink, this.logger, {
        action: 'server_profile.connect_as_grantee',
        actorUserId: principal.userId,
        targetType: 'server_profile',
        targetId: profile.id,
        meta: {
          ownerUserId: profile.userId,
          ownerGroupId: profile.ownerGroupId,
          purpose: use,
          hostname: profile.hostname,
          orgId: scope.orgId,
        },
      });
    }
    return decrypted;
  }

  /**
   * {@link getDecryptedProfile} for a caller that holds only the user and organization of an
   * existing session (the history reader and the AI context): the session's own existence proves
   * its owner passed the route's RBAC check, and `connect` is still decided by AccessPolicy NOW,
   * so a revoked share stops them.
   */
  getDecryptedProfileForSession(id: string, scope: OwnerScope, use: ProfileCredentialUse): Promise<DecryptedProfile> {
    return this.getDecryptedProfile(
      id,
      actingPrincipal({ userId: scope.userId, orgId: scope.orgId, permissions: ['sessions:write'], roles: [] }),
      use,
    );
  }

  /**
   * Transform a profile for API response. No secret, hint or ciphertext is ever returned. The `has*`
   * flags (which secrets the credential store holds) are the holder's only: a grantee never sees
   * them, so nothing about the credentials is observable through a share.
   */
  private toResponse(
    profile: ProfileRow,
    principal: Principal,
    decision: AccessDecision | null,
    stored: StoredSecrets | undefined,
    lastSessionAt: Date | null,
  ) {
    const holder = profile.userId === principal.userId;
    const role = decision?.role ?? null;
    const owner = profile.ownerGroup
      ? { kind: 'group' as const, id: profile.ownerGroup.id, name: profile.ownerGroup.name }
      : {
          kind: 'user' as const,
          id: profile.user.id,
          name: profile.user.displayName ?? profile.user.email,
        };
    return {
      id: profile.id,
      userId: profile.userId,
      name: profile.name,
      hostname: profile.hostname,
      port: profile.port,
      username: profile.username,
      authMethod: profile.authMethod,
      tags: profile.tags,
      color: profile.color,
      aiOutputSharing: profile.aiOutputSharing ?? true,
      ...(holder
        ? {
            hasPassword: stored?.has('password') ?? false,
            hasPrivateKey: stored?.has('private_key') ?? false,
            hasPassphrase: stored?.has('passphrase') ?? false,
          }
        : {}),
      fingerprint: profile.fingerprint ?? null,
      hostKeyAlgorithm: profile.hostKeyAlgorithm ?? null,
      hostKeyTrustedAt: profile.hostKeyTrustedAt ?? null,
      facts: readStoredFacts(profile.facts),
      factsProbedAt: profile.factsProbedAt ?? null,
      hostKeyState: hostKeyStateOf(profile),
      health: healthOf(profile),
      lastTestAt: profile.lastTestAt ?? null,
      lastTestOk: profile.lastTestOk ?? null,
      lastSessionAt,
      owner,
      access: {
        role,
        via: decision?.via ?? null,
        shared: !(role === 'owner' && !profile.ownerGroupId),
        // Whether the caller saved the credentials: only they may change the connection or the secrets.
        credentialHolder: holder,
        can: capabilitiesOf(SERVER_PROFILE_RESOURCE, role, RESPONSE_ACTIONS, principal.permissions),
      },
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
