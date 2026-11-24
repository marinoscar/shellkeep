import {
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AUDIT_SINK, type AuditSink, type Principal } from '@marinoscar/platform-api/core';
import { AccessPolicy, PrincipalGroupsProvider } from '@marinoscar/platform-api/sharing';
import { PrismaService } from '../prisma/prisma.service';
import type { OwnerScope } from '../common/types/owner-scope';
import { recordAudit } from '../common/audit/record-audit';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SessionQueryDto } from './dto/session-query.dto';
import { SessionManagerService } from './session-manager.service';
import { TerminalWebhooksService } from './webhooks/terminal-webhooks.service';
import { SERVER_PROFILE_RESOURCE } from '../app-registrations/sharing';
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

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
    private readonly webhooks: TerminalWebhooksService,
    private readonly access: AccessPolicy,
    private readonly principalGroups: PrincipalGroupsProvider,
    // Circular with SessionsService (the manager updates activity and status): forwardRef on both sides.
    @Inject(forwardRef(() => SessionManagerService))
    private readonly sessionManager: SessionManagerService,
  ) {}

  /**
   * Closes the live SSH stream (and tells attached WebSocket clients `session_ended`) for each id, after the
   * row update committed. Never throws: a failure to close is logged and the row stays terminated. The remote
   * tmux session is not killed.
   */
  private async closeLive(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      try {
        await this.sessionManager.terminateSession(id);
      } catch (err) {
        this.logger.error(
          `Failed to close live connection for terminated session ${id}: ${err instanceof Error ? err.message : 'error'}`,
        );
      }
    }
  }

  private audit(
    action: string,
    scope: OwnerScope,
    sessionId: string,
    meta: Record<string, string | number | boolean | null> = {},
  ): Promise<void> {
    return recordAudit(this.auditSink, this.logger, {
      action,
      actorUserId: scope.userId,
      targetType: 'terminal_session',
      targetId: sessionId,
      meta,
    });
  }

  /**
   * List terminal sessions for a user with pagination and status filter
   */
  async findAll(scope: OwnerScope, query: SessionQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const status = query.status ?? 'all';
    const skip = (page - 1) * pageSize;

    const where: any = { userId: scope.userId, orgId: scope.orgId };

    if (status !== 'all') {
      where.status = status;
    }
    if (query.serverProfileId) {
      where.serverProfileId = query.serverProfileId;
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
      items: items.map((item: any) => this.toResponse(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get a single terminal session by ID with owner check
   */
  async findOne(id: string, scope: OwnerScope) {
    const session = await this.prisma.terminalSession.findFirst({
      where: { id, userId: scope.userId, orgId: scope.orgId },
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
   * Create a new terminal session. The caller must be allowed to `connect` to the server profile:
   * their own, or one shared with them (or with a group of theirs) as `operator` or better. Any other
   * profile answers 404. The session is the caller's own: each person who connects to a shared server
   * opens their own tmux session, and no credential is read here.
   */
  async create(principal: Principal, dto: CreateSessionDto) {
    if (!principal.activeOrgId) throw new ForbiddenException('No active organization');
    const scope: OwnerScope = { userId: principal.userId, orgId: principal.activeOrgId };
    // The caller's groups are read fresh: the principal the guard built may be a few seconds old.
    const me = await this.principalGroups.enrich(principal);
    await this.access.require(me, 'connect', { type: SERVER_PROFILE_RESOURCE, id: dto.serverProfileId });
    const serverProfile = await this.prisma.serverProfile.findFirst({
      where: { id: dto.serverProfileId, orgId: scope.orgId },
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
        userId: scope.userId,
        orgId: scope.orgId,
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

    await this.audit('terminal_session.create', scope, session.id, {
      serverProfileId: dto.serverProfileId,
    });
    this.logger.log(`Terminal session "${name}" created by user ${scope.userId}`);
    // After the row is written, outside any transaction (#54). Never throws.
    await this.webhooks.sessionCreated(scope, session, serverProfile.name);

    return this.toResponse(session);
  }

  /**
   * Update session name
   */
  async update(id: string, scope: OwnerScope, dto: UpdateSessionDto) {
    const existing = await this.prisma.terminalSession.findFirst({
      where: { id, userId: scope.userId, orgId: scope.orgId },
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

    this.logger.log(`Terminal session "${session.name}" updated by user ${scope.userId}`);

    return this.toResponse(session);
  }

  /**
   * Terminate a session
   */
  async terminate(id: string, scope: OwnerScope) {
    const existing = await this.prisma.terminalSession.findFirst({
      where: { id, userId: scope.userId, orgId: scope.orgId },
    });

    if (!existing) {
      throw new NotFoundException(`Terminal session with ID ${id} not found`);
    }

    const terminatedAt = new Date();
    const session = await this.prisma.terminalSession.update({
      where: { id },
      data: {
        status: 'terminated',
        terminatedAt,
      },
      include: {
        serverProfile: {
          select: SERVER_PROFILE_SELECT,
        },
      },
    });

    await this.audit('terminal_session.terminate', scope, session.id);
    this.logger.log(`Terminal session "${session.name}" terminated by user ${scope.userId}`);
    await this.webhooks.sessionTerminated(scope, session, 'user', terminatedAt);
    await this.closeLive([session.id]);

    return this.toResponse(session);
  }

  /**
   * Batch terminate multiple sessions by ID for a user
   */
  async batchTerminate(ids: string[], scope: OwnerScope): Promise<{ terminated: number }> {
    const where = {
      id: { in: ids },
      userId: scope.userId,
      orgId: scope.orgId,
      status: { not: 'terminated' as const },
    };
    // Read the ids first so each terminated session gets its own audit row (and webhook event).
    const targets = (await this.prisma.terminalSession.findMany({
      where,
      select: { id: true, serverProfileId: true },
    })) as Array<{ id: string; serverProfileId: string }>;

    const terminatedAt = new Date();
    const result = await this.prisma.terminalSession.updateMany({
      where,
      data: {
        status: 'terminated',
        terminatedAt,
      },
    });

    for (const target of targets) {
      await this.audit('terminal_session.terminate', scope, target.id, { batch: true });
      // After the update committed, outside any transaction (#54). Never throws.
      await this.webhooks.sessionTerminated(scope, target, 'batch', terminatedAt);
    }

    await this.closeLive(targets.map((target) => target.id));

    this.logger.log(`Batch terminated ${result.count} sessions for user ${scope.userId}`);

    return { terminated: result.count };
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
  async getActiveSessions(scope: OwnerScope) {
    const sessions = await this.prisma.terminalSession.findMany({
      where: {
        userId: scope.userId,
        orgId: scope.orgId,
        status: { in: ['active', 'detached'] },
      },
      orderBy: { lastActivityAt: 'desc' },
      include: {
        serverProfile: {
          select: SERVER_PROFILE_SELECT,
        },
      },
    });

    return sessions.map((session: any) => this.toResponse(session));
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
