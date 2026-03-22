import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SessionQueryDto } from './dto/session-query.dto';
import { randomUUID } from 'crypto';

const SERVER_PROFILE_SELECT = {
  name: true,
  hostname: true,
  port: true,
  username: true,
  color: true,
};

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List terminal sessions for a user with pagination and status filter
   */
  async findAll(userId: string, query: SessionQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const status = query.status ?? 'all';
    const skip = (page - 1) * pageSize;

    const where: any = { userId };

    if (status !== 'all') {
      where.status = status;
    }

    const [items, total] = await Promise.all([
      this.prisma.terminalSession.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
        include: {
          serverProfile: {
            select: SERVER_PROFILE_SELECT,
          },
        },
      }),
      this.prisma.terminalSession.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toResponse(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get a single terminal session by ID with owner check
   */
  async findOne(id: string, userId: string) {
    const session = await this.prisma.terminalSession.findFirst({
      where: { id, userId },
      include: {
        serverProfile: {
          select: SERVER_PROFILE_SELECT,
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Terminal session with ID ${id} not found`);
    }

    return this.toResponse(session);
  }

  /**
   * Create a new terminal session
   */
  async create(userId: string, dto: CreateSessionDto) {
    // Verify server profile ownership
    const serverProfile = await this.prisma.serverProfile.findFirst({
      where: { id: dto.serverProfileId, userId },
    });

    if (!serverProfile) {
      throw new NotFoundException(`Server profile with ID ${dto.serverProfileId} not found`);
    }

    // Generate tmux session ID
    const sessionUuid = randomUUID();
    const tmuxSessionId = `sk-${sessionUuid.substring(0, 8)}`;

    // Auto-generate name from server profile if not provided
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const defaultName = `${serverProfile.name}-${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const name = dto.name || defaultName;

    const session = await this.prisma.terminalSession.create({
      data: {
        userId,
        serverProfileId: dto.serverProfileId,
        name,
        tmuxSessionId,
        status: 'active',
        cols: 80,
        rows: 24,
        lastActivityAt: now,
      },
      include: {
        serverProfile: {
          select: SERVER_PROFILE_SELECT,
        },
      },
    });

    this.logger.log(`Terminal session "${name}" created by user ${userId}`);

    return this.toResponse(session);
  }

  /**
   * Update session name
   */
  async update(id: string, userId: string, dto: UpdateSessionDto) {
    const existing = await this.prisma.terminalSession.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException(`Terminal session with ID ${id} not found`);
    }

    const session = await this.prisma.terminalSession.update({
      where: { id },
      data: { name: dto.name },
      include: {
        serverProfile: {
          select: SERVER_PROFILE_SELECT,
        },
      },
    });

    this.logger.log(`Terminal session "${session.name}" updated by user ${userId}`);

    return this.toResponse(session);
  }

  /**
   * Terminate a session
   */
  async terminate(id: string, userId: string) {
    const existing = await this.prisma.terminalSession.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException(`Terminal session with ID ${id} not found`);
    }

    const session = await this.prisma.terminalSession.update({
      where: { id },
      data: {
        status: 'terminated',
        terminatedAt: new Date(),
      },
      include: {
        serverProfile: {
          select: SERVER_PROFILE_SELECT,
        },
      },
    });

    this.logger.log(`Terminal session "${session.name}" terminated by user ${userId}`);

    return this.toResponse(session);
  }

  /**
   * Update last activity timestamp
   */
  async updateActivity(id: string): Promise<void> {
    await this.prisma.terminalSession.update({
      where: { id },
      data: { lastActivityAt: new Date() },
    });
  }

  /**
   * Update session status
   */
  async updateStatus(id: string, status: 'active' | 'detached' | 'terminated'): Promise<void> {
    const data: any = { status };
    if (status === 'terminated') {
      data.terminatedAt = new Date();
    }
    await this.prisma.terminalSession.update({ where: { id }, data });
  }

  /**
   * Get active or detached sessions for a user
   */
  async getActiveSessions(userId: string) {
    const sessions = await this.prisma.terminalSession.findMany({
      where: {
        userId,
        status: { in: ['active', 'detached'] },
      },
      orderBy: { lastActivityAt: 'desc' },
      include: {
        serverProfile: {
          select: SERVER_PROFILE_SELECT,
        },
      },
    });

    return sessions.map((session) => this.toResponse(session));
  }

  /**
   * Transform session for API response
   */
  private toResponse(session: any) {
    const { serverProfile, ...rest } = session;
    return {
      ...rest,
      serverProfile: serverProfile
        ? {
            name: serverProfile.name,
            hostname: serverProfile.hostname,
            port: serverProfile.port,
            username: serverProfile.username,
            color: serverProfile.color,
          }
        : null,
    };
  }
}
