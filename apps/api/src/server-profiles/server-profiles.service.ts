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
import { AUDIT_SINK, runInOrg, type AuditSink, type Principal } from '@marinoscar/platform-api/core';
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
import { accessibleListWhere, capabilitiesOf, requireGroupOwnership } from '../platform/sharing/sharing-access';
import { recordAudit } from '../common/audit/record-audit';
import { CreateServerProfileDto } from './dto/create-server-profile.dto';
import { UpdateServerProfileDto } from './dto/update-server-profile.dto';
import { ServerProfilesQueryDto } from './dto/server-profiles-query.dto';
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

/** The connection-defining columns and the secrets: only the user who holds the credentials may change them. */
const CREDENTIAL_HOLDER_FIELDS = ['hostname', 'port', 'username', 'authMethod', 'password', 'privateKey', 'passphrase'] as const;

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
   * shared with them or with one of their groups (`filter`: `all`, `mine` or `shared`), with the
   * owner and what the caller may do. A profile the caller cannot see is not in the list.
   */
  async findAll(principal: Principal, query: ServerProfilesQueryDto) {
    const { page, pageSize, search, filter } = query;
    const me = await this.principalGroups.enrich(principal);
    const scope = this.scopeOf(me);
    const skip = (page - 1) * pageSize;

    const { rows, total, decisions } = await runInOrg(this.prisma, scope, async (tx) => {
      const visible = await accessibleListWhere({
        tx,
        principal: me,
        type: SERVER_PROFILE_RESOURCE,
        table: 'server_profiles',
        ownerUserField: 'userId',
        ownerGroupField: 'ownerGroupId',
        filter,
      });
      const where: Prisma.ServerProfileWhereInput = {
        AND: [
          visible as Prisma.ServerProfileWhereInput,
          ...(search
            ? [
                {
                  OR: [
                    { name: { contains: search, mode: 'insensitive' as const } },
                    { hostname: { contains: search, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
        ],
      };
      const found = await tx.serverProfile.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        include: OWNER_INCLUDE,
      });
      const count = await tx.serverProfile.count({ where });
      const map = await this.access.decideManyIn(
        tx,
        me,
        'read',
        found.map((row) => ({ type: SERVER_PROFILE_RESOURCE, id: row.id })),
      );
      return { rows: found, total: count, decisions: map };
    });

    // The credential flags are the holder's own business: read them only for rows the caller holds.
    const stored = await this.storedSecretsByProfile(me.userId);

    return {
      items: rows.map((row) =>
        this.toResponse(row, me, decisions.get(`${SERVER_PROFILE_RESOURCE}:${row.id}`) ?? null, stored.get(row.id)),
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** One profile the caller may read; 404 for anyone else, whether or not it exists. */
  async findOne(id: string, principal: Principal) {
    const me = await this.principalGroups.enrich(principal);
    const scope = this.scopeOf(me);
    const { row, decision } = await runInOrg(this.prisma, scope, async (tx) => {
      const allowed = await this.access.requireIn(tx, me, 'read', { type: SERVER_PROFILE_RESOURCE, id });
      const found = await tx.serverProfile.findFirst({ where: { id, orgId: scope.orgId }, include: OWNER_INCLUDE });
      if (!found) throw new NotFoundException(`Server profile with ID ${id} not found`);
      return { row: found, decision: allowed };
    });
    const stored = row.userId === me.userId ? await this.storedSecrets(row.userId, row.id) : undefined;
    return this.toResponse(row, me, decision, stored);
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
      const touched = CREDENTIAL_HOLDER_FIELDS.filter((field) => dto[field] !== undefined);
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

    // A different endpoint is a different server: what was trusted and probed for the old
    // one proves nothing about the new one, so it prompts again on the next connect.
    const endpointChanged =
      (dto.hostname !== undefined && dto.hostname !== existing.hostname) ||
      (dto.port !== undefined && dto.port !== existing.port);
    if (endpointChanged) {
      Object.assign(data, HOST_KEY_RESET, { facts: Prisma.DbNull, factsProbedAt: null });
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

    await this.audit('server_profile.update', scope, profile, endpointChanged ? { hostKeyReset: true } : {});
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
      data: HOST_KEY_RESET,
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
   * Transform a profile for API response. No secret, hint or ciphertext is ever returned. The `has*`
   * flags (which secrets the credential store holds) are the holder's only: a grantee never sees
   * them, so nothing about the credentials is observable through a share.
   */
  private toResponse(
    profile: ProfileRow,
    principal: Principal,
    decision: AccessDecision | null,
    stored: StoredSecrets | undefined,
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
      owner,
      access: {
        role,
        via: decision?.via ?? null,
        shared: !(role === 'owner' && !profile.ownerGroupId),
        can: capabilitiesOf(SERVER_PROFILE_RESOURCE, role, RESPONSE_ACTIONS, principal.permissions),
      },
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
