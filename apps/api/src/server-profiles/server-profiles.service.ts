import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AUDIT_SINK, type AuditSink } from '@marinoscar/platform-api/core';
import { UserCredentialsService } from '@marinoscar/platform-api/credentials';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { OwnerScope } from '../common/types/owner-scope';
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

/** What a forgotten or reset endpoint leaves: no trusted key. */
const HOST_KEY_RESET = {
  fingerprint: null,
  hostKeyAlgorithm: null,
  hostKeyTrustedAt: null,
  hostKeyTrustedBy: null,
} as const;

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
  ) {}

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

  /**
   * List server profiles for a user with pagination and search
   */
  async findAll(scope: OwnerScope, query: ServerProfilesQueryDto) {
    const { page, pageSize, search } = query;
    const skip = (page - 1) * pageSize;

    const where: any = { userId: scope.userId, orgId: scope.orgId };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { hostname: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.serverProfile.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.serverProfile.count({ where }),
    ]);

    const stored = await this.storedSecretsByProfile(scope.userId);

    return {
      items: items.map((item) => this.toResponse(item, stored.get(item.id) ?? new Set())),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get a single server profile by ID with owner check
   */
  async findOne(id: string, scope: OwnerScope) {
    const profile = await this.prisma.serverProfile.findFirst({
      where: { id, userId: scope.userId, orgId: scope.orgId },
    });

    if (!profile) {
      throw new NotFoundException(`Server profile with ID ${id} not found`);
    }

    return this.toResponse(profile, await this.storedSecrets(scope.userId, profile.id));
  }

  /**
   * Create a new server profile
   */
  async create(scope: OwnerScope, dto: CreateServerProfileDto) {
    const data: any = {
      userId: scope.userId,
      orgId: scope.orgId,
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

    await this.audit('server_profile.create', scope, profile);
    this.logger.log(`Server profile "${dto.name}" created by user ${scope.userId}`);

    return this.toResponse(profile, await this.storedSecrets(scope.userId, profile.id));
  }

  /**
   * Update an existing server profile
   */
  async update(id: string, scope: OwnerScope, dto: UpdateServerProfileDto) {
    // Verify ownership
    const existing = await this.prisma.serverProfile.findFirst({
      where: { id, userId: scope.userId, orgId: scope.orgId },
    });

    if (!existing) {
      throw new NotFoundException(`Server profile with ID ${id} not found`);
    }

    const data: any = {};

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
      await this.writeSecret(scope.userId, id, 'password', dto.password);
    }
    if (dto.privateKey !== undefined) {
      await this.writeSecret(scope.userId, id, 'private_key', dto.privateKey);
    }
    if (dto.passphrase !== undefined) {
      await this.writeSecret(scope.userId, id, 'passphrase', dto.passphrase);
    }

    const profile = await this.prisma.serverProfile.update({
      where: { id },
      data,
    });

    await this.audit('server_profile.update', scope, profile, endpointChanged ? { hostKeyReset: true } : {});
    this.logger.log(`Server profile "${profile.name}" updated by user ${scope.userId}`);

    return this.toResponse(profile, await this.storedSecrets(scope.userId, profile.id));
  }

  /**
   * Delete a server profile with owner check
   */
  async remove(id: string, scope: OwnerScope) {
    const existing = await this.prisma.serverProfile.findFirst({
      where: { id, userId: scope.userId, orgId: scope.orgId },
    });

    if (!existing) {
      throw new NotFoundException(`Server profile with ID ${id} not found`);
    }

    await this.prisma.serverProfile.delete({ where: { id } });
    await this.removeSecrets(scope.userId, id);

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
  async testConnection(id: string, scope: OwnerScope): Promise<TestConnectionResult> {
    const profile = await this.getDecryptedProfile(id, scope);

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
  async scanHostKey(id: string, scope: OwnerScope): Promise<HostKeyScanResponse> {
    const profile = await this.findOwned(id, scope);
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
  async trustHostKey(id: string, scope: OwnerScope, dto: TrustHostKeyDto) {
    const profile = await this.findOwned(id, scope);

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
      where: { id, userId: scope.userId, orgId: scope.orgId },
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
    } else {
      await this.audit('server_profile.host_key_trusted', scope, profile, {
        fingerprint: presented.fingerprint,
        algorithm: presented.algorithm,
      });
    }
    this.logger.log(`Host key ${replacing ? 'replaced' : 'trusted'} for profile ${id} by user ${scope.userId}`);

    // The key is trusted now, so the probe can connect; best effort, never fails the trust.
    try {
      await this.factsService.probe(await this.getDecryptedProfile(id, scope));
    } catch (error) {
      this.logger.warn(`Facts probe after trust failed for profile ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return this.findOne(id, scope);
  }

  /** Forgets the trusted key (and the facts probed through it); the next connect prompts again. */
  async forgetHostKey(id: string, scope: OwnerScope) {
    const profile = await this.findOwned(id, scope);
    await this.prisma.serverProfile.updateMany({
      where: { id, userId: scope.userId, orgId: scope.orgId },
      data: HOST_KEY_RESET,
    });
    await this.audit('server_profile.host_key_forgotten', scope, profile, {
      fingerprint: profile.fingerprint ?? null,
    });
    return this.findOne(id, scope);
  }

  /** Forces a facts probe. Rejects with the host-key refusal when the key is not trusted. */
  async refreshFacts(id: string, scope: OwnerScope): Promise<FactsResponse> {
    const profile = await this.getDecryptedProfile(id, scope);
    const facts = await this.factsService.probe(profile);
    return { facts, factsProbedAt: new Date() };
  }

  /**
   * The server's facts: the cached ones while they are younger than `maxAgeMs`, else a fresh
   * probe. A failing probe falls back to the cached facts (or null); it never throws.
   */
  async getFacts(id: string, scope: OwnerScope, options: { maxAgeMs?: number } = {}): Promise<ServerFacts | null> {
    const maxAgeMs = options.maxAgeMs ?? FACTS_MAX_AGE_MS;
    const row = await this.findOwned(id, scope);
    const cached = readStoredFacts(row.facts);
    if (cached && row.factsProbedAt && Date.now() - row.factsProbedAt.getTime() < maxAgeMs) return cached;
    try {
      return await this.factsService.probe(await this.getDecryptedProfile(id, scope));
    } catch (error) {
      this.logger.warn(`Facts probe failed for profile ${id}: ${error instanceof Error ? error.message : String(error)}`);
      return cached;
    }
  }

  private async findOwned(id: string, scope: OwnerScope) {
    const profile = await this.prisma.serverProfile.findFirst({
      where: { id, userId: scope.userId, orgId: scope.orgId },
    });
    if (!profile) {
      throw new NotFoundException(`Server profile with ID ${id} not found`);
    }
    return profile;
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
   * Get a profile with decrypted credentials (for internal use by terminal module)
   */
  async getDecryptedProfile(id: string, scope: OwnerScope): Promise<DecryptedProfile> {
    const profile = await this.prisma.serverProfile.findFirst({
      where: { id, userId: scope.userId, orgId: scope.orgId },
    });

    if (!profile) {
      throw new NotFoundException(`Server profile with ID ${id} not found`);
    }

    // Server-side only, at the moment of connect: the plaintext reaches the SSH
    // client and nothing else (no log, response, span or job payload).
    const secret = (field: SshSecretField) =>
      this.credentials.getSecret(
        profile.userId,
        SSH_CREDENTIAL_PURPOSE,
        sshCredentialName(profile.id, field),
      );

    return {
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
  }

  /**
   * Transform a profile for API response: the `has*` flags say which secrets the
   * credential store holds; no secret, hint or ciphertext is ever returned.
   */
  private toResponse(profile: any, stored: StoredSecrets) {
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
      hasPassword: stored.has('password'),
      hasPrivateKey: stored.has('private_key'),
      hasPassphrase: stored.has('passphrase'),
      fingerprint: profile.fingerprint ?? null,
      hostKeyAlgorithm: profile.hostKeyAlgorithm ?? null,
      hostKeyTrustedAt: profile.hostKeyTrustedAt ?? null,
      facts: readStoredFacts(profile.facts),
      factsProbedAt: profile.factsProbedAt ?? null,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
