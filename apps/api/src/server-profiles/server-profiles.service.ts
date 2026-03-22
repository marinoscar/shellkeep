import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServerProfileDto } from './dto/create-server-profile.dto';
import { UpdateServerProfileDto } from './dto/update-server-profile.dto';
import { ServerProfilesQueryDto } from './dto/server-profiles-query.dto';
import { encrypt, decrypt, getEncryptionKey } from '../common/utils/encryption.util';
import { Client } from 'ssh2';

@Injectable()
export class ServerProfilesService {
  private readonly logger = new Logger(ServerProfilesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List server profiles for a user with pagination and search
   */
  async findAll(userId: string, query: ServerProfilesQueryDto) {
    const { page, pageSize, search } = query;
    const skip = (page - 1) * pageSize;

    const where: any = { userId };

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

    return {
      data: items.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Get a single server profile by ID with owner check
   */
  async findOne(id: string, userId: string) {
    const profile = await this.prisma.serverProfile.findFirst({
      where: { id, userId },
    });

    if (!profile) {
      throw new NotFoundException(`Server profile with ID ${id} not found`);
    }

    return this.toResponse(profile);
  }

  /**
   * Create a new server profile
   */
  async create(userId: string, dto: CreateServerProfileDto) {
    const key = getEncryptionKey();

    const data: any = {
      userId,
      name: dto.name,
      hostname: dto.hostname,
      port: dto.port,
      username: dto.username,
      authMethod: dto.authMethod,
      tags: dto.tags || [],
    };

    if (dto.password) {
      data.encryptedPassword = encrypt(dto.password, key);
    }
    if (dto.privateKey) {
      data.encryptedPrivateKey = encrypt(dto.privateKey, key);
    }
    if (dto.passphrase) {
      data.encryptedPassphrase = encrypt(dto.passphrase, key);
    }

    const profile = await this.prisma.serverProfile.create({ data });

    this.logger.log(`Server profile "${dto.name}" created by user ${userId}`);

    return this.toResponse(profile);
  }

  /**
   * Update an existing server profile
   */
  async update(id: string, userId: string, dto: UpdateServerProfileDto) {
    // Verify ownership
    const existing = await this.prisma.serverProfile.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException(`Server profile with ID ${id} not found`);
    }

    const key = getEncryptionKey();

    const data: any = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.hostname !== undefined) data.hostname = dto.hostname;
    if (dto.port !== undefined) data.port = dto.port;
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.authMethod !== undefined) data.authMethod = dto.authMethod;
    if (dto.tags !== undefined) data.tags = dto.tags;

    if (dto.password !== undefined) {
      data.encryptedPassword = dto.password ? encrypt(dto.password, key) : null;
    }
    if (dto.privateKey !== undefined) {
      data.encryptedPrivateKey = dto.privateKey ? encrypt(dto.privateKey, key) : null;
    }
    if (dto.passphrase !== undefined) {
      data.encryptedPassphrase = dto.passphrase ? encrypt(dto.passphrase, key) : null;
    }

    const profile = await this.prisma.serverProfile.update({
      where: { id },
      data,
    });

    this.logger.log(`Server profile "${profile.name}" updated by user ${userId}`);

    return this.toResponse(profile);
  }

  /**
   * Delete a server profile with owner check
   */
  async remove(id: string, userId: string) {
    const existing = await this.prisma.serverProfile.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException(`Server profile with ID ${id} not found`);
    }

    await this.prisma.serverProfile.delete({ where: { id } });

    this.logger.log(`Server profile "${existing.name}" deleted by user ${userId}`);
  }

  /**
   * Test SSH connection using stored credentials
   */
  async testConnection(id: string, userId: string): Promise<{ success: boolean; error?: string }> {
    const profile = await this.getDecryptedProfile(id, userId);

    return new Promise((resolve) => {
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
  }

  /**
   * Get a profile with decrypted credentials (for internal use by terminal module)
   */
  async getDecryptedProfile(id: string, userId: string) {
    const profile = await this.prisma.serverProfile.findFirst({
      where: { id, userId },
    });

    if (!profile) {
      throw new NotFoundException(`Server profile with ID ${id} not found`);
    }

    const key = getEncryptionKey();

    return {
      id: profile.id,
      userId: profile.userId,
      name: profile.name,
      hostname: profile.hostname,
      port: profile.port,
      username: profile.username,
      authMethod: profile.authMethod,
      tags: profile.tags,
      password: profile.encryptedPassword ? decrypt(profile.encryptedPassword, key) : null,
      privateKey: profile.encryptedPrivateKey ? decrypt(profile.encryptedPrivateKey, key) : null,
      passphrase: profile.encryptedPassphrase ? decrypt(profile.encryptedPassphrase, key) : null,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  /**
   * Transform a profile for API response, stripping encrypted fields
   */
  private toResponse(profile: any) {
    return {
      id: profile.id,
      userId: profile.userId,
      name: profile.name,
      hostname: profile.hostname,
      port: profile.port,
      username: profile.username,
      authMethod: profile.authMethod,
      tags: profile.tags,
      hasPassword: !!profile.encryptedPassword,
      hasPrivateKey: !!profile.encryptedPrivateKey,
      hasPassphrase: !!profile.encryptedPassphrase,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
