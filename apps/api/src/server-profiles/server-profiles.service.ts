import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AUDIT_SINK, type AuditSink } from '@marinoscar/platform-api/core';
import { UserCredentialsService } from '@marinoscar/platform-api/credentials';
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
import { Client } from 'ssh2';

/** Which secret fields of a profile are stored, for the `has*` flags of a response. */
type StoredSecrets = ReadonlySet<SshSecretField>;

@Injectable()
export class ServerProfilesService {
  private readonly logger = new Logger(ServerProfilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
    private readonly credentials: UserCredentialsService,
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

    await this.audit('server_profile.update', scope, profile);
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
   * Test SSH connection using stored credentials
   */
  async testConnection(id: string, scope: OwnerScope): Promise<{ success: boolean; error?: string }> {
    const profile = await this.getDecryptedProfile(id, scope);

    const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      const conn = new Client();
      const timeout = setTimeout(() => {
        conn.end();
        resolve({ success: false, error: 'Connection timed out after 10 seconds' });
      }, 10000);

      conn.on('ready', () => {
        clearTimeout(timeout);
        conn.end();
        resolve({ success: true });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ success: false, error: err.message });
      });

      const connectConfig: any = {
        host: profile.hostname,
        port: profile.port,
        username: profile.username,
        readyTimeout: 10000,
      };

      if (profile.authMethod === 'password' && profile.password) {
        connectConfig.password = profile.password;
      } else if (profile.authMethod === 'key' && profile.privateKey) {
        connectConfig.privateKey = profile.privateKey;
        if (profile.passphrase) {
          connectConfig.passphrase = profile.passphrase;
        }
      } else if (profile.authMethod === 'agent') {
        connectConfig.agent = process.env.SSH_AUTH_SOCK;
      }

      conn.connect(connectConfig);
    });

    await this.audit('server_profile.test', scope, profile, { success: result.success });
    return result;
  }

  /**
   * Get a profile with decrypted credentials (for internal use by terminal module)
   */
  async getDecryptedProfile(id: string, scope: OwnerScope) {
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
      name: profile.name,
      hostname: profile.hostname,
      port: profile.port,
      username: profile.username,
      authMethod: profile.authMethod,
      tags: profile.tags,
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
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
